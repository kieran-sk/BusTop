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

  getAthensMinutes() {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('el-GR', {
        timeZone: 'Europe/Athens',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
      return hour * 60 + minute;
    } catch (e) {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  },

  adjustOfflineArrivals(data, cachedTimestamp) {
    if (!data || !Array.isArray(data.arrivals)) return data;
    const currentMinutes = this.getAthensMinutes();
    const cloned = JSON.parse(JSON.stringify(data));
    cloned.is_offline = true;

    const adjustedArrivals = [];
    for (const a of cloned.arrivals) {
      a.is_live = false;
      a.is_offline = true;

      const timeStr = a.estimated_arrival_time || a.departure_time;
      if (timeStr) {
        const m = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (m) {
          const arrM = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
          let diff = arrM - currentMinutes;
          // If this scheduled trip already departed earlier today, roll forward to tomorrow (+1440m)
          if (diff < -5) {
            diff += 1440;
          }
          a.btime2 = diff;
          a.status_label = a.departure_time ? `Προγρ. (${a.departure_time})` : `Προγρ. (${timeStr})`;
          adjustedArrivals.push(a);
          continue;
        }
      }

      // If no HH:MM format found, decay previous btime2 by elapsed minutes
      if (typeof a.btime2 === 'number') {
        const elapsedMins = Math.floor((Date.now() - (cachedTimestamp || Date.now())) / 60000);
        const rem = a.btime2 - elapsedMins;
        if (rem >= 0) {
          a.btime2 = rem;
          adjustedArrivals.push(a);
        }
      }
    }

    // Sort upcoming arrivals chronologically so the next actual bus is at top
    adjustedArrivals.sort((a, b) => a.btime2 - b.btime2);
    cloned.arrivals = adjustedArrivals;
    return cloned;
  },

  getFromOfflineCache(key) {
    try {
      const cache = this.getOfflineCache();
      const entry = cache[key];
      if (!entry || !entry.data) return null;
      if (key.includes('/arrivals')) {
        return this.adjustOfflineArrivals(entry.data, entry.timestamp);
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  },

  async fetchJson(endpoint) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Μη έγκυρη απόκριση (status ${res.status}): αναμενόταν JSON`);
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      // Cache response for offline resilience (skip coordinate-based URLs to avoid cache exhaustion)
      if ((endpoint.includes('/api/stops/') || endpoint.includes('/api/lines') || endpoint.includes('/api/routes/')) &&
          !endpoint.includes('lat=') && !endpoint.includes('lng=')) {
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

  async getAllStops() {
    try {
      const res = await this.fetchJson('/api/stops/all');
      if (Array.isArray(res) && res.length > 0) return res;
    } catch (e) {}
    try {
      const res2 = await this.fetchJson('/data/all_stops.json');
      if (Array.isArray(res2) && res2.length > 0) return res2;
    } catch (e2) {}
    return [];
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
  },

  async getDisruptions() {
    return this.fetchJson('/api/disruptions');
  },

  async planJourney(originLat, originLng, destLat, destLng) {
    return this.fetchJson(`/api/routing/journey?originLat=${originLat}&originLng=${originLng}&destLat=${destLat}&destLng=${destLng}`);
  }
};

window.API = API;
