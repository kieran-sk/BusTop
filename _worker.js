/**
 * Athens OASA Bus - Cloudflare Pages Edge Worker
 * Full serverless backend running directly on Cloudflare Edge in Athens
 */

const CACHE = new Map();

function getCache(key) {
  const item = CACHE.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    CACHE.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data, ttl) {
  CACHE.set(key, { data, expiry: Date.now() + ttl * 1000 });
}

const OASA_BASE = 'https://telematics.oasa.gr/api/';

async function oasaRequest(action, params = {}, ttl = 0) {
  const q = new URLSearchParams({ act: action, ...params });
  const k = action + ':' + q.toString();
  if (ttl > 0) {
    const c = getCache(k);
    if (c) return c;
  }
  const res = await fetch(OASA_BASE + '?' + q.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8'
    }
  });
  if (!res.ok) throw new Error('OASA API HTTP ' + res.status);
  const text = await res.text();
  if (!text || text.trim() === 'null' || text.trim() === '') return null;
  try {
    const data = JSON.parse(text);
    if (ttl > 0 && data) setCache(k, data, ttl);
    return data;
  } catch (e) {
    return null;
  }
}

function cleanRouteDestination(route) {
  if (!route) return '';
  let descr = (route.RouteDescr || route.LineDescr || '').trim();
  if (!descr) return '';
  if (/κυκλικη|circular/i.test(descr)) return 'Κυκλική';
  descr = descr.replace(/^[\*\sA-Za-z0-9Α-Ωα-ω\.]+\*\s*/, '').replace(/^\*+\s*/, '').replace(/\[.*?\]/g, ' ').trim();
  descr = descr.replace(/\((ΜΕΣΩ|ΠΑΡΑΛΛΑΓΗ|ΕΝΑΛΛΑΚΤΙΚΗ|ΚΥΚΛΙΚΗ|VIA).*?\)/gi, ' ').trim();
  if (descr.includes('-')) {
    const parts = descr.split('-').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) descr = parts[parts.length - 1];
  }
  descr = descr.replace(/[()\[\]]/g, '').replace(/\.([^\s\d])/g, (m, ch) => '. ' + ch).replace(/\s+/g, ' ').trim();
  return descr || 'Τέρμα';
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function getAthensCurrentTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('el-GR', {
    timeZone: 'Europe/Athens',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return {
    totalMinutes: hour * 60 + minute,
    formatted: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
  };
}

async function getCombinedArrivals(stopCode, targetDay = 'today') {
  const athensNow = getAthensCurrentTime();
  const currentMinutes = athensNow.totalMinutes;
  const isTomorrow = targetDay === 'tomorrow';
  const [liveArrivalsRaw, stopRoutesFetchRaw] = await Promise.all([
    isTomorrow ? Promise.resolve([]) : oasaRequest('getStopArrivals', { p1: stopCode }, 10).catch(() => []),
    oasaRequest('webRoutesForStop', { p1: stopCode }, 1800).catch(() => [])
  ]);
  const liveArrivals = Array.isArray(liveArrivalsRaw) ? liveArrivalsRaw : [];
  const stopRoutesRaw = Array.isArray(stopRoutesFetchRaw) ? stopRoutesFetchRaw : [];
  const routeCodeMap = new Map();
  for (const r of stopRoutesRaw) {
    if (!routeCodeMap.has(String(r.RouteCode))) routeCodeMap.set(String(r.RouteCode), r);
  }
  const stopRoutes = Array.from(routeCodeMap.values());
  const routesByCode = new Map();
  for (const r of stopRoutes) routesByCode.set(String(r.RouteCode), r);
  const results = [];
  const routesWithLive = new Set();
  const linesWithLive = new Set();
  if (!isTomorrow) {
    for (const arr of liveArrivals) {
      const rc = String(arr.route_code);
      routesWithLive.add(rc);
      const route = routesByCode.get(rc) || {};
      const lid = route.LineID || arr.line_id || (arr.route_code ? `#${arr.route_code}` : '?');
      if (lid) linesWithLive.add(String(lid).trim());
      const btime2 = parseInt(arr.btime2, 10);
      const arrMin = currentMinutes + btime2;
      const estTime = String(Math.floor(arrMin / 60) % 24).padStart(2, '0') + ':' + String(Math.round(arrMin % 60)).padStart(2, '0');
      results.push({
        route_code: rc,
        line_code: route.LineCode || null,
        line_id: lid,
        line_descr: route.LineDescr || route.RouteDescr || 'Λεωφορείο ΟΑΣΑ',
        route_descr: route.RouteDescr || '',
        destination: cleanRouteDestination(route),
        direction: /κυκλικη|circular/i.test(route.LineDescr || '') ? '🔄' : (route.RouteType === '2' ? '⬅️' : '➡️'),
        veh_code: arr.veh_code || null,
        btime2: btime2,
        estimated_arrival_time: estTime,
        is_live: true,
        status_label: 'Ζωντανό GPS',
        source: 'gps_telematics'
      });
    }
  }

  // Helper to prioritize active operational routes over defunct/school/variant lines
  const routeScore = (r) => {
    const descr = r.RouteDescr || '';
    let score = 100;
    if (descr.startsWith('***')) score -= 60;
    if (/^[Α-ΩA-Z]\*|^\*/.test(descr)) score -= 40;
    if (/σχολικ/i.test(descr)) score -= 30;
    if (/νυχτεριν/i.test(descr)) score -= 10;
    const lc = parseInt(r.LineCode, 10);
    if (!isNaN(lc)) score += Math.min(20, lc / 100);
    return score;
  };

  // Group candidate routes by line_id so every line is represented
  const lineRoutesMap = new Map();
  for (const r of stopRoutes) {
    const lid = String(r.LineID || 'BUS').trim();
    if (!lineRoutesMap.has(lid)) lineRoutesMap.set(lid, []);
    lineRoutesMap.get(lid).push(r);
  }
  const candidateRoutes = [];
  for (const [lid, routes] of lineRoutesMap.entries()) {
    routes.sort((a, b) => routeScore(b) - routeScore(a));
    const seenLineCodes = new Set();
    let count = 0;
    for (const r of routes) {
      const lc = String(r.LineCode);
      if (!seenLineCodes.has(lc) && count < 2) {
        seenLineCodes.add(lc);
        candidateRoutes.push(r);
        count++;
      }
    }
  }

  await Promise.all(candidateRoutes.map(async (route) => {
    const lineCode = route.LineCode;
    const rc = String(route.RouteCode);
    const lineId = route.LineID || 'BUS';
    if (!lineCode) return;
    try {
      const sched = await oasaRequest('getDailySchedule', { line_code: lineCode }, 600);
      if (!sched) return;
      const isCome = route.RouteType === '2';
      const departures = (isCome ? sched.come : sched.go) || (sched.go?.length ? sched.go : sched.come) || [];
      if (!Array.isArray(departures) || departures.length === 0) return;
      let stopOrder = 1;
      try {
        const rs = await oasaRequest('webGetStops', { p1: rc }, 1800);
        if (Array.isArray(rs)) {
          const f = rs.find(s => String(s.StopCode) === String(stopCode) || String(s.StopID) === String(stopCode));
          if (f && f.RouteStopOrder) stopOrder = parseInt(f.RouteStopOrder, 10);
        }
      } catch(e) {}
      const transit = Math.max(0, (stopOrder - 1) * 2.2);
      for (const dep of departures) {
        const rawT = isCome
          ? (dep.sde_start2 || dep.sdd_start2 || dep.sde_start1 || dep.sdd_start1)
          : (dep.sde_start1 || dep.sdd_start1 || dep.sde_start2 || dep.sdd_start2);
        const depM = timeToMinutes(rawT);
        if (depM === null) continue;
        const arrMin = depM + transit;
        const rem = isTomorrow ? Math.round((1440 - currentMinutes) + arrMin) : Math.round(arrMin - currentMinutes);
        if (isTomorrow || (rem >= 1 && rem <= 1440)) {
          const alreadyHasLive = !isTomorrow && results.some(
            r => r.line_id === lineId && r.is_live && Math.abs(r.btime2 - rem) <= 7
          );
          if (!alreadyHasLive) {
            const depFormatted = String(Math.floor(depM / 60) % 24).padStart(2, '0') + ':' + String(depM % 60).padStart(2, '0');
            const estFormatted = String(Math.floor(arrMin / 60) % 24).padStart(2, '0') + ':' + String(Math.round(arrMin % 60)).padStart(2, '0');
            results.push({
              route_code: rc,
              line_code: lineCode,
              line_id: lineId,
              line_descr: route.LineDescr || route.RouteDescr || 'Λεωφορείο ΟΑΣΑ',
              route_descr: route.RouteDescr || '',
              direction: /κυκλικη|circular/i.test(route.LineDescr || '') ? '🔄' : (route.RouteType === '2' ? '⬅️' : '➡️'),
              veh_code: null,
              btime2: rem,
              estimated_arrival_time: estFormatted,
              is_live: false,
              departure_time: depFormatted,
              destination: cleanRouteDestination(route),
              departure_terminal: cleanRouteDestination(route),
              status_label: 'Προγραμματισμένη (' + depFormatted + ')',
              source: 'timetable_estimate'
            });
          }
        }
      }
    } catch(e) {}
  }));

  // Deduplicate exact line departures
  const deduplicatedMap = new Map();
  for (const a of results) {
    const key = a.is_live
      ? `${a.line_id}_live_${a.veh_code || a.route_code}_${a.btime2}`
      : `${a.line_id}_sched_${a.departure_time}`;
    if (!deduplicatedMap.has(key)) deduplicatedMap.set(key, a);
  }
  const finalResults = Array.from(deduplicatedMap.values());
  finalResults.sort((a, b) => a.btime2 - b.btime2);
  return { stop_code: stopCode, athens_time: athensNow.formatted, target_day: targetDay, total_arrivals: finalResults.length, arrivals: finalResults };
}

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const isAllowed = !origin ||
    origin.includes('bustop.pages.dev') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.startsWith('android-app://') ||
    origin === 'null';

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': isAllowed ? (origin || '*') : 'https://bustop.pages.dev',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

const jsonRes = (data, status = 200, req = null) => {
  const body = (data === null || data === undefined) ? { success: false, data: null } : data;
  return new Response(JSON.stringify(body), {
    status,
    headers: req ? getCorsHeaders(req) : {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(request)
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      try {
        if (path === '/api/config') return jsonRes({ googleMapsApiKey: '', status: 'ok', version: '1.0.0', edge: 'Cloudflare Pages (Athens)' });
        if (path === '/api/lines') return jsonRes((await oasaRequest('webGetLines', {}, 1800)) || []);
        if (path === '/api/lines/resolve') {
          const lid = url.searchParams.get('lineId');
          const lines = await oasaRequest('webGetLines', {}, 1800);
          const m = Array.isArray(lines) && lines.find(l => String(l.LineID).trim().toLowerCase() === String(lid).trim().toLowerCase());
          return m ? jsonRes({ line_code: m.LineCode, line_id: m.LineID, line_descr: m.LineDescr }) : jsonRes({ error: 'Not found' }, 404);
        }
        const mRoutes = path.match(/^\/api\/lines\/([^\/]+)\/routes$/);
        if (mRoutes) return jsonRes((await oasaRequest('webGetRoutes', { p1: mRoutes[1] }, 1800)) || []);
        const mStops = path.match(/^\/api\/routes\/([^\/]+)\/stops$/);
        if (mStops) return jsonRes((await oasaRequest('webGetStops', { p1: mStops[1] }, 1800)) || []);
        const mDet = path.match(/^\/api\/routes\/([^\/]+)\/details$/);
        if (mDet) return jsonRes((await oasaRequest('webRouteDetails', { p1: mDet[1] }, 1800)) || []);
        const mBuses = path.match(/^\/api\/routes\/([^\/]+)\/buses$/);
        if (mBuses) return jsonRes((await oasaRequest('getBusLocation', { p1: mBuses[1] }, 10)) || []);
        if (path === '/api/buses/live') return jsonRes((await oasaRequest('getBusLocation', { p1: url.searchParams.get('routeCode') }, 10)) || []);
        const mStopRoutes = path.match(/^\/api\/stops\/([^\/]+)\/routes$/);
        if (mStopRoutes) {
          const rts = await oasaRequest('webRoutesForStop', { p1: mStopRoutes[1] }, 1800);
          return jsonRes((Array.isArray(rts) ? rts : []).map(r => ({
            ...r,
            cleanDestination: cleanRouteDestination(r),
            directionLabel: /κυκλικη|circular/i.test(r.RouteDescr||'') ? '🔄' : (r.RouteType === '2' ? '⬅️' : '➡️')
          })));
        }
        const mArr = path.match(/^\/api\/stops\/([^\/]+)\/arrivals$/);
        if (mArr) return jsonRes(await getCombinedArrivals(mArr[1], url.searchParams.get('day') || 'today'));
        if (path === '/api/stops/all') {
          const cached = getCache('all_master_stops');
          if (cached) return jsonRes(cached);
          try {
            // First attempt to load bundled static all_stops.json from assets
            const assetRes = await env.ASSETS.fetch(new Request(new URL('/data/all_stops.json', request.url)));
            if (assetRes.ok) {
              const stops = await assetRes.json();
              if (Array.isArray(stops) && stops.length > 0) {
                setCache('all_master_stops', stops, 86400);
                return jsonRes(stops);
              }
            }
          } catch(assetErr) {}

          try {
            const res = await fetch('https://telematics.oasa.gr/api/?act=getStops', {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': '*/*'
              }
            });
            if (!res.ok) throw new Error('OASA API error');
            const rawText = await res.text();
            // Parse OASA SQL/tuple format: (-order, "StopCode", "StopDescr", "StopDescrEng", "StopStreet", "StopStreetEng", Heading, StopLng, StopLat, ...)
            const stops = [];
            const regex = /\(-?\d+,\s*"([^"]+)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*[^,]+,\s*([0-9.]+),\s*([0-9.]+)/g;
            let match;
            while ((match = regex.exec(rawText)) !== null) {
              const stopCode = match[1];
              const descr = match[2];
              const descrEng = match[3];
              const street = match[4] === 'null' ? '' : match[4];
              const lng = parseFloat(match[6]);
              const lat = parseFloat(match[7]);
              stops.push({
                StopCode: stopCode,
                StopDescr: descr,
                StopDescrEng: descrEng,
                StopStreet: street,
                StopLat: lat,
                StopLng: lng
              });
            }
            if (stops.length > 0) {
              setCache('all_master_stops', stops, 86400);
              return jsonRes(stops);
            }
            return jsonRes([]);
          } catch(e) {
            return jsonRes([]);
          }
        }
        if (path === '/api/stops/search') {
          const q = (url.searchParams.get('q') || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          if (!q) return jsonRes([]);

          // 1. First try searching in master stops list
          let allStops = getCache('all_master_stops');
          if (!allStops || allStops.length === 0) {
            try {
              const assetRes = await env.ASSETS.fetch(new Request(new URL('/data/all_stops.json', request.url)));
              if (assetRes.ok) {
                allStops = await assetRes.json();
                if (Array.isArray(allStops) && allStops.length > 0) {
                  setCache('all_master_stops', allStops, 86400);
                }
              }
            } catch(e) {}
          }

          if (Array.isArray(allStops) && allStops.length > 0) {
            const matches = allStops.filter(s => {
              const sCode = String(s.StopCode || '');
              const sName = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              const sStreet = (s.StopStreet || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              const sEng = (s.StopDescrEng || '').toLowerCase();
              return sCode.includes(q) || sName.includes(q) || sStreet.includes(q) || sEng.includes(q);
            }).slice(0, 30);
            return jsonRes(matches);
          }

          // Fallback: search central hubs
          const hubs = [
            { lat: 37.9845, lng: 23.7335 }, // Center / Omonia / Syntagma
            { lat: 37.9429, lng: 23.6469 }, // Piraeus
            { lat: 38.0483, lng: 23.8055 }, // Marousi / Kifisia
            { lat: 37.9056, lng: 23.7547 }  // Glyfada / South
          ];
          const results = await Promise.all(hubs.map(h => oasaRequest('getClosestStops', { p1: h.lat, p2: h.lng }, 120).catch(() => [])));
          const merged = new Map();
          for (const list of results) {
            if (Array.isArray(list)) {
              for (const s of list) {
                const sCode = String(s.StopCode);
                if (!merged.has(sCode)) {
                  const sName = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                  const sStreet = (s.StopStreet || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                  if (sCode.includes(q) || sName.includes(q) || sStreet.includes(q)) {
                    merged.set(sCode, s);
                  }
                }
              }
            }
          }
          return jsonRes(Array.from(merged.values()).slice(0, 30));
        }
        if (path === '/api/stops/closest') {
          const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
          if (isNaN(lat) || isNaN(lng)) return jsonRes([]);

          const [s1, s2, s3, s4] = await Promise.all([
            oasaRequest('getClosestStops', { p1: lat, p2: lng }, 30).catch(() => []),
            oasaRequest('getClosestStops', { p1: lat + 0.005, p2: lng + 0.005 }, 60).catch(() => []),
            oasaRequest('getClosestStops', { p1: lat - 0.005, p2: lng - 0.005 }, 60).catch(() => []),
            oasaRequest('getClosestStops', { p1: lat + 0.005, p2: lng - 0.005 }, 60).catch(() => [])
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
          const topStops = sorted.slice(0, 45);

          const enriched = await Promise.all(topStops.map(async s => {
            try {
              const routes = await oasaRequest('webRoutesForStop', { p1: s.StopCode }, 1800);
              const linesMap = new Map();
              if (Array.isArray(routes)) {
                for (const r of routes) {
                  if (r.LineID && !linesMap.has(r.LineID)) {
                    linesMap.set(r.LineID, {
                      line_id: r.LineID,
                      last_stop: cleanRouteDestination(r),
                      direction: /κυκλικη/i.test(r.RouteDescr||'') ? '🔄' : (r.RouteType === '2' ? '⬅️' : '➡️')
                    });
                  }
                }
              }
              return { ...s, serving_lines: Array.from(linesMap.values()) };
            } catch(e) { return { ...s, serving_lines: [] }; }
          }));

          // Sort stops: Stops with active routes first, stops with no routes at the bottom
          enriched.sort((a, b) => {
            const aHas = Array.isArray(a.serving_lines) && a.serving_lines.length > 0;
            const bHas = Array.isArray(b.serving_lines) && b.serving_lines.length > 0;
            if (aHas && !bHas) return -1;
            if (!aHas && bHas) return 1;
            return (a.distanceMeters || 0) - (b.distanceMeters || 0);
          });

          return jsonRes(enriched);
        }
        const mTimetable = path.match(/^\/api\/lines\/([^\/]+)\/timetable$/);
        if (mTimetable) {
          let lineCode = mTimetable[1];
          // Check if lineCode is a LineID (e.g. A5, 040, 306) and resolve it
          const lines = await oasaRequest('webGetLines', {}, 1800);
          if (Array.isArray(lines)) {
            const m = lines.find(l => String(l.LineID).trim().toLowerCase() === String(lineCode).trim().toLowerCase());
            if (m) lineCode = m.LineCode;
          }
          const [daily, days] = await Promise.all([
            oasaRequest('getDailySchedule', { line_code: lineCode }, 600),
            oasaRequest('getScheduleDaysMasterline', { p1: lineCode }, 3600)
          ]);
          return jsonRes({
            line_code: lineCode,
            schedule_days: Array.isArray(days) ? days : [],
            profiles: {},
            daily_schedule: daily || {}
          });
        }

        // Service Disruptions, Route Modifications & Strikes
        if (path === '/api/disruptions') {
          const cached = getCache('edge_disruptions');
          if (cached) return jsonRes(cached);
          try {
            const res = await fetch('https://www.oasa.gr/wp-json/wp/v2/posts?categories=82&per_page=15', {
              headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (res.ok) {
              const posts = await res.json();
              const parsed = (Array.isArray(posts) ? posts : []).map(p => {
                const title = (p.title && p.title.rendered ? p.title.rendered : '')
                  .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&#8216;/g, '‘').replace(/&#8217;/g, '’')
                  .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”').replace(/&#8230;/g, '…').replace(/&amp;/g, '&')
                  .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                const excerpt = (p.excerpt && p.excerpt.rendered ? p.excerpt.rendered : '')
                  .replace(/<[^>]*>/g, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
                const affectedLines = new Set();
                const lineMatches = `${title} ${excerpt}`.match(/\b([0-9]{3}|[A-ZΑ-Ω][0-9]{1,2}|X[0-9]{2}|Ε[0-9]{2}|[0-9]{1,2})\b/gi);
                if (lineMatches) {
                  lineMatches.forEach(m => {
                    const c = m.trim().toUpperCase();
                    if (!/^(202\d|201\d|19\d\d|30|15|60)$/.test(c) || title.includes(`γραμμής ${c}`)) {
                      affectedLines.add(c);
                    }
                  });
                }
                let type = 'notice';
                let typeLabel = 'Ενημέρωση ΟΑΣΑ';
                if (/απεργ|στάση εργασίας/i.test(title)) { type = 'strike'; typeLabel = 'Απεργία / Στάση Εργασίας'; }
                else if (/τροποποίησ|παράταση/i.test(title)) { type = 'modification'; typeLabel = 'Τροποποίηση Διαδρομής'; }
                else if (/έργα|εργασι/i.test(title)) { type = 'roadworks'; typeLabel = 'Οδικά Έργα'; }

                let dateFormatted = '';
                if (p.date) {
                  const d = new Date(p.date);
                  if (!isNaN(d.getTime())) {
                    dateFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                  }
                }
                return { id: p.id, title, excerpt, date: p.date, dateFormatted, link: p.link, type, typeLabel, affectedLines: Array.from(affectedLines) };
              });
              setCache('edge_disruptions', parsed, 900);
              return jsonRes(parsed);
            }
          } catch(e) {}
          return jsonRes([]);
        }

        // Point-to-Point Journey Planner (A to B Transit Routing)
        if (path === '/api/routing/journey') {
          const oLat = parseFloat(url.searchParams.get('originLat')), oLng = parseFloat(url.searchParams.get('originLng'));
          const dLat = parseFloat(url.searchParams.get('destLat')), dLng = parseFloat(url.searchParams.get('destLng'));
          if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
            return jsonRes({ itineraries: [] });
          }

          const calcDist = (lat1, lng1, lat2, lng2) => {
            const dLatM = (lat2 - lat1) * 111139;
            const dLngM = (lng2 - lng1) * (111139 * Math.cos(lat1 * Math.PI / 180));
            return Math.round(Math.sqrt(dLatM * dLatM + dLngM * dLngM));
          };

          const directDist = calcDist(oLat, oLng, dLat, dLng);
          if (directDist < 400) {
            const walkMin = Math.ceil(directDist / 75) + 1;
            return jsonRes({
              origin: { lat: oLat, lng: oLng },
              destination: { lat: dLat, lng: dLng },
              directDistanceMeters: directDist,
              itineraries: [{
                type: 'walk_only',
                durationMinutes: walkMin,
                walkingMeters: directDist,
                summary: `Απευθείας περπάτημα (${directDist}μ • ~${walkMin}')`,
                steps: [{ kind: 'walk', instruction: 'Περπατήστε απευθείας στον προορισμό σας', meters: directDist, minutes: walkMin }]
              }]
            });
          }

          const [s1, s2] = await Promise.all([
            oasaRequest('getClosestStops', { p1: oLat, p2: oLng }, 60).catch(() => []),
            oasaRequest('getClosestStops', { p1: dLat, p2: dLng }, 60).catch(() => [])
          ]);

          const oStops = (Array.isArray(s1) ? s1 : []).slice(0, 4);
          const dStops = (Array.isArray(s2) ? s2 : []).slice(0, 4);

          const oRoutesPromises = oStops.map(s => oasaRequest('webRoutesForStop', { p1: s.StopCode }, 1800).catch(() => []));
          const dRoutesPromises = dStops.map(s => oasaRequest('webRoutesForStop', { p1: s.StopCode }, 1800).catch(() => []));
          const [oR, dR] = await Promise.all([Promise.all(oRoutesPromises), Promise.all(dRoutesPromises)]);

          const oLineMap = new Map();
          oStops.forEach((s, idx) => {
            (oR[idx] || []).forEach(r => {
              if (r && r.LineID && !oLineMap.has(r.LineID)) oLineMap.set(r.LineID, { stop: s, route: r });
            });
          });

          const dLineMap = new Map();
          dStops.forEach((s, idx) => {
            (dR[idx] || []).forEach(r => {
              if (r && r.LineID && !dLineMap.has(r.LineID)) dLineMap.set(r.LineID, { stop: s, route: r });
            });
          });

          const itineraries = [];
          for (const [lineId, oEntry] of oLineMap.entries()) {
            if (dLineMap.has(lineId)) {
              const dEntry = dLineMap.get(lineId);
              const startStop = oEntry.stop, endStop = dEntry.stop;
              if (startStop.StopCode === endStop.StopCode) continue;

              const w1 = calcDist(oLat, oLng, parseFloat(startStop.StopLat), parseFloat(startStop.StopLng));
              const w2 = calcDist(dLat, dLng, parseFloat(endStop.StopLat), parseFloat(endStop.StopLng));
              const w1Min = Math.ceil(w1 / 75) + 1, w2Min = Math.ceil(w2 / 75) + 1;
              const rideDist = calcDist(parseFloat(startStop.StopLat), parseFloat(startStop.StopLng), parseFloat(endStop.StopLat), parseFloat(endStop.StopLng));
              const rideMin = Math.max(3, Math.round(rideDist / 280));
              const totalMin = w1Min + 4 + rideMin + w2Min;

              itineraries.push({
                type: 'direct_bus',
                lineId,
                totalDurationMinutes: totalMin,
                transitMinutes: rideMin,
                totalWalkMeters: w1 + w2,
                departureStop: { code: startStop.StopCode, name: startStop.StopDescr, lat: parseFloat(startStop.StopLat), lng: parseFloat(startStop.StopLng), walkMeters: w1, walkMinutes: w1Min },
                arrivalStop: { code: endStop.StopCode, name: endStop.StopDescr, lat: parseFloat(endStop.StopLat), lng: parseFloat(endStop.StopLng), walkMeters: w2, walkMinutes: w2Min },
                steps: [
                  { kind: 'walk', instruction: `Περπατήστε ${w1Min}' (${w1}μ) μέχρι τη στάση ${startStop.StopDescr}`, meters: w1, minutes: w1Min },
                  { kind: 'transit', mode: 'bus', lineId, lineDescr: `Γραμμή ${lineId}`, direction: cleanRouteDestination(oEntry.route), fromStop: startStop.StopDescr, toStop: endStop.StopDescr, durationMinutes: rideMin, distanceMeters: rideDist },
                  { kind: 'walk', instruction: `Περπατήστε ${w2Min}' (${w2}μ) από τη στάση ${endStop.StopDescr} στον προορισμό σας`, meters: w2, minutes: w2Min }
                ]
              });
            }
          }
          itineraries.sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes);
          return jsonRes({ origin: { lat: oLat, lng: oLng }, destination: { lat: dLat, lng: dLng }, directDistanceMeters: directDist, itineraries: itineraries.slice(0, 5) });
        }

        // Web Push VAPID Configuration & Registration Endpoints
        if (path === '/api/push/config') {
          return jsonRes({
            publicKey: 'BMFpVKCE4nWW4qSakggJbRvBp9DMvb4dDC_bDWsIERpb8dpRH7Oj5nv9Z69kGu1LTg05XqacAzLgArdt5xoz5QQ'
          });
        }

        if (path === '/api/push/register' && request.method === 'POST') {
          try {
            const body = await request.json();
            // Cache active push subscription in edge memory
            if (body && body.subscription && body.subscription.endpoint) {
              const subKey = 'push_sub:' + body.subscription.endpoint;
              setCache(subKey, body, 86400 * 7); // 7 days
            }
            return jsonRes({ success: true });
          } catch(e) {
            return jsonRes({ error: 'Invalid JSON payload' }, 400);
          }
        }

        return jsonRes({ error: 'Endpoint not found' }, 404);
      } catch(err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
