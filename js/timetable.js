/**
 * Full Timetable & Route Stop Progression Browser per Line
 * Displays scheduled departures and full list of stops for BOTH directions (Outbound & Inbound).
 * Clicking any stop takes the user directly to the corresponding departures page for that stop.
 */

class TimetableManager {
  constructor(containerId = 'timetable-container') {
    this.containerId = containerId;
    this.currentLine = null;
    this.timetableData = null;
    this.routes = [];
    this.stopsByRoute = new Map();
    this.liveBusesByRoute = new Map();
    this.selectedDayIndex = 0; // 0: Daily, 1: Saturday, 2: Sunday
    this.currentViewMode = 'stops'; // 'stops' or 'schedule'
  }

  async loadLine(lineCode, lineId = '', lineDescr = '') {
    // 1. Resolve lineCode if missing or invalid
    if (!lineCode || lineCode === 'undefined' || lineCode === 'null' || lineCode === '') {
      if (lineId && window.Search && Array.isArray(window.Search.allLines)) {
        const found = window.Search.allLines.find(l => String(l.LineID).trim().toLowerCase() === String(lineId).trim().toLowerCase());
        if (found) {
          lineCode = found.LineCode;
          lineDescr = lineDescr || found.LineDescr;
        }
      }
    }
    if (!lineCode || lineCode === 'undefined' || lineCode === 'null' || lineCode === '') {
      if (lineId && window.API && typeof window.API.resolveLine === 'function') {
        try {
          const res = await window.API.resolveLine(lineId);
          if (res && res.line_code) {
            lineCode = res.line_code;
            lineDescr = lineDescr || res.line_descr;
          }
        } catch (e) {}
      }
    }

    this.currentLine = { lineCode, lineId, lineDescr };
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = `
      <div style="padding: 3.5rem 1rem; text-align: center;">
        <div class="m3-pulse-dot" style="width: 16px; height: 16px; margin: 0 auto 1rem; background: var(--md-sys-color-primary);"></div>
        <div style="font-weight: 800; font-size: 1.1rem; color: #0f172a;">Φόρτωση δρομολογίου & στάσεων Γραμμής ${lineId || lineCode}...</div>
        <div style="font-size: 0.85rem; color: #64748b; margin-top: 4px;">Ανάκτηση διαδρομής & ωραρίων ΟΑΣΑ</div>
      </div>
    `;

    try {
      const [timetableData, routes] = await Promise.all([
        window.API.getLineTimetable(lineCode),
        window.API.getRoutes(lineCode)
      ]);
      this.timetableData = timetableData;
      this.routes = Array.isArray(routes) ? routes : [];

      // Pre-fetch stops and live buses for both directions
      await Promise.all(this.routes.slice(0, 4).map(async (r) => {
        try {
          const stops = await window.API.getRouteStops(r.RouteCode);
          this.stopsByRoute.set(String(r.RouteCode), Array.isArray(stops) ? stops : []);
          const buses = await window.API.getLiveBuses(r.RouteCode);
          this.liveBusesByRoute.set(String(r.RouteCode), Array.isArray(buses) ? buses : []);
        } catch (e) {
          console.warn(`Could not load route details for ${r.RouteCode}:`, e);
        }
      }));

      this.render();
    } catch (err) {
      container.innerHTML = `
        <div class="m3-card" style="text-align: center; padding: 2.5rem 1rem;">
          <div style="color: var(--md-sys-color-error); font-weight: 800; margin-bottom: 0.5rem; font-size: 1.1rem;">Αδυναμία φόρτωσης δρομολογίου</div>
          <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 1rem;">${err.message}</div>
          <button class="m3-btn m3-btn-primary" onclick="window.Timetable.loadLine('${lineCode}', '${lineId}', '${lineDescr}')">Δοκιμάστε ξανά</button>
        </div>
      `;
    }
  }

  setDayIndex(index) {
    this.selectedDayIndex = index;
    this.render();
  }

  setViewMode(mode) {
    this.currentViewMode = mode;
    this.render();
  }

