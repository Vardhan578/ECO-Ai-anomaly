/**
 * EcoPulse — Dynamic Environment & Deployment Configuration (config.js)
 * 
 * Provides runtime configuration for connecting the frontend dashboard
 * to the deployed or local Python Flask ML Backend.
 *
 * PRECEDENCE ORDER FOR API_URL RESOLUTION:
 * 1. URL Query Parameter: ?api=https://your-backend-url.onrender.com
 * 2. LocalStorage override: window.localStorage.getItem('ECOPULSE_API_URL')
 * 3. window.ECOPULSE_DEPLOYED_URL (if pre-configured in build)
 * 4. Automatic Same-Origin: If running on a cloud domain or port 5000, defaults to window.location.origin
 * 5. Local Fallback: http://127.0.0.1:5000 (standard development backend)
 */

window.ECOPULSE_CONFIG = (function () {
  'use strict';

  // 1. Check for query parameter override (?api=...)
  function getQueryApiUrl() {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('api')) {
        const val = params.get('api').trim().replace(/\/+$/, '');
        if (val) return val;
      }
    } catch (e) {
      console.warn('EcoPulse Config: Could not parse query parameters', e);
    }
    return null;
  }

  // 2. Check for localStorage override
  function getStorageApiUrl() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const val = window.localStorage.getItem('ECOPULSE_API_URL');
      if (val) return val.trim().replace(/\/+$/, '');
    } catch (e) {
      console.warn('EcoPulse Config: Could not read from localStorage', e);
    }
    return null;
  }

  // 3. Check for Netlify build-injected environment variable (window.ECOPULSE_BACKEND_URL)
  function getInjectedApiUrl() {
    if (typeof window !== 'undefined' && window.ECOPULSE_BACKEND_URL && typeof window.ECOPULSE_BACKEND_URL === 'string') {
      const val = window.ECOPULSE_BACKEND_URL.trim().replace(/\/+$/, '');
      if (val) return val;
    }
    return null;
  }

  // 4. Determine natural origin
  function getNaturalApiUrl() {
    if (typeof window === 'undefined' || !window.location) return 'http://127.0.0.1:5000';

    const hostname = window.location.hostname;
    const port = window.location.port;
    const isLocalhost = hostname === '127.0.0.1' || hostname === 'localhost';

    // If served from Flask monolith locally (port 5000)
    if (port === '5000') {
      return window.location.origin;
    }

    // Running on separate local frontend server (e.g. port 8000)
    if (isLocalhost) {
      return 'http://127.0.0.1:5000';
    }

    // If served on cloud domain (e.g. *.onrender.com)
    return window.location.origin;
  }

  const queryUrl = getQueryApiUrl();
  const storageUrl = getStorageApiUrl();
  const injectedUrl = getInjectedApiUrl();
  const naturalUrl = getNaturalApiUrl();

  const activeApiUrl = queryUrl || storageUrl || injectedUrl || naturalUrl;

  return {
    API_URL: activeApiUrl,
    APP_NAME: 'EcoPulse ML Dashboard',
    VERSION: '2.0.0',
    IS_LOCAL: activeApiUrl.includes('127.0.0.1') || activeApiUrl.includes('localhost'),
    SOURCE: queryUrl ? 'query_param' : (storageUrl ? 'local_storage' : 'auto_detected'),

    /**
     * Programmatically update the backend API URL at runtime
     * @param {string|null} newUrl - Full URL to backend (e.g. 'https://my-backend.onrender.com') or null to reset
     */
    setApiUrl: function (newUrl) {
      if (!newUrl) {
        localStorage.removeItem('ECOPULSE_API_URL');
      } else {
        localStorage.setItem('ECOPULSE_API_URL', newUrl.trim().replace(/\/+$/, ''));
      }
      window.location.reload();
    },

    /**
     * Reset to automatic environment detection
     */
    resetApiUrl: function () {
      localStorage.removeItem('ECOPULSE_API_URL');
      window.location.reload();
    }
  };
})();
