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

  /**
   * Helper to decode HTML entities in WordPress text
   */
  decodeHtmlEntities(text = '') {
    if (!text) return '';
    return text
      .replace(/&#8211;/g, '–')
      .replace(/&#8212;/g, '—')
      .replace(/&#8216;/g, '‘')
      .replace(/&#8217;/g, '’')
      .replace(/&#8220;/g, '“')
      .replace(/&#8221;/g, '”')
      .replace(/&#8230;/g, '…')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Retrieve official OASA service disruptions, temporary route modifications, and strike bulletins
   */
  async getDisruptions() {
    const cacheKey = 'oasa_disruptions_bulletins';
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const url = 'https://www.oasa.gr/wp-json/wp/v2/posts?categories=82&per_page=15';
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) throw new Error(`OASA News HTTP ${res.status}`);
      const posts = await res.json();
      if (!Array.isArray(posts)) return [];

      const parsed = posts.map(p => {
        const rawTitle = p.title && p.title.rendered ? p.title.rendered : '';
        const title = this.decodeHtmlEntities(rawTitle);
        const rawExcerpt = p.excerpt && p.excerpt.rendered ? p.excerpt.rendered : '';
        const excerpt = this.decodeHtmlEntities(rawExcerpt);

        // Detect affected line numbers from title and excerpt
        const affectedLines = new Set();
        // Regex for bus lines: 3 digits (e.g. 040, 608, 025), X/E-lines (e.g. X95, E14), letter+digits (e.g. A5, B2)
        const lineMatches = `${title} ${excerpt}`.match(/\b([0-9]{3}|[A-ZΑ-Ω][0-9]{1,2}|X[0-9]{2}|Ε[0-9]{2}|[0-9]{1,2})\b/gi);
        if (lineMatches) {
          lineMatches.forEach(m => {
            const clean = m.trim().toUpperCase();
            // Filter out common false positives like years (2026, 2025), street numbers if huge, etc.
            if (!/^(202\d|201\d|19\d\d|30|15|60)$/.test(clean) || title.includes(`γραμμής ${clean}`) || title.includes(`γραμμών ${clean}`)) {
              if (clean.length >= 2 || /^[0-9]$/.test(clean)) {
                affectedLines.add(clean);
              }
            }
          });
        }

        // Determine announcement category & badge type
        let type = 'notice';
        let typeLabel = 'Ενημέρωση ΟΑΣΑ';
        const lowerTitle = title.toLowerCase();
        if (/απεργ|στάση εργασίας|κινητοποίηση/i.test(lowerTitle)) {
          type = 'strike';
          typeLabel = 'Απεργία / Στάση Εργασίας';
        } else if (/τροποποίησ|παράταση προσωρινής|μερική προσωρινή/i.test(lowerTitle)) {
          type = 'modification';
          typeLabel = 'Τροποποίηση Διαδρομής';
        } else if (/έργα|εργασι/i.test(lowerTitle)) {
          type = 'roadworks';
          typeLabel = 'Οδικά Έργα';
        }

        // Format Greek date (e.g. 28/09/2026)
        let dateFormatted = '';
        if (p.date) {
          const d = new Date(p.date);
          if (!isNaN(d.getTime())) {
            dateFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          }
        }

        return {
          id: p.id,
          title,
          excerpt,
          date: p.date,
          dateFormatted,
          link: p.link,
          type,
          typeLabel,
          affectedLines: Array.from(affectedLines)
        };
      });

      this.setCache(cacheKey, parsed, 900); // 15 min cache
      return parsed;
    } catch (e) {
      console.warn('Failed to fetch OASA disruptions bulletins:', e.message);
      return [];
    }
  }

  /**
   * Simple Point-to-Point Journey Planner (A to B Multimodal Transit Routing)
   */
  async planJourney(originLat, originLng, destLat, destLng) {
    const oLat = parseFloat(originLat);
    const oLng = parseFloat(originLng);
    const dLat = parseFloat(destLat);
    const dLng = parseFloat(destLng);

    if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
      return { itineraries: [], error: 'Invalid coordinates' };
    }

    // Direct distance calculation
    const calcDist = (lat1, lng1, lat2, lng2) => {
      const dLatM = (lat2 - lat1) * 111139;
      const dLngM = (lng2 - lng1) * (111139 * Math.cos(lat1 * Math.PI / 180));
      return Math.round(Math.sqrt(dLatM * dLatM + dLngM * dLngM));
    };

    const directDist = calcDist(oLat, oLng, dLat, dLng);

    // If destination is closer than 400m, suggest walking directly
    if (directDist < 400) {
      const walkMin = Math.ceil(directDist / 75) + 1;
      return {
        origin: { lat: oLat, lng: oLng },
        destination: { lat: dLat, lng: dLng },
        directDistanceMeters: directDist,
        itineraries: [
          {
            type: 'walk_only',
            durationMinutes: walkMin,
            walkingMeters: directDist,
            summary: `Απευθείας περπάτημα (${directDist}μ • ~${walkMin}')`,
            steps: [
              {
                kind: 'walk',
                instruction: `Περπατήστε απευθείας στον προορισμό σας`,
                meters: directDist,
                minutes: walkMin
              }
            ]
          }
        ]
      };
    }

    // Step 1: Discover candidate departure stops (< 750m) and arrival stops (< 750m)
    const [rawOStops, rawDStops] = await Promise.all([
      this.getClosestStops(oLat, oLng).catch(() => []),
      this.getClosestStops(dLat, dLng).catch(() => [])
    ]);

    const oStops = (Array.isArray(rawOStops) ? rawOStops : [])
      .map(s => ({ ...s, dist: calcDist(oLat, oLng, parseFloat(s.StopLat), parseFloat(s.StopLng)) }))
      .filter(s => s.dist <= 850)
      .slice(0, 5);

    const dStops = (Array.isArray(rawDStops) ? rawDStops : [])
      .map(s => ({ ...s, dist: calcDist(dLat, dLng, parseFloat(s.StopLat), parseFloat(s.StopLng)) }))
      .filter(s => s.dist <= 850)
      .slice(0, 5);

    // Fetch lines for origin and destination stops
    const oRoutesPromises = oStops.map(s => this.getStopRoutes(s.StopCode).catch(() => []));
    const dRoutesPromises = dStops.map(s => this.getStopRoutes(s.StopCode).catch(() => []));

    const [oRoutesResults, dRoutesResults] = await Promise.all([
      Promise.all(oRoutesPromises),
      Promise.all(dRoutesPromises)
    ]);

    // Map: lineId -> { originStop, route }
    const oLineMap = new Map();
    oStops.forEach((s, idx) => {
      const routes = oRoutesResults[idx] || [];
      if (Array.isArray(routes)) {
        routes.forEach(r => {
          if (r && r.LineID && !oLineMap.has(r.LineID)) {
            oLineMap.set(r.LineID, { stop: s, route: r });
          }
        });
      }
    });

    // Map: lineId -> { destStop, route }
    const dLineMap = new Map();
    dStops.forEach((s, idx) => {
      const routes = dRoutesResults[idx] || [];
      if (Array.isArray(routes)) {
        routes.forEach(r => {
          if (r && r.LineID && !dLineMap.has(r.LineID)) {
            dLineMap.set(r.LineID, { stop: s, route: r });
          }
        });
      }
    });

    const itineraries = [];

    // Step 2: Identify Direct Bus / Trolley Lines
    for (const [lineId, oEntry] of oLineMap.entries()) {
      if (dLineMap.has(lineId)) {
        const dEntry = dLineMap.get(lineId);
        const startStop = oEntry.stop;
        const endStop = dEntry.stop;

        // Skip if start and end are identical stop
        if (startStop.StopCode === endStop.StopCode) continue;

        const walk1Meters = startStop.dist;
        const walk1Minutes = Math.ceil(walk1Meters / 75) + 1;

        const walk2Meters = endStop.dist;
        const walk2Minutes = Math.ceil(walk2Meters / 75) + 1;

        const transitDistance = calcDist(
          parseFloat(startStop.StopLat), parseFloat(startStop.StopLng),
          parseFloat(endStop.StopLat), parseFloat(endStop.StopLng)
        );

        // Approximate bus speed in Athens traffic: ~17 km/h (~280 meters/minute) + 3 min wait buffer
        const rideMinutes = Math.max(3, Math.round(transitDistance / 280));
        const waitMinutes = 4;
        const totalDuration = walk1Minutes + waitMinutes + rideMinutes + walk2Minutes;

        const lineDescr = oEntry.route.RouteDescr || oEntry.route.LineDescr || `Γραμμή ${lineId}`;
        const destination = oEntry.route.cleanDestination || 'Τέρμα';

        itineraries.push({
          type: 'direct_bus',
          lineId,
          totalDurationMinutes: totalDuration,
          transitMinutes: rideMinutes,
          totalWalkMeters: walk1Meters + walk2Meters,
          departureStop: {
            code: startStop.StopCode,
            name: startStop.StopDescr,
            lat: parseFloat(startStop.StopLat),
            lng: parseFloat(startStop.StopLng),
            walkMeters: walk1Meters,
            walkMinutes: walk1Minutes
          },
          arrivalStop: {
            code: endStop.StopCode,
            name: endStop.StopDescr,
            lat: parseFloat(endStop.StopLat),
            lng: parseFloat(endStop.StopLng),
            walkMeters: walk2Meters,
            walkMinutes: walk2Minutes
          },
          steps: [
            {
              kind: 'walk',
              instruction: `Περπατήστε ${walk1Minutes}' (${walk1Meters}μ) μέχρι τη στάση ${startStop.StopDescr}`,
              meters: walk1Meters,
              minutes: walk1Minutes
            },
            {
              kind: 'transit',
              mode: 'bus',
              lineId,
              lineDescr,
              direction: destination,
              fromStop: startStop.StopDescr,
              toStop: endStop.StopDescr,
              durationMinutes: rideMinutes,
              distanceMeters: transitDistance
            },
            {
              kind: 'walk',
              instruction: `Περπατήστε ${walk2Minutes}' (${walk2Meters}μ) από τη στάση ${endStop.StopDescr} στον προορισμό σας`,
              meters: walk2Meters,
              minutes: walk2Minutes
            }
          ]
        });
      }
    }

    // Step 3: Check for Metro connections (Lines 1, 2, 3, Tram)
    const metroService = require('./metro-service');
    if (metroService && metroService.stations) {
      const allStations = Object.values(metroService.stations);

      // Find closest stations to origin (< 1000m) and destination (< 1000m)
      const nearOStations = allStations
        .map(st => ({ ...st, dist: calcDist(oLat, oLng, st.lat, st.lng) }))
        .filter(st => st.dist <= 1000)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);

      const nearDStations = allStations
        .map(st => ({ ...st, dist: calcDist(dLat, dLng, st.lat, st.lng) }))
        .filter(st => st.dist <= 1000)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);

      for (const st1 of nearOStations) {
        for (const st2 of nearDStations) {
          if (st1.id === st2.id) continue;

          // Check if they share a metro line
          const commonLines = (st1.lines || []).filter(l => (st2.lines || []).includes(l));
          if (commonLines.length > 0) {
            const lineName = commonLines[0];
            const walk1Min = Math.ceil(st1.dist / 80) + 1;
            const walk2Min = Math.ceil(st2.dist / 80) + 1;

            const metroDist = calcDist(st1.lat, st1.lng, st2.lat, st2.lng);
            // Metro speed in Athens is ~32 km/h (~530 m/min)
            const metroRideMin = Math.max(3, Math.round(metroDist / 530));
            const totalDuration = walk1Min + 4 + metroRideMin + walk2Min;

            itineraries.push({
              type: 'direct_metro',
              lineId: lineName,
              totalDurationMinutes: totalDuration,
              transitMinutes: metroRideMin,
              totalWalkMeters: st1.dist + st2.dist,
              departureStop: {
                code: st1.id,
                name: `Σταθμός ${st1.name}`,
                lat: st1.lat,
                lng: st1.lng,
                walkMeters: st1.dist,
                walkMinutes: walk1Min
              },
              arrivalStop: {
                code: st2.id,
                name: `Σταθμός ${st2.name}`,
                lat: st2.lat,
                lng: st2.lng,
                walkMeters: st2.dist,
                walkMinutes: walk2Min
              },
              steps: [
                {
                  kind: 'walk',
                  instruction: `Περπατήστε ${walk1Min}' (${st1.dist}μ) μέχρι τον Σταθμό Μετρό ${st1.name}`,
                  meters: st1.dist,
                  minutes: walk1Min
                },
                {
                  kind: 'transit',
                  mode: 'metro',
                  lineId: lineName,
                  lineDescr: `Μετρό ${lineName}`,
                  fromStop: st1.name,
                  toStop: st2.name,
                  durationMinutes: metroRideMin,
                  distanceMeters: metroDist
                },
                {
                  kind: 'walk',
                  instruction: `Περπατήστε ${walk2Min}' (${st2.dist}μ) από τον Σταθμό ${st2.name} στον προορισμό σας`,
                  meters: st2.dist,
                  minutes: walk2Min
                }
              ]
            });
          }
        }
      }
    }

    // Sort itineraries by total duration
    itineraries.sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes);

    // Enrich top 3 bus itineraries with live telematics arrivals for the departure stop
    const topItins = itineraries.slice(0, 5);
    await Promise.all(topItins.map(async (itin) => {
      if (itin.type === 'direct_bus' && itin.departureStop && itin.departureStop.code) {
        try {
          const arrivals = await this.getStopArrivals(itin.departureStop.code);
          if (Array.isArray(arrivals)) {
            const match = arrivals.find(a => String(a.line_id || a.btime2) && (a.line_id === itin.lineId || a.route_code));
            if (match && match.btime2) {
              itin.liveEtaMinutes = parseInt(match.btime2, 10);
            }
          }
        } catch (e) {}
      }
    }));

    return {
      origin: { lat: oLat, lng: oLng },
      destination: { lat: dLat, lng: dLng },
      directDistanceMeters: directDist,
      itineraries: topItins
    };
  }
}

module.exports = new OasaService();

