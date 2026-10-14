#!/usr/bin/env python3
"""
EcoPulse — Hybrid Anomaly & Leakage Detection Engine

Combines unsupervised machine learning (IsolationForest) with domain-specific
hydraulic rules to classify water-flow anomalies, suppress false alarms, and confirm leakages.
"""

import os
import joblib
import numpy as np
import pandas as pd

MODEL_PATH = "ecopulse_model.joblib"

ZONE_METADATA = {
    "kitchen": {
        "name": "Kitchen",
        "baseline_mean_flow": 2.8,
        "nominal_pressure": 3.20,
        "nominal_max": 6.5,
        "burst_threshold": 18.0,
        "max_high_flow_sec": 30,
        "max_low_flow_sec": 45,
        "active_hours": (6, 23)
    },
    "bathroom": {
        "name": "Bathroom",
        "baseline_mean_flow": 4.5,
        "nominal_pressure": 3.05,
        "nominal_max": 8.5,
        "burst_threshold": 16.0,
        "max_high_flow_sec": 45,
        "max_low_flow_sec": 35,
        "active_hours": (5, 24)
    },
    "garden": {
        "name": "Garden Irrigation",
        "baseline_mean_flow": 0.0,
        "nominal_pressure": 3.50,
        "nominal_max": 12.0,
        "burst_threshold": 22.0,
        "max_high_flow_sec": 60,
        "max_low_flow_sec": 60,
        "active_hours": (17, 19)
    },
    "main_supply": {
        "name": "Main Supply Line",
        "baseline_mean_flow": 7.3,
        "nominal_pressure": 3.65,
        "nominal_max": 22.0,
        "burst_threshold": 35.0,
        "max_high_flow_sec": 60,
        "max_low_flow_sec": 60,
        "active_hours": (0, 24)
    }
}

