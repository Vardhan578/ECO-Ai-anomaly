#!/usr/bin/env python3
"""
EcoPulse — Synthetic Water Flow Dataset Generator

Generates a reproducible synthetic dataset containing realistic normal residential 
water usage profiles alongside simulated anomaly and leakage scenarios.

DATASET IDENTIFICATION & CALIBRATION NOTICE:
This dataset is synthetically generated based on standard municipal residential 
consumption benchmarks, diurnal schedule profiles, and typical fixture flow rates. 
It is intended for algorithmic training, evaluation, and hackathon demonstration. 
No claim of real-world meter accuracy is made until calibrated against physically labelled 
telemetry from physical ultrasonic or pulse-counter smart water meters.
"""

import os
import random
import numpy as np
import pandas as pd

# Fix random seeds for reproducible data generation
RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)

ZONE_PROFILES = {
    "kitchen": {
        "nominal_pressure": 3.20,
        "baseline_mean_flow": 2.8,
        "max_normal_flow": 6.5,
        "active_hours": (6, 23)
    },
    "bathroom": {
        "nominal_pressure": 3.05,
        "baseline_mean_flow": 4.5,
        "max_normal_flow": 8.5,
        "active_hours": (5, 24)
    },
    "garden": {
        "nominal_pressure": 3.50,
        "baseline_mean_flow": 0.0,
        "max_normal_flow": 12.0,
        "active_hours": (17, 19) # Scheduled irrigation only
    },
    "main_supply": {
        "nominal_pressure": 3.65,
        "baseline_mean_flow": 7.3,
        "max_normal_flow": 22.0,
        "active_hours": (0, 24)
    }
}

