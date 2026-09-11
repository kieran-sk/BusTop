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
      const lid = route.LineID || arr.line_id || 'BUS';
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
        direction: /κυκλικη|circular/i.test(route.LineDescr || '') ? 'Κυκλική' : (route.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση'),
        veh_code: arr.veh_code || null,
        btime2: btime2,
        estimated_arrival_time: estTime,
        is_live: true,
        status_label: 'Ζωντανό GPS',
        source: 'gps_telematics'
      });
    }
  }

  // Group candidate routes by line_id so every line is represented
  const lineRoutesMap = new Map();
  for (const r of stopRoutes) {
    const lid = String(r.LineID || 'BUS').trim();
    if (!lineRoutesMap.has(lid)) lineRoutesMap.set(lid, []);
    lineRoutesMap.get(lid).push(r);
  }
  const candidateRoutes = [];
  for (const [lid, routes] of lineRoutesMap.entries()) {
    const primary = routes.find(r => !((r.RouteDescr || '').startsWith('***')));
    candidateRoutes.push(primary || routes[0]);
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
          const f = rs.find(s => String(s.StopCode) === String(stopCode));
          if (f && f.RouteStopOrder) stopOrder = parseInt(f.RouteStopOrder, 10);
        }
      } catch(e) {}
      const transit = Math.max(0, (stopOrder - 1) * 2.2);
      for (const dep of departures) {
        const rawT = dep.sde_start1 || dep.sdd_start1;
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
              direction: /κυκλικη|circular/i.test(route.LineDescr || '') ? 'Κυκλική' : (route.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση'),
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

const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  }
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
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
            directionLabel: /κυκλικη|circular/i.test(r.RouteDescr||'') ? 'Κυκλική' : (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση')
          })));
        }
        const mArr = path.match(/^\/api\/stops\/([^\/]+)\/arrivals$/);
        if (mArr) return jsonRes(await getCombinedArrivals(mArr[1], url.searchParams.get('day') || 'today'));
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
                      direction: /κυκλικη/i.test(r.RouteDescr||'') ? 'Κυκλική' : (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση')
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
        return jsonRes({ error: 'Endpoint not found' }, 404);
      } catch(err) {
        return jsonRes({ error: err.message }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
