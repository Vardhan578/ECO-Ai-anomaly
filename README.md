# EcoPulse — AI-Powered Water Leakage Detection & Prevention System

EcoPulse is a modern, responsive environmental intelligence web dashboard that combines unsupervised machine learning (**IsolationForest**) and domain-specific hydraulic rules to detect, monitor, and prevent water leakages in residential and commercial plumbing networks.

---

## Architecture Overview

EcoPulse utilizes a hybrid detection architecture:
1. **Frontend Dashboard**: Clean HTML5, Vanilla CSS, and JavaScript with Chart.js visualization, real-time telemetry streaming, interactive leak simulation scenarios, and zone isolation valves.
2. **Machine Learning Layer**: Unsupervised `IsolationForest` (scikit-learn) trained on multi-dimensional telemetry features to detect statistical outliers without requiring prior labelled leak data.
3. **Domain Heuristic Layer**: Configurable hydraulic rules (evaluating continuous flow duration, pressure collapse, and schedule windows) to corroborate ML outliers and eliminate false alarms.
4. **Lightweight REST API**: Python Flask backend exposing `/api/health`, `/api/telemetry/reading`, `/api/telemetry/latest`, and `/api/alerts/recent`.

---

## Dataset & Model Disclosure

> [!IMPORTANT]
> **Synthetic Training Data & Real-World Accuracy Notice:**  
> The training dataset (`synthetic_water_flow_data.csv`) is generated synthetically using realistic diurnal residential flow profiles, standard fixture rates (taps, showers, toilets, irrigation), and simulated hydraulic failure modes. While the model achieves high precision and ROC-AUC on this benchmark, **no claim of real-world meter accuracy is made until the model is calibrated and validated against labelled data collected from physical smart water meters**.

### Extracted Feature Vectors
The `IsolationForest` model evaluates 6 continuous features per reading:
1. `flow_rate`: Current flow rate in L/min.
2. `continuous_duration_sec`: Continuous flow duration in seconds.
3. `recent_consumption_liters`: Rolling consumption in Litres over the preceding 30-minute window.
4. `time_of_day_hour`: Float timestamp representation of hour of day (0.00 – 23.99).
5. `flow_diff_from_baseline`: Measured flow minus the zone's normal historical average.
6. `pressure_delta`: Zone nominal baseline pressure minus current hydraulic line pressure (bar).

### Distinction: Outlier Anomaly vs. Confirmed Leakage
* **ML Outlier Detected (`INVESTIGATING_ANOMALY`)**: The IsolationForest flagged an atypical multi-dimensional telemetry point (e.g. higher than typical flow), but the duration is still within normal residential usage (e.g. filling a pasta pot or washing dishes). The system accommodates normal usage and avoids false alarms.
* **Confirmed Leakage (`CONFIRMED_LEAK` / `CRITICAL_LEAK`)**: The ML anomaly is corroborated by continuous duration exceeding threshold limits, sudden pressure collapse ($\ge 0.75\text{ bar}$), or flow exceeding catastrophic burst ratings.

---

## Windows Setup & Installation

### Prerequisites
* Windows 10 or 11
* Python 3.10+ (Python 3.13 supported)

### 1. Open PowerShell or Command Prompt
Navigate to your project directory:
```powershell
cd "c:\Users\HP\Desktop\ECO-Ai anomaly"
```

### 2. Install Required Python Packages
```powershell
pip install -r requirements.txt
```
*(Packages installed: `flask`, `flask-cors`, `pandas`, `scikit-learn`, `numpy`, `joblib`)*

### 3. Generate Synthetic Dataset & Train Model
```powershell
python model_trainer.py
```
This generates `synthetic_water_flow_data.csv` (4,000 synthetic residential usage records) and trains `ecopulse_model.joblib`.

### 4. Run Automated Tests
```powershell
python test_api_and_model.py
```
Runs 7 comprehensive integration tests covering dataset generation, model inference, false alarm suppression, and API endpoints.

---

## How to Run the Application

### Option A: Complete ML Backend & Frontend (Recommended)
1. Start the Flask server:
   ```powershell
   python server.py
   ```
2. Open your web browser to:
   ```text
   http://127.0.0.1:5000/
   ```
   *(The Flask server serves both the ML API endpoints and the dashboard directly, with live IsolationForest predictions).*

### Option B: Separate Frontend & Backend with CORS
1. In Terminal 1, start the Flask ML backend:
   ```powershell
   python server.py
   ```
2. In Terminal 2, start the static HTTP server:
   ```powershell
   python -m http.server 8000
   ```
