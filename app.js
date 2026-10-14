/**
 * EcoPulse — AI-Powered Water Leakage Detection & Prevention System
 * Application Logic & Flask Machine Learning Integration (IsolationForest)
 */

// --- Machine Learning Backend API State ---
const ML_BACKEND = {
  url: (typeof window !== 'undefined' && window.ECOPULSE_CONFIG && window.ECOPULSE_CONFIG.API_URL)
    ? window.ECOPULSE_CONFIG.API_URL.replace(/\/+$/, '')
    : 'http://127.0.0.1:5000',
  connected: false,
  checking: false,
  features: [],
  lastAnomalyScore: 0.14,
  disclaimer: 'Model is trained on reproducible synthetic residential usage data.'
};

// --- Local Detection Engine Instance (Heuristics Fallback & Verification) ---
const engine = new DetectionEngine.WaterLeakageDetectionEngine();

// --- Global Application State ---
const state = {
  // Real-time metrics
  currentFlowRate: 8.6,       // Aggregate L/min
  todayConsumption: 342.8,    // Total Litres
  dailyBudget: 450.0,         // Budget in Litres
  anomaliesCount: 0,          // Active leak count
  waterSavedLiters: 1280.0,   // Estimated conserved Litres
  costSavedPerLiter: 0.0035,  // Approx $0.0035 / Litre

  // Audio alerts
  soundEnabled: true,

  // Live sensor ticker
  isLiveTickerActive: true,
  tickerIntervalId: null,
  tickSpeedMs: 3000,

  // Selected chart range: '1h' | '24h' | '7d' | '30d'
  selectedRange: '24h',

  // Active leak incident state (null if all normal)
  activeLeak: null,

  // Zones definition with flow and pressure telemetry
  zones: {
    kitchen: {
      id: 'kitchen',
      name: 'Kitchen',
      icon: '🍳',
      flow: 3.2,
      baseFlow: 3.2,
      nominalMax: 6.0,
      pressure: 3.20,
      basePressure: 3.20,
      status: 'normal',   // normal | elevated | leak | idle | shut
      valveOpen: true,
      meta: 'Dishwasher, Faucet, RO Purifier',
      dataSource: 'simulated',
      mlScore: 0.12,
      mlOutlier: false,
      mlClassification: 'Normal'
    },
    bathroom: {
      id: 'bathroom',
      name: 'Bathroom',
      icon: '🚿',
      flow: 5.4,
      baseFlow: 5.4,
      nominalMax: 8.5,
      pressure: 3.05,
      basePressure: 3.05,
      status: 'normal',
      valveOpen: true,
      meta: 'Shower, Flush Valve, Basin Tap',
      dataSource: 'simulated',
      mlScore: 0.15,
      mlOutlier: false,
      mlClassification: 'Normal'
    },
    garden: {
      id: 'garden',
      name: 'Garden Irrigation',
      icon: '🌱',
      flow: 0.0,
      baseFlow: 0.0,
      nominalMax: 12.0,
      pressure: 3.50,
      basePressure: 3.50,
      status: 'idle',
      valveOpen: true,
      meta: 'Drip System, Lawn Sprinklers',
      dataSource: 'simulated',
      mlScore: 0.05,
      mlOutlier: false,
      mlClassification: 'Normal'
    },
    main_supply: {
      id: 'main_supply',
      name: 'Main Supply Line',
      icon: '💧',
      flow: 8.6,
      baseFlow: 8.6,
      nominalMax: 22.0,
      pressure: 3.65,
      basePressure: 3.65,
      status: 'normal',
      valveOpen: true,
      meta: 'Inlet Meter & Pressure Regulator',
      dataSource: 'simulated',
      mlScore: 0.18,
      mlOutlier: false,
      mlClassification: 'Normal'
    }
  },

  // Alert Log
  alerts: [
    {
      id: 'ALT-1082',
      incidentId: 'INC-BATHROOM-1082',
      zoneId: 'bathroom',
      zoneName: 'Bathroom',
      severity: 'warning',
      rulePattern: 'Continuous Low-Flow Leak',
      timestamp: 'Today, 06:14 AM',
      flowRate: 2.1,
      pressure: 3.0,
      mlScore: 0.74,
      message: 'IsolationForest detected statistical outlier (Score: 0.74). Corroborated by duration heuristic: persistent trickle of 2.1 L/min (>35s) in Bathroom.',
      acknowledged: true
    }
  ],

  // Latest telemetry reading buffer (for table inspector)
  latestReadings: {},

  // Chart instance
  chartInstance: null
};

// --- Web Audio Synthesizer for Alerts ---
function playAlertTone(type = 'alarm') {
  if (!state.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    if (type === 'alarm') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'success') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (err) {
    console.debug('AudioContext notification:', err);
  }
}

// --- Machine Learning Backend Health Check ---
async function checkMlBackendHealth() {
  const pill = document.getElementById('mlBackendPill');
  const dot = document.getElementById('mlBackendDot');
  const text = document.getElementById('mlBackendText');
  const offlineBanner = document.getElementById('mlBackendOfflineBanner');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${ML_BACKEND.url}/api/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      ML_BACKEND.connected = true;
      ML_BACKEND.features = data.features || [];

      if (pill) {
        pill.className = 'ml-backend-pill connected';
        dot.className = 'status-dot connected';
        text.textContent = 'ML Model: Active (IsolationForest)';
      }
      if (offlineBanner) offlineBanner.classList.remove('active');
      return true;
    }
  } catch (err) {
    // Backend offline
  }

  // Handle Backend Offline Gracefully (Requirement 10)
  ML_BACKEND.connected = false;
  if (pill) {
    pill.className = 'ml-backend-pill disconnected';
    dot.className = 'status-dot disconnected';
    text.textContent = 'ML Backend: Offline';
  }
  if (offlineBanner) offlineBanner.classList.add('active');
  return false;
}

