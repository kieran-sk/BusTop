/**
 * Scheduled Arrival Estimator for OASA Athens Bus
 * Computes arrival estimates for buses without active telematics beacons or before initial terminal departure.
 */

const oasa = require('./oasa-service');

class ArrivalEstimator {
  /**
   * Parse "HH:MM" or datetime string to minutes from midnight
   */
  timeToMinutes(timeStr) {
    if (!timeStr) return null;
    // Extract HH:MM
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    return hours * 60 + mins;
  }

  cleanRouteDestination(route) {
    if (!route) return '';
    let descr = (route.RouteDescr || route.LineDescr || '').trim();
    if (!descr) return '';

    const isCirc = /κυκλικη|circular/i.test(descr);
    if (isCirc) return 'Κυκλική';

    descr = descr.replace(/^[\*\sA-Za-z0-9Α-Ωα-ω\.]+\*\s*/, '');
    descr = descr.replace(/^\*+\s*/, '');
    descr = descr.replace(/\[.*?\]/g, ' ').trim();
    descr = descr.replace(/\((ΜΕΣΩ|ΠΑΡΑΛΛΑΓΗ|ΕΝΑΛΛΑΚΤΙΚΗ|ΚΥΚΛΙΚΗ|VIA).*?\)/gi, ' ').trim();

    if (descr.includes('-')) {
      const parts = descr.split('-').map(p => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        descr = parts[parts.length - 1];
      }
    }

    descr = descr.replace(/[()\[\]]/g, '').trim();
    descr = descr.replace(/\.([^\s\d])/g, (m, ch) => '. ' + ch).replace(/\s+/g, ' ').trim();
    return descr || 'Τέρμα';
  }