3. Open `http://localhost:8000/index.html`. The dashboard automatically connects to `http://127.0.0.1:5000` via CORS.

---

## Persistent Storage Layer (SQLite)

EcoPulse incorporates a persistent **SQLite** database (`ecopulse.db`) providing zero-configuration relational storage:
* **`readings` Table**: Automatically records all incoming sensor telemetry with precise timestamps, zone identifiers, continuous duration, flow rate, hydraulic pressure, operating status, ML outlier scores, detection alerts, and explicit data source (`simulated` vs `real`).
* **`alerts` Table**: Stores anomaly incidents, rule patterns, severity classifications, estimated water wastage, estimated savings, and acknowledgement timestamps.
* **Persistent State Across Reboots**: Telemetry history and alert states persist across server restarts.
* **Realistic Seeding**: Generates realistic multi-day baseline consumption and historical anomalies out-of-the-box so History and Report views are immediately usable.

---

## API Documentation

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check, service status, algorithm info, database connection, and synthetic data disclosure. |
| `GET` | `/api/model/info` | Returns model hyperparameters, features, contamination, and score ranges. |
| `POST` | `/api/telemetry/reading` | Submits a water-flow reading, runs ML inference, and writes reading & alerts to SQLite. |
| `GET` | `/api/telemetry/latest` | Returns the most recent readings and predictions across all monitored zones. |
| `GET` | `/api/alerts/recent` | Returns recent anomaly and confirmed leakage incidents from SQLite. |
| `POST` | `/api/alerts/<id>/acknowledge` | Acknowledges a specific alert incident in persistent storage. |
| `POST` | `/api/alerts/acknowledge-all` | Batch acknowledges all active alerts (optional zone filter). |
| `GET` | `/api/history` | Filtered historical telemetry by date range, zone, alert severity, and data source with pagination. |
| `GET` | `/api/summaries/daily` | Returns daily aggregated consumption volumes, reading counts, and anomaly frequencies. |
| `GET` | `/api/summaries/monthly` | Returns monthly aggregated consumption volumes and anomaly trends. |
| `GET` | `/api/reports` | Returns high-level sustainability & financial metrics with explicit measured vs. estimated distinction. |

### Sample Reading Submission Payload
```json
{
  "zone": "bathroom",
  "flow_rate": 18.5,
  "continuous_duration_sec": 45,
  "pressure_bar": 2.85,
  "time_of_day_hour": 14.5,
  "data_source": "real"
}
```

### Sample Response
```json
{
  "zone": "bathroom",
  "zone_name": "Bathroom",
  "flow_rate": 18.5,
  "pressure_bar": 2.85,
  "stored_reading_id": 245,
  "ml_prediction": {
    "algorithm": "IsolationForest",
    "is_outlier": true,
    "anomaly_score": 0.884,
    "raw_decision_score": -0.214,
    "classification": "Outlier Detected"
  },
  "rule_verification": {
    "rule_name": "Catastrophic Flow Burst",
    "severity": "critical"
  },
  "confirmed_leakage": true,
  "status": "CRITICAL_LEAK",
  "explanation": "IsolationForest flagged outlier (Score: 0.884). Flow rate (18.5 L/min) critically exceeds Bathroom burst limit of 16.0 L/min.",
  "data_source": "real"
}
```

---

## Interactive Dashboard Features

1. **📊 Primary Multi-View Navigation**:
   - **Live Monitoring**: Real-time KPI cards, dynamic Chart.js trends, zone grid with remote valve isolation, emergency alerts banner, live telemetry inspector, and audio synthesizer.
   - **Telemetry & Alert History**: Powerful SQLite query interface with date range filters, zone selector, severity filter, data origin filter (`simulated` vs `real`), pagination, and one-click CSV export.
   - **Consumption & Savings Reports**: Audited sustainability overview with explicit distinction between measured consumption and algorithmic savings/wastage projections, accompanied by daily and monthly summary tables.

2. **🧠 ML Architecture Modal**:
   - Inspect the `IsolationForest` binary tree partitioning equations and hyperparameters (120 trees, 4% contamination).
   - View real-time animated anomaly score gauge (`0.00` to `1.00`) dynamically tracking live telemetry.
   - Review the 6 continuous feature vector definitions and benchmark training breakdown (3,520 normal, 480 simulated anomalies).

3. **🎛️ Dynamic Threshold Tuning Sliders**:
   - Open the **Detection Rules** modal to adjust zone burst ratings (Kitchen, Bathroom, Garden) and pressure collapse thresholds in real-time.
   - Experience live dynamic engine adaptation as telemetry streams.