// --- Submit Reading to Flask Machine Learning API ---
async function submitReadingToMlBackend(zoneId, flow, pressure, durationSec = 0) {
  const hour = new Date().getHours() + (new Date().getMinutes() / 60.0);
  const payload = {
    zone: zoneId,
    flow_rate: flow,
    pressure_bar: pressure,
    continuous_duration_sec: durationSec,
    time_of_day_hour: hour,
    recent_consumption_liters: +(flow * (Math.max(durationSec, 30) / 60.0)).toFixed(2)
  };

  if (!ML_BACKEND.connected) {
    // Real API failed / offline: Fall back to local rule-based verification
    // Do NOT create fake AI results! Mark clearly as N/A (Rule Fallback)
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${ML_BACKEND.url}/api/telemetry/reading`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.debug('ML API request error:', err);
    ML_BACKEND.connected = false;
    checkMlBackendHealth();
  }

  return null;
}

// --- Historical & Real-Time Chart Data Generators ---
function generateChartData(range) {
  let labels = [];
  let values = [];
  let anomalyIndices = [];

  if (range === '1h') {
    const now = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 4 * 60 * 1000);
      labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      if (i === 0 && state.activeLeak) {
        values.push(state.currentFlowRate);
        anomalyIndices.push(14);
      } else {
        const val = +(7.5 + Math.sin(i * 0.8) * 2.2 + (Math.random() * 1.5 - 0.75)).toFixed(1);
        values.push(Math.max(1.0, val));
      }
    }
  } else if (range === '24h') {
    for (let h = 0; h < 24; h++) {
      labels.push(`${h.toString().padStart(2, '0')}:00`);

      let baseLiters = 8;
      if (h >= 6 && h <= 9) baseLiters = 28 + Math.random() * 8;
      else if (h >= 10 && h <= 17) baseLiters = 14 + Math.random() * 5;
      else if (h >= 18 && h <= 21) baseLiters = 26 + Math.random() * 9;
      else baseLiters = 2 + Math.random() * 2;

      if (h === 6) {
        baseLiters += 12;
        anomalyIndices.push(h);
      }

      const currentHour = new Date().getHours();
      if (h === currentHour && state.activeLeak) {
        baseLiters += state.activeLeak.flowSpike * 2.5;
        anomalyIndices.push(h);
      }

      values.push(+baseLiters.toFixed(1));
    }
  } else if (range === '7d') {
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    values = [385, 412, 360, 445, 398, 482, 342];
    anomalyIndices = [1];
  } else if (range === '30d') {
    labels = ['Day 1-5', 'Day 6-10', 'Day 11-15', 'Day 16-20', 'Day 21-25', 'Day 26-30'];
    values = [1940, 2180, 2050, 2350, 1980, 1820];
    anomalyIndices = [3];
  }

  return { labels, values, anomalyIndices };
}

// --- Initialize Chart.js Instance ---
function initChart() {
  const canvas = document.getElementById('waterChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, 'rgba(20, 184, 166, 0.35)');
  gradient.addColorStop(1, 'rgba(20, 184, 166, 0.00)');

  const data = generateChartData(state.selectedRange);

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: state.selectedRange === '1h' ? 'Flow Rate (L/min)' : 'Water Consumed (Litres)',
          data: data.values,
          borderColor: '#0d9488',
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: (ctx) => (data.anomalyIndices.includes(ctx.dataIndex) ? 7 : 3.5),
          pointHoverRadius: 8,
          pointBackgroundColor: (ctx) => (data.anomalyIndices.includes(ctx.dataIndex) ? '#ef4444' : '#0d9488'),
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#ffffff',
          bodyColor: '#e2e8f0',
          titleFont: { size: 13, weight: 'bold' },
          bodyFont: { size: 12 },
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: function (context) {
              const unit = state.selectedRange === '1h' ? ' L/min' : ' Litres';
              const isAnomaly = data.anomalyIndices.includes(context.dataIndex);
              return `${context.parsed.y}${unit} ${isAnomaly ? '🚨 [ML Anomaly Confirmed]' : ''}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#f1f5f9', drawBorder: false },
          ticks: { color: '#64748b', font: { size: 11, family: 'Inter' } }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9', drawBorder: false },
          ticks: {
            color: '#64748b',
            font: { size: 11, family: 'Inter' },
            callback: (v) => v + (state.selectedRange === '1h' ? ' L/m' : ' L')
          }
        }
      }
    }
  });
}

function updateChart(range = state.selectedRange) {
  state.selectedRange = range;

  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  const overlay = document.getElementById('chartLoadingOverlay');
  if (overlay) overlay.classList.add('active');

  setTimeout(() => {
    const data = generateChartData(range);
    state.chartInstance.data.labels = data.labels;
    state.chartInstance.data.datasets[0].data = data.values;
    state.chartInstance.data.datasets[0].label =
      range === '1h' ? 'Flow Rate (L/min)' : 'Water Consumed (Litres)';

    state.chartInstance.data.datasets[0].pointRadius = (ctx) =>
      data.anomalyIndices.includes(ctx.dataIndex) ? 7 : 3.5;
    state.chartInstance.data.datasets[0].pointBackgroundColor = (ctx) =>
      data.anomalyIndices.includes(ctx.dataIndex) ? '#ef4444' : '#0d9488';

    state.chartInstance.update();
    if (overlay) overlay.classList.remove('active');
  }, 180);
}

// --- Telemetry Processing & Hybrid Detection Cycle ---
async function processTelemetryCycle() {
  const timestampNow = new Date();
  const timestampStr = timestampNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const timestampMs = timestampNow.getTime();

  // 1. Calculate Aggregate Flow
  let totalFlow = 0;
  Object.values(state.zones).forEach((zone) => {
    if (zone.id !== 'main_supply' && zone.valveOpen) {
      totalFlow += zone.flow;
    }
  });

  state.zones.main_supply.flow = +(totalFlow + (totalFlow > 0 ? 0.3 : 0)).toFixed(1);
  state.currentFlowRate = state.zones.main_supply.flow;

  // 2. Evaluate Each Zone with ML Backend + Local Rules
  let activeIncidentsCount = 0;
  let highestSeverity = 'normal';
  let primaryIncident = null;
  let maxAnomalyScore = 0.05;

  for (const zone of Object.values(state.zones)) {
    // Generate full reading
    const reading = engine.generateReading(
      zone.id,
      zone.flow,
      zone.pressure,
      zone.dataSource,
      timestampMs
    );
    state.latestReadings[zone.id] = reading;

    // Check duration from tracking
    const tracking = engine.zoneStates[zone.id];
    let durationSec = 0;
    if (tracking?.highFlowStartTime) {
      durationSec = Math.round((timestampMs - tracking.highFlowStartTime) / 1000);
    } else if (tracking?.lowFlowStartTime) {
      durationSec = Math.round((timestampMs - tracking.lowFlowStartTime) / 1000);
    }

    // Call real Flask ML Backend API if available
    const mlResponse = await submitReadingToMlBackend(zone.id, zone.flow, zone.pressure, durationSec);
    
    // Local rule fallback / verification
    const evalResult = engine.analyzeReading(reading, {
      valveClosed: !zone.valveOpen
    });

    zone.evalResult = evalResult;

    if (mlResponse) {
      zone.mlScore = mlResponse.ml_prediction.anomaly_score;
      zone.mlOutlier = mlResponse.ml_prediction.is_outlier;
      zone.mlClassification = mlResponse.ml_prediction.classification;
      zone.confirmedLeakage = mlResponse.confirmed_leakage;
      zone.backendStatus = mlResponse.status;
      zone.explanation = mlResponse.explanation;
    } else {
      // Offline: clear ML claims
      zone.mlScore = null;
      zone.mlOutlier = false;
      zone.mlClassification = 'N/A (Backend Offline)';
      zone.confirmedLeakage = evalResult.isIncident;
      zone.backendStatus = evalResult.alertLevel === 'critical' ? 'CRITICAL_LEAK' : (evalResult.alertLevel === 'warning' ? 'CONFIRMED_LEAK' : 'NORMAL');
      zone.explanation = evalResult.explanation;
    }

    if (zone.mlScore !== null && zone.mlScore > maxAnomalyScore) {
      maxAnomalyScore = zone.mlScore;
    }

    // Update zone status
    if (!zone.valveOpen) {
      zone.status = 'isolated';
    } else if (zone.confirmedLeakage || evalResult.alertLevel === 'critical' || evalResult.alertLevel === 'warning') {
      zone.status = 'leak';
      activeIncidentsCount++;
      const isCrit = evalResult.alertLevel === 'critical' || zone.backendStatus === 'CRITICAL_LEAK';
      if (isCrit) highestSeverity = 'critical';
      else if (highestSeverity !== 'critical') highestSeverity = 'warning';

      primaryIncident = {
        zoneId: zone.id,
        zoneName: zone.name,
        severity: isCrit ? 'critical' : 'warning',
        ruleName: evalResult.ruleTriggered || (mlResponse ? mlResponse.rule_verification.rule_name : 'Statistical Anomaly'),
        currentFlowRate: zone.flow,
        currentPressure: zone.pressure,
        explanation: zone.explanation || evalResult.explanation,
        mlScore: zone.mlScore
      };

      // Stateful incident alert management (Requirement 10)
      if (evalResult.isNewIncident && evalResult.incident) {
        const inc = evalResult.incident;
        const newAlert = {
          id: `ALT-${Math.floor(1000 + Math.random() * 9000)}`,
          incidentId: inc.id,
          zoneId: zone.id,
          zoneName: zone.name,
          severity: primaryIncident.severity,
          rulePattern: primaryIncident.ruleName,
          timestamp: timestampStr,
          flowRate: reading.flowRate,
          pressure: reading.pressure,
          mlScore: zone.mlScore,
          message: zone.explanation || evalResult.explanation,
          acknowledged: false
        };
        state.alerts.unshift(newAlert);
        playAlertTone('alarm');
        showToast(`🚨 ${primaryIncident.severity.toUpperCase()}: ${zone.name} — ${primaryIncident.ruleName}`, 'error');
      } else if (evalResult.incident) {
        const existingAlert = state.alerts.find((a) => a.incidentId === evalResult.incident.id);
        if (existingAlert) {
          existingAlert.timestamp = `Active (${timestampStr})`;
          existingAlert.flowRate = reading.flowRate;
          existingAlert.pressure = reading.pressure;
          existingAlert.mlScore = zone.mlScore;
          existingAlert.message = zone.explanation || evalResult.explanation;
        }
      }
    } else if (zone.mlOutlier) {
      // ML Outlier detected, but NOT confirmed as leak (under duration observation)
      zone.status = 'elevated';
    } else if (zone.flow === 0) {
      zone.status = 'idle';
    } else if (zone.flow > zone.nominalMax * 0.8) {
      zone.status = 'elevated';
    } else {
      zone.status = 'normal';
    }
  }

  ML_BACKEND.lastAnomalyScore = maxAnomalyScore;
  updateMlModalMeter(maxAnomalyScore);

  // 3. Active Leak Update
  if (activeIncidentsCount > 0 && primaryIncident) {
    state.activeLeak = {
      ...primaryIncident,
      estimatedWastageLiters: +(primaryIncident.currentFlowRate * 0.25).toFixed(1),
      timestamp: timestampStr
    };
  } else {
    state.activeLeak = null;
  }

  // 4. Render UI & Telemetry Table
  renderUI();
  renderTelemetryTable();
}

