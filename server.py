#!/usr/bin/env python3
"""
EcoPulse — Flask Machine Learning API Backend

Provides RESTful API endpoints for:
1. Health check (/api/health)
2. Submitting water-flow readings for ML inference (/api/telemetry/reading)
3. Retrieving latest detection results (/api/telemetry/latest)
4. Retrieving recent alerts and incidents (/api/alerts/recent)
5. Model information and synthetic training disclosure (/api/model/info)
"""

import os
import sys
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from hybrid_detector import HybridLeakageDetector

import database

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__, static_folder=".")

# Configure CORS: support wildcards or comma-separated origins from environment
cors_origins_env = os.environ.get("CORS_ORIGINS", "*").strip()
if cors_origins_env == "*":
    CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)
else:
    allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": allowed_origins}}, supports_credentials=True)

# Initialize Hybrid ML Detector and SQLite Persistent Database
detector = HybridLeakageDetector()
database.init_db()

# In-memory history buffers
latest_detections = {}
recent_alerts_log = []

@app.route("/healthz", methods=["GET"])
def healthz():
    """Lightweight production health-check probe for cloud orchestrators (K8s, Render, Fly, Railway)."""
    try:
        count = database.get_readings_count()
        db_status = "connected"
        status_code = 200
    except Exception as e:
        count = 0
        db_status = f"error: {str(e)}"
        status_code = 503

    return jsonify({
        "status": "ok" if status_code == 200 else "unhealthy",
        "service": "EcoPulse ML Backend",
        "version": "2.0.0",
        "environment": os.environ.get("ENVIRONMENT", "production"),
        "timestamp": datetime.now().isoformat(),
        "database": {
            "type": "SQLite",
            "status": db_status,
            "total_readings": count
        }
    }), status_code

@app.route("/api/health", methods=["GET"])
def health_check():
    """Comprehensive health check endpoint indicating model status and synthetic training disclosure."""
    return jsonify({
        "status": "healthy",
        "service": "EcoPulse ML Backend",
        "version": "2.0.0",
        "model": "IsolationForest (scikit-learn)",
        "features": detector.feature_columns,
        "timestamp": datetime.now().isoformat(),
        "database": {
            "type": "SQLite",
            "status": "connected",
            "total_readings": database.get_readings_count()
        },
        "training_data": {
            "source": "Synthetic Residential Water Telemetry Benchmark",
            "real_world_accuracy_disclaimer": "Model is trained on reproducible synthetic usage patterns. Validation against labelled physical smart-meter datasets is required before real-world operational certification."
        }
    }), 200

@app.route("/api/model/info", methods=["GET"])
def model_info():
    """Returns model parameters and metadata."""
    bundle = detector.model_bundle or {}
    return jsonify({
        "algorithm": bundle.get("algorithm", "IsolationForest"),
        "features": bundle.get("feature_columns", []),
        "training_samples": bundle.get("training_samples", 0),
        "contamination": bundle.get("contamination", 0.04),
        "dataset_notice": bundle.get("dataset_notice", "Synthetic Dataset"),
        "min_decision_score": bundle.get("min_decision_score"),
        "max_decision_score": bundle.get("max_decision_score")
    }), 200

@app.route("/api/telemetry/reading", methods=["POST"])
def submit_reading():
    """
    Submits a water-flow reading, evaluates inference, and persists
    both the reading and any alert incident into SQLite storage.
    """
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "Invalid request: JSON object required"}), 400

        zone = data.get("zone", "kitchen") or "kitchen"
        timestamp_str = datetime.now().strftime("%H:%M:%S")

        # Evaluate through IsolationForest + Domain Rules
        result = detector.evaluate_reading(data)
        result["timestamp"] = timestamp_str
        result["timestamp_iso"] = datetime.now().isoformat()
        result["data_source"] = data.get("data_source", result.get("data_source", "simulated"))

        # Store latest detection for this zone in memory
        latest_detections[zone] = result

        # Persist telemetry reading to SQLite
        reading_id = database.insert_reading(result)
        result["stored_reading_id"] = reading_id

        # If confirmed leakage or investigating anomaly, record in SQLite alerts table
        if result["confirmed_leakage"]:
            alert_id = f"ALT-{zone.upper()}-{int(datetime.now().timestamp())%10000}"
            alert_item = {
                "id": alert_id,
                "incident_id": f"INC-{zone.upper()}-{int(datetime.now().timestamp())%10000}",
                "zone_id": zone,
                "zone_name": result["zone_name"],
                "severity": result["rule_verification"]["severity"],
                "rule_pattern": result["rule_verification"]["rule_name"],
                "ml_score": result["ml_prediction"]["anomaly_score"],
                "flow_rate": result["flow_rate"],
                "pressure_bar": result["pressure_bar"],
                "timestamp": result["timestamp_iso"],
                "explanation": result["explanation"],
                "data_source": result["data_source"],
                "estimated_wastage_liters": round(result["flow_rate"] * 0.25, 2),
                "estimated_savings_liters": round(result["flow_rate"] * 15.0, 2),
                "acknowledged": 0,
                "active": 1
            }
            database.insert_or_update_alert(alert_item)

            # Also maintain in-memory buffer for legacy backward compatibility
            existing = next((a for a in recent_alerts_log if a.get("zone") == zone and a.get("active", True)), None)
            if existing:
                existing["last_seen"] = timestamp_str
                existing["flow_rate"] = result["flow_rate"]
                existing["anomaly_score"] = result["ml_prediction"]["anomaly_score"]
            else:
                alert_legacy = {
                    "id": alert_id,
                    "zone": zone,
                    "zone_name": result["zone_name"],
                    "severity": result["rule_verification"]["severity"],
                    "rule_name": result["rule_verification"]["rule_name"],
                    "anomaly_score": result["ml_prediction"]["anomaly_score"],
                    "flow_rate": result["flow_rate"],
                    "pressure_bar": result["pressure_bar"],
                    "timestamp": timestamp_str,
                    "explanation": result["explanation"],
                    "active": True
                }
                recent_alerts_log.insert(0, alert_legacy)
                if len(recent_alerts_log) > 50:
                    recent_alerts_log.pop()

        return jsonify(result), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to process telemetry reading: {str(e)}"}), 400

