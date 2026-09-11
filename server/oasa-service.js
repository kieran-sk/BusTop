/**
 * OASA Telematics API Client with Smart In-Memory Caching
 * Athens Urban Transport Organisation (ΟΑΣΑ)
 */

// Force accept TLS certs and prioritize IPv4 to avoid IPv6 timeouts on OASA servers
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const https = require('https');
const zlib = require('zlib');

// SSL Agent that bypasses strict cert verification and forces IPv4
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  family: 4,
  timeout: 15000
});

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      agent: httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`OASA API HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => {
      req.destroy(new Error('Connection timed out to OASA server (15s)'));
    });
    req.on('error', reject);
  });
}

function httpsGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      agent: httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*'
      },
      timeout: 20000
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`OASA API HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => {
      req.destroy(new Error('Connection timed out fetching master stops (20s)'));
    });
    req.on('error', reject);
  });
}

class OasaService {
  constructor() {
    const envUrl = process.env.OASA_API_URL ? process.env.OASA_API_URL.trim().replace(/\/+$/, '') + '/' : '';
    this.baseUrl = envUrl || 'https://telematics.oasa.gr/api/';
    this.cache = new Map();
  }

  /**
   * Internal cache helper
   */
  getCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  setCache(key, data, ttlSeconds) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Core request dispatcher to OASA Telematics API
   */
  async request(action, params = {}, ttlSeconds = 0) {
    const queryParams = new URLSearchParams({ act: action, ...params });
    const cacheKey = `${action}:${queryParams.toString()}`;

    if (ttlSeconds > 0) {
      const cached = this.getCache(cacheKey);
      if (cached) return cached;
    }

    const url = `${this.baseUrl}?${queryParams.toString()}`;

    try {
      const text = await httpsGet(url);
      if (!text || text.trim() === 'null' || text.trim() === '') {
        return null;
      }

      const data = JSON.parse(text);
      if (ttlSeconds > 0 && data) {
        this.setCache(cacheKey, data, ttlSeconds);
      }
      return data;
    } catch (err) {
      console.error(`[OASA Error] ${action}:`, err.message, err.cause ? (err.cause.message || err.cause) : '');
      // Return stale cache if available
      const stale = this.cache.get(cacheKey);
      if (stale) {
        console.warn(`[OASA Cache] Serving stale data for ${cacheKey}`);
        return stale.data;
      }
      throw err;
    }
  }

  /**
   * Retrieve all bus lines (e.g. 040, X95, 608)
   */
  async getLines() {
    return this.request('webGetLines', {}, 1800); // 30 min cache
  }

  /**
   * Retrieve all bus lines with Master Line info
   */
  async getLinesWithML() {
    return this.request('webGetLinesWithMLinfo', {}, 1800);
  }

  /**
   * Retrieve routes for a specific line
   * @param {string} lineCode 
   */
  async getRoutes(lineCode) {
    return this.request('webGetRoutes', { p1: lineCode }, 1800);
  }

  /**
   * Retrieve stops along a specific route
   * @param {string} routeCode 
   */
  async getStops(routeCode) {
    return this.request('webGetStops', { p1: routeCode }, 1800);
  }

  /**
   * Retrieve route details and ordered coordinates
   * @param {string} routeCode 
   */
  async getRouteDetails(routeCode) {
    return this.request('webRouteDetails', { p1: routeCode }, 1800);
  }

  /**
   * Retrieve lines and routes passing through a stop
   * @param {string} stopCode 
   */
  async getStopRoutes(stopCode) {
    return this.request('webRoutesForStop', { p1: stopCode }, 1800);
  }

  /**
   * Live real-time arrivals for a stop
   * @param {string} stopCode 
   */
  async getStopArrivals(stopCode) {
    return this.request('getStopArrivals', { p1: stopCode }, 10); // 10 sec cache
  }

  /**
   * Live real-time GPS locations of buses on a route
   * @param {string} routeCode 
   */
  async getBusLocations(routeCode) {
    return this.request('getBusLocation', { p1: routeCode }, 10); // 10 sec cache
  }

  /**
   * Full daily scheduled departure timetable for a line
   * @param {string} lineCode 
   */
  async getDailySchedule(lineCode) {
    return this.request('getDailySchedule', { line_code: lineCode }, 600); // 10 min cache
  }

  /**
   * Available schedule profiles for a line (Daily, Saturday, Sunday)
   * @param {string} lineCode 
   */
  async getScheduleDays(lineCode) {
    return this.request('getScheduleDaysMasterline', { p1: lineCode }, 3600);
  }

  /**
   * Departures for specific day profile (Weekdays, Saturday, Sunday)
   * @param {string} mlCode 
   * @param {string} sdcCode 
   * @param {string} lineCode 
   */
  async getSchedLines(mlCode, sdcCode, lineCode) {
    return this.request('getSchedLines', { p1: mlCode, p2: sdcCode, p3: lineCode }, 1800);
  }

  /**
   * Stops near user's GPS position
   * @param {number} lat 
   * @param {number} lng 
   */
  async getClosestStops(lat, lng) {
    return this.request('getClosestStops', { p1: lat, p2: lng }, 30);
  }