4. **✅ Incident Acknowledgement**:
   - Acknowledge alerts individually with timestamped resolution tracking in SQLite, or acknowledge all active alerts simultaneously.

5. **🧪 Automated Test Suites**:
   - **QA Comprehensive 15-Scenario Suite**: `python test_qa_comprehensive.py` (15/15 passed).
   - **SQLite Persistence & Summaries**: `python test_sqlite_storage.py` (9/9 passed).
   - **ML & API Integration**: `python test_api_and_model.py` (7/7 passed).
   - **Hydraulic Engine Heuristics**: `python test_engine.py` (7/7 passed).
   - **DOM & JS Integrity Inspector**: `python test_qa_inspector.py` (101/101 DOM elements validated).

---

## 🚀 Public Hackathon Deployment Guide

EcoPulse is designed for zero-friction public deployment. You can deploy it as a **unified monolith** (Flask serves both API and Dashboard) or as a **split deployment** (Frontend on Vercel/Netlify, Backend on Render/Railway).

### Option A: One-Click Render Deployment (Recommended)
1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of EcoPulse v2.0"
   git remote add origin https://github.com/<your-username>/ecopulse.git
   git branch -M main
   git push -u origin main
   ```
2. Log into [Render.com](https://render.com) and click **New > Blueprint**.
3. Select your repository. Render will automatically read [`render.yaml`](file:///c:/Users/HP/Desktop/ECO-Ai%20anomaly/render.yaml) and configure:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 server:app`
   - Health Check: `/healthz`
4. Once deployed, Render gives you a public URL (e.g. `https://ecopulse-system.onrender.com`).
5. Open the URL in your browser — your full dashboard and ML backend are live and working out of the box!

### Option B: Docker Container Deployment (Universal)
```bash
# Build the production container
docker build -t ecopulse:v2.0 .

# Run with persistent volume for SQLite
docker run -d -p 5000:5000 -v ecopulse-data:/app/data --name ecopulse-app ecopulse:v2.0

# Or using Docker Compose:
docker-compose up -d
```

### Option C: Split Deployment (Vercel Frontend + Render Backend)
1. Deploy Backend to Render or Railway using the commands in Option A.
2. In [`config.js`](file:///c:/Users/HP/Desktop/ECO-Ai%20anomaly/config.js), or via URL parameter, connect the frontend:
   - Open your deployed frontend with `?api=https://your-backend.onrender.com`
   - Or run `window.ECOPULSE_CONFIG.setApiUrl('https://your-backend.onrender.com')` in the browser console.
3. CORS is pre-configured with `CORS_ORIGINS=*` to allow seamless cross-origin communication.

---

## 💾 SQLite Persistence in Hosting Environments

| Hosting Environment | Filesystem Behavior | Persistence Recommendation |
|---------------------|---------------------|----------------------------|
| **Local Windows/Mac** | Persistent local disk | Fully persistent in `ecopulse.db` with WAL mode. |
| **Docker (Self-Hosted)** | Ephemeral container | Mount named volume (`-v ecopulse-data:/app/data`) with `DATABASE_PATH=/app/data/ecopulse.db`. |
| **Render (Free Tier)** | Ephemeral disk | Server restarts every ~15 min of inactivity. Attaching a 1GB Persistent Disk to `/var/data` ensures permanent storage across restarts. |
| **Railway.app** | Ephemeral container | Add a Railway Volume mounted to `/app/data` with `DATABASE_PATH=/app/data/ecopulse.db`. |
| **Fly.io** | Ephemeral container | Create a volume (`fly volumes create ecopulse_data`) and mount to `/app/data`. |
| **Vercel / Netlify** | Read-only serverless | Not suitable for hosting SQLite files. Host the Flask backend on Render/Railway and static assets on Vercel. |

---

## ⚙️ Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Port for the Flask REST API server. |
| `HOST` | `0.0.0.0` | Binding IP address for containerized routing. |
| `ENVIRONMENT` | `production` | Deployment mode flag (`production` or `development`). |
| `DATABASE_PATH` | `ecopulse.db` | Absolute or relative path to SQLite database file. |
| `CORS_ORIGINS` | `*` | Comma-separated list of allowed origins or `*` for public hackathon demos. |
| `SECRET_KEY` | *(Default Demo Key)* | Cryptographic key for session/security verification. |
| `TARIFF_PER_LITER` | `0.0035` | Municipal water tariff in USD per liter ($3.50/m³). |

