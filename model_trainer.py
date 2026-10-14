#!/usr/bin/env python3
"""
EcoPulse — Machine Learning Anomaly Detection Model Trainer

Trains an unsupervised IsolationForest model on representative normal water-usage data.
Extracts multi-dimensional telemetry features and persists the model for real-time inference.
"""

import os
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, roc_auc_score

FEATURE_COLUMNS = [
    "flow_rate",
    "continuous_duration_sec",
    "recent_consumption_liters",
    "time_of_day_hour",
    "flow_diff_from_baseline",
    "pressure_delta"
]

MODEL_PATH = "ecopulse_model.joblib"
DATASET_PATH = "synthetic_water_flow_data.csv"

def train_isolation_forest(data_path=DATASET_PATH, output_model_path=MODEL_PATH):
    """
    Trains IsolationForest on the normal subset of the synthetic dataset.
    """
    if not os.path.exists(data_path):
        from dataset_generator import generate_synthetic_dataset
        print(f"Dataset '{data_path}' not found. Generating synthetic dataset...")
        generate_synthetic_dataset(output_csv=data_path)

    df = pd.read_csv(data_path)
    print(f"Loaded dataset from '{data_path}' with {len(df)} records.")

    # In unsupervised anomaly detection, we train primarily on normal baseline usage
    train_normal_df = df[df["is_anomaly_label"] == 0]
    X_train = train_normal_df[FEATURE_COLUMNS]

    print(f"Training IsolationForest on {len(X_train)} normal usage samples across 6 features:")
    for feat in FEATURE_COLUMNS:
        print(f"  - {feat}")

    # IsolationForest: contamination set to expected outlier proportion (~0.04)
    model = IsolationForest(
        n_estimators=120,
        max_samples="auto",
        contamination=0.04,
        random_state=42,
        n_jobs=-1
    )

    model.fit(X_train)

    # Evaluate on the entire dataset (including simulated leaks)
    X_all = df[FEATURE_COLUMNS]
    y_true = df["is_anomaly_label"].values  # 0 = normal, 1 = anomaly

    # IsolationForest returns -1 for outlier/anomaly, 1 for inlier/normal
    preds_raw = model.predict(X_all)
    y_pred = np.where(preds_raw == -1, 1, 0)

    # Decision function: lower values mean more anomalous
    scores_raw = model.decision_function(X_all)
    # Normalized anomaly score: invert and scale to [0.0, 1.0]
    min_s, max_s = scores_raw.min(), scores_raw.max()
    anomaly_scores = 1.0 - ((scores_raw - min_s) / (max_s - min_s + 1e-8))

    print("\n" + "=" * 50)
    print("IsolationForest Evaluation on Synthetic Benchmark:")
    print("=" * 50)
    print(classification_report(y_true, y_pred, target_names=["Normal", "Simulated Anomaly"]))
    try:
        auc = roc_auc_score(y_true, anomaly_scores)
        print(f"ROC-AUC Score: {auc:.4f}")
    except Exception as e:
        print(f"ROC-AUC: {e}")

    # Package model artifact with feature metadata
    artifact = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "min_decision_score": float(min_s),
        "max_decision_score": float(max_s),
        "training_samples": len(X_train),
        "algorithm": "IsolationForest",
        "contamination": 0.04,
        "dataset_notice": "Trained on synthetic residential water usage dataset. Calibrate with physical meter data before production deployment."
    }

    joblib.dump(artifact, output_model_path)
    print(f"\nModel artifact saved successfully to '{output_model_path}'.")
    return artifact

if __name__ == "__main__":
    train_isolation_forest()
