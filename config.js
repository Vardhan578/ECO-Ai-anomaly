/**
 * EcoPulse — Dynamic Environment & Deployment Configuration (config.js)
 * 
 * Provides runtime configuration for connecting the frontend dashboard
 * to the deployed or local Python Flask ML Backend.
 *
 * PRECEDENCE ORDER FOR API_URL RESOLUTION:
 * 1. URL Query Parameter: ?api=https://eco-ai-anomaly.onrender.com
 * 2. LocalStorage override: window.localStorage.getItem('ECOPULSE_API_URL')
 * 3. Netlify build injection: window.ECOPULSE_BACKEND_URL (from env-config.js)
 * 4. Automatic Environment Detection:
 *    - Local development (localhost, 127.0.0.1, file:): http://127.0.0.1:5000 (or origin if port 5000)
 *    - Cloud backend origin (*.onrender.com): window.location.origin
 *    - Production frontend (*.netlify.app or other host): https://eco-ai-anomaly.onrender.com
 */

window.ECOPULSE_CONFIG = (function () {
  'use strict';

  const DEFAULT_PRODUCTION_BACKEND_URL = 'https://eco-ai-anomaly.onrender.com';
  const DEFAULT_LOCAL_BACKEND_URL = 'http://127.0.0.1:5000';

  // Helper to sanitize URLs (remove trailing slashes)
  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/\/+$/, '');
  }

  // 1. Check for query parameter override (?api=...)
  function getQueryApiUrl() {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('api')) {
        const val = sanitizeUrl(params.get('api'));
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
      const val = sanitizeUrl(window.localStorage.getItem('ECOPULSE_API_URL'));
      if (val) return val;
    } catch (e) {
      console.warn('EcoPulse Config: Could not read from localStorage', e);
    }
    return null;
  }

  // 3. Check for Netlify build-injected environment variable (window.ECOPULSE_BACKEND_URL)
  function getInjectedApiUrl() {
    if (typeof window !== 'undefined' && window.ECOPULSE_BACKEND_URL && typeof window.ECOPULSE_BACKEND_URL === 'string') {
      const val = sanitizeUrl(window.ECOPULSE_BACKEND_URL);
      if (val) return val;
    }
    return null;
  }

  // Helper to determine if running locally
  function checkIsLocalhost() {
    if (typeof window === 'undefined' || !window.location) return true;
    const hostname = (window.location.hostname || '').toLowerCase();
    const protocol = window.location.protocol || '';
    if (protocol === 'file:' || !hostname) return true;
    return hostname === '127.0.0.1' || 
           hostname === 'localhost' || 
           hostname === '::1' || 
           hostname.endsWith('.localhost');
  }

  // 4. Automatic Environment Detection
  function getDefaultApiUrl() {
    if (typeof window === 'undefined' || !window.location) return DEFAULT_LOCAL_BACKEND_URL;

    const hostname = (window.location.hostname || '').toLowerCase();
    const port = window.location.port || '';
    const protocol = window.location.protocol || '';

    // File protocol or empty hostname (opened locally from disk)
    if (protocol === 'file:' || !hostname) {
      return DEFAULT_LOCAL_BACKEND_URL;
    }

    const isLocalhost = checkIsLocalhost();

    // If running on localhost
    if (isLocalhost) {
      // If served directly from Flask monolith on port 5000
      if (port === '5000') {
        return window.location.origin;
      }
      // Running on separate local frontend server (e.g. port 8000, 3000, 8080)
      return DEFAULT_LOCAL_BACKEND_URL;
    }

    // If frontend is served directly by the Render Flask backend
    if (hostname.includes('onrender.com')) {
      return window.location.origin;
    }

    // Production frontend deployment (e.g. Netlify *.netlify.app, custom domains)
    return DEFAULT_PRODUCTION_BACKEND_URL;
  }

  const queryUrl = getQueryApiUrl();
  const storageUrl = getStorageApiUrl();
  const isLocal = checkIsLocalhost();
  // Only use build-injected URL if not on localhost, unless explicitly on localhost and injected is local
  const rawInjectedUrl = getInjectedApiUrl();
  const injectedUrl = (isLocal && rawInjectedUrl && !rawInjectedUrl.includes('localhost') && !rawInjectedUrl.includes('127.0.0.1'))
    ? null
    : rawInjectedUrl;
  const defaultUrl = getDefaultApiUrl();

  const activeApiUrl = queryUrl || storageUrl || injectedUrl || defaultUrl;

  return {
    API_URL: activeApiUrl,
    APP_NAME: 'EcoPulse ML Dashboard',
    VERSION: '2.0.0',
    DEFAULT_PRODUCTION_BACKEND_URL: DEFAULT_PRODUCTION_BACKEND_URL,
    DEFAULT_LOCAL_BACKEND_URL: DEFAULT_LOCAL_BACKEND_URL,
    IS_LOCAL: activeApiUrl.includes('127.0.0.1') || activeApiUrl.includes('localhost'),
    SOURCE: queryUrl ? 'query_param' : (storageUrl ? 'local_storage' : (injectedUrl ? 'injected_env' : 'default_detection')),

    /**
     * Programmatically update the backend API URL at runtime
     * @param {string|null} newUrl - Full URL to backend (e.g. 'https://eco-ai-anomaly.onrender.com') or null to reset
     */
    setApiUrl: function (newUrl) {
      if (!newUrl) {
        localStorage.removeItem('ECOPULSE_API_URL');
      } else {
        localStorage.setItem('ECOPULSE_API_URL', sanitizeUrl(newUrl));
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