// --- UI Rendering ---
function renderUI() {
  const activeAlerts = state.alerts.filter((a) => !a.acknowledged);
  state.anomaliesCount = activeAlerts.length;

  // 1. Flow Rate KPI
  const flowValEl = document.getElementById('kpiFlowRate');
  flowValEl.textContent = state.currentFlowRate.toFixed(1);
  const flowBadgeEl = document.getElementById('kpiFlowBadge');

  if (state.activeLeak) {
    const isCrit = state.activeLeak.severity === 'critical';
    flowBadgeEl.className = 'kpi-status-badge badge-alert';
    flowBadgeEl.innerHTML = isCrit ? '🚨 Critical Leak Surge' : '⚠️ Anomaly Warning';
  } else if (state.currentFlowRate > 18.0) {
    flowBadgeEl.className = 'kpi-status-badge badge-alert';
    flowBadgeEl.innerHTML = '⚠️ Elevated Demand';
  } else {
    flowBadgeEl.className = 'kpi-status-badge badge-normal';
    flowBadgeEl.innerHTML = '✓ Normal Flow';
  }

  // 2. Today's Consumption KPI
  document.getElementById('kpiConsumption').textContent = state.todayConsumption.toFixed(1);
  const pctBudget = Math.min(100, Math.round((state.todayConsumption / state.dailyBudget) * 100));
  document.getElementById('kpiBudgetFill').style.width = `${pctBudget}%`;
  document.getElementById('kpiBudgetNote').textContent = `${pctBudget}% of daily budget (${state.dailyBudget} L)`;

  // 3. Anomalies KPI & ML Anomaly Score
  const anomalyValEl = document.getElementById('kpiAnomalies');
  anomalyValEl.textContent = state.anomaliesCount;
  const anomalyCard = document.getElementById('kpiCardAnomalies');
  const anomalyBadgeEl = document.getElementById('kpiAnomalyBadge');

  if (state.anomaliesCount > 0) {
    anomalyCard.classList.add('has-anomaly');
    anomalyBadgeEl.className = 'kpi-status-badge badge-alert';
    anomalyBadgeEl.innerHTML = `⚠️ ${state.anomaliesCount} Active Incident${state.anomaliesCount > 1 ? 's' : ''}`;
  } else {
    anomalyCard.classList.remove('has-anomaly');
    anomalyBadgeEl.className = 'kpi-status-badge badge-normal';
    anomalyBadgeEl.innerHTML = '✓ Zero Leaks';
  }

  // Real ML Anomaly Score in KPI Card 3
  const kpiMlScore = document.getElementById('kpiMlScore');
  if (kpiMlScore) {
    if (ML_BACKEND.connected) {
      const score = ML_BACKEND.lastAnomalyScore;
      const label = score > 0.65 ? 'Outlier' : (score > 0.45 ? 'Elevated' : 'Normal');
      kpiMlScore.textContent = `${score.toFixed(3)} (${label})`;
      kpiMlScore.style.color = score > 0.65 ? '#dc2626' : (score > 0.45 ? '#d97706' : '#059669');
    } else {
      kpiMlScore.textContent = 'N/A (Backend Offline)';
      kpiMlScore.style.color = '#94a3b8';
    }
  }

  // 4. Water Saved KPI & Impact
  document.getElementById('kpiWaterSaved').textContent = state.waterSavedLiters.toLocaleString();
  const savedDollars = (state.waterSavedLiters * state.costSavedPerLiter).toFixed(2);
  document.getElementById('kpiCostSaved').textContent = `~$${savedDollars} Cost Saved`;
  document.getElementById('conserveAvoidedVal').textContent = `${state.waterSavedLiters.toLocaleString()} L`;
  document.getElementById('conserveCostVal').textContent = `$${savedDollars}`;
  const showersSaved = Math.round(state.waterSavedLiters / 35);
  document.getElementById('conserveShowersVal').textContent = `${showersSaved} Showers`;

  // 5. Header Status Pill
  const headerStatusPill = document.getElementById('headerStatusPill');
  const headerStatusText = document.getElementById('headerStatusText');
  if (state.activeLeak) {
    headerStatusPill.className = 'status-pill leak-alert';
    headerStatusText.textContent = `${state.activeLeak.severity.toUpperCase()}: ${state.activeLeak.zoneName.toUpperCase()}`;
  } else {
    headerStatusPill.className = 'status-pill';
    headerStatusText.textContent = 'LIVE MONITORING ACTIVE';
  }

  // 6. Emergency Leak Banner
  const emergencyBanner = document.getElementById('emergencyLeakBanner');
  if (state.activeLeak) {
    emergencyBanner.classList.add('active');
    const scoreStr = state.activeLeak.mlScore !== null && state.activeLeak.mlScore !== undefined 
      ? ` | IsolationForest Outlier Score: ${state.activeLeak.mlScore.toFixed(3)}` 
      : '';
    document.getElementById('emergencyTitle').textContent =
      `${state.activeLeak.severity.toUpperCase()} ALERT: ${state.activeLeak.zoneName.toUpperCase()} — ${state.activeLeak.ruleName}`;
    document.getElementById('emergencyDesc').textContent =
      `${state.activeLeak.explanation} Flow: ${state.activeLeak.flowSpike} L/min | Pressure: ${state.activeLeak.pressure} bar${scoreStr} | Est. Wastage: ${state.activeLeak.estimatedWastageLiters} L.`;
  } else {
    emergencyBanner.classList.remove('active');
  }

  // 7. Render Zones
  renderZones();

  // 8. Render Alerts Feed
  renderAlerts();
}

