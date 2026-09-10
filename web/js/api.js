/**
 * Client API Client for Athens OASA Bus Suite
 */

const API = {
  // Can be pointed to any hosted backend URL (e.g. Render, Railway, Localtunnel, etc.)
  baseUrl: localStorage.getItem('OASA_API_BASE_URL') || window.location.origin,

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
      return await res.json();
    } catch (err) {
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