  /**
   * Master stops database for all of Athens (parsed from getStops compressed payload)
   */
  async getAllStops() {
    const cached = this.getCache('all_master_stops');
    if (cached) return cached;

    try {
      const buf = await httpsGetBuffer(`${this.baseUrl}?act=getStops`);
      const raw = zlib.gunzipSync(buf).toString('utf8');
      const regex = /\((-?\d+),\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*(-?\d+),([0-9.]+),([0-9.]+)/g;
      let match;
      const stops = [];
      while ((match = regex.exec(raw)) !== null) {
        stops.push({
          StopCode: match[1],
          StopID: match[2],
          StopDescr: match[3],
          StopDescrEng: match[4],
          StopStreet: match[5] !== 'null' ? match[5] : '',
          StopStreetEng: match[6] !== 'null' ? match[6] : '',
          StopHeading: match[7],
          StopLng: match[8],
          StopLat: match[9]
        });
      }
      this.setCache('all_master_stops', stops, 86400); // 24h cache
      return stops;
    } catch (e) {
      console.warn('Failed to fetch master stops:', e.message);
      return [];
    }
  }

  /**
   * Search stops by code, Greek/English name, or street
   * @param {string} query
   */
  async searchStops(query) {
    if (!query) return [];
    const q = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const stops = await this.getAllStops();
    return stops.filter(s => {
      const code = s.StopCode || '';
      const id = s.StopID || '';
      const descr = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const descrEn = (s.StopDescrEng || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const street = (s.StopStreet || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return code.includes(q) || id.includes(q) || descr.includes(q) || descrEn.includes(q) || street.includes(q);
    }).slice(0, 25);
  }

  /**
   * Live real-time GPS locations of buses on a route with reporting latency
   * @param {string} routeCode 
   */
  async getLiveBusesWithAge(routeCode) {
    const rawBuses = await this.getBusLocations(routeCode);
    if (!Array.isArray(rawBuses)) return [];

    const now = Date.now();
    return rawBuses.map(b => {
      let reportSeconds = 30;
      let ageLabelGr = 'πριν 30δ.';
      if (b.CS_DATE) {
        const cleaned = b.CS_DATE.replace(/:(\d{3})(AM|PM)$/i, ' $2');
        const parsed = Date.parse(cleaned);
        if (!isNaN(parsed)) {
          reportSeconds = Math.max(0, Math.round((now - parsed) / 1000));
          if (reportSeconds < 60) {
            ageLabelGr = `πριν ${reportSeconds}δ.`;
          } else {
            const mins = Math.floor(reportSeconds / 60);
            ageLabelGr = `πριν ${mins}λ.`;
          }
        }
      }

      return {
        ...b,
        report_seconds: reportSeconds,
        report_age_gr: ageLabelGr,
        status_gr: reportSeconds <= 90 ? 'Σε κίνηση' : 'Στάση'
      };
    });
  }

  /**
   * Sync citywide fleet locations snapshot from oasa.live
   */
  async syncOasaLiveFleet() {
    const cached = this.getCache('oasa_live_fleet');
    if (cached) return cached;

    try {
      const res = await fetch('https://s3.eu-central-1.amazonaws.com/oasa/routeLocations.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        this.setCache('oasa_live_fleet', data, 60); // 60 sec cache
        return data;
      }
    } catch (e) {
      console.warn('Could not sync oasa.live fleet snapshot:', e.message);
    }
    return {};
  }

  /**
   * Calculate urban walking distance and duration between two coordinates
   * Uses OSRM pedestrian network with Athens Manhattan street tortuosity fallback
   */
  async getWalkingRoute(fromLat, fromLng, toLat, toLng) {
    const lat1 = parseFloat(fromLat);
    const lng1 = parseFloat(fromLng);
    const lat2 = parseFloat(toLat);
    const lng2 = parseFloat(toLng);
    if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
      return { distanceMeters: 0, walkMinutes: 2 };
    }

    const cacheKey = `walk_${lat1.toFixed(4)}_${lng1.toFixed(4)}_${lat2.toFixed(4)}_${lng2.toFixed(4)}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    // Fallback: Athens Manhattan pedestrian network distance with 1.25 urban street tortuosity
    const dLatM = Math.abs(lat2 - lat1) * 111139;
    const avgLat = ((lat1 + lat2) / 2) * Math.PI / 180;
    const dLngM = Math.abs(lng2 - lng1) * (111139 * Math.cos(avgLat));
    const fallbackMeters = Math.round((dLatM + dLngM) * 1.25);
    const fallbackMinutes = Math.ceil(fallbackMeters / 75) + 2;

    try {
      const url = `https://router.project-osrm.org/route/v1/walking/${lng1},${lat1};${lng2},${lat2}?overview=false`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.routes && json.routes[0]) {
          const distanceMeters = Math.round(json.routes[0].distance);
          const walkMinutes = Math.ceil(distanceMeters / 75) + 2;
          const result = { distanceMeters, walkMinutes, source: 'osrm' };
          this.setCache(cacheKey, result, 3600);
          return result;
        }
      }
    } catch (e) {
      // Use fallback
    }

    const result = { distanceMeters: fallbackMeters, walkMinutes: fallbackMinutes, source: 'urban_network' };
    this.setCache(cacheKey, result, 3600);
    return result;
  }
}

module.exports = new OasaService();