def generate_synthetic_dataset(num_samples=4000, output_csv="synthetic_water_flow_data.csv"):
    """
    Generates a structured dataset with normal usage and simulated leak scenarios.
    """
    records = []
    
    # Proportion: 88% Normal, 12% Anomalous/Leakage
    num_normal = int(num_samples * 0.88)
    num_anomaly = num_samples - num_normal

    # --- 1. Generate Normal Residential Telemetry ---
    for i in range(num_normal):
        zone = random.choice(["kitchen", "bathroom", "garden", "main_supply"])
        prof = ZONE_PROFILES[zone]

        # Time of day (0.00 to 23.99)
        hour = random.uniform(0.0, 24.0)
        int_hour = int(hour)

        # Diurnal usage weight
        if 6 <= int_hour <= 9:      # Morning peak
            activity_prob = 0.75
        elif 10 <= int_hour <= 17:  # Midday regular
            activity_prob = 0.40
        elif 18 <= int_hour <= 21:  # Evening peak
            activity_prob = 0.70
        else:                       # Night quiet window
            activity_prob = 0.08

        # Determine flow and duration
        is_active = random.random() < activity_prob
        
        # Garden is only normally active during scheduled hours
        if zone == "garden":
            is_active = (17 <= int_hour < 19) and (random.random() < 0.6)

        if is_active:
            # Normal in-use flow
            if zone == "kitchen":
                # Dishwashing / faucet: 2.0 to 6.0 L/min, duration 20s to 420s
                flow_rate = round(random.uniform(1.8, prof["max_normal_flow"]), 2)
                duration_sec = int(random.uniform(15, 360))
            elif zone == "bathroom":
                # Shower or flush: 3.5 to 8.2 L/min, duration 30s to 600s
                flow_rate = round(random.uniform(2.5, prof["max_normal_flow"]), 2)
                duration_sec = int(random.uniform(25, 600))
            elif zone == "garden":
                # Sprinklers: 8.0 to 12.0 L/min, duration 10 min to 30 min
                flow_rate = round(random.uniform(7.5, prof["max_normal_flow"]), 2)
                duration_sec = int(random.uniform(300, 1500))
            else: # main_supply
                flow_rate = round(random.uniform(4.0, 16.0), 2)
                duration_sec = int(random.uniform(30, 900))
        else:
            # Idle state
            flow_rate = 0.0
            duration_sec = 0

        # Feature: Difference from baseline
        flow_diff_from_baseline = round(flow_rate - prof["baseline_mean_flow"], 2)

        # Feature: Pressure & pressure delta (normal minor hydraulic fluctuations +/- 0.15 bar)
        pressure_jitter = random.gauss(0, 0.08) - (flow_rate * 0.015)
        current_pressure = round(max(1.5, prof["nominal_pressure"] + pressure_jitter), 2)
        pressure_delta = round(prof["nominal_pressure"] - current_pressure, 2)

        # Feature: Recent consumption (rolling 30-min approximate in Litres)
        recent_consumption_liters = round(max(0.0, (flow_rate * (duration_sec / 60.0)) + random.uniform(0, 15)), 2)

        records.append({
            "zone": zone,
            "flow_rate": flow_rate,
            "continuous_duration_sec": duration_sec,
            "recent_consumption_liters": recent_consumption_liters,
            "time_of_day_hour": round(hour, 2),
            "flow_diff_from_baseline": flow_diff_from_baseline,
            "pressure_bar": current_pressure,
            "pressure_delta": pressure_delta,
            "is_anomaly_label": 0,
            "scenario_type": "normal_residential"
        })

    # --- 2. Generate Simulated Anomaly / Leakage Scenarios ---
    anomaly_scenarios = [
        "continuous_low_flow_toilet",   # Running toilet flapper
        "catastrophic_pipe_burst",      # Massive fracture / rupture
        "sudden_pressure_drop_leak",    # Joint decoupling with pressure loss
        "unscheduled_off_hours_flow",   # Off-hours midnight irrigation or open faucet
        "slow_pinhole_drip"             # Persistent micro-trickle
    ]

    for i in range(num_anomaly):
        scenario = random.choice(anomaly_scenarios)

        if scenario == "continuous_low_flow_toilet":
            zone = "bathroom"
            prof = ZONE_PROFILES[zone]
            # Persistent low flow of 1.2 to 2.4 L/min lasting for 1,800 to 14,400 seconds (30m to 4h)
            flow_rate = round(random.uniform(1.1, 2.6), 2)
            duration_sec = int(random.uniform(1800, 14400))
            hour = round(random.uniform(0.0, 24.0), 2)
            current_pressure = round(prof["nominal_pressure"] - random.uniform(0.1, 0.25), 2)

        elif scenario == "catastrophic_pipe_burst":
            zone = random.choice(["kitchen", "garden", "main_supply"])
            prof = ZONE_PROFILES[zone]
            # Massive flow exceeding burst ceiling
            flow_rate = round(random.uniform(prof["max_normal_flow"] + 6.0, 38.0), 2)
            duration_sec = int(random.uniform(120, 3600))
            hour = round(random.uniform(0.0, 24.0), 2)
            # Pressure drops significantly under burst
            current_pressure = round(max(1.0, prof["nominal_pressure"] - random.uniform(0.9, 1.8)), 2)

        elif scenario == "sudden_pressure_drop_leak":
            zone = random.choice(["garden", "main_supply"])
            prof = ZONE_PROFILES[zone]
            flow_rate = round(random.uniform(12.0, 24.0), 2)
            duration_sec = int(random.uniform(60, 1800))
            hour = round(random.uniform(0.0, 24.0), 2)
            # Pressure collapse >= 0.8 bar
            current_pressure = round(prof["nominal_pressure"] - random.uniform(0.85, 1.60), 2)

        elif scenario == "unscheduled_off_hours_flow":
            zone = "garden"
            prof = ZONE_PROFILES[zone]
            # Flow active at 2:00 AM to 4:00 AM (inactive window)
            hour = round(random.uniform(1.0, 4.5), 2)
            flow_rate = round(random.uniform(5.0, 11.0), 2)
            duration_sec = int(random.uniform(1200, 7200))
            current_pressure = round(prof["nominal_pressure"] - random.uniform(0.1, 0.3), 2)

        else: # slow_pinhole_drip
            zone = random.choice(["kitchen", "bathroom"])
            prof = ZONE_PROFILES[zone]
            flow_rate = round(random.uniform(0.5, 0.95), 2)
            duration_sec = int(random.uniform(3600, 28800)) # Many hours
            hour = round(random.uniform(0.0, 24.0), 2)
            current_pressure = round(prof["nominal_pressure"] - random.uniform(0.05, 0.15), 2)

        pressure_delta = round(prof["nominal_pressure"] - current_pressure, 2)
        flow_diff_from_baseline = round(flow_rate - prof["baseline_mean_flow"], 2)
        recent_consumption_liters = round(max(5.0, (flow_rate * (min(duration_sec, 1800) / 60.0))), 2)

        records.append({
            "zone": zone,
            "flow_rate": flow_rate,
            "continuous_duration_sec": duration_sec,
            "recent_consumption_liters": recent_consumption_liters,
            "time_of_day_hour": hour,
            "flow_diff_from_baseline": flow_diff_from_baseline,
            "pressure_bar": current_pressure,
            "pressure_delta": pressure_delta,
            "is_anomaly_label": 1,
            "scenario_type": scenario
        })

    # Shuffle dataset
    random.shuffle(records)
    df = pd.DataFrame(records)

    # Save to CSV
    df.to_csv(output_csv, index=False)
    print(f"Generated synthetic dataset with {len(df)} records saved to '{output_csv}'.")
    print(f" - Normal usage records: {len(df[df['is_anomaly_label'] == 0])}")
    print(f" - Anomalous leak records: {len(df[df['is_anomaly_label'] == 1])}")
    return df

if __name__ == "__main__":
    generate_synthetic_dataset()