  renderDirectionSchedule(trips, currentMins) {
    if (!Array.isArray(trips) || trips.length === 0) {
      return `
        <div style="padding: 2rem 1rem; text-align: center; color: #64748b; font-size: 0.85rem;">
          Δεν καταγράφηκαν προγραμματισμένα δρομολόγια για αυτή την κατεύθυνση.
        </div>
      `;
    }

    let nextTripFound = false;

    return trips.map(t => {
      const raw = t.sde_start1 || t.sdd_start1 || '';
      const match = raw.match(/(\d{1,2}):(\d{2})/);
      if (!match) return '';
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const tripMins = h * 60 + m;
      const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      const isPast = tripMins < currentMins;
      let isNext = false;
      if (!isPast && !nextTripFound) {
        isNext = true;
        nextTripFound = true;
      }

      const diff = tripMins - currentMins;

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.85rem; border-radius: 8px; margin-bottom: 0.3rem; background: ${isNext ? '#eff6ff' : isPast ? '#f8fafc' : '#ffffff'}; border: 1px solid ${isNext ? '#93c5fd' : '#e2e8f0'}; opacity: ${isPast ? '0.55' : '1'};">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <span style="font-family: 'Roboto Mono', monospace; font-size: 1.05rem; font-weight: 800; color: ${isNext ? '#005ac1' : '#0f172a'};">
              ${formatted}
            </span>
            ${isNext ? `<span class="m3-badge m3-badge-live" style="font-size: 0.68rem; padding: 1px 6px;">Επόμενο σε ${diff}λ</span>` : ''}
          </div>
          <div style="font-size: 0.78rem; font-weight: 600; color: ${isNext ? '#005ac1' : '#64748b'};">
            ${isPast ? 'Αναχώρησε' : isNext ? 'Επικείμενο' : `Σε ${diff}λ`}
          </div>
        </div>
      `;
    }).join('');
  }

  renderDirectionStops(stops, liveBuses = []) {
    if (!Array.isArray(stops) || stops.length === 0) {
      return `
        <div style="padding: 2rem 1rem; text-align: center; color: #64748b; font-size: 0.85rem;">
          Δεν βρέθηκαν καταγεγραμμένες στάσεις για αυτή τη διαδρομή.
        </div>
      `;
    }

    return stops.map((s, idx) => {
      const stopOrder = s.RouteStopOrder || (idx + 1);
      const stopTitle = s.StopDescr || `Στάση #${s.StopCode}`;
      const safeTitle = stopTitle.replace(/'/g, "\\'");
      const lat = parseFloat(s.StopLat) || 'null';
      const lng = parseFloat(s.StopLng) || 'null';

      // Check if any live bus is located near this stop (within ~300m)
      const nearBus = liveBuses.find(b => {
        if (!b.CS_LAT || !b.CS_LNG || isNaN(lat) || isNaN(lng)) return false;
        const bLat = parseFloat(b.CS_LAT);
        const bLng = parseFloat(b.CS_LNG);
        const dLat = Math.abs(bLat - lat);
        const dLng = Math.abs(bLng - lng);
        return dLat < 0.003 && dLng < 0.003;
      });

      return `
        <div class="route-stop-item" style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0.9rem; border-radius: 12px; margin-bottom: 0.4rem; background: #ffffff; border: 1px solid #e2e8f0; cursor: pointer; transition: all 0.2s;" onclick="window.App.selectStop('${s.StopCode}', '${safeTitle}', ${lat}, ${lng}, true)" title="Κλικ για προβολή αφίξεων στη στάση ${stopTitle}">
          <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: #eff6ff; color: var(--md-sys-color-primary); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.78rem; flex-shrink: 0; border: 1.5px solid #bfdbfe;">
              ${stopOrder}
            </div>
            <div>
              <div style="font-weight: 800; font-size: 0.92rem; color: #0f172a; line-height: 1.25;">
                ${stopTitle}
              </div>
              <div style="font-size: 0.75rem; color: #64748b; margin-top: 1px;">
                ${s.StopStreet ? s.StopStreet + ' • ' : ''}Στάση #${s.StopCode}
              </div>
              ${nearBus ? `
                <div style="display: inline-flex; align-items: center; gap: 4px; margin-top: 3px; font-size: 0.7rem; font-weight: 700; color: #047857; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">
                  <span class="m3-pulse-dot" style="background: #047857; width: 6px; height: 6px;"></span>
                  Λεωφ. #${nearBus.VEH_NO} (${nearBus.report_age_gr || 'ζωντανά'})
                </div>
              ` : ''}
            </div>
          </div>
          <span class="m3-badge" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-primary); font-size: 0.72rem; font-weight: 700; flex-shrink: 0; margin-left: 0.5rem;">
            Αφίξεις ➔
          </span>
        </div>
      `;
    }).join('');
  }

  calculateBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  async initRouteMap() {
    const mapContainer = document.getElementById('line-route-map');
    if (!mapContainer) return;

    if (this.routeMap) {
      try {
        this.routeMap.remove();
      } catch (e) {}
      this.routeMap = null;
    }

    this.routeMap = L.map('line-route-map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.routeMap);

    const routesToPlot = [];
    const outRoute = this.routes.find(r => r.RouteType !== '2') || this.routes[0];
    const inRoute = this.routes.find(r => r.RouteType === '2') || this.routes[1];

    if (this.activeMapRouteCode) {
      const selected = this.routes.find(r => String(r.RouteCode) === String(this.activeMapRouteCode));
      if (selected) routesToPlot.push(selected);
    } else {
      if (outRoute) routesToPlot.push(outRoute);
      if (inRoute && inRoute.RouteCode !== outRoute?.RouteCode) routesToPlot.push(inRoute);
    }

    const allBounds = [];

    for (const route of routesToPlot) {
      const isReturn = route.RouteType === '2';
      const routeColor = isReturn ? '#047857' : '#005ac1';
      const rCode = route.RouteCode;

      let coords = [];
      try {
        const details = await window.API.getRouteDetails(rCode);
        if (Array.isArray(details) && details.length > 1) {
          coords = details
            .map(d => [parseFloat(d.routed_y), parseFloat(d.routed_x)])
            .filter(pt => !isNaN(pt[0]) && !isNaN(pt[1]));
        }
      } catch (e) {
        console.warn('Could not fetch route details coords:', e);
      }

      const stops = this.stopsByRoute.get(String(rCode)) || [];
      if (coords.length < 2 && stops.length > 1) {
        coords = stops
          .map(s => [parseFloat(s.StopLat), parseFloat(s.StopLng)])
          .filter(pt => !isNaN(pt[0]) && !isNaN(pt[1]));
      }

      if (coords.length >= 2) {
        // Draw Route Polyline
        const polyline = L.polyline(coords, {
          color: routeColor,
          weight: 5,
          opacity: 0.85,
          lineJoin: 'round'
        }).addTo(this.routeMap);
        allBounds.push(polyline.getBounds());

        // Place directional arrows along polyline
        const step = Math.max(3, Math.floor(coords.length / 10));
        for (let i = 0; i < coords.length - 1; i += step) {
          const p1 = coords[i];
          const p2 = coords[Math.min(i + 1, coords.length - 1)];
          const bearing = this.calculateBearing(p1[0], p1[1], p2[0], p2[1]);

          const arrowIcon = L.divIcon({
            className: 'route-dir-arrow',
            html: `
              <div style="transform: rotate(${bearing}deg); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; color: #ffffff; background: ${routeColor}; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.35); border: 2px solid #ffffff;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 20l8-4 8 4z"/></svg>
              </div>
            `,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          });

          L.marker(p1, { icon: arrowIcon, interactive: false }).addTo(this.routeMap);
        }

        // Plot Stops along route
        stops.forEach((s, idx) => {
          const lat = parseFloat(s.StopLat);
          const lng = parseFloat(s.StopLng);
          if (isNaN(lat) || isNaN(lng)) return;

          const stopOrder = s.RouteStopOrder || (idx + 1);
          const stopTitle = s.StopDescr || `Στάση #${s.StopCode}`;
          const safeTitle = stopTitle.replace(/'/g, "\\'");

          const stopIcon = L.divIcon({
            className: 'route-map-stop',
            html: `
              <div style="background: #ffffff; color: ${routeColor}; border: 2px solid ${routeColor}; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 800; box-shadow: 0 1px 4px rgba(0,0,0,0.25);">
                ${stopOrder}
              </div>
            `,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });

          const m = L.marker([lat, lng], { icon: stopIcon }).addTo(this.routeMap);
          m.bindPopup(`
            <div style="font-family: inherit; padding: 2px; min-width: 180px;">
              <div style="font-weight: 800; font-size: 0.95rem; color: #0f172a; margin-bottom: 2px;">${stopTitle}</div>
              <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px;">Στάση #${s.StopCode} • Σειρά ${stopOrder}</div>
              <button class="m3-btn m3-btn-primary" style="width: 100%; padding: 0.35rem 0.6rem; font-size: 0.8rem; border-radius: 9999px;" onclick="window.App.selectStop('${s.StopCode}', '${safeTitle}', ${lat}, ${lng}, true)">
                Προβολή Αφίξεων
              </button>
            </div>
          `);
        });

        // Plot Live Buses if available
        const liveBuses = this.liveBusesByRoute.get(String(rCode)) || [];
        liveBuses.forEach(b => {
          const bLat = parseFloat(b.CS_LAT);
          const bLng = parseFloat(b.CS_LNG);
          if (isNaN(bLat) || isNaN(bLng)) return;

          const busIcon = L.divIcon({
            className: 'route-live-bus',
            html: `
              <div style="background: #e11d48; color: #ffffff; border-radius: 8px; padding: 2px 6px; font-size: 0.7rem; font-weight: 800; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid #ffffff; display: flex; align-items: center; gap: 4px;">
                <span>🚌 #${b.VEH_NO || ''}</span>
              </div>
            `,
            iconSize: [60, 24],
            iconAnchor: [30, 12]
          });

          const bm = L.marker([bLat, bLng], { icon: busIcon }).addTo(this.routeMap);
          bm.bindPopup(`
            <div style="font-family: inherit; font-size: 0.85rem;">
              <strong>Λεωφορείο #${b.VEH_NO}</strong><br>
              Στίγμα: ${b.report_age_gr || 'ζωντανά'}
            </div>
          `);
        });
      }
    }

    if (allBounds.length > 0) {
      let combined = allBounds[0];
      for (let i = 1; i < allBounds.length; i++) {
        combined = combined.extend(allBounds[i]);
      }
      this.routeMap.fitBounds(combined, { padding: [30, 30] });
    } else {
      this.routeMap.setView([37.9845, 23.7335], 13);
    }
  }

  setMapRoute(routeCode) {
    this.activeMapRouteCode = routeCode;
    this.initRouteMap();
  }

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (!this.timetableData || !this.currentLine) {
      container.innerHTML = `
        <div class="m3-card" style="text-align: center; padding: 3rem 1rem;">
          <h3 style="font-weight: 800; font-size: 1.25rem; margin-bottom: 0.5rem; color: var(--md-sys-color-primary);">Επιλέξτε Γραμμή Λεωφορείου</h3>
          <p style="color: #64748b; font-size: 0.9rem; max-width: 440px; margin: 0 auto;">
            Αναζητήστε οποιαδήποτε γραμμή της Αθήνας για να δείτε τα ωράρια, τις στάσεις και τον χάρτη διαδρομής.
          </p>
        </div>
      `;
      return;
    }

    const { schedule_days, profiles, daily_schedule } = this.timetableData;
    const days = schedule_days && schedule_days.length > 0 ? schedule_days : [
      { sdc_code: 'daily', sdc_descr: 'ΚΑΘΗΜΕΡΙΝΗ' },
      { sdc_code: 'sat', sdc_descr: 'ΣΑΒΒΑΤΟ' },
      { sdc_code: 'sun', sdc_descr: 'ΚΥΡΙΑΚΗ' }
    ];

    const currentDay = days[this.selectedDayIndex] || days[0];
    const profile = profiles && profiles[currentDay.sdc_code];
    const activeSchedule = (profile && profile.data) || daily_schedule || { go: [], come: [] };

    const goTrips = activeSchedule.go || [];
    const comeTrips = activeSchedule.come || [];

    // Current Athens time in minutes
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('el-GR', {
      timeZone: 'Europe/Athens',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const currH = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const currM = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const currentMins = currH * 60 + currM;

    // Routes identification
    const outRoute = this.routes.find(r => r.RouteType !== '2') || this.routes[0] || {};
    const inRoute = this.routes.find(r => r.RouteType === '2') || this.routes[1] || {};

    const outStops = this.stopsByRoute.get(String(outRoute.RouteCode)) || [];
    const inStops = this.stopsByRoute.get(String(inRoute.RouteCode)) || [];

    const outBuses = this.liveBusesByRoute.get(String(outRoute.RouteCode)) || [];
    const inBuses = this.liveBusesByRoute.get(String(inRoute.RouteCode)) || [];

    // Circular route detection
    const startsEndsSameStop = outStops.length > 1 && String(outStops[0].StopCode) === String(outStops[outStops.length - 1].StopCode);
    const hasSingleRoute = this.routes.length === 1;
    const descrStatesCircular = /κυκλικη|circular/i.test(this.currentLine.lineDescr || '') || /κυκλικη|circular/i.test(outRoute.RouteDescr || '');
    const inStopsEmpty = inStops.length === 0;

    const isCircular = startsEndsSameStop || hasSingleRoute || descrStatesCircular || inStopsEmpty;

    // Schedules and stops HTML
    const outScheduleHtml = this.renderDirectionSchedule(goTrips, currentMins);
    const inScheduleHtml = this.renderDirectionSchedule(comeTrips, currentMins);

    const outStopsHtml = this.renderDirectionStops(outStops, outBuses);
    const inStopsHtml = this.renderDirectionStops(inStops, inBuses);

    const isStopsMode = this.currentViewMode === 'stops';
    const isScheduleMode = this.currentViewMode === 'schedule';
    const isMapMode = this.currentViewMode === 'map';

    // Subtitle description
    const subtitleText = isCircular
      ? `🔄 Κυκλική Διαδρομή • ${outStops.length} στάσεις • ${isStopsMode ? 'Πλήρης κύκλος διαδρομής' : `${goTrips.length} προγραμματισμένα δρομολόγια`}`
      : `Πλήρες Δρομολόγιο • 2 Κατευθύνσεις (${outStops.length} στάσεις Μετάβαση / ${inStops.length} Επιστροφή)`;

    // Main Content
    let mainContentHtml = '';

    if (isMapMode) {
      mainContentHtml = `
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem; margin-top: 0.5rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
            <div style="font-weight: 800; font-size: 0.95rem; color: #005ac1; display: flex; align-items: center; gap: 6px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
              Χάρτης Διαδρομής
            </div>
            ${!isCircular && inRoute.RouteCode ? `
              <div style="display: flex; gap: 0.4rem;">
                <button class="m3-filter-chip ${!this.activeMapRouteCode ? 'active' : ''}" onclick="window.Timetable.setMapRoute(null)">Και οι 2</button>
                <button class="m3-filter-chip ${this.activeMapRouteCode === outRoute.RouteCode ? 'active' : ''}" onclick="window.Timetable.setMapRoute('${outRoute.RouteCode}')">Μετάβαση</button>
                <button class="m3-filter-chip ${this.activeMapRouteCode === inRoute.RouteCode ? 'active' : ''}" onclick="window.Timetable.setMapRoute('${inRoute.RouteCode}')">Επιστροφή</button>
              </div>
            ` : ''}
          </div>
          <div id="line-route-map" style="height: 440px; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; background: #e2e8f0;"></div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.6rem; font-size: 0.75rem; color: #64748b; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="display: inline-flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #005ac1;"></span>
                Μετάβαση
              </span>
              ${!isCircular && inRoute.RouteCode ? `
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #047857;"></span>
                  Επιστροφή
                </span>
              ` : ''}
              <span style="display: inline-flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: #e11d48;"></span>
                Ζωντανά Λεωφορεία
              </span>
            </div>
            <span>Κάντε κλικ σε στάση για προβολή αφίξεων</span>
          </div>
        </div>
      `;
    } else if (isCircular) {
      mainContentHtml = `
        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1.15rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.6rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-weight: 800; font-size: 1rem; color: #005ac1;">Κυκλική Διαδρομή</span>
                <span class="m3-badge" style="background: #e0f2fe; color: #005ac1; font-size: 0.72rem; font-weight: 800; padding: 2px 8px;">
                  🔄 Κυκλική
                </span>
              </div>
              <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
                ${outRoute.RouteDescr || this.currentLine.lineDescr || 'Πλήρης Κύκλος Διαδρομής'} • ${isStopsMode ? `${outStops.length} στάσεις` : `${goTrips.length} δρομολόγια`}
              </div>
            </div>
          </div>
          <div style="max-height: 520px; overflow-y: auto; padding-right: 4px;">
            ${isStopsMode ? outStopsHtml : outScheduleHtml}
          </div>
        </div>
      `;
    } else {
      mainContentHtml = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 1.25rem;">
          <!-- Direction 1: Outbound / Μετάβαση -->
          <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">
              <div>
                <div style="font-weight: 800; font-size: 0.95rem; color: #005ac1;">Κατεύθυνση 1: Μετάβαση</div>
                <div style="font-size: 0.75rem; color: #64748b;">
                  ${outRoute.RouteDescr || 'Προς Τέρμα'} • ${isStopsMode ? `${outStops.length} στάσεις` : `${goTrips.length} δρομολόγια`}
                </div>
              </div>
              <span class="m3-badge" style="background: #e0f2fe; color: #005ac1; font-size: 0.65rem;">Μετάβαση</span>
            </div>
            <div style="max-height: 480px; overflow-y: auto; padding-right: 4px;">
              ${isStopsMode ? outStopsHtml : outScheduleHtml}
            </div>
          </div>

          <!-- Direction 2: Inbound / Επιστροφή -->
          <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 16px; padding: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">
              <div>
                <div style="font-weight: 800; font-size: 0.95rem; color: #047857;">Κατεύθυνση 2: Επιστροφή</div>
                <div style="font-size: 0.75rem; color: #64748b;">
                  ${inRoute.RouteDescr || 'Προς Αφετηρία'} • ${isStopsMode ? `${inStops.length} στάσεις` : `${comeTrips.length} δρομολόγια`}
                </div>
              </div>
              <span class="m3-badge" style="background: #ecfdf5; color: #047857; font-size: 0.65rem;">Επιστροφή</span>
            </div>
            <div style="max-height: 480px; overflow-y: auto; padding-right: 4px;">
              ${isStopsMode ? inStopsHtml : inScheduleHtml}
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="m3-card" style="margin-bottom: 1.5rem; background: #ffffff;">
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.25rem;">
              <span class="ticker-line-badge" style="font-size: 1.05rem;">
                ${this.currentLine.lineId || 'BUS'}
              </span>
              <h2 style="font-size: 1.2rem; font-weight: 900; color: #0f172a;">${this.currentLine.lineDescr || 'Γραμμή ΟΑΣΑ'}</h2>
              ${isCircular ? `
                <span class="m3-badge" style="background: #e0f2fe; color: #005ac1; font-weight: 800; font-size: 0.72rem; padding: 2px 8px;">
                  🔄 Κυκλική Διαδρομή
                </span>
              ` : ''}
              <button class="m3-icon-btn" style="width: 36px; height: 36px; border: none; cursor: pointer; background: none;" title="Αποθήκευση γραμμής" onclick="event.stopPropagation(); const isFav = window.Favorites.toggleLine('${this.currentLine.lineCode}', '${this.currentLine.lineId}', '${(this.currentLine.lineDescr || '').replace(/'/g, "\\'")}'); this.querySelector('svg').setAttribute('fill', isFav ? '#eab308' : 'none'); this.querySelector('svg').setAttribute('stroke', isFav ? '#ca8a04' : '#64748b');">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="${window.Favorites && window.Favorites.isLineFav(this.currentLine.lineCode) ? '#eab308' : 'none'}" stroke="${window.Favorites && window.Favorites.isLineFav(this.currentLine.lineCode) ? '#ca8a04' : '#64748b'}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </button>
            </div>
            <div style="font-size: 0.8rem; color: #64748b;">
              ${subtitleText}
            </div>
          </div>
          <button class="m3-btn m3-btn-tonal" style="padding: 0.4rem 0.85rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 6px;" onclick="window.App.goBack()" title="Επιστροφή στην προηγούμενη οθόνη">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            <span>Πίσω</span>
          </button>
        </div>

        <!-- View Mode Segmented Control: Stops vs Schedule vs Route Map -->
        <div style="display: flex; gap: 0.4rem; margin-bottom: 1.25rem; background: var(--md-sys-color-surface-container); padding: 4px; border-radius: 9999px; max-width: 480px; overflow-x: auto;">
          <button class="m3-btn ${isStopsMode ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="flex: 1; padding: 0.45rem 0.8rem; font-size: 0.82rem; border-radius: 9999px; white-space: nowrap;" onclick="window.Timetable.setViewMode('stops')">
            🚏 Στάσεις
          </button>
          <button class="m3-btn ${isScheduleMode ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="flex: 1; padding: 0.45rem 0.8rem; font-size: 0.82rem; border-radius: 9999px; white-space: nowrap;" onclick="window.Timetable.setViewMode('schedule')">
            🕒 Ωράρια
          </button>
          <button class="m3-btn ${isMapMode ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="flex: 1; padding: 0.45rem 0.8rem; font-size: 0.82rem; border-radius: 9999px; white-space: nowrap;" onclick="window.Timetable.setViewMode('map')">
            🗺️ Χάρτης
          </button>
        </div>

        ${isScheduleMode ? `
          <!-- Days Filter Chips for Timetable -->
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; overflow-x: auto; padding-bottom: 0.25rem;">
            ${days.map((d, i) => `
              <button class="m3-filter-chip ${i === this.selectedDayIndex ? 'active' : ''}" onclick="window.Timetable.setDayIndex(${i})">
                ${d.sdc_descr || 'Ημέρα'}
              </button>
            `).join('')}
          </div>
        ` : ''}

        ${mainContentHtml}
      </div>
    `;

    if (isMapMode) {
      setTimeout(() => this.initRouteMap(), 80);
    }
  }
}

window.Timetable = new TimetableManager();