@app.route("/api/telemetry/latest", methods=["GET"])
def get_latest_telemetry():
    """Returns the most recent readings and predictions across all monitored zones."""
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "zones": latest_detections,
        "count": len(latest_detections)
    }), 200

@app.route("/api/alerts/recent", methods=["GET"])
def get_recent_alerts():
    """Returns recent anomaly and leakage incidents from persistent SQLite storage."""
    alerts = database.query_alerts(limit=50)
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "alerts": alerts,
        "count": len(alerts)
    }), 200

@app.route("/api/alerts/<alert_id>/acknowledge", methods=["POST"])
def acknowledge_alert_endpoint(alert_id):
    """Acknowledges an individual alert incident in persistent SQLite storage."""
    success = database.acknowledge_alert(alert_id)
    if success:
        return jsonify({"status": "success", "alert_id": alert_id, "acknowledged": True}), 200
    return jsonify({"error": "Alert not found or already acknowledged"}), 404

@app.route("/api/alerts/acknowledge-all", methods=["POST"])
def acknowledge_all_alerts_endpoint():
    """Acknowledges all active alerts in SQLite."""
    data = request.get_json(silent=True) or {}
    zone = data.get("zone", "all")
    count = database.acknowledge_all_alerts(zone_id=zone)
    return jsonify({"status": "success", "acknowledged_count": count}), 200

@app.route("/api/history", methods=["GET"])
def get_history():
    """
    Returns filtered telemetry readings from persistent SQLite storage.
    Filters: start_date, end_date, zone, severity, data_source, page, limit.
    """
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    zone = request.args.get("zone", "all")
    severity = request.args.get("severity", "all")
    data_source = request.args.get("data_source", "all")
    limit = min(int(request.args.get("limit", 50)), 500)
    page = max(int(request.args.get("page", 1)), 1)
    offset = (page - 1) * limit

    data = database.query_readings(
        start_date=start_date,
        end_date=end_date,
        zone_id=zone,
        alert_level=severity,
        data_source=data_source,
        limit=limit,
        offset=offset
    )
    data["page"] = page
    data["timestamp"] = datetime.now().isoformat()
    return jsonify(data), 200

@app.route("/api/summaries/daily", methods=["GET"])
def get_daily_summaries_endpoint():
    """Returns daily consumption and anomaly aggregates from SQLite."""
    days = min(int(request.args.get("days", 14)), 90)
    summaries = database.get_daily_summaries(days=days)
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "days_queried": days,
        "daily_summaries": summaries
    }), 200

@app.route("/api/summaries/monthly", methods=["GET"])
def get_monthly_summaries_endpoint():
    """Returns monthly consumption and anomaly aggregates from SQLite."""
    months = min(int(request.args.get("months", 6)), 24)
    summaries = database.get_monthly_summaries(months=months)
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "months_queried": months,
        "monthly_summaries": summaries
    }), 200

@app.route("/api/reports", methods=["GET"])
def get_report_endpoint():
    """
    Returns total consumption, detected anomalies, estimated wastage,
    estimated savings, and cost savings with explicit separation between
    measured and estimated metrics.
    """
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    zone = request.args.get("zone", "all")

    report = database.get_report_summary(start_date=start_date, end_date=end_date, zone_id=zone)
    return jsonify(report), 200

# Static file routing to serve the frontend directly from Flask if desired
@app.route("/")
def serve_index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def serve_static(path):
    if os.path.exists(path):
        return send_from_directory(".", path)
    return jsonify({"error": "File not found"}), 404

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    print("=" * 65)
    print("EcoPulse ML Backend Server with Persistent SQLite Storage")
    print(f"Running on http://{host}:{port}")
    print("=" * 65)
    app.run(host=host, port=port, debug=False)