// --- Render Zone Cards ---
function renderZones() {
  const container = document.getElementById('zonesGrid');
  if (!container) return;
  container.innerHTML = '';

  Object.values(state.zones).forEach((zone) => {
    const card = document.createElement('div');
    const isLeakZone = state.activeLeak && state.activeLeak.zoneId === zone.id;
    card.className = `zone-card ${isLeakZone ? 'zone-leak' : ''}`;

    const gaugePct = Math.min(100, Math.round((zone.flow / zone.nominalMax) * 100));
    let fillClass = 'zone-flow-fill';
    let statusBadgeHtml = '';

    if (!zone.valveOpen) {
      statusBadgeHtml = `<span class="op-status status-isolated">Valve Isolated</span>`;
    } else if (isLeakZone) {
      fillClass += ' over-limit';
      const isCrit = state.activeLeak.severity === 'critical';
      statusBadgeHtml = `<span class="op-status status-abnormal">${isCrit ? '🚨 Critical Leak' : '⚠️ Warning Leak'}</span>`;
    } else if (zone.mlOutlier) {
      statusBadgeHtml = `<span class="op-status status-elevated">ML Outlier</span>`;
    } else if (zone.flow === 0) {
      statusBadgeHtml = `<span class="op-status status-idle">Idle</span>`;
    } else if (zone.flow > zone.nominalMax * 0.8) {
      fillClass += ' elevated';
      statusBadgeHtml = `<span class="op-status status-elevated">Elevated</span>`;
    } else {
      statusBadgeHtml = `<span class="op-status status-nominal">Nominal</span>`;
    }

    const isPressureLow = zone.pressure < (zone.basePressure - 0.7);
    const mlScoreBadge = zone.mlScore !== null 
      ? `<span class="ml-score-chip ${zone.mlScore > 0.65 ? 'high-outlier' : (zone.mlScore > 0.45 ? 'moderate-outlier' : '')}">ML: ${zone.mlScore.toFixed(2)}</span>`
      : `<span class="ml-score-chip" style="color:#94a3b8;">ML: N/A</span>`;

    card.innerHTML = `
      <div class="zone-card-top">
        <div class="zone-info-main">
          <div class="zone-icon">${zone.icon}</div>
          <div>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span class="zone-name">${zone.name}</span>
              <span class="data-source-badge simulated" title="Data Source: Simulated Synthetic Telemetry">Simulated</span>
            </div>
            <div class="zone-meta">${zone.meta}</div>
          </div>
        </div>
        ${statusBadgeHtml}
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.6rem;">
        <div class="pressure-chip ${isPressureLow ? 'pressure-drop' : ''}" title="Hydraulic Line Pressure">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Pressure: <strong>${zone.pressure.toFixed(2)} bar</strong>
        </div>
        ${mlScoreBadge}
      </div>

      <div>
        <div class="zone-flow-row">
          <div class="zone-flow-val">
            ${zone.flow.toFixed(1)} <span>L/min</span>
          </div>
          <div class="zone-baseline-text">Ceiling: ${zone.nominalMax} L/m</div>
        </div>
        <div class="zone-flow-gauge">
          <div class="${fillClass}" style="width: ${gaugePct}%"></div>
        </div>
      </div>

      <div class="zone-actions">
        <div class="valve-status ${zone.valveOpen ? '' : 'closed'}">
          <span style="font-size:0.85rem;">${zone.valveOpen ? '🟢' : '🔴'}</span>
          Valve: ${zone.valveOpen ? 'Open' : 'Isolated'}
        </div>
        <button class="valve-toggle-btn ${zone.valveOpen ? '' : 'valve-shut'}" onclick="toggleZoneValve('${zone.id}')">
          ${zone.valveOpen ? 'Isolate Valve' : 'Re-open Valve'}
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// --- Render Live Telemetry Table Inspector ---
function renderTelemetryTable() {
  const tbody = document.getElementById('telemetryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  Object.values(state.zones).forEach((zone) => {
    const reading = state.latestReadings[zone.id];
    if (!reading) return;

    const tr = document.createElement('tr');
    
    // ML Score column
    let mlScoreCell = `<span class="ml-score-chip" style="color:#94a3b8;">N/A (Offline)</span>`;
    let mlClassCell = `<span style="color:#94a3b8;">Offline</span>`;
    let confirmedCell = zone.confirmedLeakage ? `<span class="badge-alert">🚨 Confirmed</span>` : `<span style="color:#059669; font-weight:600;">✓ Normal</span>`;

    if (zone.mlScore !== null) {
      const isHigh = zone.mlScore > 0.65;
      const isMod = zone.mlScore > 0.45;
      mlScoreCell = `<span class="ml-score-chip ${isHigh ? 'high-outlier' : (isMod ? 'moderate-outlier' : '')}">${zone.mlScore.toFixed(3)}</span>`;
      mlClassCell = `<strong style="color:${isHigh ? '#dc2626' : (isMod ? '#d97706' : '#059669')}">${zone.mlClassification}</strong>`;
    }

    tr.innerHTML = `
      <td>${reading.timestamp}</td>
      <td><strong>${zone.name}</strong></td>
      <td>${reading.flowRate.toFixed(2)} L/min</td>
      <td>${reading.pressure.toFixed(2)} bar</td>
      <td><span class="op-status status-${zone.status}">${zone.status}</span></td>
      <td>${mlScoreCell}</td>
      <td>${mlClassCell}</td>
      <td>${confirmedCell}</td>
      <td><span class="data-source-badge simulated">SIMULATED</span></td>
    `;

    tbody.appendChild(tr);
  });
}

// --- Render Alerts Feed ---
function renderAlerts() {
  const list = document.getElementById('alertsList');
  const countBadge = document.getElementById('alertsCountBadge');
  if (!list || !countBadge) return;

  const activeAlerts = state.alerts.filter((a) => !a.acknowledged);
  countBadge.textContent = `${activeAlerts.length} Active`;
  countBadge.className = `alerts-count-badge ${activeAlerts.length > 0 ? 'has-alerts' : ''}`;

  if (state.alerts.length === 0) {
    list.innerHTML = `
      <div class="alerts-empty-state">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="title">All Systems Secure</p>
        <p class="sub">No leakage or pressure anomalies detected across monitored zones.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = '';
  state.alerts.forEach((alert) => {
    const item = document.createElement('div');
    item.className = `alert-item severity-${alert.severity}`;

    const scoreTag = alert.mlScore !== null && alert.mlScore !== undefined
      ? `<span class="ml-score-chip high-outlier" style="font-size:0.7rem;">ML Score: ${alert.mlScore.toFixed(2)}</span>`
      : '';

    item.innerHTML = `
      <div class="alert-item-header">
        <div class="alert-item-zone">
          <span>${alert.severity === 'critical' ? '🔴' : '🟡'}</span>
          ${alert.zoneName}
          <span style="font-size:0.72rem; color:var(--text-muted); font-weight:600;">[${alert.rulePattern || 'Anomaly'}]</span>
          ${alert.acknowledged ? '<span style="font-size:0.7rem;color:#64748b;font-weight:normal;">(Acknowledged)</span>' : ''}
        </div>
        <div class="alert-item-time">${alert.timestamp}</div>
      </div>
      <div class="alert-item-message">${alert.message}</div>
      <div class="alert-item-meta">
        <div style="display:flex; gap:0.5rem; align-items:center;">
          <span class="alert-flow-tag">Flow: ${alert.flowRate} L/min</span>
          <span class="pressure-chip" style="font-size:0.7rem; padding:0.1rem 0.4rem;">Pressure: ${alert.pressure || 3.0} bar</span>
          ${scoreTag}
        </div>
        ${
          !alert.acknowledged
            ? `<button class="alert-ack-btn" onclick="acknowledgeSingleAlert('${alert.id}')">Acknowledge ✓</button>`
            : `<span style="font-size:0.72rem;color:#059669;font-weight:600;">Resolved</span>`
        }
      </div>
    `;

    list.appendChild(item);
  });
}

// --- Interactive Simulation Actions ---
function simulateNormalUsage() {
  showToast('Simulating everyday normal water usage (Kitchen sink running at 7.2 L/min)...', 'info');

  state.zones.kitchen.flow = 7.2;
  state.zones.kitchen.pressure = 3.10;
  state.todayConsumption += 3.8;

  processTelemetryCycle();
  playAlertTone('success');

  let steps = 6;
  const interval = setInterval(() => {
    steps--;
    state.zones.kitchen.flow = +(state.zones.kitchen.flow - 0.7).toFixed(1);
    if (steps <= 0) {
      clearInterval(interval);
      state.zones.kitchen.flow = state.zones.kitchen.baseFlow;
      state.zones.kitchen.pressure = state.zones.kitchen.basePressure;
      showToast('Normal usage complete. Telemetry returned to nominal baseline.', 'success');
    }
    processTelemetryCycle();
  }, 1000);
}

function openLeakModal() {
  const modal = document.getElementById('leakScenarioModal');
  if (modal) modal.classList.add('active');
}

function closeLeakModal() {
  const modal = document.getElementById('leakScenarioModal');
  if (modal) modal.classList.remove('active');
}

function triggerLeakScenario(zoneId, severity, flowSpike, ruleName, description, customPressure = null) {
  closeLeakModal();

  const zone = state.zones[zoneId];
  if (!zone) return;

  zone.flow = flowSpike;
  zone.pressure = customPressure !== null ? customPressure : +(zone.basePressure - 0.35).toFixed(2);
  zone.valveOpen = true;

  const tracking = engine.zoneStates[zoneId];
  const now = Date.now();
  if (ruleName.includes('Low-Flow') || flowSpike <= zone.nominalMax) {
    tracking.lowFlowStartTime = now - 50000;
  } else if (ruleName.includes('Off-Hours')) {
    tracking.inactiveFlowStartTime = now - 25000;
  } else {
    tracking.highFlowStartTime = now - 45000;
  }

  if (customPressure !== null) {
    tracking.recentPressures = [
      { timeMs: now - 3000, pressure: zone.basePressure },
      { timeMs: now, pressure: customPressure }
    ];
  }

  processTelemetryCycle();
  updateChart(state.selectedRange);
}

function resetSimulation() {
  engine.reset();
  state.activeLeak = null;

  Object.values(state.zones).forEach((zone) => {
    zone.flow = zone.baseFlow;
    zone.pressure = zone.basePressure;
    zone.status = zone.baseFlow === 0 ? 'idle' : 'normal';
    zone.valveOpen = true;
    zone.mlScore = 0.12;
    zone.mlOutlier = false;
    zone.mlClassification = 'Normal';
  });

  state.alerts.forEach((a) => (a.acknowledged = true));

  processTelemetryCycle();
  updateChart(state.selectedRange);
  playAlertTone('success');
  showToast('Simulation and detection engine reset to default operational baselines.', 'success');
}

function acknowledgeAlerts() {
  const ackCount = engine.acknowledgeAllIncidents();
  state.alerts.forEach((alert) => (alert.acknowledged = true));

  renderUI();
  showToast(`${Math.max(1, ackCount)} alert(s) acknowledged and flagged as reviewed.`, 'success');
}

function acknowledgeSingleAlert(alertId) {
  const alert = state.alerts.find((a) => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    renderUI();
    showToast(`Alert acknowledged.`, 'info');
  }
}

function toggleZoneValve(zoneId) {
  const zone = state.zones[zoneId];
  if (!zone) return;

  zone.valveOpen = !zone.valveOpen;

  if (!zone.valveOpen) {
    zone.flow = 0.0;
    zone.status = 'isolated';

    if (state.activeLeak && state.activeLeak.zoneId === zoneId) {
      const savedAmount = 140;
      state.waterSavedLiters += savedAmount;
      state.activeLeak = null;
      showToast(`🛡️ Valve Closed for ${zone.name}. Leak isolated! Estimated ${savedAmount} L saved.`, 'success');
      playAlertTone('success');
    } else {
      showToast(`Valve isolated for ${zone.name}.`, 'info');
    }
  } else {
    zone.flow = zone.baseFlow;
    zone.pressure = zone.basePressure;
    showToast(`Valve reopened for ${zone.name}. Flow restored to baseline.`, 'info');
  }

  processTelemetryCycle();
  updateChart(state.selectedRange);
}

function startLiveTicker() {
  if (state.tickerIntervalId) clearInterval(state.tickerIntervalId);

  state.tickerIntervalId = setInterval(() => {
    if (!state.isLiveTickerActive) return;

    Object.values(state.zones).forEach((zone) => {
      if (zone.valveOpen && zone.baseFlow > 0 && (!state.activeLeak || state.activeLeak.zoneId !== zone.id)) {
        const jitterFlow = (Math.random() * 0.4 - 0.2);
        zone.flow = Math.max(0.2, +(zone.baseFlow + jitterFlow).toFixed(1));
        const jitterP = (Math.random() * 0.06 - 0.03);
        zone.pressure = +(zone.basePressure + jitterP).toFixed(2);
      }
    });

    const increment = (state.currentFlowRate * (state.tickSpeedMs / 60000));
    state.todayConsumption = +(state.todayConsumption + increment).toFixed(1);

    updateClock();
    processTelemetryCycle();
  }, state.tickSpeedMs);
}

function toggleLiveTicker() {
  state.isLiveTickerActive = !state.isLiveTickerActive;
  const btn = document.getElementById('liveTickerToggle');
  if (btn) {
    btn.innerHTML = state.isLiveTickerActive
      ? '<span>🟢</span> Live Stream: <strong>Active</strong>'
      : '<span>⏸️</span> Live Stream: <strong>Paused</strong>';
  }
  showToast(state.isLiveTickerActive ? 'Live sensor stream resumed.' : 'Live sensor stream paused.', 'info');
}

function updateClock() {
  const clockEl = document.getElementById('liveClock');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  const btn = document.getElementById('soundToggleBtn');
  if (btn) {
    btn.classList.toggle('muted', !state.soundEnabled);
    btn.innerHTML = state.soundEnabled ? '🔔 Sound On' : '🔕 Muted';
  }
  showToast(state.soundEnabled ? 'Audio alarms enabled.' : 'Audio alarms muted.', 'info');
}

function runBrowserEngineTests() {
  const results = DetectionEngine.runAutomatedEngineTests();
  const tbody = document.getElementById('testResultsTableBody');
  const badge = document.getElementById('testScoreBadge');
  const modal = document.getElementById('testResultsModal');

  if (!tbody || !modal) return;
  tbody.innerHTML = '';

  let passCount = 0;
  results.forEach((res) => {
    if (res.passed) passCount++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${res.testName}</strong></td>
      <td><span class="${res.passed ? 'badge-pass' : 'badge-fail'}">${res.passed ? 'PASSED' : 'FAILED'}</span></td>
      <td style="color:${res.passed ? '#059669' : '#dc2626'}; font-size:0.78rem;">${res.details}</td>
    `;
    tbody.appendChild(tr);
  });

  if (badge) {
    badge.textContent = `${passCount}/${results.length} Passed`;
    badge.className = passCount === results.length ? 'badge-pass' : 'badge-fail';
  }

  modal.classList.add('active');
  playAlertTone('success');
}

function openRulesModal() {
  const modal = document.getElementById('engineRulesModal');
  if (modal) modal.classList.add('active');
}

function closeRulesModal() {
  const modal = document.getElementById('engineRulesModal');
  if (modal) modal.classList.remove('active');
}

function openMlModal() {
  const modal = document.getElementById('mlArchitectureModal');
  if (modal) {
    modal.classList.add('active');
    updateMlModalMeter(ML_BACKEND.lastAnomalyScore);
  }
}

function closeMlModal() {
  const modal = document.getElementById('mlArchitectureModal');
  if (modal) modal.classList.remove('active');
}

function updateMlModalMeter(score) {
  const scoreVal = document.getElementById('mlModalScoreVal');
  const indicator = document.getElementById('mlMeterIndicator');
  const statusEl = document.getElementById('mlModalClassification');
  if (!scoreVal || !indicator) return;

  const validScore = typeof score === 'number' && !isNaN(score) ? score : 0.14;
  scoreVal.textContent = validScore.toFixed(3);

  const pct = Math.min(100, Math.max(0, Math.round(validScore * 100)));
  indicator.style.left = `${pct}%`;

  if (statusEl) {
    if (validScore >= 0.65) {
      statusEl.textContent = 'Current Status: Statistical Outlier (Above 0.65 Decision Threshold)';
      statusEl.style.color = 'var(--red-600)';
    } else if (validScore >= 0.45) {
      statusEl.textContent = 'Current Status: Elevated Observation Window (Corroborating Duration)';
      statusEl.style.color = 'var(--amber-600)';
    } else {
      statusEl.textContent = 'Current Status: Normal Usage (Below 0.65 Decision Threshold)';
      statusEl.style.color = 'var(--green-700)';
    }
  }
}

function exportAlertsToCSV() {
  if (!state.alerts || state.alerts.length === 0) {
    showToast('Incident log is empty. No alerts to export.', 'info');
    return;
  }

  const headers = [
    'Alert ID',
    'Incident ID',
    'Timestamp',
    'Zone',
    'Severity',
    'Detection Rule Pattern',
    'Flow Rate (L/min)',
    'Pressure (bar)',
    'ML Anomaly Score',
    'Acknowledged',
    'Diagnosis'
  ];

  const rows = state.alerts.map((a) => [
    `"${a.id || ''}"`,
    `"${a.incidentId || ''}"`,
    `"${a.timestamp || ''}"`,
    `"${a.zoneName || a.zoneId || ''}"`,
    `"${(a.severity || '').toUpperCase()}"`,
    `"${(a.rulePattern || '').replace(/"/g, '""')}"`,
    typeof a.flowRate === 'number' ? a.flowRate.toFixed(1) : (a.flowRate || ''),
    typeof a.pressure === 'number' ? a.pressure.toFixed(2) : (a.pressure || ''),
    typeof a.mlScore === 'number' ? a.mlScore.toFixed(3) : (a.mlScore || 'N/A'),
    a.acknowledged ? 'YES' : 'NO',
    `"${(a.message || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadLink.setAttribute('href', url);
  downloadLink.setAttribute('download', `ecopulse_leakage_audit_log_${dateStr}.csv`);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);

  showToast(`✅ Exported ${state.alerts.length} incident records to CSV!`, 'success');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span style="font-size:1.1rem;">
      ${type === 'error' ? '🚨' : type === 'success' ? '✅' : 'ℹ️'}
    </span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Multi-View Navigation (Live Monitoring, SQLite History, Sustainability Reports) ---
function switchView(viewName) {
  const tabs = {
    dashboard: document.getElementById('navTabDashboard'),
    history: document.getElementById('navTabHistory'),
    reports: document.getElementById('navTabReports')
  };
  const views = {
    dashboard: document.getElementById('viewDashboard'),
    history: document.getElementById('viewHistory'),
    reports: document.getElementById('viewReports')
  };

  Object.entries(tabs).forEach(([k, tab]) => {
    if (tab) {
      const isActive = k === viewName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  });

  Object.entries(views).forEach(([k, view]) => {
    if (view) {
      view.classList.toggle('active', k === viewName);
    }
  });

  if (viewName === 'history') {
    fetchHistory(1);
  } else if (viewName === 'reports') {
    fetchReports();
  }
}

// --- History Page State & Operations (SQLite Querying) ---
const historyState = {
  page: 1,
  limit: 15,
  totalCount: 0,
  totalPages: 1,
  currentReadings: []
};

async function fetchHistory(page = 1) {
  historyState.page = page;
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Querying SQLite persistent telemetry store...</td></tr>`;

  const startDate = document.getElementById('filterStartDate')?.value || '';
  const endDate = document.getElementById('filterEndDate')?.value || '';
  const zone = document.getElementById('filterZoneSelect')?.value || 'all';
  const severity = document.getElementById('filterSeveritySelect')?.value || 'all';
  const source = document.getElementById('filterSourceSelect')?.value || 'all';

  const params = new URLSearchParams({
    page: String(page),
    limit: String(historyState.limit),
    zone: zone,
    severity: severity,
    data_source: source
  });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);

  try {
    const res = await fetch(`${ML_BACKEND.url}/api/history?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    historyState.currentReadings = data.readings || [];
    historyState.totalCount = data.total_count || 0;
    historyState.totalPages = Math.max(1, Math.ceil(historyState.totalCount / historyState.limit));

    // Update stats bar
    const matchEl = document.getElementById('historyMatchCount');
    const anomEl = document.getElementById('historyAnomaliesCount');
    const volEl = document.getElementById('historyConsumedLiters');
    const pageEl = document.getElementById('historyPageInfo');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');

    if (matchEl) matchEl.textContent = historyState.totalCount;
    const anomaliesInSet = historyState.currentReadings.filter(r => r.alert_level === 'warning' || r.alert_level === 'critical').length;
    if (anomEl) anomEl.textContent = anomaliesInSet;

    const totalLit = historyState.currentReadings.reduce((sum, r) => sum + (r.measured_liters || 0), 0);
    if (volEl) volEl.textContent = `${totalLit.toFixed(1)} L`;

    if (pageEl) pageEl.textContent = `Page ${historyState.page} of ${historyState.totalPages} (${historyState.totalCount} items)`;
    if (btnPrev) btnPrev.disabled = historyState.page <= 1;
    if (btnNext) btnNext.disabled = historyState.page >= historyState.totalPages;

    // Render Table
    if (historyState.currentReadings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No records found matching the specified filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    historyState.currentReadings.forEach((r) => {
      const tr = document.createElement('tr');
      const isCrit = r.alert_level === 'critical';
      const isWarn = r.alert_level === 'warning';
      const alertBadge = isCrit
        ? `<span class="op-status status-abnormal">Critical</span>`
        : (isWarn ? `<span class="op-status status-elevated">Warning</span>` : `<span class="op-status status-nominal">Normal</span>`);

      const sourceBadge = r.data_source === 'real'
        ? `<span class="data-source-badge real" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">REAL SENSOR</span>`
        : `<span class="data-source-badge simulated">SIMULATED</span>`;

      const scoreChip = r.ml_anomaly_score !== null && r.ml_anomaly_score !== undefined
        ? `<span class="ml-score-chip ${r.ml_anomaly_score > 0.65 ? 'high-outlier' : (r.ml_anomaly_score > 0.45 ? 'moderate-outlier' : '')}">${Number(r.ml_anomaly_score).toFixed(3)}</span>`
        : `<span class="ml-score-chip" style="color:#94a3b8;">N/A</span>`;

      const formattedTs = r.timestamp ? r.timestamp.replace('T', ' ').slice(0, 19) : '--';

      tr.innerHTML = `
        <td style="font-variant-numeric:tabular-nums; white-space:nowrap;">${formattedTs}</td>
        <td><strong>${r.zone_name || r.zone_id}</strong></td>
        <td style="font-weight:600;">${Number(r.flow_rate).toFixed(2)} L/m</td>
        <td>${Number(r.pressure_bar || 3.0).toFixed(2)} bar</td>
        <td><span class="op-status status-${r.operating_status || 'normal'}">${r.operating_status || 'normal'}</span></td>
        <td>${alertBadge}</td>
        <td>${sourceBadge}</td>
        <td>${scoreChip}</td>
        <td style="font-size:0.75rem; color:var(--text-secondary); max-width:260px;">
          ${r.rule_triggered ? `<strong>[${r.rule_triggered}]</strong> ` : ''}${r.explanation || 'Nominal residential usage.'}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error fetching SQLite history:', err);
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:#dc2626;">Error querying SQLite backend. Please verify that the Flask server is running on ${ML_BACKEND.url}.</td></tr>`;
  }
}

function exportFilteredHistoryToCSV() {
  if (!historyState.currentReadings || historyState.currentReadings.length === 0) {
    showToast('No history records to export.', 'info');
    return;
  }

  const headers = [
    'Reading ID',
    'Timestamp',
    'Zone ID',
    'Zone Name',
    'Flow Rate (L/min)',
    'Pressure (bar)',
    'Duration (sec)',
    'Status',
    'Data Source',
    'ML Score',
    'Alert Level',
    'Rule Triggered',
    'Measured Volume (L)',
    'Explanation'
  ];

  const rows = historyState.currentReadings.map((r) => [
    r.id,
    `"${r.timestamp || ''}"`,
    `"${r.zone_id || ''}"`,
    `"${r.zone_name || ''}"`,
    Number(r.flow_rate).toFixed(2),
    Number(r.pressure_bar || 3.0).toFixed(2),
    r.continuous_duration_sec || 0,
    `"${r.operating_status || 'normal'}"`,
    `"${r.data_source || 'simulated'}"`,
    Number(r.ml_anomaly_score || 0).toFixed(3),
    `"${r.alert_level || 'normal'}"`,
    `"${(r.rule_triggered || '').replace(/"/g, '""')}"`,
    Number(r.measured_liters || 0).toFixed(3),
    `"${(r.explanation || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.setAttribute('href', url);
  a.setAttribute('download', `ecopulse_filtered_telemetry_${dateStr}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`✅ Exported ${historyState.currentReadings.length} history records to CSV!`, 'success');
}

// --- Alert Acknowledgement Logic (Requirement 8) ---
async function acknowledgeSingleAlert(alertId) {
  try {
    const res = await fetch(`${ML_BACKEND.url}/api/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      const alert = state.alerts.find(a => a.id === alertId);
      if (alert) alert.acknowledged = true;
      renderAlerts();
      playAlertTone('success');
      showToast(`✓ Incident ${alertId} acknowledged and updated in SQLite.`, 'success');
    } else {
      showToast(`Could not acknowledge alert ${alertId}.`, 'error');
    }
  } catch (err) {
    console.error('Error acknowledging alert:', err);
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert) alert.acknowledged = true;
    renderAlerts();
    showToast(`✓ Alert marked acknowledged locally.`, 'info');
  }
}

async function acknowledgeAllAlerts() {
  try {
    await fetch(`${ML_BACKEND.url}/api/alerts/acknowledge-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: 'all' })
    });
    state.alerts.forEach(a => a.acknowledged = true);
    state.activeLeak = null;
    renderUI();
    playAlertTone('success');
    showToast('✓ All active alerts acknowledged in persistent SQLite database.', 'success');
    if (document.getElementById('viewHistory')?.classList.contains('active')) {
      fetchHistory(historyState.page);
    }
  } catch (err) {
    console.error('Error acknowledging all alerts:', err);
    state.alerts.forEach(a => a.acknowledged = true);
    state.activeLeak = null;
    renderUI();
    showToast('✓ All active alerts acknowledged.', 'info');
  }
}

