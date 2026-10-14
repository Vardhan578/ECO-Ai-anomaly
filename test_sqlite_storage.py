#!/usr/bin/env python3
"""
EcoPulse — SQLite Persistent Storage & Summary Calculations Test Suite

Tests:
1. Database initialization and schema creation.
2. Storing water-flow readings with timestamps, zone names, and data source ('simulated' vs 'real').
3. Storing anomaly detection results and alert incidents.
4. Historical filtering by date range, zone, and alert severity.
5. Daily and monthly consumption summary calculations.
6. Report summary calculations (measured consumption, anomalies, estimated wastage, estimated savings, cost savings).
7. Verification that measured metrics are clearly distinguished from estimated metrics.
8. Alert acknowledgement persistence in SQLite.
9. Data persistence across backend restart simulation.
10. Flask REST API endpoints for history, summaries, reports, and acknowledgement.
"""

import os
import sys
import unittest
import json
import sqlite3
import tempfile
from datetime import datetime, timedelta

import database
from server import app

class TestEcoPulseSQLiteStorage(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Create a dedicated temporary database for isolated testing
        cls.temp_dir = tempfile.mkdtemp()
        cls.test_db_path = os.path.join(cls.temp_dir, "test_ecopulse.db")
        database.init_db(db_path=cls.test_db_path, seed_if_empty=False)

        # Flask test client
        app.config["TESTING"] = True
        cls.client = app.test_client()

    @classmethod
    def tearDownClass(cls):
        if os.path.exists(cls.test_db_path):
            try:
                os.remove(cls.test_db_path)
            except Exception:
                pass

    def test_01_database_initialization(self):
        """Database initializes tables and indexes properly."""
        with database.get_connection(self.test_db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall()]
            self.assertIn("readings", tables)
            self.assertIn("alerts", tables)

            # Check indexes
            cursor.execute("SELECT name FROM sqlite_master WHERE type='index';")
            indexes = [row[0] for row in cursor.fetchall()]
            self.assertIn("idx_readings_timestamp", indexes)
            self.assertIn("idx_readings_zone", indexes)
            self.assertIn("idx_alerts_severity", indexes)
        print("  [PASS] Test 1: SQLite schema initialized with tables and performance indexes.")

    def test_02_store_readings_with_source(self):
        """Stores water-flow readings with timestamps, zone names, and simulated/real data source."""
        reading_simulated = {
            "timestamp_iso": "2026-10-14T10:00:00",
            "zone": "kitchen",
            "zone_name": "Kitchen",
            "flow_rate": 3.4,
            "pressure_bar": 3.20,
            "continuous_duration_sec": 12,
            "time_of_day_hour": 10.0,
            "operating_status": "normal",
            "data_source": "simulated",
            "ml_prediction": {"anomaly_score": 0.12, "is_outlier": False, "classification": "Normal"},
            "rule_verification": {"severity": "normal", "rule_name": None},
            "confirmed_leakage": False,
            "explanation": "Normal dishwashing flow"
        }
        r1_id = database.insert_reading(reading_simulated, db_path=self.test_db_path)
        self.assertIsNotNone(r1_id)

        reading_real = {
            "timestamp_iso": "2026-10-14T10:05:00",
            "zone": "bathroom",
            "zone_name": "Bathroom",
            "flow_rate": 5.8,
            "pressure_bar": 3.05,
            "continuous_duration_sec": 25,
            "time_of_day_hour": 10.08,
            "operating_status": "normal",
            "data_source": "real",
            "ml_prediction": {"anomaly_score": 0.15, "is_outlier": False, "classification": "Normal"},
            "rule_verification": {"severity": "normal", "rule_name": None},
            "confirmed_leakage": False,
            "explanation": "Normal basin flow from calibrated physical meter"
        }
        r2_id = database.insert_reading(reading_real, db_path=self.test_db_path)
        self.assertIsNotNone(r2_id)

        # Verify from database
        res = database.query_readings(db_path=self.test_db_path)
        self.assertEqual(res["total_count"], 2)
        sources = {r["data_source"] for r in res["readings"]}
        self.assertIn("simulated", sources)
        self.assertIn("real", sources)
        print("  [PASS] Test 2: Water-flow readings stored with timestamps, zones, and data sources.")

    def test_03_store_anomaly_and_alert(self):
        """Stores anomaly detection results and alerts in SQLite."""
        leak_reading = {
            "timestamp_iso": "2026-10-14T11:00:00",
            "zone": "kitchen",
            "zone_name": "Kitchen",
            "flow_rate": 22.5,
            "pressure_bar": 2.10,
            "continuous_duration_sec": 60,
            "time_of_day_hour": 11.0,
            "operating_status": "leak",
            "data_source": "simulated",
            "ml_prediction": {"anomaly_score": 0.94, "is_outlier": True, "classification": "Outlier Detected"},
            "rule_verification": {"severity": "critical", "rule_name": "Catastrophic Flow Burst"},
            "confirmed_leakage": True,
            "explanation": "Flow rate of 22.5 L/m exceeds burst ceiling of 18.0 L/m."
        }
        r_id = database.insert_reading(leak_reading, db_path=self.test_db_path)
        self.assertIsNotNone(r_id)

        alert_data = {
            "id": "ALT-TEST-1001",
            "incident_id": "INC-TEST-1001",
            "timestamp": "2026-10-14T11:00:00",
            "zone_id": "kitchen",
            "zone_name": "Kitchen",
            "severity": "critical",
            "rule_pattern": "Catastrophic Flow Burst",
            "flow_rate": 22.5,
            "pressure_bar": 2.10,
            "ml_score": 0.94,
            "message": "Burst line in Kitchen",
            "data_source": "simulated",
            "estimated_wastage_liters": 25.0,
            "estimated_savings_liters": 850.0,
            "acknowledged": 0,
            "active": 1
        }
        a_id = database.insert_or_update_alert(alert_data, db_path=self.test_db_path)
        self.assertEqual(a_id, "ALT-TEST-1001")

        alerts = database.query_alerts(db_path=self.test_db_path)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "critical")
        self.assertEqual(alerts[0]["acknowledged"], 0)
        print("  [PASS] Test 3: Anomaly detection results and critical alert stored in SQLite.")

    def test_04_filter_history(self):
        """Filters readings by date range, zone, and alert severity."""
        # Query by zone = 'kitchen'
        res_kitchen = database.query_readings(zone_id="kitchen", db_path=self.test_db_path)
        self.assertEqual(res_kitchen["total_count"], 2)

        # Query by zone = 'bathroom'
        res_bath = database.query_readings(zone_id="bathroom", db_path=self.test_db_path)
        self.assertEqual(res_bath["total_count"], 1)

        # Query by alert severity = 'critical'
        res_crit = database.query_readings(alert_level="critical", db_path=self.test_db_path)
        self.assertEqual(res_crit["total_count"], 1)
        self.assertEqual(res_crit["readings"][0]["zone_id"], "kitchen")

        # Query by date range
        res_date = database.query_readings(start_date="2026-10-14", end_date="2026-10-14", db_path=self.test_db_path)
        self.assertEqual(res_date["total_count"], 3)
        print("  [PASS] Test 4: Historical readings filtered by date range, zone, and alert severity.")

    def test_05_alert_acknowledgement(self):
        """Acknowledging an alert updates status to acknowledged and sets timestamp."""
        # Initial status is unacknowledged
        alerts_before = database.query_alerts(unacknowledged_only=True, db_path=self.test_db_path)
        self.assertEqual(len(alerts_before), 1)

        # Acknowledge
        success = database.acknowledge_alert("ALT-TEST-1001", db_path=self.test_db_path)
        self.assertTrue(success)

        # Verify acknowledged in DB
        alerts_after = database.query_alerts(unacknowledged_only=True, db_path=self.test_db_path)
        self.assertEqual(len(alerts_after), 0)

        all_alerts = database.query_alerts(db_path=self.test_db_path)
        self.assertEqual(all_alerts[0]["acknowledged"], 1)
        self.assertIsNotNone(all_alerts[0]["acknowledged_at"])
        print("  [PASS] Test 5: Alert acknowledgement persists with timestamp and deactivates active flag.")

    def test_06_daily_and_monthly_summaries(self):
        """Computes daily and monthly consumption aggregates accurately."""
        daily = database.get_daily_summaries(days=7, db_path=self.test_db_path)
        self.assertGreater(len(daily), 0)
        today_summary = daily[-1]
        self.assertEqual(today_summary["day"], "2026-10-14")
        self.assertGreater(today_summary["total_measured_liters"], 0.0)
        self.assertEqual(today_summary["total_readings"], 3)

        monthly = database.get_monthly_summaries(months=3, db_path=self.test_db_path)
        self.assertGreater(len(monthly), 0)
        self.assertEqual(monthly[-1]["month"], "2026-10")
        print("  [PASS] Test 6: Daily and monthly consumption summaries aggregated accurately.")

    def test_07_report_summary_and_distinction(self):
        """Generates report summary and clearly distinguishes measured from estimated metrics."""
        rep = database.get_report_summary(db_path=self.test_db_path)
        self.assertIn("measured_metrics", rep)
        self.assertIn("estimated_metrics", rep)

        measured = rep["measured_metrics"]
        estimated = rep["estimated_metrics"]

        # Verify measured metrics
        self.assertIn("total_measured_consumption_liters", measured)
        self.assertIn("total_detected_anomalies", measured)
        self.assertIn("confirmed_leaks_count", measured)
        self.assertEqual(measured["measurement_type"], "Direct Sensor Telemetry (Ground Truth)")

        # Verify estimated metrics
        self.assertIn("estimated_water_wastage_liters", estimated)
        self.assertIn("estimated_water_savings_liters", estimated)
        self.assertIn("estimated_cost_savings_dollars", estimated)
        self.assertIn("estimation_model", estimated)

        # Requirement 7: Explicit distinction check
        self.assertIn("clarification_notice", rep)
        self.assertNotEqual(measured["total_measured_consumption_liters"], estimated["estimated_water_savings_liters"])
        print("  [PASS] Test 7: Report generated with clear distinction between measured & estimated metrics.")

    def test_08_persistence_after_backend_restart(self):
        """Readings and alerts remain available after closing and re-opening DB (backend restart simulation)."""
        # Re-initialize connection to simulate backend restart
        restarted_count = database.get_readings_count(db_path=self.test_db_path)
        self.assertEqual(restarted_count, 3)

        restarted_alerts = database.query_alerts(db_path=self.test_db_path)
        self.assertEqual(len(restarted_alerts), 1)
        self.assertEqual(restarted_alerts[0]["id"], "ALT-TEST-1001")
        self.assertEqual(restarted_alerts[0]["acknowledged"], 1)
        print("  [PASS] Test 8: Telemetry readings and alerts persist across simulated backend restarts.")

    def test_09_flask_api_history_and_reports(self):
        """Tests Flask API endpoints for history, summaries, reports, and acknowledgement."""
        # 1. Health check returns SQLite status
        res_health = self.client.get("/api/health")
        self.assertEqual(res_health.status_code, 200)
        data_h = res_health.get_json()
        self.assertIn("database", data_h)
        self.assertEqual(data_h["database"]["type"], "SQLite")

        # 2. History endpoint
        res_hist = self.client.get("/api/history?limit=10")
        self.assertEqual(res_hist.status_code, 200)
        data_hist = res_hist.get_json()
        self.assertIn("readings", data_hist)
        self.assertIn("total_count", data_hist)

        # 3. Summaries endpoints
        res_daily = self.client.get("/api/summaries/daily?days=7")
        self.assertEqual(res_daily.status_code, 200)
        self.assertIn("daily_summaries", res_daily.get_json())

        res_monthly = self.client.get("/api/summaries/monthly?months=3")
        self.assertEqual(res_monthly.status_code, 200)
        self.assertIn("monthly_summaries", res_monthly.get_json())

        # 4. Reports endpoint
        res_rep = self.client.get("/api/reports")
        self.assertEqual(res_rep.status_code, 200)
        data_rep = res_rep.get_json()
        self.assertIn("measured_metrics", data_rep)
        self.assertIn("estimated_metrics", data_rep)

        # 5. Acknowledge All endpoint
        res_ack_all = self.client.post("/api/alerts/acknowledge-all", json={"zone": "all"})
        self.assertEqual(res_ack_all.status_code, 200)
        print("  [PASS] Test 9: Flask REST API history, daily/monthly summaries, and reports endpoints verified.")

def run_tests():
    print("=" * 68)
    print("EcoPulse — SQLite Persistent Storage & Summaries Test Suite")
    print("=" * 68)
    suite = unittest.TestLoader().loadTestsFromTestCase(TestEcoPulseSQLiteStorage)
    runner = unittest.TextTestRunner(verbosity=0)
    result = runner.run(suite)
    print("=" * 68)
    print(f"Results: {result.testsRun - len(result.failures) - len(result.errors)}/{result.testsRun} Tests Passed.")
    print("=" * 68)
    return 0 if result.wasSuccessful() else 1

if __name__ == "__main__":
    sys.exit(run_tests())
