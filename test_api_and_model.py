#!/usr/bin/env python3
"""
EcoPulse — Machine Learning & API Backend Test Suite

Tests:
1. Synthetic dataset generator
2. IsolationForest model training and inference
3. Hybrid rule-based correlation and false alarm suppression
4. Flask REST API endpoints (/api/health, /api/telemetry/reading, /api/telemetry/latest, /api/alerts/recent)
"""

import os
import sys
import unittest
import json

class TestEcoPulseMLAndAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Generate dataset and train model if not present
        from dataset_generator import generate_synthetic_dataset
        from model_trainer import train_isolation_forest
        
        if not os.path.exists("synthetic_water_flow_data.csv"):
            generate_synthetic_dataset(num_samples=1000, output_csv="synthetic_water_flow_data.csv")
        
        if not os.path.exists("ecopulse_model.joblib"):
            train_isolation_forest(data_path="synthetic_water_flow_data.csv", output_model_path="ecopulse_model.joblib")

        from hybrid_detector import HybridLeakageDetector
        cls.detector = HybridLeakageDetector(model_path="ecopulse_model.joblib")

        from server import app
        app.config["TESTING"] = True
        cls.client = app.test_client()

    def test_01_health_check_endpoint(self):
        """GET /api/health returns 200 and model disclosures."""
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("IsolationForest", data["model"])
        self.assertIn("training_data", data)
        self.assertIn("Synthetic", data["training_data"]["source"])
        print("  [PASS] Test 1: Health check endpoint returns 200 with model and synthetic disclosures.")

    def test_02_model_info_endpoint(self):
        """GET /api/model/info returns model parameters."""
        res = self.client.get("/api/model/info")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["algorithm"], "IsolationForest")
        self.assertIn("flow_rate", data["features"])
        print("  [PASS] Test 2: Model info endpoint returns features and IsolationForest metadata.")

    def test_03_normal_flow_prediction(self):
        """Normal residential flow is classified as Normal without confirmed leakage."""
        reading = {
            "zone": "kitchen",
            "flow_rate": 3.2,
            "continuous_duration_sec": 15,
            "pressure_bar": 3.20,
            "time_of_day_hour": 12.0
        }
        res = self.detector.evaluate_reading(reading)
        self.assertFalse(res["confirmed_leakage"])
        self.assertEqual(res["status"], "NORMAL")
        self.assertLess(res["ml_prediction"]["anomaly_score"], 0.65)
        print("  [PASS] Test 3: Normal reading (3.2 L/min) classified as Normal (Leak: False).")

    def test_04_catastrophic_burst_prediction(self):
        """Severe burst flow triggers ML outlier and confirmed critical leak."""
        reading = {
            "zone": "kitchen",
            "flow_rate": 26.5, # Critically above 18 burst limit
            "continuous_duration_sec": 60,
            "pressure_bar": 2.30,
            "time_of_day_hour": 14.0
        }
        res = self.detector.evaluate_reading(reading)
        self.assertTrue(res["confirmed_leakage"])
        self.assertEqual(res["status"], "CRITICAL_LEAK")
        self.assertEqual(res["rule_verification"]["severity"], "critical")
        print("  [PASS] Test 4: Catastrophic burst flow triggers ML outlier & Confirmed Critical Leak.")

    def test_05_continuous_low_flow_prediction(self):
        """Persistent low-flow (running toilet) triggers anomaly and confirmed leak."""
        reading = {
            "zone": "bathroom",
            "flow_rate": 1.6,
            "continuous_duration_sec": 180, # > 35s limit
            "pressure_bar": 3.00,
            "time_of_day_hour": 10.0
        }
        res = self.detector.evaluate_reading(reading)
        self.assertTrue(res["confirmed_leakage"])
        self.assertEqual(res["rule_verification"]["rule_name"], "Continuous Low-Flow Leak")
        print("  [PASS] Test 5: Running toilet trickle (>35s) triggers Confirmed Low-Flow Leak.")

    def test_06_transient_high_flow_false_alarm_suppression(self):
        """Temporary high flow within duration limit is NOT classified as a leak."""
        reading = {
            "zone": "kitchen",
            "flow_rate": 7.5, # Above 6.5 ceiling, but below 18 burst
            "continuous_duration_sec": 15, # < 30s allowed duration
            "pressure_bar": 3.15,
            "time_of_day_hour": 19.0
        }
        res = self.detector.evaluate_reading(reading)
        self.assertFalse(res["confirmed_leakage"])
        self.assertEqual(res["rule_verification"]["rule_name"], "Transient Elevated Usage")
        print("  [PASS] Test 6: High flow within permissible duration (<30s) suppresses false alarm.")

    def test_07_api_submit_reading_and_retrieve_latest(self):
        """POST /api/telemetry/reading and GET /api/telemetry/latest."""
        payload = {
            "zone": "garden",
            "flow_rate": 15.0,
            "continuous_duration_sec": 120,
            "pressure_bar": 2.10, # Sudden pressure drop
            "time_of_day_hour": 18.0
        }
        post_res = self.client.post("/api/telemetry/reading", 
                                    data=json.dumps(payload),
                                    content_type="application/json")
        self.assertEqual(post_res.status_code, 200)
        data = post_res.get_json()
        self.assertEqual(data["zone"], "garden")
        self.assertIn("ml_prediction", data)
        self.assertIn("anomaly_score", data["ml_prediction"])

        # Check /api/telemetry/latest
        get_res = self.client.get("/api/telemetry/latest")
        self.assertEqual(get_res.status_code, 200)
        latest_data = get_res.get_json()
        self.assertIn("garden", latest_data["zones"])
        self.assertEqual(latest_data["zones"]["garden"]["flow_rate"], 15.0)

        # Check /api/alerts/recent
        alerts_res = self.client.get("/api/alerts/recent")
        self.assertEqual(alerts_res.status_code, 200)
        alerts_data = alerts_res.get_json()
        self.assertGreater(alerts_data["count"], 0)
        print("  [PASS] Test 7: API submits reading, evaluates inference, and retrieves latest telemetry & alerts.")

def run_suite():
    print("=" * 65)
    print("EcoPulse ML & API Integration Test Suite")
    print("=" * 65)
    suite = unittest.TestLoader().loadTestsFromTestCase(TestEcoPulseMLAndAPI)
    runner = unittest.TextTestRunner(verbosity=0)
    result = runner.run(suite)
    print("=" * 65)
    print(f"Results: {result.testsRun - len(result.failures) - len(result.errors)}/{result.testsRun} Tests Passed.")
    print("=" * 65)
    return 0 if result.wasSuccessful() else 1

if __name__ == "__main__":
    sys.exit(run_suite())