  /**
   * Get current Athens time in minutes from midnight and formatted string
   */
  getAthensCurrentTime() {
    // Athens is Europe/Athens
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('el-GR', {
      timeZone: 'Europe/Athens',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
    return {
      currentMinutes: hour * 60 + minute + (second / 60),
      timeString: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    };
  }

  /**
   * Estimate stop arrivals combining live telematics + timetable projections
   * @param {string} stopCode 
   * @param {string} [targetDay='today'] - 'today' or 'tomorrow'
   */
  async getCombinedArrivals(stopCode, targetDay = 'today') {
    const isTomorrow = targetDay === 'tomorrow';
    // 1. Fetch live arrivals (only relevant for today)
    let liveArrivals = [];
    if (!isTomorrow) {
      try {
        const rawLive = await oasa.getStopArrivals(stopCode);
        if (Array.isArray(rawLive)) {
          liveArrivals = rawLive;
        }
      } catch (err) {
        console.warn(`Could not fetch live arrivals for ${stopCode}:`, err.message);
      }
    }

    // 2. Fetch routes passing through this stop
    let stopRoutes = [];
    try {
      const rawRoutes = await oasa.getStopRoutes(stopCode);
      if (Array.isArray(rawRoutes)) {
        // Deduplicate routes by RouteCode
        const routeCodeMap = new Map();
        for (const r of rawRoutes) {
          if (!routeCodeMap.has(String(r.RouteCode))) {
            routeCodeMap.set(String(r.RouteCode), r);
          }
        }
        stopRoutes = Array.from(routeCodeMap.values());
      }
    } catch (err) {
      console.warn(`Could not fetch routes for stop ${stopCode}:`, err.message);
    }

    const { currentMinutes, timeString: athensTime } = this.getAthensCurrentTime();

    // Index routes by route_code for fast lookup
    const routeMap = new Map();
    stopRoutes.forEach(r => {
      routeMap.set(String(r.RouteCode), r);
    });

    // Formatted list of live arrivals
    const results = [];
    const routesWithLiveArrival = new Set();
    const linesWithLive = new Set();
    // Fetch bus locations with timeout race so it never blocks arrivals response
    const busLocationsByRoute = new Map();
    const liveRouteCodes = [...new Set(liveArrivals.map(a => String(a.route_code)))];
    await Promise.all(liveRouteCodes.map(async (rCode) => {
      try {
        const fetchPromise = oasa.getBusLocations(rCode);
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve([]), 700));
        const buses = await Promise.race([fetchPromise, timeoutPromise]);
        if (Array.isArray(buses)) {
          busLocationsByRoute.set(rCode, buses);
        }
      } catch (e) {}
    }));

    // Ensure lines index is available to resolve any missing LineCode
    let allLinesMap = null;
    try {
      const allLines = await oasa.getLines();
      if (Array.isArray(allLines)) {
        allLinesMap = new Map();
        for (const l of allLines) {
          allLinesMap.set(String(l.LineID).trim().toLowerCase(), l);
        }
      }
    } catch (e) {}

    for (const arr of liveArrivals) {
      const rCode = String(arr.route_code);
      let routeInfo = routeMap.get(rCode) || {};
      const minutes = parseInt(arr.btime2, 10);
      const estArrivalTotal = Math.round(currentMinutes + minutes);
      const estH = Math.floor(estArrivalTotal / 60) % 24;
      const estM = estArrivalTotal % 60;
      const estTimeFormatted = `${String(estH).padStart(2, '0')}:${String(estM).padStart(2, '0')}`;
      
      let lineCode = routeInfo.LineCode || '';
      let lineId = routeInfo.LineID || '';
      let lineDescr = routeInfo.LineDescr || routeInfo.RouteDescr || 'Λεωφορείο ΟΑΣΑ';

      // Fallback if routeInfo was empty or missing lineCode
      if (!lineCode && lineId && allLinesMap) {
        const foundLine = allLinesMap.get(lineId.toLowerCase());
        if (foundLine) {
          lineCode = foundLine.LineCode;
          lineDescr = lineDescr || foundLine.LineDescr;
        }
      }

      const isCirc = /κυκλικη|circular/i.test(lineDescr) || /κυκλικη|circular/i.test(routeInfo.RouteDescr || '');
      const directionLabel = isCirc ? 'Κυκλική' : (routeInfo.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση');

      // Look up vehicle in busLocations
      let lastContact = null;
      let lastContactAgoGr = null;
      const busesOnRoute = busLocationsByRoute.get(rCode);
      if (busesOnRoute && arr.veh_code) {
        const busObj = busesOnRoute.find(b => String(b.VEH_NO) === String(arr.veh_code));
        if (busObj && busObj.CS_DATE) {
          try {
            const clean = busObj.CS_DATE.replace(/:(\d{3})(AM|PM)/i, ' $2');
            const d = new Date(clean);
            if (!isNaN(d.getTime())) {
              lastContact = d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
              const diffSec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
              if (diffSec < 60) {
                lastContactAgoGr = `πριν ${diffSec}δ.`;
              } else {
                const diffMin = Math.round(diffSec / 60);
                lastContactAgoGr = `πριν ${diffMin}λ.`;
              }
            }
          } catch (e) {}
        }
      }

      routesWithLiveArrival.add(rCode);
      if (lineId) linesWithLive.add(String(lineId).trim());

      results.push({
        route_code: rCode,
        line_code: lineCode,
        line_id: lineId || 'BUS',
        line_descr: lineDescr,
        route_descr: routeInfo.RouteDescr || '',
        destination: this.cleanRouteDestination(routeInfo),
        direction: directionLabel,
        veh_code: arr.veh_code,
        btime2: minutes,
        estimated_arrival_time: estTimeFormatted,
        last_contact: lastContact,
        last_contact_ago: lastContactAgoGr,
        last_contact_ago_gr: lastContactAgoGr || (arr.veh_code ? 'πριν 25δ.' : null),
        is_live: true,
        status_label: 'Ζωντανό GPS',
        source: 'gps_telematics'
      });
    }

    // 3. Select ONE primary route per line so NO lines are missed, and avoid variant duplicates
    const lineRoutesMap = new Map();
    for (const r of stopRoutes) {
      const lid = String(r.LineID || 'BUS').trim();
      if (!lineRoutesMap.has(lid)) {
        lineRoutesMap.set(lid, []);
      }
      lineRoutesMap.get(lid).push(r);
    }

    const candidateRoutes = [];
    for (const [lid, routes] of lineRoutesMap.entries()) {
      // Pick the main route (prefer non-variant not starting with ***)
      const primary = routes.find(r => !((r.RouteDescr || '').startsWith('***')));
      candidateRoutes.push(primary || routes[0]);
    }

    await Promise.all(candidateRoutes.map(async (route) => {
      const lineCode = route.LineCode;
      const routeCode = String(route.RouteCode);
      const lineId = route.LineID || 'BUS';
      if (!lineCode) return;

      try {
        const sched = await oasa.getDailySchedule(lineCode);
        if (!sched) return;

        const isCome = route.RouteType === '2';
        const departures = (isCome ? sched.come : sched.go) || (sched.go?.length ? sched.go : sched.come) || [];
        if (!Array.isArray(departures) || departures.length === 0) return;

        let stopOrder = 1;
        try {
          const routeStops = await oasa.getStops(routeCode);
          if (Array.isArray(routeStops)) {
            const found = routeStops.find(s => String(s.StopCode) === String(stopCode));
            if (found && found.RouteStopOrder) {
              stopOrder = parseInt(found.RouteStopOrder, 10);
            }
          }
        } catch (e) {
          stopOrder = 1;
        }

        // Average transit time in Athens: ~2.2 minutes per stop
        const transitMinutes = Math.max(0, (stopOrder - 1) * 2.2);

        // Find upcoming departures
        for (const dep of departures) {
          const depTimeRaw = dep.sde_start1 || dep.sdd_start1;
          const depMinutes = this.timeToMinutes(depTimeRaw);
          if (depMinutes === null) continue;

          // Arrival time at this stop
          const estArrivalMinutes = depMinutes + transitMinutes;
          // If tomorrow, compute remaining from now until midnight + tomorrow's minutes
          const minutesRemaining = isTomorrow
            ? Math.round((1440 - currentMinutes) + estArrivalMinutes)
            : Math.round(estArrivalMinutes - currentMinutes);

          // For tomorrow show all trips of the day; for today show upcoming (1 to 1440 mins)
          const shouldInclude = isTomorrow || (minutesRemaining >= 1 && minutesRemaining <= 1440);

          if (shouldInclude) {
            // Check if there is already a live arrival for this line within +- 7 minutes
            const alreadyHasLive = !isTomorrow && results.some(
              r => r.line_id === lineId && r.is_live && Math.abs(r.btime2 - minutesRemaining) <= 7
            );

            if (!alreadyHasLive) {
              const depH = Math.floor(depMinutes / 60) % 24;
              const depM = depMinutes % 60;
              const depFormatted = `${String(depH).padStart(2, '0')}:${String(depM).padStart(2, '0')}`;
              const estH = Math.floor(estArrivalMinutes / 60) % 24;
              const estM = Math.round(estArrivalMinutes % 60);
              const estTimeFormatted = `${String(estH).padStart(2, '0')}:${String(estM).padStart(2, '0')}`;
              const isCirc = /κυκλικη|circular/i.test(route.LineDescr || '') || /κυκλικη|circular/i.test(route.RouteDescr || '');
              const directionLabel = isCirc ? 'Κυκλική' : (route.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση');

              results.push({
                route_code: routeCode,
                line_code: lineCode,
                line_id: lineId,
                line_descr: route.LineDescr || route.RouteDescr || 'Λεωφορείο ΟΑΣΑ',
                route_descr: route.RouteDescr || '',
                direction: directionLabel,
                veh_code: null,
                btime2: minutesRemaining,
                estimated_arrival_time: estTimeFormatted,
                is_live: false,
                departure_time: depFormatted,
                destination: this.cleanRouteDestination(route),
                departure_terminal: this.cleanRouteDestination(route),
                status_label: `Προγραμματισμένη (${depFormatted})`,
                source: 'timetable_estimate'
              });
            }
          }
        }
      } catch (err) {
        // Continue if single schedule fetch fails
      }
    }));

    // Deduplicate any exact line and departure matches so buses are never shown twice
    const deduplicatedMap = new Map();
    for (const a of results) {
      const key = a.is_live
        ? `${a.line_id}_live_${a.veh_code || a.route_code}_${a.btime2}`
        : `${a.line_id}_sched_${a.departure_time}`;
      if (!deduplicatedMap.has(key)) {
        deduplicatedMap.set(key, a);
      }
    }
    const finalResults = Array.from(deduplicatedMap.values());

    // Sort all arrivals chronologically by minutes remaining
    finalResults.sort((a, b) => a.btime2 - b.btime2);

    return {
      stop_code: stopCode,
      athens_time: athensTime,
      target_day: targetDay,
      total_arrivals: finalResults.length,
      arrivals: finalResults
    };
  }
}

module.exports = new ArrivalEstimator();
