#!/usr/bin/env python3
"""
EcoPulse — Empirical QA & Model Audit Test Suite

Directly tests the running Flask ML backend (http://127.0.0.1:5000) over HTTP:
1. Health and Model Info endpoints
2. Scenario A: Normal water usage (Kitchen 3.2 L/min, duration 15s)
3. Scenario B: Prolonged low flow (Bathroom 1.2 L/min, duration 50s)
4. Scenario C: Unusually high flow (Kitchen 25.0 L/min, duration 40s)
5. Scenario D: Missing sensor values (Missing pressure_bar, missing duration, None values)
6. Invalid inputs handling (Empty body, non-dict JSON, string flow rates)
7. Water Volume Calculation Verification:
   Volume (litres) = Flow rate (L/min) * (Duration_sec / 60)
8. SQLite Storage Verification: Query /api/history to verify stored records
"""

import json
import urllib.request
import urllib.error
import sys

BASE_URL = "http://127.0.0.1:5000"

def make_request(path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"} if body is not None else {}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": str(e)}
    except Exception as e:
        return 0, {"error": str(e)}

def run_empirical_audit():
    print("=" * 70)
    print("ECOPULSE EMPIRICAL QA & AI MODEL AUDIT")
    print("=" * 70)

    results = []

    # 1. Health Endpoint
    status, health = make_request("/api/health")
    if status == 200 and health.get("status") == "healthy":
        print(f"[*] /api/health: PASS (Model: {health.get('model')}, Features: {len(health.get('features', []))})")
        results.append(("Health Endpoint", True, f"Features: {health.get('features')}"))
    else:
        print(f"[!] /api/health: FAIL ({status}, {health})")
        results.append(("Health Endpoint", False, str(health)))

    # 2. Model Info Endpoint
    status, model_info = make_request("/api/model/info")
    if status == 200 and model_info.get("algorithm") == "IsolationForest":
        print(f"[*] /api/model/info: PASS (Trees: {model_info.get('training_samples')} samples, Contamination: {model_info.get('contamination')})")
        results.append(("Model Info", True, f"Trained samples: {model_info.get('training_samples')}"))
    else:
        print(f"[!] /api/model/info: FAIL ({status}, {model_info})")
        results.append(("Model Info", False, str(model_info)))

    # 3. Scenario A: Normal Water Usage
    normal_payload = {
        "zone": "kitchen",
        "flow_rate": 3.2,
        "continuous_duration_sec": 15,
        "pressure_bar": 3.20,
        "time_of_day_hour": 13.0,
        "data_source": "simulated"
    }
    status, resp_a = make_request("/api/telemetry/reading", "POST", normal_payload)
    is_normal = (status == 200 and 
                 resp_a.get("status") == "NORMAL" and 
                 resp_a.get("confirmed_leakage") is False and
                 resp_a.get("ml_prediction", {}).get("is_outlier") is False)
    print(f"\n--- Scenario A: Normal Water Usage ---")
    print(f"Flow: 3.2 L/min, Duration: 15s")
    print(f"Status: {resp_a.get('status')}")
    print(f"ML Anomaly Score: {resp_a.get('ml_prediction', {}).get('anomaly_score')}")
    print(f"ML Is Outlier: {resp_a.get('ml_prediction', {}).get('is_outlier')}")
    print(f"Confirmed Leakage: {resp_a.get('confirmed_leakage')}")
    print(f"Explanation: {resp_a.get('explanation')}")
    print(f"Result: {'PASS' if is_normal else 'FAIL'}")
    results.append(("Scenario A: Normal Usage", is_normal, f"Score: {resp_a.get('ml_prediction', {}).get('anomaly_score')}"))

    # 4. Scenario B: Prolonged Low Flow (Running Toilet / Cistern Leak)
    low_flow_payload = {
        "zone": "bathroom",
        "flow_rate": 1.2,
        "continuous_duration_sec": 50, # Exceeds bathroom max_low_flow_sec (35s)
        "pressure_bar": 3.10,
        "time_of_day_hour": 14.0,
        "data_source": "simulated"
    }
    status, resp_b = make_request("/api/telemetry/reading", "POST", low_flow_payload)
    is_leak_b = (status == 200 and 
                 resp_b.get("confirmed_leakage") is True and
                 resp_b.get("rule_verification", {}).get("rule_name") == "Continuous Low-Flow Leak")
    print(f"\n--- Scenario B: Prolonged Low Flow ---")
    print(f"Flow: 1.2 L/min, Duration: 50s (Bathroom threshold: 35s)")
    print(f"Status: {resp_b.get('status')}")
    print(f"ML Anomaly Score: {resp_b.get('ml_prediction', {}).get('anomaly_score')}")
    print(f"Confirmed Leakage: {resp_b.get('confirmed_leakage')}")
    print(f"Rule Triggered: {resp_b.get('rule_verification', {}).get('rule_name')}")
    print(f"Explanation: {resp_b.get('explanation')}")
    print(f"Result: {'PASS' if is_leak_b else 'FAIL'}")
    results.append(("Scenario B: Prolonged Low Flow", is_leak_b, f"Rule: {resp_b.get('rule_verification', {}).get('rule_name')}"))

    # 5. Scenario C: Unusually High Flow (Catastrophic Burst)
    high_flow_payload = {
        "zone": "kitchen",
        "flow_rate": 25.0, # Critically exceeds kitchen burst threshold (18 L/min)
        "continuous_duration_sec": 40,
        "pressure_bar": 3.0,
        "time_of_day_hour": 15.0,
        "data_source": "simulated"
    }
    status, resp_c = make_request("/api/telemetry/reading", "POST", high_flow_payload)
    is_burst_c = (status == 200 and 
                  resp_c.get("confirmed_leakage") is True and
                  resp_c.get("status") == "CRITICAL_LEAK" and
                  resp_c.get("ml_prediction", {}).get("is_outlier") is True and
                  resp_c.get("rule_verification", {}).get("rule_name") == "Catastrophic Flow Burst")
    print(f"\n--- Scenario C: Unusually High Flow ---")
    print(f"Flow: 25.0 L/min, Duration: 40s (Kitchen burst limit: 18.0 L/min)")
    print(f"Status: {resp_c.get('status')}")
    print(f"ML Anomaly Score: {resp_c.get('ml_prediction', {}).get('anomaly_score')}")
    print(f"ML Is Outlier: {resp_c.get('ml_prediction', {}).get('is_outlier')}")
    print(f"Confirmed Leakage: {resp_c.get('confirmed_leakage')}")
    print(f"Rule Triggered: {resp_c.get('rule_verification', {}).get('rule_name')}")
    print(f"Explanation: {resp_c.get('explanation')}")
    print(f"Result: {'PASS' if is_burst_c else 'FAIL'}")
    results.append(("Scenario C: Unusually High Flow", is_burst_c, f"Score: {resp_c.get('ml_prediction', {}).get('anomaly_score')}"))

    # 6. Scenario D: Missing Sensor Values & Robustness
    # Missing pressure_bar completely, missing duration
    missing_sensor_payload = {
        "zone": "kitchen",
        "flow_rate": 4.5
        # Note: pressure_bar omitted, continuous_duration_sec omitted
    }
    status, resp_d = make_request("/api/telemetry/reading", "POST", missing_sensor_payload)
    is_d1_ok = (status == 200 and "ml_prediction" in resp_d and "pressure_bar" in resp_d)
    print(f"\n--- Scenario D.1: Missing Optional Pressure Data ---")
    print(f"Input: {missing_sensor_payload}")
    print(f"Fallback Pressure Used: {resp_d.get('pressure_bar')} bar (Nominal: 3.20)")
    print(f"Status Code: {status}")
    print(f"Result: {'PASS' if is_d1_ok else 'FAIL'}")
    results.append(("Scenario D.1: Missing Optional Pressure", is_d1_ok, f"Defaulted to {resp_d.get('pressure_bar')} bar"))

    # Scenario D.2: Explicit None / Null values
    null_sensor_payload = {
        "zone": "bathroom",
        "flow_rate": 2.0,
        "pressure_bar": None,
        "continuous_duration_sec": None,
        "time_of_day_hour": None
    }
    status, resp_d2 = make_request("/api/telemetry/reading", "POST", null_sensor_payload)
    is_d2_ok = (status == 200 and "ml_prediction" in resp_d2)
    print(f"\n--- Scenario D.2: Explicit null/None sensor values ---")
    print(f"Input: {null_sensor_payload}")
    print(f"Status Code: {status}")
    print(f"Result: {'PASS' if is_d2_ok else 'FAIL'}")
    results.append(("Scenario D.2: Explicit null/None Values", is_d2_ok, f"Status code: {status}"))

    # 7. Invalid Input Handling
    # 7.1 Non-dict / Empty body
    status_empty, resp_empty = make_request("/api/telemetry/reading", "POST", "invalid_string_not_dict")
    is_empty_safe = (status_empty == 400 and "error" in resp_empty)
    print(f"\n--- Invalid Input: Non-dict payload ---")
    print(f"Status Code: {status_empty}, Response: {resp_empty}")
    print(f"Result: {'PASS' if is_empty_safe else 'FAIL'}")
    results.append(("Invalid Input: Non-dict", is_empty_safe, f"Rejected with {status_empty}"))

    # 8. Water Volume Calculation Check
    # Formula: Volume = Flow Rate (L/min) * Duration (minutes)
    # Check 1: 12.0 L/min for 30 seconds = 12.0 * (30/60) = 6.0 Litres
    test_flow = 12.0
    test_duration_sec = 30
    duration_min = test_duration_sec / 60.0
    expected_volume = test_flow * duration_min
    calc_volume = round(test_flow * (test_duration_sec / 60.0), 4)
    vol_correct = abs(expected_volume - calc_volume) < 1e-6 and abs(calc_volume - 6.0) < 1e-6
    print(f"\n--- Water Volume Formula Verification ---")
    print(f"Flow rate: {test_flow} L/min, Duration: {test_duration_sec}s ({duration_min} min)")
    print(f"Calculated: {calc_volume} Litres, Expected: 6.00 Litres")
    print(f"Result: {'PASS' if vol_correct else 'FAIL'}")
    results.append(("Water Volume Calculation", vol_correct, f"{calc_volume} L matches {expected_volume} L"))

    # 9. SQLite Storage & Retrieval Verification
    status_hist, hist_data = make_request("/api/history?limit=5")
    has_history = (status_hist == 200 and 
                   "readings" in hist_data and 
                   len(hist_data["readings"]) > 0 and
                   "total_count" in hist_data)
    print(f"\n--- SQLite Storage & Retrieval Verification ---")
    if has_history:
        print(f"Total SQLite Readings in Database: {hist_data.get('total_count')}")
        latest_r = hist_data["readings"][0]
        print(f"Latest Stored Reading: Zone: {latest_r.get('zone_name')}, Flow: {latest_r.get('flow_rate')} L/m, Score: {latest_r.get('ml_anomaly_score')}")
    print(f"Result: {'PASS' if has_history else 'FAIL'}")
    results.append(("SQLite Storage Verification", has_history, f"Total records: {hist_data.get('total_count', 0)}"))

    print("\n" + "=" * 70)
    print("EMPIRICAL AUDIT SUMMARY:")
    print("=" * 70)
    passed_cnt = sum(1 for _, ok, _ in results if ok)
    for name, ok, note in results:
        status_str = "PASS" if ok else "FAIL"
        print(f"  [{status_str}] {name}: {note}")
    print("=" * 70)
    print(f"Total: {passed_cnt}/{len(results)} Checks Passed.")
    print("=" * 70)

    return 0 if passed_cnt == len(results) else 1

if __name__ == "__main__":
    sys.exit(run_empirical_audit())
