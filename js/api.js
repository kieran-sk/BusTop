/**
 * Client API Client for Athens OASA Bus Suite
 */

const API = {
  // Can be pointed to any hosted backend URL (e.g. Render, Railway, Localtunnel, etc.)
  baseUrl: localStorage.getItem('OASA_API_BASE_URL') || window.location.origin,

  // Local Offline Stop & Schedule Storage
  getOfflineCache() {
    try {
      return JSON.parse(localStorage.getItem('OASA_OFFLINE_STOPS_CACHE') || '{}');
    } catch (e) {
      return {};
    }
  },

  saveOfflineCache(key, data) {
    try {
      const cache = this.getOfflineCache();
      cache[key] = { data, timestamp: Date.now() };
      // Keep most recent 250 items to conserve storage
      const keys = Object.keys(cache);
      if (keys.length > 250) {
        delete cache[keys[0]];
      }
      localStorage.setItem('OASA_OFFLINE_STOPS_CACHE', JSON.stringify(cache));
    } catch (e) {}
  },

  getFromOfflineCache(key) {
    try {
      const cache = this.getOfflineCache();
      return cache[key] ? cache[key].data : null;
    } catch (e) {
      return null;
    }
  },

  async fetchJson(endpoint) {
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Μη έγκυρη απόκριση (status ${res.status}): αναμενόταν JSON`);
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      // Cache response for offline resilience
      if (endpoint.includes('/api/stops/') || endpoint.includes('/api/lines') || endpoint.includes('/api/routes/')) {
        this.saveOfflineCache(endpoint, data);
      }
      return data;
    } catch (err) {
      // Offline fallback: Attempt to serve from local storage cache
      const cached = this.getFromOfflineCache(endpoint);
      if (cached) {
        console.log(`[Zero Data Mode] Serving offline cached data for: ${endpoint}`);
        return cached;
      }
      console.error(`API error for ${endpoint}:`, err);
      throw err;
    }
  },

  async getConfig() {
    return this.fetchJson('/api/config');
  },

  async getLines() {
    return this.fetchJson('/api/lines');
  },

  async resolveLine(lineId) {
    return this.fetchJson(`/api/lines/resolve?lineId=${encodeURIComponent(lineId)}`);
  },

  async getRoutes(lineCode) {
    return this.fetchJson(`/api/lines/${lineCode}/routes`);
  },

  async getRouteStops(routeCode) {
    return this.fetchJson(`/api/routes/${routeCode}/stops`);
  },

  async getRouteDetails(routeCode) {
    return this.fetchJson(`/api/routes/${routeCode}/details`);
  },

  async getRouteBuses(routeCode) {
    return this.fetchJson(`/api/routes/${routeCode}/buses`);
  },

  async getStopRoutes(stopCode) {
    return this.fetchJson(`/api/stops/${stopCode}/routes`);
  },

  async getStopArrivals(stopCode, day = 'today') {
    return this.fetchJson(`/api/stops/${stopCode}/arrivals${day ? `?day=${day}` : ''}`);
  },

  async getClosestStops(lat, lng) {
    return this.fetchJson(`/api/stops/closest?lat=${lat}&lng=${lng}`);
  },

  async getStopsInBounds(north, south, east, west, limit = 80) {
    return this.fetchJson(`/api/stops/bounds?north=${north}&south=${south}&east=${east}&west=${west}&limit=${limit}`);
  },

  async getLineTimetable(lineCode) {
    return this.fetchJson(`/api/lines/${lineCode}/timetable`);
  },

  async getLiveBuses(routeCode) {
    return this.fetchJson(`/api/buses/live?routeCode=${routeCode}`);
  },

  async getFleetSnapshot() {
    return this.fetchJson('/api/buses/fleet');
  },

  async getWalkingRoute(fromLat, fromLng, toLat, toLng) {
    return this.fetchJson(`/api/routing/walk?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`);
  }
};

window.API = API;
