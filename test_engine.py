#!/usr/bin/env python3
"""
EcoPulse — Anomaly Detection Engine Test Suite
Automated verification for water-leakage detection rules:
1. Normal usage within zone baseline -> Normal.
2. Catastrophic burst exceeding burst threshold -> Critical.
3. Sudden pressure drop accompanied by flow -> Critical.
4. Continuous low flow for an unusually long period -> Warning.
5. Transient high flow within allowed duration -> Normal (NOT classified as leak).
6. Continuous flow in inactive zone -> Warning / Critical.
7. Prevention of duplicate alerts for ongoing continuous incident.
"""

import sys
import time

class MockReading:
    def __init__(self, zone, flow_rate, pressure=3.0, data_source="simulated", timestamp_ms=None):
        self.zone = zone
        self.flow_rate = float(flow_rate)
        self.pressure = float(pressure)
        self.data_source = data_source
        self.timestamp_ms = timestamp_ms or int(time.time() * 1000)

class PythonDetectionEngine:
    """Python mirror of the JavaScript Anomaly Detection Engine rules for automated CLI tests."""
    def __init__(self):
        self.zones = {
            "kitchen": {
                "name": "Kitchen",
                "baseline_max": 6.0,
                "burst_threshold": 18.0,
                "max_low_flow_sec": 45,
                "max_high_flow_sec": 30,
                "nominal_pressure": 3.2,
                "is_expected_active": True,
                "active_hours": (6, 23)
            },
            "bathroom": {
                "name": "Bathroom",
                "baseline_max": 8.5,
                "burst_threshold": 16.0,
                "max_low_flow_sec": 35,
                "max_high_flow_sec": 45,
                "nominal_pressure": 3.0,
                "is_expected_active": True,
                "active_hours": (5, 24)
            },
            "garden": {
                "name": "Garden Irrigation",
                "baseline_max": 12.0,
                "burst_threshold": 22.0,
                "max_low_flow_sec": 60,
                "max_high_flow_sec": 60,
                "nominal_pressure": 3.5,
                "is_expected_active": False,
                "active_hours": (17, 19)
            },
            "main_supply": {
                "name": "Main Supply Line",
                "baseline_max": 22.0,
                "burst_threshold": 35.0,
                "max_low_flow_sec": 60,
                "max_high_flow_sec": 60,
                "nominal_pressure": 3.6,
                "is_expected_active": True,
                "active_hours": (0, 24)
            }
        }
        self.pressure_drop_threshold = 0.75
        self.global_low_flow_min = 0.4
        self.zone_states = {z: {"low_flow_start": None, "high_flow_start": None, "inactive_flow_start": None, "pressures": []} for z in self.zones}
        self.active_incidents = {}

    def analyze_reading(self, reading, custom_hour=None):
        z_cfg = self.zones[reading.zone]
        tracking = self.zone_states[reading.zone]
        now_ms = reading.timestamp_ms

        # Pressure tracking
        tracking["pressures"].append({"time_ms": now_ms, "pressure": reading.pressure})
        if len(tracking["pressures"]) > 3:
            tracking["pressures"].pop(0)

        delta_p = 0.0
        if len(tracking["pressures"]) >= 2:
            delta_p = round(tracking["pressures"][0]["pressure"] - reading.pressure, 2)

        # Active schedule check
        hour = custom_hour if custom_hour is not None else 12
        is_scheduled = z_cfg["active_hours"][0] <= hour < z_cfg["active_hours"][1]

        # Rule 1: Sudden Pressure Drop + Flow (Critical)
        if delta_p >= self.pressure_drop_threshold and reading.flow_rate >= self.global_low_flow_min:
            return self._handle_incident(reading.zone, "critical", "Sudden Pressure Collapse",
                                         f"Sudden pressure drop of {delta_p} bar accompanied by flow of {reading.flow_rate} L/min", reading)

        # Rule 2: Burst Threshold (Critical)
        if reading.flow_rate >= z_cfg["burst_threshold"]:
            return self._handle_incident(reading.zone, "critical", "Catastrophic Flow Burst",
                                         f"Flow rate of {reading.flow_rate} L/min critically exceeds burst threshold of {z_cfg['burst_threshold']} L/min", reading)

        # Rule 3: Off-Hours Unscheduled Usage
        if not is_scheduled and reading.flow_rate >= self.global_low_flow_min:
            if not tracking["inactive_flow_start"]:
                tracking["inactive_flow_start"] = now_ms
            elapsed_inactive = (now_ms - tracking["inactive_flow_start"]) / 1000.0
            if elapsed_inactive >= 15:
                sev = "critical" if reading.flow_rate > z_cfg["baseline_max"] else "warning"
                return self._handle_incident(reading.zone, sev, "Off-Hours Unscheduled Usage",
                                             f"Unscheduled flow of {reading.flow_rate} L/min in {z_cfg['name']}", reading)
        else:
            tracking["inactive_flow_start"] = None

        # Rule 4: Continuous Low Flow Leak
        if self.global_low_flow_min <= reading.flow_rate <= z_cfg["baseline_max"]:
            if not tracking["low_flow_start"]:
                tracking["low_flow_start"] = now_ms
            elapsed_low = (now_ms - tracking["low_flow_start"]) / 1000.0
            if elapsed_low >= z_cfg["max_low_flow_sec"]:
                return self._handle_incident(reading.zone, "warning", "Continuous Low-Flow Leak",
                                             f"Continuous low flow of {reading.flow_rate} L/min for {elapsed_low}s in {z_cfg['name']}", reading)
        else:
            tracking["low_flow_start"] = None

        # Rule 5: Transient vs Sustained High Flow
        if z_cfg["baseline_max"] < reading.flow_rate < z_cfg["burst_threshold"]:
            if not tracking["high_flow_start"]:
                tracking["high_flow_start"] = now_ms
            elapsed_high = (now_ms - tracking["high_flow_start"]) / 1000.0
            if elapsed_high >= z_cfg["max_high_flow_sec"]:
                return self._handle_incident(reading.zone, "warning", "Sustained High Flow Anomaly",
                                             f"Elevated flow of {reading.flow_rate} L/min exceeded {z_cfg['max_high_flow_sec']}s", reading)
            else:
                # Normal high usage within permitted window!
                return {"alert_level": "normal", "rule": "Transient Elevated Usage", "is_incident": False, "is_new": False}
        else:
            tracking["high_flow_start"] = None

        return {"alert_level": "normal", "rule": None, "is_incident": False, "is_new": False}

    def _handle_incident(self, zone, severity, rule_name, explanation, reading):
        existing = self.active_incidents.get(zone)
        if existing and existing.get("is_active"):
            existing["last_seen_ms"] = reading.timestamp_ms
            existing["current_flow"] = reading.flow_rate
            return {
                "alert_level": severity,
                "rule": rule_name,
                "explanation": explanation,
                "is_incident": True,
                "is_new": False,  # Duplicate prevented!
                "incident_id": existing["id"]
            }

        incident_id = f"INC-{zone.upper()}-{int(time.time()*1000)%10000}"
        incident = {
            "id": incident_id,
            "zone": zone,
            "severity": severity,
            "rule": rule_name,
            "is_active": True
        }
        self.active_incidents[zone] = incident
        return {
            "alert_level": severity,
            "rule": rule_name,
            "explanation": explanation,
            "is_incident": True,
            "is_new": True,
            "incident_id": incident_id
        }