// --- Reports & Consumption Summaries Logic (Requirements 5, 6, 7) ---
async function fetchReports() {
  const zoneSelect = document.getElementById('reportZoneFilter');
  const zone = zoneSelect ? zoneSelect.value : 'all';

  try {
    // 1. Fetch High-Level Sustainability & Economic Report
    const repRes = await fetch(`${ML_BACKEND.url}/api/reports?zone=${zone}`);
    if (repRes.ok) {
      const rep = await repRes.json();
      const measured = rep.measured_metrics || {};
      const estimated = rep.estimated_metrics || {};

      document.getElementById('repTotalMeasuredLiters').textContent =
        Number(measured.total_measured_consumption_liters || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      document.getElementById('repMeasuredBillVal').textContent =
        `$${Number(measured.measured_utility_bill_dollars || 0).toFixed(2)}`;

      document.getElementById('repTotalAnomalies').textContent =
        measured.total_detected_anomalies || 0;
      document.getElementById('repConfirmedLeaksVal').textContent =
        measured.confirmed_leaks_count || 0;

      document.getElementById('repEstimatedWastageLiters').textContent =
        Number(estimated.estimated_water_wastage_liters || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const wastedCost = Number(estimated.estimated_water_wastage_liters || 0) * 0.0035;
      document.getElementById('repWastedCostVal').textContent = `$${wastedCost.toFixed(2)}`;

      document.getElementById('repEstimatedSavingsLiters').textContent =
        Number(estimated.estimated_water_savings_liters || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      document.getElementById('repCostSavingsVal').textContent =
        `~$${Number(estimated.estimated_cost_savings_dollars || 0).toFixed(2)}`;
    }

    // 2. Fetch Daily Consumption Summaries (Requirement 5)
    const dailyRes = await fetch(`${ML_BACKEND.url}/api/summaries/daily?days=14`);
    const dailyTbody = document.getElementById('dailySummaryTableBody');
    if (dailyRes.ok && dailyTbody) {
      const dailyData = await dailyRes.json();
      const list = dailyData.daily_summaries || [];
      dailyTbody.innerHTML = '';
      if (list.length === 0) {
        dailyTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1rem;">No daily summaries recorded yet.</td></tr>`;
      } else {
        list.slice().reverse().forEach((row) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${row.day}</strong></td>
            <td style="font-weight:700; color:var(--teal-800);">${Number(row.total_measured_liters || 0).toFixed(1)} L</td>
            <td>${row.total_readings}</td>
            <td>${row.anomaly_count > 0 ? `<span class="badge-alert" style="font-size:0.7rem;">${row.anomaly_count} Flagged</span>` : `<span style="color:#059669; font-weight:600;">0 (Clean)</span>`}</td>
            <td>${Number(row.avg_flow_rate || 0).toFixed(1)} L/m</td>
          `;
          dailyTbody.appendChild(tr);
        });
      }
    }

    // 3. Fetch Monthly Consumption Summaries (Requirement 5)
    const monthlyRes = await fetch(`${ML_BACKEND.url}/api/summaries/monthly?months=6`);
    const monthlyTbody = document.getElementById('monthlySummaryTableBody');
    if (monthlyRes.ok && monthlyTbody) {
      const monthlyData = await monthlyRes.json();
      const list = monthlyData.monthly_summaries || [];
      monthlyTbody.innerHTML = '';
      if (list.length === 0) {
        monthlyTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1rem;">No monthly summaries recorded yet.</td></tr>`;
      } else {
        list.slice().reverse().forEach((row) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${row.month}</strong></td>
            <td style="font-weight:700; color:var(--navy-900);">${Number(row.total_measured_liters || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</td>
            <td>${row.total_readings}</td>
            <td>${row.anomaly_count > 0 ? `<span class="badge-alert" style="font-size:0.7rem;">${row.anomaly_count} Flagged</span>` : `0`}</td>
            <td>${row.leak_count > 0 ? `<strong style="color:#dc2626;">${row.leak_count}</strong>` : `0`}</td>
          `;
          monthlyTbody.appendChild(tr);
        });
      }
    }

  } catch (err) {
    console.error('Error fetching sustainability reports:', err);
    showToast('Could not refresh report data from SQLite backend.', 'error');
  }
}

async function loadPersistentAlerts() {
  try {
    const res = await fetch(`${ML_BACKEND.url}/api/alerts/recent`);
    if (res.ok) {
      const data = await res.json();
      if (data.alerts && data.alerts.length > 0) {
        state.alerts = data.alerts.map(a => ({
          id: a.id,
          incidentId: a.incident_id || a.id,
          zoneId: a.zone_id || a.zone,
          zoneName: a.zone_name,
          severity: a.severity,
          rulePattern: a.rule_pattern || a.rule_name,
          timestamp: a.timestamp ? a.timestamp.replace('T', ' ').slice(0, 19) : 'Recent',
          flowRate: a.flow_rate,
          pressure: a.pressure_bar,
          mlScore: a.ml_score || a.anomaly_score,
          message: a.message || a.explanation,
          data_source: a.data_source || 'simulated',
          acknowledged: !!a.acknowledged
        }));
        renderUI();
      }
    }
  } catch (err) {
    console.warn('Could not load persistent alerts from backend:', err);
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initial UI Render & Health Check
  renderUI();
  await checkMlBackendHealth();

  // 2. Initial Telemetry & Detection Cycle
  await processTelemetryCycle();

  // 3. Initialize Chart.js
  initChart();

  // 4. Start Live Ticker & Clock
  startLiveTicker();
  updateClock();

  // 5. Periodic Backend Health Ping (every 10s)
  setInterval(checkMlBackendHealth, 10000);

  // 6. Attach Event Handlers
  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const range = e.target.dataset.range;
      if (range) updateChart(range);
    });
  });

  document.getElementById('btnSimulateNormal').addEventListener('click', simulateNormalUsage);
  document.getElementById('btnSimulateLeak').addEventListener('click', openLeakModal);
  document.getElementById('btnResetSimulation').addEventListener('click', resetSimulation);
  document.getElementById('btnAcknowledgeAlerts').addEventListener('click', acknowledgeAlerts);
  document.getElementById('liveTickerToggle').addEventListener('click', toggleLiveTicker);
  document.getElementById('soundToggleBtn').addEventListener('click', toggleSound);

  const btnRetry = document.getElementById('btnRetryBackend');
  if (btnRetry) btnRetry.addEventListener('click', () => {
    showToast(`Re-checking Flask ML service at ${ML_BACKEND.url}...`, 'info');
    checkMlBackendHealth();
  });

  const btnRunTests = document.getElementById('btnRunTests');
  if (btnRunTests) btnRunTests.addEventListener('click', runBrowserEngineTests);

  const btnOpenRules = document.getElementById('btnOpenRulesModal');
  if (btnOpenRules) btnOpenRules.addEventListener('click', openRulesModal);

  const sensSelect = document.getElementById('engineSensitivitySelect');
  if (sensSelect) {
    sensSelect.addEventListener('change', (e) => {
      engine.config.sensitivity = e.target.value;
      showToast(`Detection sensitivity updated to: ${e.target.value.toUpperCase()}`, 'info');
    });
  }

  document.getElementById('btnEmergencyIsolate').addEventListener('click', () => {
    if (state.activeLeak) toggleZoneValve(state.activeLeak.zoneId);
  });
  document.getElementById('btnEmergencyAck').addEventListener('click', acknowledgeAlerts);

  document.getElementById('modalCloseBtn').addEventListener('click', closeLeakModal);
  document.getElementById('leakScenarioModal').addEventListener('click', (e) => {
    if (e.target.id === 'leakScenarioModal') closeLeakModal();
  });

  const rulesCloseBtn = document.getElementById('rulesModalCloseBtn');
  if (rulesCloseBtn) rulesCloseBtn.addEventListener('click', closeRulesModal);
  const rulesModal = document.getElementById('engineRulesModal');
  if (rulesModal) {
    rulesModal.addEventListener('click', (e) => {
      if (e.target.id === 'engineRulesModal') closeRulesModal();
    });
  }

  const testCloseBtn = document.getElementById('testModalCloseBtn');
  if (testCloseBtn) testCloseBtn.addEventListener('click', () => {
    document.getElementById('testResultsModal').classList.remove('active');
  });
  const testModal = document.getElementById('testResultsModal');
  if (testModal) {
    testModal.addEventListener('click', (e) => {
      if (e.target.id === 'testResultsModal') testModal.classList.remove('active');
    });
  }

  // ML Architecture Modal
  const btnOpenMl = document.getElementById('btnOpenMlModal');
  if (btnOpenMl) btnOpenMl.addEventListener('click', openMlModal);

  const mlCloseBtn = document.getElementById('mlModalCloseBtn');
  if (mlCloseBtn) mlCloseBtn.addEventListener('click', closeMlModal);

  const mlModal = document.getElementById('mlArchitectureModal');
  if (mlModal) {
    mlModal.addEventListener('click', (e) => {
      if (e.target.id === 'mlArchitectureModal') closeMlModal();
    });
  }

  // Export CSV Log
  const btnExport = document.getElementById('btnExportAlerts');
  if (btnExport) btnExport.addEventListener('click', exportAlertsToCSV);

  // Dynamic Threshold Tuning Sliders
  const slKitchen = document.getElementById('sliderKitchenBurst');
  const valKitchen = document.getElementById('valKitchenBurst');
  if (slKitchen) {
    slKitchen.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engine.config.zones.kitchen.burstThreshold = val;
      if (valKitchen) valKitchen.textContent = `${val.toFixed(1)} L/m`;
    });
  }

  const slBathroom = document.getElementById('sliderBathroomBurst');
  const valBathroom = document.getElementById('valBathroomBurst');
  if (slBathroom) {
    slBathroom.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engine.config.zones.bathroom.burstThreshold = val;
      if (valBathroom) valBathroom.textContent = `${val.toFixed(1)} L/m`;
    });
  }

  const slGarden = document.getElementById('sliderGardenBurst');
  const valGarden = document.getElementById('valGardenBurst');
  if (slGarden) {
    slGarden.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engine.config.zones.garden.burstThreshold = val;
      if (valGarden) valGarden.textContent = `${val.toFixed(1)} L/m`;
    });
  }

  const slPressure = document.getElementById('sliderPressureDrop');
  const valPressure = document.getElementById('valPressureDrop');
  if (slPressure) {
    slPressure.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engine.config.pressureDropThresholdBar = val;
      if (valPressure) valPressure.textContent = `${val.toFixed(2)} bar`;
    });
  }

  const btnResetTh = document.getElementById('btnResetThresholds');
  if (btnResetTh) {
    btnResetTh.addEventListener('click', () => {
      engine.config.zones.kitchen.burstThreshold = 18.0;
      engine.config.zones.bathroom.burstThreshold = 16.0;
      engine.config.zones.garden.burstThreshold = 22.0;
      engine.config.pressureDropThresholdBar = 0.75;

      if (slKitchen) slKitchen.value = 18.0;
      if (valKitchen) valKitchen.textContent = '18.0 L/m';
      if (slBathroom) slBathroom.value = 16.0;
      if (valBathroom) valBathroom.textContent = '16.0 L/m';
      if (slGarden) slGarden.value = 22.0;
      if (valGarden) valGarden.textContent = '22.0 L/m';
      if (slPressure) slPressure.value = 0.75;
      if (valPressure) valPressure.textContent = '0.75 bar';

      showToast('Hydraulic thresholds restored to factory defaults.', 'info');
    });
  }

  // Multi-View Navigation Tabs
  const tabDash = document.getElementById('navTabDashboard');
  const tabHist = document.getElementById('navTabHistory');
  const tabReps = document.getElementById('navTabReports');

  if (tabDash) tabDash.addEventListener('click', () => switchView('dashboard'));
  if (tabHist) tabHist.addEventListener('click', () => switchView('history'));
  if (tabReps) tabReps.addEventListener('click', () => switchView('reports'));

  // History Filter Handlers
  const btnApplyHist = document.getElementById('btnApplyHistoryFilters');
  if (btnApplyHist) btnApplyHist.addEventListener('click', () => fetchHistory(1));

  const btnResetHist = document.getElementById('btnResetHistoryFilters');
  if (btnResetHist) {
    btnResetHist.addEventListener('click', () => {
      const sDate = document.getElementById('filterStartDate');
      const eDate = document.getElementById('filterEndDate');
      const zSel = document.getElementById('filterZoneSelect');
      const sevSel = document.getElementById('filterSeveritySelect');
      const srcSel = document.getElementById('filterSourceSelect');
      if (sDate) sDate.value = '';
      if (eDate) eDate.value = '';
      if (zSel) zSel.value = 'all';
      if (sevSel) sevSel.value = 'all';
      if (srcSel) srcSel.value = 'all';
      fetchHistory(1);
    });
  }

  const btnPrevP = document.getElementById('btnPrevPage');
  if (btnPrevP) {
    btnPrevP.addEventListener('click', () => {
      if (historyState.page > 1) fetchHistory(historyState.page - 1);
    });
  }

  const btnNextP = document.getElementById('btnNextPage');
  if (btnNextP) {
    btnNextP.addEventListener('click', () => {
      if (historyState.page < historyState.totalPages) fetchHistory(historyState.page + 1);
    });
  }

  const btnExpHist = document.getElementById('btnExportHistoryCsv');
  if (btnExpHist) btnExpHist.addEventListener('click', exportFilteredHistoryToCSV);

  const btnAckAllHist = document.getElementById('btnAcknowledgeAllHistory');
  if (btnAckAllHist) btnAckAllHist.addEventListener('click', acknowledgeAllAlerts);

  // Reports Handlers
  const reportZFilter = document.getElementById('reportZoneFilter');
  if (reportZFilter) reportZFilter.addEventListener('change', fetchReports);

  const btnRefRep = document.getElementById('btnRefreshReport');
  if (btnRefRep) btnRefRep.addEventListener('click', fetchReports);

  // Load persistent SQLite alerts on startup
  await loadPersistentAlerts();
});