class HybridLeakageDetector:
    def __init__(self, model_path=MODEL_PATH):
        self.model_path = model_path
        self.model_bundle = None
        self.model = None
        self.feature_columns = []
        self.load_or_train_model()

    def load_or_train_model(self):
        """Loads trained IsolationForest bundle or trains a new one."""
        if not os.path.exists(self.model_path):
            from model_trainer import train_isolation_forest
            print(f"Model bundle '{self.model_path}' not found. Training model now...")
            self.model_bundle = train_isolation_forest(output_model_path=self.model_path)
        else:
            self.model_bundle = joblib.load(self.model_path)
        
        self.model = self.model_bundle["model"]
        self.feature_columns = self.model_bundle["feature_columns"]
        self.min_decision = self.model_bundle.get("min_decision_score", -0.35)
        self.max_decision = self.model_bundle.get("max_decision_score", 0.15)
        print(f"HybridLeakageDetector initialized with {self.model_bundle.get('algorithm', 'IsolationForest')}.")

    def evaluate_reading(self, reading_data):
        """
        Evaluates a water flow reading using IsolationForest ML + Domain Rules.
        
        reading_data keys:
            - zone (str): 'kitchen' | 'bathroom' | 'garden' | 'main_supply'
            - flow_rate (float): L/min
            - continuous_duration_sec (int, optional): duration in seconds
            - pressure_bar (float, optional): bar
            - time_of_day_hour (float, optional): 0-24
            - recent_consumption_liters (float, optional): Litres
        """
        zone = reading_data.get("zone") or "kitchen"
        if zone not in ZONE_METADATA:
            zone = "kitchen"
        prof = ZONE_METADATA[zone]

        def _safe_float(val, default):
            if val is None:
                return default
            try:
                return float(val)
            except (ValueError, TypeError):
                return default

        def _safe_int(val, default):
            if val is None:
                return default
            try:
                return int(val)
            except (ValueError, TypeError):
                return default

        flow_rate = max(0.0, _safe_float(reading_data.get("flow_rate"), 0.0))
        duration_sec = max(0, _safe_int(reading_data.get("continuous_duration_sec"), 0))
        hour = _safe_float(reading_data.get("time_of_day_hour"), 12.0)
        
        # Pressure handling: if missing or None, safely default to nominal pressure
        nominal_p = prof["nominal_pressure"]
        pressure = _safe_float(reading_data.get("pressure_bar"), nominal_p)
        pressure_delta = round(nominal_p - pressure, 2)

        # Baseline flow diff
        flow_diff_from_baseline = round(flow_rate - prof["baseline_mean_flow"], 2)

        # Recent consumption
        default_rc = max(0.0, flow_rate * (duration_sec / 60.0))
        recent_consumption = _safe_float(reading_data.get("recent_consumption_liters"), default_rc)

        # 1. Prepare Feature Vector for IsolationForest
        features = {
            "flow_rate": flow_rate,
            "continuous_duration_sec": duration_sec,
            "recent_consumption_liters": recent_consumption,
            "time_of_day_hour": hour,
            "flow_diff_from_baseline": flow_diff_from_baseline,
            "pressure_delta": pressure_delta
        }
        X = pd.DataFrame([features])[self.feature_columns]

        # 2. Run IsolationForest Inference
        raw_pred = self.model.predict(X)[0]       # -1 for anomaly, 1 for normal
        raw_score = self.model.decision_function(X)[0] # Lower is more anomalous

        # Normalize score to [0.0, 1.0]: 0.0 = highly normal, 1.0 = extreme outlier
        norm_score = round(float(np.clip(1.0 - ((raw_score - self.min_decision) / (self.max_decision - self.min_decision + 1e-8)), 0.0, 1.0)), 3)
        is_ml_outlier = bool(raw_pred == -1 or norm_score > 0.65)

        # 3. Rule-Based Verification (Ensemble to reduce false alarms)
        rule_name = None
        rule_severity = "normal"
        explanation = "Flow and pressure telemetry match normal residential profile."
        confirmed_leakage = False

        # Schedule check
        int_hour = int(hour)
        is_scheduled = prof["active_hours"][0] <= int_hour < prof["active_hours"][1]

        # Rule Check A: Catastrophic Flow Burst (> burst_threshold)
        if flow_rate >= prof["burst_threshold"]:
            rule_name = "Catastrophic Flow Burst"
            rule_severity = "critical"
            confirmed_leakage = True
            explanation = f"IsolationForest flagged outlier (Score: {norm_score}). Flow rate ({flow_rate} L/min) critically exceeds {prof['name']} burst limit of {prof['burst_threshold']} L/min."

        # Rule Check B: Sudden Pressure Drop Accompanied by Flow
        elif pressure_delta >= 0.75 and flow_rate >= 0.4:
            rule_name = "Sudden Pressure Drop & Rupture"
            rule_severity = "critical"
            confirmed_leakage = True
            explanation = f"IsolationForest flagged outlier (Score: {norm_score}). Hydraulic pressure dropped by {pressure_delta} bar with active flow ({flow_rate} L/min) indicating pipe puncture or decoupling."

        # Rule Check C: Continuous Low Flow Leak (Running Toilet / Cistern Trickle)
        elif 0.4 <= flow_rate <= 2.2 and duration_sec >= prof["max_low_flow_sec"]:
            rule_name = "Continuous Low-Flow Leak"
            rule_severity = "warning"
            confirmed_leakage = True
            explanation = f"IsolationForest flagged abnormal duration (Score: {norm_score}). Persistent trickle ({flow_rate} L/min) continued for {duration_sec}s in {prof['name']}. Matches running toilet or leaking fitting."

        # Rule Check D: Off-Hours Unscheduled Usage
        elif not is_scheduled and flow_rate >= 0.4 and duration_sec >= 15:
            rule_name = "Off-Hours Unscheduled Flow"
            rule_severity = "warning" if flow_rate <= prof["nominal_max"] else "critical"
            confirmed_leakage = True
            explanation = f"IsolationForest flagged temporal anomaly (Score: {norm_score}). Unscheduled flow of {flow_rate} L/min in {prof['name']} at {int_hour}:00 outside permitted operating schedule."

        # Rule Check E: Transient High Demand (False Alarm Suppression!)
        elif prof["nominal_max"] < flow_rate < prof["burst_threshold"]:
            if duration_sec <= prof["max_high_flow_sec"]:
                # High flow within permissible duration!
                # Even if ML flagged an outlier, domain rules classify it as NORMAL!
                rule_name = "Transient Elevated Usage"
                rule_severity = "normal"
                confirmed_leakage = False
                explanation = f"Flow of {flow_rate} L/min is within allowed duration window ({duration_sec}s / {prof['max_high_flow_sec']}s). High residential demand accommodated (No leak)."
            else:
                rule_name = "Sustained Elevated Flow Anomaly"
                rule_severity = "warning"
                confirmed_leakage = True
                explanation = f"IsolationForest flagged outlier (Score: {norm_score}). Elevated flow ({flow_rate} L/min) exceeded duration limit of {prof['max_high_flow_sec']}s in {prof['name']}."

        # Overall Status Classification
        if confirmed_leakage:
            status = "CRITICAL_LEAK" if rule_severity == "critical" else "CONFIRMED_LEAK"
        elif is_ml_outlier:
            status = "INVESTIGATING_ANOMALY" # ML flagged anomaly, but not yet confirmed by rules
            explanation = f"IsolationForest detected statistical outlier (Score: {norm_score}), currently within permissible baseline duration. Under observation."
        else:
            status = "NORMAL"

        return {
            "zone": zone,
            "zone_name": prof["name"],
            "flow_rate": flow_rate,
            "pressure_bar": pressure,
            "continuous_duration_sec": duration_sec,
            "ml_prediction": {
                "algorithm": "IsolationForest",
                "is_outlier": is_ml_outlier,
                "anomaly_score": norm_score,
                "raw_decision_score": round(float(raw_score), 4),
                "classification": "Outlier Detected" if is_ml_outlier else "Normal"
            },
            "rule_verification": {
                "rule_name": rule_name,
                "severity": rule_severity
            },
            "confirmed_leakage": confirmed_leakage,
            "status": status,
            "explanation": explanation,
            "data_source": "simulated"
        }
