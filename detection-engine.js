/**
 * EcoPulse — Anomaly Detection Engine
 * 
 * Configurable rule-based and temporal heuristics engine for real-time
 * water flow telemetry analysis, leak classification, and incident management.
 */

(function (global) {
  'use strict';

  // --- Default Engine Configuration ---
  const DEFAULT_ENGINE_CONFIG = {
    // Mode sensitivity
    sensitivity: 'balanced', // 'strict' | 'balanced' | 'relaxed'

    // General thresholds
    globalLowFlowMin: 0.4,          // Min flow to consider non-zero trickle (L/min)
    pressureDropThresholdBar: 0.75, // Sudden pressure drop indicating rupture (bar)
    pressureDropSampleCount: 3,     // Readings to evaluate pressure delta

    // Zone-specific thresholds & operational rules
    zones: {
      kitchen: {
        zoneId: 'kitchen',
        zoneName: 'Kitchen',
        baselineMin: 0.0,
        baselineMax: 6.0,           // Normal dishwashing/cooking peak
        burstThreshold: 18.0,       // Catastrophic burst threshold (L/min)
        maxContinuousLowFlowSec: 45,// Max seconds of continuous trickle (e.g. dripping faucet)
        maxHighFlowDurationSec: 30, // Max seconds of elevated flow before flagging (filling pots ok up to 30s)
        nominalPressureBar: 3.2,
        isExpectedActive: true,     // Schedule flag
        activeHours: { start: 6, end: 23 } // 06:00 to 23:00
      },
      bathroom: {
        zoneId: 'bathroom',
        zoneName: 'Bathroom',
        baselineMin: 0.0,
        baselineMax: 8.5,           // Normal shower/flush
        burstThreshold: 16.0,       // Toilet overflow / supply line split
        maxContinuousLowFlowSec: 35,// Running flapper valve trickle
        maxHighFlowDurationSec: 45, // Shower cycle
        nominalPressureBar: 3.0,
        isExpectedActive: true,
        activeHours: { start: 5, end: 24 }
      },
      garden: {
        zoneId: 'garden',
        zoneName: 'Garden Irrigation',
        baselineMin: 0.0,
        baselineMax: 12.0,          // Scheduled irrigation
        burstThreshold: 22.0,       // Main hose / sub-surface pipe rupture
        maxContinuousLowFlowSec: 60,// Slow drip line tear
        maxHighFlowDurationSec: 60,
        nominalPressureBar: 3.5,
        isExpectedActive: false,    // Garden is normally inactive unless scheduled!
        activeHours: { start: 17, end: 19 } // Scheduled 5pm-7pm only
      },
      main_supply: {
        zoneId: 'main_supply',
        zoneName: 'Main Supply Line',
        baselineMin: 0.0,
        baselineMax: 22.0,          // Aggregate residential load
        burstThreshold: 35.0,       // Main municipal inlet split
        maxContinuousLowFlowSec: 60,
        maxHighFlowDurationSec: 60,
        nominalPressureBar: 3.6,
        isExpectedActive: true,
        activeHours: { start: 0, end: 24 }
      }
    }
  };

  /**
   * WaterLeakageDetectionEngine Class
   */
  class WaterLeakageDetectionEngine {
    constructor(customConfig = {}) {
      // Deep clone default config and merge
      this.config = JSON.parse(JSON.stringify(DEFAULT_ENGINE_CONFIG));
      this.mergeConfig(customConfig);

      // Stateful tracking per zone for temporal heuristics
      this.zoneStates = {
        kitchen: this._createInitialZoneTrackingState('kitchen'),
        bathroom: this._createInitialZoneTrackingState('bathroom'),
        garden: this._createInitialZoneTrackingState('garden'),
        main_supply: this._createInitialZoneTrackingState('main_supply')
      };

      // Active Incidents map (zoneId -> IncidentObject)
      // Prevents duplicate alert spam for continuous ongoing incidents!
      this.activeIncidents = new Map();

      // Recent history buffer of evaluated readings (max 100)
      this.readingHistory = [];
    }

    _createInitialZoneTrackingState(zoneId) {
      return {
        zoneId,
        lowFlowStartTime: null,
        highFlowStartTime: null,
        inactiveFlowStartTime: null,
        lastReading: null,
        recentPressures: []
      };
    }

    mergeConfig(customConfig) {
      if (!customConfig) return;
      if (customConfig.sensitivity) this.config.sensitivity = customConfig.sensitivity;
      if (customConfig.pressureDropThresholdBar) this.config.pressureDropThresholdBar = customConfig.pressureDropThresholdBar;
      if (customConfig.zones) {
        for (const [zId, zCfg] of Object.entries(customConfig.zones)) {
          if (this.config.zones[zId]) {
            Object.assign(this.config.zones[zId], zCfg);
          }
        }
      }
    }

    /**
     * Resets internal temporal state and clears active incidents
     */
    reset() {
      for (const zoneId of Object.keys(this.zoneStates)) {
        this.zoneStates[zoneId] = this._createInitialZoneTrackingState(zoneId);
      }
      this.activeIncidents.clear();
      this.readingHistory = [];
    }

    /**
     * Helper to generate a realistic structured reading
     * 
     * @param {string} zoneId 
     * @param {number} flowRate 
     * @param {number|null} customPressure 
     * @param {'simulated'|'real'} dataSource 
     * @param {number|null} customTimestampMs 
     * @returns {Object} Structured WaterReading
     */
    generateReading(zoneId, flowRate, customPressure = null, dataSource = 'simulated', customTimestampMs = null) {
      const zConfig = this.config.zones[zoneId] || {
        zoneName: zoneId,
        nominalPressureBar: 3.0,
        baselineMax: 10.0
      };

      const now = customTimestampMs ? new Date(customTimestampMs) : new Date();
      const timeMs = now.getTime();

      // Determine nominal pressure with slight natural fluctuations
      let pressure = customPressure;
      if (pressure === null || pressure === undefined) {
        const jitter = (Math.sin(timeMs / 10000) * 0.15) - (flowRate > 0 ? (flowRate * 0.02) : 0);
        pressure = Math.max(1.0, +(zConfig.nominalPressureBar + jitter).toFixed(2));
      }

      // Initial naive operating status
      let operatingStatus = 'nominal';
      if (flowRate <= 0.05) operatingStatus = 'idle';
      else if (flowRate > zConfig.baselineMax) operatingStatus = 'elevated';

      return {
        id: `READ-${zoneId.toUpperCase()}-${timeMs}-${Math.floor(Math.random() * 1000)}`,
        timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        timestampISO: now.toISOString(),
        timestampMs: timeMs,
        zone: zoneId,
        zoneName: zConfig.zoneName,
        flowRate: +Number(flowRate).toFixed(2),
        pressure: +Number(pressure).toFixed(2),
        operatingStatus,
        dataSource // 'simulated' or 'real'
      };
    }

    /**
     * Analyzes a single water flow reading against detection rules.
     * 
     * @param {Object} reading - The water reading
     * @param {Object} options - Evaluation options { customHour, valveClosed }
     * @returns {Object} EvaluationResult
     */
    analyzeReading(reading, options = {}) {
      const { zone, flowRate, pressure, timestampMs } = reading;
      const zConfig = this.config.zones[zone];

      if (!zConfig) {
        return {
          alertLevel: 'normal',
          ruleTriggered: null,
          explanation: 'Zone configuration not found.',
          isIncident: false,
          incident: null
        };
      }

      // If zone valve is manually isolated/closed, flow should be 0
      if (options.valveClosed) {
        this._clearZoneTemporalTracking(zone);
        this._resolveActiveIncident(zone, 'Valve isolated by operator');
        return {
          alertLevel: 'normal',
          ruleTriggered: null,
          explanation: `Zone ${zConfig.zoneName} valve is isolated. Flow disabled.`,
          isIncident: false,
          incident: null
        };
      }

      const tracking = this.zoneStates[zone];
      const nowMs = timestampMs || Date.now();

      // 1. Update Pressure Tracking History
      tracking.recentPressures.push({ timeMs: nowMs, pressure });
      if (tracking.recentPressures.length > this.config.pressureDropSampleCount) {
        tracking.recentPressures.shift();
      }

      // Compute pressure drop from the oldest tracked sample in window
      let deltaPressureDrop = 0;
      if (tracking.recentPressures.length >= 2) {
        const baselineP = tracking.recentPressures[0].pressure;
        deltaPressureDrop = +(baselineP - pressure).toFixed(2);
      }

      // 2. Evaluate Operating Hours Schedule
      const currentHour = options.customHour !== undefined 
        ? options.customHour 
        : new Date(nowMs).getHours();

      const isScheduledActive = zConfig.activeHours
        ? (currentHour >= zConfig.activeHours.start && currentHour < zConfig.activeHours.end)
        : zConfig.isExpectedActive;

      // =========================================================================
      // RULE CHECKS (Ordered by Criticality)
      // =========================================================================

      // RULE 1: Sudden Pressure Drop Accompanied by Flow (Critical)
      // Sudden drop in line pressure indicates physical rupture or burst joint
      if (deltaPressureDrop >= this.config.pressureDropThresholdBar && flowRate >= this.config.globalLowFlowMin) {
        const explanation = `Sudden pressure drop of ${deltaPressureDrop} bar (from ${tracking.recentPressures[0].pressure} bar to ${pressure} bar) accompanied by flow of ${flowRate} L/min in ${zConfig.zoneName}. Severe pipe puncture or joint decoupling detected.`;
        return this._handleIncidentDetection(zone, 'critical', 'Sudden Pressure Collapse', explanation, reading);
      }

      // RULE 2: Abnormally High Flow (Burst Threshold Exceeded - Critical)
      // Flow exceeds maximum burst rating for the zone
      if (flowRate >= zConfig.burstThreshold) {
        const explanation = `Flow rate of ${flowRate} L/min critically exceeds the zone burst threshold of ${zConfig.burstThreshold} L/min in ${zConfig.zoneName}. Catastrophic breach or open emergency line.`;
        return this._handleIncidentDetection(zone, 'critical', 'Catastrophic Flow Burst', explanation, reading);
      }

      // RULE 3: Continuous Flow When Zone is Expected to be Inactive (Warning / Critical)
      // Flow occurring during scheduled inactive hours (e.g. night window or unscheduled irrigation)
      if (!isScheduledActive && flowRate >= this.config.globalLowFlowMin) {
        if (!tracking.inactiveFlowStartTime) {
          tracking.inactiveFlowStartTime = nowMs;
        }

        const elapsedInactiveSec = (nowMs - tracking.inactiveFlowStartTime) / 1000;
        const maxAllowedInactiveSec = 15; // Grace period before alert

        if (elapsedInactiveSec >= maxAllowedInactiveSec) {
          const severity = flowRate > zConfig.baselineMax ? 'critical' : 'warning';
          const explanation = `Continuous off-hours water flow of ${flowRate} L/min detected in ${zConfig.zoneName} for ${Math.round(elapsedInactiveSec)}s outside scheduled active window (${zConfig.activeHours ? `${zConfig.activeHours.start}:00-${zConfig.activeHours.end}:00` : 'Inactive'}).`;
          return this._handleIncidentDetection(zone, severity, 'Off-Hours Unscheduled Usage', explanation, reading);
        }
      } else {
        tracking.inactiveFlowStartTime = null;
      }

      // RULE 4: Continuous Low Flow for an Unusually Long Period (Warning)
      // Persistent low flow (e.g. 0.5 - 2.5 L/min) without returning to 0 (running toilet, dripping tap)
      if (flowRate >= this.config.globalLowFlowMin && flowRate <= zConfig.baselineMax) {
        if (!tracking.lowFlowStartTime) {
          tracking.lowFlowStartTime = nowMs;
        }

        const elapsedLowFlowSec = (nowMs - tracking.lowFlowStartTime) / 1000;
        if (elapsedLowFlowSec >= zConfig.maxContinuousLowFlowSec) {
          const explanation = `Continuous low flow of ${flowRate} L/min has persisted uninterrupted for ${Math.round(elapsedLowFlowSec)}s (threshold: ${zConfig.maxContinuousLowFlowSec}s) in ${zConfig.zoneName}. Typical signature of a running toilet valve, leaking cistern, or pinhole fissure.`;
          return this._handleIncidentDetection(zone, 'warning', 'Continuous Low-Flow Leak', explanation, reading);
        }
      } else {
        // Returned to 0 or escalated to high
        tracking.lowFlowStartTime = null;
      }

      // RULE 5: Sustained Elevated Flow Exceeding Normal Duration (Warning)
      // NOTE: Rule 5 ensures we do NOT classify every high flow reading as a leak.
      // Filling a pot or quick rinse is allowed up to maxHighFlowDurationSec!
      if (flowRate > zConfig.baselineMax && flowRate < zConfig.burstThreshold) {
        if (!tracking.highFlowStartTime) {
          tracking.highFlowStartTime = nowMs;
        }

        const elapsedHighFlowSec = (nowMs - tracking.highFlowStartTime) / 1000;
        if (elapsedHighFlowSec >= zConfig.maxHighFlowDurationSec) {
          const explanation = `Elevated flow of ${flowRate} L/min has exceeded normal peak duration (${zConfig.maxHighFlowDurationSec}s) for ${Math.round(elapsedHighFlowSec)}s in ${zConfig.zoneName}. Exceeds standard residential usage pattern.`;
          return this._handleIncidentDetection(zone, 'warning', 'Sustained High Flow Anomaly', explanation, reading);
        } else {
          // Within allowed normal high-usage duration window!
          // Account for normal usage pattern: do NOT classify as leak yet!
          this._resolveActiveIncident(zone, 'Normal high-demand usage within duration limits');
          return {
            alertLevel: 'normal',
            ruleTriggered: 'Transient Elevated Usage',
            explanation: `Elevated flow of ${flowRate} L/min in ${zConfig.zoneName} is within permissible duration (${Math.round(elapsedHighFlowSec)}s / ${zConfig.maxHighFlowDurationSec}s). Permitted normal usage.`,
            isIncident: false,
            incident: null
          };
        }
      } else {
        tracking.highFlowStartTime = null;
      }

      // =========================================================================
      // NORMAL STATE
      // Flow is within baseline limits and normal operational conditions
      // =========================================================================
      this._resolveActiveIncident(zone, 'Flow returned to normal baseline');

      return {
        alertLevel: 'normal',
        ruleTriggered: null,
        explanation: `Flow (${flowRate} L/min) and pressure (${pressure} bar) are within nominal operating parameters for ${zConfig.zoneName}.`,
        isIncident: false,
        incident: null
      };
    }

    /**
     * Stateful incident management:
     * Prevents duplicate alerts for the same continuously active incident.
     */
    _handleIncidentDetection(zoneId, severity, ruleName, explanation, reading) {
      const nowMs = reading.timestampMs || Date.now();
      const existing = this.activeIncidents.get(zoneId);

      if (existing && existing.isActive) {
        // Incident already active! Update metrics rather than creating a duplicate alert
        existing.lastSeenMs = nowMs;
        existing.lastSeenTimestamp = reading.timestamp;
        existing.currentFlowRate = reading.flowRate;
        existing.currentPressure = reading.pressure;
        existing.severity = severity; // Escalate if needed
        existing.explanation = explanation;

        // Accumulate estimated wastage: (flowRate L/min * elapsed minutes)
        const elapsedMinutes = (nowMs - existing.startedAtMs) / 60000;
        existing.estimatedWastageLiters = +(existing.currentFlowRate * elapsedMinutes).toFixed(1);

        return {
          alertLevel: severity,
          ruleTriggered: ruleName,
          explanation,
          isIncident: true,
          isNewIncident: false, // NOT a duplicate alert!
          incident: existing
        };
      }

      // Brand new incident created
      const incidentId = `INC-${zoneId.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const newIncident = {
        id: incidentId,
        zoneId,
        zoneName: this.config.zones[zoneId]?.zoneName || zoneId,
        severity, // 'warning' | 'critical'
        ruleName,
        explanation,
        startedAtMs: nowMs,
        startedAtTimestamp: reading.timestamp,
        lastSeenMs: nowMs,
        lastSeenTimestamp: reading.timestamp,
        currentFlowRate: reading.flowRate,
        currentPressure: reading.pressure,
        estimatedWastageLiters: +(reading.flowRate * 0.1).toFixed(1),
        isActive: true,
        acknowledged: false
      };

      this.activeIncidents.set(zoneId, newIncident);

      return {
        alertLevel: severity,
        ruleTriggered: ruleName,
        explanation,
        isIncident: true,
        isNewIncident: true, // First time trigger
        incident: newIncident
      };
    }

    _resolveActiveIncident(zoneId, resolutionReason) {
      const existing = this.activeIncidents.get(zoneId);
      if (existing && existing.isActive) {
        existing.isActive = false;
        existing.resolvedAtMs = Date.now();
        existing.resolutionReason = resolutionReason;
      }
    }

    _clearZoneTemporalTracking(zoneId) {
      const tracking = this.zoneStates[zoneId];
      if (tracking) {
        tracking.lowFlowStartTime = null;
        tracking.highFlowStartTime = null;
        tracking.inactiveFlowStartTime = null;
        tracking.recentPressures = [];
      }
    }

    /**
     * Returns all currently active incidents
     */
    getActiveIncidents() {
      const active = [];
      for (const inc of this.activeIncidents.values()) {
        if (inc.isActive) active.push(inc);
      }
      return active;
    }

    /**
     * Acknowledges all active incidents
     */
    acknowledgeAllIncidents() {
      let count = 0;
      for (const inc of this.activeIncidents.values()) {
        if (!inc.acknowledged) {
          inc.acknowledged = true;
          count++;
        }
      }
      return count;
    }
  }

  // --- Built-in Automated Test Suite ---
  function runAutomatedEngineTests() {
    const results = [];
    const engine = new WaterLeakageDetectionEngine();

    function assert(testName, condition, details = '') {
      results.push({
        testName,
        passed: !!condition,
        details: condition ? 'PASSED' : `FAILED: ${details}`
      });
    }

    const t0 = 1700000000000;

    // Test 1: Normal Flow Baseline
    {
      engine.reset();
      const r = engine.generateReading('kitchen', 3.5, 3.2, 'simulated', t0);
      const res = engine.analyzeReading(r);
      assert(
        'Rule 0: Normal usage within baseline remains Normal',
        res.alertLevel === 'normal' && !res.isIncident,
        `Expected alertLevel 'normal', got '${res.alertLevel}'`
      );
    }

    // Test 2: Catastrophic Burst Threshold Exceeded (Critical)
    {
      engine.reset();
      const r = engine.generateReading('kitchen', 24.5, 3.0, 'simulated', t0);
      const res = engine.analyzeReading(r);
      assert(
        'Rule 2: Burst threshold (>18 L/min) triggers Critical Alert',
        res.alertLevel === 'critical' && res.ruleTriggered === 'Catastrophic Flow Burst' && res.isNewIncident === true,
        `Expected 'critical' and 'Catastrophic Flow Burst', got '${res.alertLevel}', '${res.ruleTriggered}'`
      );
    }

    // Test 3: Sudden Pressure Drop Accompanied by Flow (Critical)
    {
      engine.reset();
      // Reading 1: normal pressure 3.2 bar
      const r1 = engine.generateReading('garden', 10.0, 3.5, 'simulated', t0);
      engine.analyzeReading(r1);

      // Reading 2: pressure plummets to 2.2 bar (drop of 1.3 bar > 0.75 threshold) with active flow
      const r2 = engine.generateReading('garden', 15.0, 2.2, 'simulated', t0 + 1000);
      const res2 = engine.analyzeReading(r2);
      assert(
        'Rule 1: Sudden pressure drop (delta >= 0.75 bar) triggers Critical Alert',
        res2.alertLevel === 'critical' && res2.ruleTriggered === 'Sudden Pressure Collapse',
        `Expected 'critical' with 'Sudden Pressure Collapse', got '${res2.alertLevel}', '${res2.ruleTriggered}'`
      );
    }

    // Test 4: Continuous Low Flow Over Duration (Warning)
    {
      engine.reset();
      // Flow 1.2 L/min in Bathroom at t0
      const r1 = engine.generateReading('bathroom', 1.2, 3.0, 'simulated', t0);
      const res1 = engine.analyzeReading(r1);
      // Immediately, duration is 0, so should be normal initially
      const initNormal = res1.alertLevel === 'normal';

      // Flow 1.2 L/min at t0 + 40 seconds (> bathroom threshold of 35s)
      const r2 = engine.generateReading('bathroom', 1.2, 3.0, 'simulated', t0 + 40000);
      const res2 = engine.analyzeReading(r2);
      assert(
        'Rule 4: Continuous low flow for >35s in Bathroom triggers Warning Alert',
        initNormal && res2.alertLevel === 'warning' && res2.ruleTriggered === 'Continuous Low-Flow Leak',
        `Expected initial normal, then warning with 'Continuous Low-Flow Leak', got '${res2.alertLevel}', '${res2.ruleTriggered}'`
      );
    }

    // Test 5: Temporary High Flow within Allowed Duration does NOT classify as leak
    {
      engine.reset();
      // Flow 7.5 L/min in Kitchen (above 6.0 baselineMax, but below 18 burst) at t0
      const r1 = engine.generateReading('kitchen', 7.5, 3.0, 'simulated', t0);
      const res1 = engine.analyzeReading(r1);

      // Same flow at t0 + 10s (kitchen allows up to 30s for filling pots/rinsing)
      const r2 = engine.generateReading('kitchen', 7.5, 3.0, 'simulated', t0 + 10000);
      const res2 = engine.analyzeReading(r2);

      assert(
        'Rule 5: High flow within permissible duration (<30s) is NOT classified as a leak',
        res1.alertLevel === 'normal' && res2.alertLevel === 'normal' && !res2.isIncident,
        `Expected 'normal' for transient high flow, got '${res2.alertLevel}'`
      );
    }

    // Test 6: Continuous Flow in Inactive Zone triggers Warning/Critical
    {
      engine.reset();
      // Garden is inactive outside 17:00-19:00. Test at hour 2 AM (customHour = 2)
      const r1 = engine.generateReading('garden', 5.0, 3.5, 'simulated', t0);
      engine.analyzeReading(r1, { customHour: 2 });

      // After 20 seconds of continuous flow in inactive window
      const r2 = engine.generateReading('garden', 5.0, 3.5, 'simulated', t0 + 20000);
      const res2 = engine.analyzeReading(r2, { customHour: 2 });

      assert(
        'Rule 3: Continuous flow when zone is expected to be inactive triggers Alert',
        res2.alertLevel === 'warning' && res2.ruleTriggered === 'Off-Hours Unscheduled Usage',
        `Expected 'warning' with 'Off-Hours Unscheduled Usage', got '${res2.alertLevel}', '${res2.ruleTriggered}'`
      );
    }

    // Test 7: Prevention of Duplicate Alerts for Ongoing Active Incident
    {
      engine.reset();
      // Trigger burst leak
      const r1 = engine.generateReading('kitchen', 25.0, 2.9, 'simulated', t0);
      const res1 = engine.analyzeReading(r1);

      // Next tick (still leaking at 25.0 L/min)
      const r2 = engine.generateReading('kitchen', 25.0, 2.9, 'simulated', t0 + 3000);
      const res2 = engine.analyzeReading(r2);

      assert(
        'Rule 10: Prevents duplicate alerts for continuously active incident',
        res1.isNewIncident === true && res2.isNewIncident === false && res2.incident.id === res1.incident.id,
        `Expected isNewIncident=false on repeat tick, got isNewIncident=${res2.isNewIncident}`
      );
    }

    return results;
  }

  // Export to global environment (Browser window or Node module)
  const DetectionModule = {
    DEFAULT_ENGINE_CONFIG,
    WaterLeakageDetectionEngine,
    runAutomatedEngineTests
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DetectionModule;
  }
  if (typeof global !== 'undefined') {
    global.DetectionEngine = DetectionModule;
  }

})(typeof window !== 'undefined' ? window : globalThis);