def run_tests():
    engine = PythonDetectionEngine()
    tests_passed = 0
    total_tests = 7
    t0 = 1700000000000

    print("=" * 65)
    print("EcoPulse — Automated Detection Engine Rule Verification")
    print("=" * 65)

    # Test 1: Normal Flow Baseline
    r1 = MockReading("kitchen", 3.2, 3.2, "simulated", t0)
    res1 = engine.analyze_reading(r1)
    if res1["alert_level"] == "normal" and not res1["is_incident"]:
        print("[PASS] Test 1: Baseline normal flow (3.2 L/min) remains Normal.")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 1: Expected normal, got {res1}")

    # Test 2: Catastrophic Flow Burst (>18 L/min in Kitchen)
    r2 = MockReading("kitchen", 24.5, 3.0, "simulated", t0)
    res2 = engine.analyze_reading(r2)
    if res2["alert_level"] == "critical" and res2["rule"] == "Catastrophic Flow Burst" and res2["is_new"]:
        print("[PASS] Test 2: Catastrophic burst flow triggers Critical Alert.")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 2: Expected critical burst, got {res2}")

    # Test 3: Sudden Pressure Drop
    engine_p = PythonDetectionEngine()
    r3_a = MockReading("garden", 10.0, 3.5, "simulated", t0)
    engine_p.analyze_reading(r3_a)
    r3_b = MockReading("garden", 14.0, 2.1, "simulated", t0 + 1000) # Delta = 1.4 bar drop > 0.75
    res3 = engine_p.analyze_reading(r3_b)
    if res3["alert_level"] == "critical" and res3["rule"] == "Sudden Pressure Collapse":
        print("[PASS] Test 3: Sudden pressure drop (1.4 bar drop) triggers Critical Alert.")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 3: Expected sudden pressure collapse, got {res3}")

    # Test 4: Continuous Low Flow Duration Threshold (Running Toilet)
    engine_low = PythonDetectionEngine()
    r4_a = MockReading("bathroom", 1.2, 3.0, "simulated", t0)
    res4_a = engine_low.analyze_reading(r4_a)
    # At t0 + 40 seconds (exceeds bathroom 35s max)
    r4_b = MockReading("bathroom", 1.2, 3.0, "simulated", t0 + 40000)
    res4_b = engine_low.analyze_reading(r4_b)
    if res4_a["alert_level"] == "normal" and res4_b["alert_level"] == "warning" and res4_b["rule"] == "Continuous Low-Flow Leak":
        print("[PASS] Test 4: Continuous low flow for >35s in Bathroom triggers Warning Alert.")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 4: Expected warning for prolonged low flow, got {res4_b}")

    # Test 5: Normal High Flow within Allowed Duration (NOT classified as leak)
    engine_high = PythonDetectionEngine()
    r5_a = MockReading("kitchen", 7.5, 3.0, "simulated", t0) # Above 6.0 baseline, below 18 burst
    res5_a = engine_high.analyze_reading(r5_a)
    r5_b = MockReading("kitchen", 7.5, 3.0, "simulated", t0 + 12000) # 12 seconds in (limit is 30s)
    res5_b = engine_high.analyze_reading(r5_b)
    if res5_a["alert_level"] == "normal" and res5_b["alert_level"] == "normal" and not res5_b["is_incident"]:
        print("[PASS] Test 5: High flow within permitted usage window (<30s) is NOT classified as a leak.")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 5: Expected normal for transient high flow, got {res5_b}")

    # Test 6: Inactive Zone Unscheduled Flow
    engine_sched = PythonDetectionEngine()
    r6_a = MockReading("garden", 4.5, 3.5, "simulated", t0)
    engine_sched.analyze_reading(r6_a, custom_hour=2) # 2 AM
    r6_b = MockReading("garden", 4.5, 3.5, "simulated", t0 + 20000) # 20s later
    res6 = engine_sched.analyze_reading(r6_b, custom_hour=2)
    if res6["alert_level"] == "warning" and res6["rule"] == "Off-Hours Unscheduled Usage":
        print("[PASS] Test 6: Continuous flow during scheduled inactive window triggers Alert.")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 6: Expected off-hours warning, got {res6}")

    # Test 7: Prevention of Duplicate Alerts for Active Ongoing Incident
    engine_dup = PythonDetectionEngine()
    r7_a = MockReading("kitchen", 25.0, 3.0, "simulated", t0)
    res7_a = engine_dup.analyze_reading(r7_a)
    r7_b = MockReading("kitchen", 25.0, 3.0, "simulated", t0 + 3000)
    res7_b = engine_dup.analyze_reading(r7_b)
    if res7_a["is_new"] is True and res7_b["is_new"] is False and res7_b["incident_id"] == res7_a["incident_id"]:
        print("[PASS] Test 7: Prevents duplicate alerts for continuously active incident (stateful tracking).")
        tests_passed += 1
    else:
        print(f"[FAIL] Test 7: Expected is_new=False on repeat tick, got {res7_b}")

    print("=" * 65)
    print(f"Results: {tests_passed}/{total_tests} Tests Passed.")
    print("=" * 65)

    if tests_passed == total_tests:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
