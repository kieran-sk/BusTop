/**
 * Athens OASA Bus Commuter Suite - Express Server & API Proxy
 * Includes caching, OASA Telematics integration, and scheduled arrival estimation.
 */

// Force allow TLS for OASA telematics endpoints
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const path = require('path');
const oasa = require('./oasa-service');
const estimator = require('./arrival-estimator');
const metroService = require('./metro-service');

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static web files
app.use(express.static(path.join(__dirname, '../web')));

// ================= API ENDPOINTS =================

/**
 * App Configuration (e.g. Google Maps API Key)
 */
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    status: 'ok',
    version: '1.0.0'
  });
});

/**
 * List all lines
 */
app.get('/api/lines', async (req, res) => {
  try {
    const lines = await oasa.getLines();
    res.json(lines || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lines', details: err.message });
  }
});

/**
 * Routes for a line
 */
app.get('/api/lines/:lineCode/routes', async (req, res) => {
  try {
    const { lineCode } = req.params;
    const routes = await oasa.getRoutes(lineCode);
    res.json(routes || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routes', details: err.message });
  }
});

/**
 * Stops for a route
 */
app.get('/api/routes/:routeCode/stops', async (req, res) => {
  try {
    const { routeCode } = req.params;
    const stops = await oasa.getStops(routeCode);
    res.json(stops || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stops', details: err.message });
  }
});

/**
 * Route details & polyline coordinates
 */
app.get('/api/routes/:routeCode/details', async (req, res) => {
  try {
    const { routeCode } = req.params;
    const details = await oasa.getRouteDetails(routeCode);
    res.json(details || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch route details', details: err.message });
  }
});

/**
 * Live bus GPS locations on a route with reporting latency and status
 */
app.get('/api/routes/:routeCode/buses', async (req, res) => {
  try {
    const { routeCode } = req.params;
    const buses = await oasa.getLiveBusesWithAge(routeCode);
    res.json(buses || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bus locations', details: err.message });
  }
});

app.get('/api/buses/live', async (req, res) => {
  try {
    const { routeCode } = req.query;
    if (!routeCode) {
      return res.status(400).json({ error: 'routeCode query param required' });
    }
    const buses = await oasa.getLiveBusesWithAge(routeCode);
    res.json(buses || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch live buses', details: err.message });
  }
});

/**
 * oasa.live citywide fleet snapshot
 */
app.get('/api/buses/fleet', async (req, res) => {
  try {
    const fleet = await oasa.syncOasaLiveFleet();
    res.json(fleet || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fleet snapshot', details: err.message });
  }
});

/**
 * Urban pedestrian walking distance and duration
 */
app.get('/api/routing/walk', async (req, res) => {
  try {
    const { fromLat, fromLng, toLat, toLng } = req.query;
    if (!fromLat || !fromLng || !toLat || !toLng) {
      return res.status(400).json({ error: 'fromLat, fromLng, toLat, toLng query params required' });
    }
    const route = await oasa.getWalkingRoute(fromLat, fromLng, toLat, toLng);
    res.json(route);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute walking route', details: err.message });
  }
});

/**
 * Helper to cleanly extract destination terminus from OASA route description
 */
function cleanRouteDestination(route) {
  if (!route) return '';
  let descr = (route.RouteDescr || route.LineDescr || '').trim();
  if (!descr) return '';

  const isCirc = /κυκλικη|circular/i.test(descr);
  if (isCirc) return 'Κυκλική';

  // Remove leading prefixes like "*** ", "B* ", "Γ* ", "A* ", "1* ", numbers etc.
  descr = descr.replace(/^[\*\sA-Za-z0-9Α-Ωα-ω\.]+\*\s*/, '');
  descr = descr.replace(/^\*+\s*/, '');
  // Remove bracketed notes like "[ΠΑΝΟΡΑΜΑ]", "[VIA PANORAMA-NTRAFI]"
  descr = descr.replace(/\[.*?\]/g, ' ').trim();
  // Remove remarks like (ΜΕΣΩ ...) or (ΠΑΡΑΛΛΑΓΗ ...)
  descr = descr.replace(/\((ΜΕΣΩ|ΠΑΡΑΛΛΑΓΗ|ΕΝΑΛΛΑΚΤΙΚΗ|ΚΥΚΛΙΚΗ|VIA).*?\)/gi, ' ').trim();

  // If hyphen separator exists, destination is the last segment
  if (descr.includes('-')) {
    const parts = descr.split('-').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      descr = parts[parts.length - 1];
    }
  }

  descr = descr.replace(/[()\[\]]/g, '').trim();
  // Clean dots spacing e.g. "ΣΤ.ΔΟΥΚ.ΠΛΑΚΕΝΤΙΑΣ" -> "ΣΤ. ΔΟΥΚ. ΠΛΑΚΕΝΤΙΑΣ"
  descr = descr.replace(/\.([^\s\d])/g, (m, ch) => '. ' + ch).replace(/\s+/g, ' ').trim();
  return descr || 'Τέρμα';
}

/**
 * Routes serving a specific stop
 */
app.get('/api/stops/:stopCode/routes', async (req, res) => {
  try {
    const { stopCode } = req.params;
    const routes = await oasa.getStopRoutes(stopCode);
    if (!Array.isArray(routes)) return res.json([]);

    const enrichedRoutes = routes.map(r => {
      const isCirc = /κυκλικη|circular/i.test(r.RouteDescr || '') || /κυκλικη|circular/i.test(r.LineDescr || '');
      return {
        ...r,
        cleanDestination: cleanRouteDestination(r),
        directionLabel: isCirc ? 'Κυκλική' : (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση')
      };
    });
    res.json(enrichedRoutes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stop routes', details: err.message });
  }
});

/**
 * Combined stop arrivals (Real-time Live Telematics + Scheduled departures for untracked buses)
 */
app.get('/api/stops/:stopCode/arrivals', async (req, res) => {
  try {
    const { stopCode } = req.params;
    const { day } = req.query;
    const result = await estimator.getCombinedArrivals(stopCode, day || 'today');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stop arrivals', details: err.message });
  }
});

app.get('/api/stops/closest', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = parseInt(req.query.limit, 10) || 30;
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const [s1, s2, s3, s4] = await Promise.all([
      oasa.getClosestStops(lat, lng).catch(() => []),
      oasa.getClosestStops(lat + 0.005, lng + 0.005).catch(() => []),
      oasa.getClosestStops(lat - 0.005, lng - 0.005).catch(() => []),
      oasa.getClosestStops(lat + 0.005, lng - 0.005).catch(() => [])
    ]);

    const merged = new Map();
    for (const s of [...(Array.isArray(s1) ? s1 : []), ...(Array.isArray(s2) ? s2 : []), ...(Array.isArray(s3) ? s3 : []), ...(Array.isArray(s4) ? s4 : [])]) {
      const sCode = String(s.StopCode);
      if (!merged.has(sCode)) {
        const sLat = parseFloat(s.StopLat);
        const sLng = parseFloat(s.StopLng);
        const dLat = (sLat - lat) * 111139;
        const dLng = (sLng - lng) * (111139 * Math.cos(lat * Math.PI / 180));
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        merged.set(sCode, { ...s, distanceMeters: dist });
      }
    }

    const sorted = Array.from(merged.values()).sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
    const topStops = sorted.slice(0, limit);

    // Enrich stops with deduplicated lines and their last stop destinations
    const enriched = await Promise.all(topStops.map(async (s) => {
      try {
        const routes = await oasa.getStopRoutes(s.StopCode);
        const linesMap = new Map();
        if (Array.isArray(routes)) {
          for (const r of routes) {
            const lid = r.LineID;
            if (!lid) continue;
            const dest = cleanRouteDestination(r);
            const isCirc = /κυκλικη|circular/i.test(r.RouteDescr || '') || /κυκλικη|circular/i.test(r.LineDescr || '');
            const direction = isCirc ? 'Κυκλική' : (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση');

            if (!linesMap.has(lid)) {
              linesMap.set(lid, {
                line_id: lid,
                last_stop: dest,
                direction
              });
            }
          }
        }
        return {
          ...s,
          serving_lines: Array.from(linesMap.values())
        };
      } catch (e) {
        return { ...s, serving_lines: [] };
      }
    }));

    // Sort stops: Stops with active routes first, stops with no routes at the bottom
    enriched.sort((a, b) => {
      const aHas = Array.isArray(a.serving_lines) && a.serving_lines.length > 0;
      const bHas = Array.isArray(b.serving_lines) && b.serving_lines.length > 0;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (a.distanceMeters || 0) - (b.distanceMeters || 0);
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch closest stops', details: err.message });
  }
});

/**
 * Stops within map viewport bounding box (for map panning and zooming)
 */
app.get('/api/stops/bounds', async (req, res) => {
  try {
    const north = parseFloat(req.query.north);
    const south = parseFloat(req.query.south);
    const east = parseFloat(req.query.east);
    const west = parseFloat(req.query.west);
    const limit = parseInt(req.query.limit, 10) || 80;

    if (isNaN(north) || isNaN(south) || isNaN(east) || isNaN(west)) {
      return res.status(400).json({ error: 'north, south, east, west query parameters are required' });
    }

    const allStops = await oasa.getAllStops();
    const inBounds = [];
    for (const s of allStops) {
      const lat = parseFloat(s.StopLat);
      const lng = parseFloat(s.StopLng);
      if (lat >= south && lat <= north && lng >= west && lng <= east) {
        inBounds.push({
          StopCode: s.StopCode,
          StopID: s.StopID,
          StopDescr: s.StopDescr,
          StopStreet: s.StopStreet,
          StopLat: s.StopLat,
          StopLng: s.StopLng
        });
        if (inBounds.length >= limit) break;
      }
    }

    res.json(inBounds);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stops in bounds', details: err.message });
  }
});

/**
 * Resolve LineCode from LineID or query
 */
app.get('/api/lines/resolve', async (req, res) => {
  try {
    const { lineId } = req.query;
    if (!lineId) {
      return res.status(400).json({ error: 'lineId query parameter is required' });
    }
    const lines = await oasa.getLines();
    if (Array.isArray(lines)) {
      const match = lines.find(l => String(l.LineID).trim().toLowerCase() === String(lineId).trim().toLowerCase());
      if (match) {
        return res.json({
          line_code: match.LineCode,
          line_id: match.LineID,
          line_descr: match.LineDescr
        });
      }
    }
    res.status(404).json({ error: 'Line not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve line', details: err.message });
  }
});

/**
 * Search stops by name, Greek/English description, street, or code
 */
app.get('/api/stops/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const stops = await oasa.searchStops(q);
    res.json(stops);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search stops', details: err.message });
  }
});

/**
 * Comprehensive timetable for a line (Daily, Saturday, Sunday)
 */
app.get('/api/lines/:lineCode/timetable', async (req, res) => {
  try {
    let { lineCode } = req.params;
    if (!lineCode || lineCode === 'undefined' || lineCode === 'null' || lineCode.trim() === '') {
      return res.status(400).json({ error: 'Invalid line code provided' });
    }

    lineCode = lineCode.trim();

    // Check if lineCode is actually a LineID (e.g. '021', '040', '306')
    const lines = await oasa.getLines();
    if (Array.isArray(lines)) {
      const exists = lines.some(l => String(l.LineCode) === String(lineCode));
      if (!exists) {
        const matchId = lines.find(l => String(l.LineID).trim().toLowerCase() === String(lineCode).toLowerCase());
        if (matchId) {
          lineCode = matchId.LineCode;
        }
      }
    }

    // 1. Fetch available schedule days
    const scheduleDays = await oasa.getScheduleDays(lineCode);
    
    // 2. Fetch master line info to get ml_code
    const linesWithML = await oasa.getLinesWithML();
    const lineML = linesWithML?.find(l => String(l.line_code) === String(lineCode));
    const mlCode = lineML?.ml_code;

    // 3. Fetch departures for each schedule profile
    const profiles = {};
    if (Array.isArray(scheduleDays) && mlCode) {
      for (const day of scheduleDays) {
        const sdcCode = day.sdc_code;
        try {
          const sched = await oasa.getSchedLines(mlCode, sdcCode, lineCode);
          profiles[sdcCode] = {
            title: day.sdc_descr,
            title_eng: day.sdc_descr_eng,
            data: sched
          };
        } catch (e) {
          // ignore profile fetch failure
        }
      }
    }

    // 4. Default daily schedule
    const daily = await oasa.getDailySchedule(lineCode);

    res.json({
      line_code: lineCode,
      schedule_days: scheduleDays || [],
      profiles,
      daily_schedule: daily
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch timetable', details: err.message });
  }
});

// ================= METRO & TRAM ENDPOINTS (ΣΤΑΣΥ / O2 HUB / DATA.GOV.GR) =================

/**
 * Athens Metro & Tram Network GeoJSON (tracks, stations, lines)
 */
app.get('/api/metro/network', (req, res) => {
  try {
    const geo = metroService.getNetworkGeoJson();
    res.json(geo);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metro network', details: err.message });
  }
});

/**
 * Metro & Tram Lines summary
 */
app.get('/api/metro/lines', (req, res) => {
  try {
    res.json(Object.values(metroService.lines));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metro lines', details: err.message });
  }
});

/**
 * Metro Station Details, Departures & Nearby Bus Connections
 */
app.get('/api/metro/station/:stationId', async (req, res) => {
  try {
    const { stationId } = req.params;
    const details = await metroService.getStationDetails(stationId);
    if (!details) {
      return res.status(404).json({ error: 'Station not found' });
    }
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch station details', details: err.message });
  }
});

// Strict JSON 404 handler for any API endpoint before SPA fallback
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', path: req.path });
});

// Fallback for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Athens OASA Bus Live Tracking & Commuter Suite Running `);
  console.log(` Web UI & API URL: http://localhost:${PORT}             `);
  console.log(` Serving Material 3 Expressive & Google Maps Platform   `);
  console.log(`=======================================================`);
});
