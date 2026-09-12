/**
 * Airport Departure Board ("Ticker") & Walk Navigation Engine
 * Light mode, delta-only split-flap flip animation, Greek typography,
 * urban pedestrian walking distance, dedicated alarm and pin buttons,
 * and full timetable opening on row click.
 */

class AirportTicker {
  constructor(containerId = 'ticker-container') {
    this.containerId = containerId;
    this.userLocation = null;
    this.currentStop = null;
    this.arrivals = [];
    this.timerInterval = null;
    this.previousDigitsMap = new Map();
    this.hiddenLines = new Set();
    this.showAllStops = false;
    this.modeFilter = 'all'; // 'all', 'live', 'scheduled'
    this.activeView = 'stops'; // 'stops' or 'lines'
    this.allLines = [];
    this.linesFilterQuery = '';
    this.allStops = [];
    this.stopsFilterQuery = '';
    this.isLoadingAllStops = false;
    window.Ticker = this;
  }

  setActiveView(view) {
    this.activeView = view;
    if (view === 'stops' && (!this.allStops || this.allStops.length === 0)) {
      this.loadAllStops();
    }
    this.render();
  }

  setLinesFilterQuery(q) {
    this.linesFilterQuery = q;
    this.render();
  }

  setStopsFilterQuery(q) {
    this.stopsFilterQuery = q;
    this.render();
  }

  async loadAllStops() {
    if (this.isLoadingAllStops) return;
    this.isLoadingAllStops = true;
    try {
      const stops = await window.API.getAllStops();
      if (Array.isArray(stops) && stops.length > 0) {
        this.allStops = stops;
        if (!this.currentStop) {
          this.render();
        }
      }
    } catch (e) {
      console.warn('Failed to load all stops:', e);
    } finally {
      this.isLoadingAllStops = false;
    }
  }

  setModeFilter(mode) {
    this.modeFilter = mode;
    const allBtn = document.getElementById('filter-all-btn');
    const liveBtn = document.getElementById('filter-live-btn');
    const schedBtn = document.getElementById('filter-sched-btn');
    if (allBtn && liveBtn && schedBtn) {
      allBtn.className = mode === 'all' ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-tonal';
      liveBtn.className = mode === 'live' ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-tonal';
      schedBtn.className = mode === 'scheduled' ? 'm3-btn m3-btn-primary' : 'm3-btn m3-btn-tonal';
    }
    this.render();
  }

  setUserLocation(lat, lng) {
    this.userLocation = { lat, lng };
    this.render();
  }

  setStopLoading(stopInfo) {
    this.currentStop = stopInfo;
    this.arrivals = [];
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const stopName = stopInfo.StopDescr || `Στάση #${stopInfo.StopCode}`;
    container.innerHTML = `
      <div class="ticker-board">
        <div class="ticker-board-header">
          <div class="ticker-board-title">
            <span class="m3-pulse-dot" style="background: var(--md-sys-color-primary);"></span>
            ${stopName.toUpperCase()} • ΑΦΙΞΕΙΣ
          </div>
        </div>
        <div style="padding: 3rem 1rem; text-align: center;">
          <div class="m3-pulse-dot" style="width: 14px; height: 14px; margin: 0 auto 0.75rem; background: var(--md-sys-color-primary);"></div>
          <div style="font-weight: 800; font-size: 1.05rem; color: #0f172a;">Φόρτωση αφίξεων σε πραγματικό χρόνο...</div>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">Τηλεματική ΟΑΣΑ & oasa.live</div>
        </div>
      </div>
    `;
    this.startClock();
  }

  setStopAndArrivals(stopInfo, arrivals = []) {
    if (this.currentStop && stopInfo && String(this.currentStop.StopCode) !== String(stopInfo.StopCode)) {
      this.hiddenLines.clear();
    }
    this.currentStop = stopInfo;
    this.arrivals = arrivals;
    this.render();
  }

  /**
   * Format long amounts of minutes into hours and minutes (e.g. 500λ -> 8ω 20λ)
   */
  formatMinutesHuman(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '--';
    if (mins < 60) return `${mins}λ`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}ω ${remMins}λ` : `${hours}ω`;
  }

  renderSplitFlapDigits(key, text, urgencyClass = '') {
    const chars = String(text).split('');
    const prev = this.previousDigitsMap.get(key) || '';
    const prevChars = prev.split('');
    if (this.previousDigitsMap.size > 200) {
      this.previousDigitsMap.clear();
    }
    this.previousDigitsMap.set(key, String(text));

    const html = chars.map((ch, idx) => {
      if (ch === ':' || ch === '.' || ch === '-') {
        return `<span class="flap-separator">${ch}</span>`;
      } else if (ch === ' ') {
        return `<span class="flap-separator" style="width: 6px; display: inline-block;"> </span>`;
      } else if (/[a-zA-Z\u0370-\u03ff]/.test(ch)) {
        return `<span class="flap-unit">${ch}</span>`;
      } else {
        const changed = prev.length > 0 && prevChars[idx] !== ch;
        return `<span class="flap-digit-box ${changed ? 'flap-flip' : ''}" data-digit="${ch}">${ch}</span>`;
      }
    }).join('');

    return `<div class="split-flap-board ${urgencyClass}">${html}</div>`;
  }

  /**
   * Athens urban street network walking distance (Manhattan + urban tortuosity factor)
   */
  calculateWalkingDistance(lat1, lon1, lat2, lon2) {
    const dLatM = Math.abs(lat2 - lat1) * 111139;
    const avgLat = ((lat1 + lat2) / 2) * Math.PI / 180;
    const dLngM = Math.abs(lon2 - lon1) * (111139 * Math.cos(avgLat));
    return Math.round((dLatM + dLngM) * 1.25);
  }

  /**
   * Calculate walk time in minutes along pedestrian urban network
   */
  getWalkMinutes(stopLat, stopLng) {
    const userLoc = this.userLocation || (window.App && window.App.userLocation) || (() => {
      try { return JSON.parse(localStorage.getItem('OASA_LAST_USER_LOCATION') || 'null'); } catch (e) { return null; }
    })();
    if (!userLoc || !userLoc.lat || !userLoc.lng) return null;

    let sLat = parseFloat(stopLat);
    let sLng = parseFloat(stopLng);

    // If stop coords are missing, try cached coordinates or lookup from nearby stops
    if ((isNaN(sLat) || isNaN(sLng)) && this.currentStop && this.currentStop.StopCode) {
      try {
        const cached = JSON.parse(localStorage.getItem('OASA_STOP_COORDS_' + this.currentStop.StopCode) || 'null');
        if (cached && cached.lat && cached.lng) {
          sLat = parseFloat(cached.lat);
          sLng = parseFloat(cached.lng);
        }
      } catch (e) {}

      if ((isNaN(sLat) || isNaN(sLng)) && window.Search && Array.isArray(window.Search.nearbyStops)) {
        const found = window.Search.nearbyStops.find(s => String(s.StopCode) === String(this.currentStop.StopCode));
        if (found && found.StopLat && found.StopLng) {
          sLat = parseFloat(found.StopLat);
          sLng = parseFloat(found.StopLng);
        }
      }

      if (!isNaN(sLat) && !isNaN(sLng)) {
        this.currentStop.StopLat = sLat;
        this.currentStop.StopLng = sLng;
        localStorage.setItem('OASA_STOP_COORDS_' + this.currentStop.StopCode, JSON.stringify({ lat: sLat, lng: sLng }));
      }
    }

    if (isNaN(sLat) || isNaN(sLng)) return null;

    // Cache valid coords for future queries
    if (this.currentStop && this.currentStop.StopCode) {
      localStorage.setItem('OASA_STOP_COORDS_' + this.currentStop.StopCode, JSON.stringify({ lat: sLat, lng: sLng }));
    }

    const meters = this.calculateWalkingDistance(
      userLoc.lat,
      userLoc.lng,
      sLat,
      sLng
    );
    const walkMins = Math.ceil(meters / 75) + 2;
    return {
      minutes: walkMins,
      meters: Math.round(meters)
    };
  }

  /**
   * Get Commute Advice: Signed time difference (+20λ, -2λ, +1ω 15λ)
   * Explains whether user has plenty of time (+), should leave immediately (0λ / 1-4λ), or if bus will arrive before user reaches the stop (-).
   */
  getCommuteAdvice(busMinutes, walkMinutes) {
    if (walkMinutes === null || typeof busMinutes !== 'number') {
      return {
        label: '--',
        displayLabel: '--',
        tooltip: 'Άγνωστη απόσταση στάσης',
        className: 'commute-relax',
        buffer: null
      };
    }

    const buffer = busMinutes - walkMinutes;
    const absBuf = Math.abs(buffer);
    const formattedBuf = this.formatMinutesHuman(absBuf);
    const sign = buffer > 0 ? `+${formattedBuf}` : (buffer < 0 ? `-${formattedBuf}` : '0λ');

    if (buffer >= 5) {
      return {
        label: sign,
        displayLabel: `⏱️ ${sign}`,
        shortLabel: `⏱️ ${sign}`,
        tooltip: `Περιθώριο αναχώρησης: Έχετε ${formattedBuf} διαθέσιμα πριν ξεκινήσετε για να προλάβετε το λεωφορείο!`,
        className: 'commute-relax',
        buffer
      };
    } else if (buffer >= 0) {
      return {
        label: sign,
        displayLabel: `⚡ ${sign}`,
        shortLabel: `⚡ ${sign}`,
        tooltip: `Ξεκινήστε τώρα! Το λεωφορείο φτάνει σχεδόν ταυτόχρονα με εσάς (${sign}).`,
        className: 'commute-leave-now',
        buffer
      };
    } else {
      return {
        label: sign,
        displayLabel: `⚠️ ${sign}`,
        shortLabel: `⚠️ ${sign}`,
        tooltip: `Το λεωφορείο αναμένεται ${formattedBuf} πριν φτάσετε στη στάση (χρειάζεστε ${walkMinutes}λ περπάτημα).`,
        className: 'commute-hurry',
        buffer
      };
    }
  }

  /**
   * Extract base line identifier for variant grouping (e.g. 314B -> 314, 314 -> 314, 040 -> 040, X95 -> X95)
   */
  getBaseLineId(lineId) {
    if (!lineId) return '';
    const match = String(lineId).trim().match(/^([A-Za-zΑ-Ωα-ω]*\d+)/);
    return match ? match[1].toUpperCase() : String(lineId).trim().toUpperCase();
  }

  renderArrivalRow(arr, arrIdx, walk) {
    const busMins = arr.btime2;
    const advice = this.getCommuteAdvice(busMins, walk ? walk.minutes : null);
    const isLive = arr.is_live;
    const directionText = arr.direction || 'Μετάβαση';
    const lineDescr = arr.route_descr || arr.line_descr || 'Διαδρομή Λεωφορείου';
    const safeDescr = lineDescr.replace(/'/g, "\\'");

    // Due time display: Separate split-flap digit tiles with urgency styling
    let dueDisplay = '';
    let urgencyClass = '';
    const fieldKey = `arr_${arr.line_id}_${arr.route_code}_${arrIdx}`;

    if (isLive) {
      let timeText = '';
      if (busMins >= 60) {
        timeText = this.formatMinutesHuman(busMins);
      } else {
        timeText = `${String(busMins).padStart(2, '0')}λ`;
      }

      if (busMins <= 3) {
        urgencyClass = 'urgency-now';
      } else if (busMins <= 10) {
        urgencyClass = 'urgency-soon';
      } else {
        urgencyClass = 'urgency-normal';
      }
      dueDisplay = this.renderSplitFlapDigits(fieldKey, timeText, urgencyClass);
    } else {
      urgencyClass = 'urgency-scheduled';
      const clockTime = arr.estimated_arrival_time || arr.departure_time;
      if (clockTime) {
        dueDisplay = this.renderSplitFlapDigits(fieldKey, clockTime, urgencyClass);
      } else if (typeof busMins === 'number') {
        dueDisplay = this.renderSplitFlapDigits(fieldKey, this.formatMinutesHuman(busMins), urgencyClass);
      } else {
        dueDisplay = this.renderSplitFlapDigits(fieldKey, '--:--', urgencyClass);
      }
    }

    // Check if an alarm is active for this route
    const isAlarmSet = window.Alarms && Array.isArray(window.Alarms.alarms) && window.Alarms.alarms.some(a => 
      String(a.stopCode).trim() === String(this.currentStop.StopCode).trim() && 
      String(a.lineId).trim().toUpperCase() === String(arr.line_id).trim().toUpperCase() && 
      !a.triggered
    );

    // Check if pinned for complex trips
    const isPinned = window.PinnedTrips && window.PinnedTrips.isPinned(this.currentStop.StopCode, arr.line_id);

    // Live location report latency string
    const reportAgo = arr.last_contact_ago_gr || arr.last_contact_ago;

    const walkMins = (walk && typeof walk.minutes === 'number') ? walk.minutes : null;

    return `
      <div class="ticker-row" onclick="window.App.openLineTimetableBothDirections('${arr.line_code}', '${arr.line_id}', '${safeDescr}')" title="Κλικ για προβολή πλήρους δρομολογίου και στάσεων">
        <!-- Top Section: Line Badge, Destination, Direction, GPS Status & Labeled Arrival Countdown -->
        <div class="ticker-row-top">
          <div class="ticker-cell-line">
            <span class="ticker-line-badge">
              ${arr.line_id}
            </span>
          </div>
          <div class="ticker-dest-info">
            <div class="ticker-dest-title-row">
              <span class="ticker-dest-name">${arr.destination || lineDescr}</span>
              <span class="m3-badge ticker-dir-badge">${directionText}</span>
            </div>
            <div class="ticker-dest-sub">
              ${isLive ? `
                <span style="color: #059669; font-weight: 700; font-size: 0.74rem; display: inline-flex; align-items: center; gap: 4px;">
                  <span class="m3-pulse-dot" style="width: 5px; height: 5px; background: #059669;"></span>
                  Ζωντανό GPS${reportAgo ? ` (πριν ${reportAgo})` : ''}${arr.veh_code ? ` • #${arr.veh_code}` : ''}
                </span>
              ` : `
                <span style="color: #64748b; font-weight: 600; font-size: 0.74rem;">
                  🕒 Προγραμματισμένο${arr.departure_time ? ` (Αναχώρηση ${arr.departure_time})` : ''}
                </span>
              `}
              ${lineDescr && arr.destination && lineDescr !== arr.destination ? `<span style="font-size: 0.7rem; color: #94a3b8;">• ${lineDescr}</span>` : ''}
            </div>
          </div>
          <div class="ticker-cell-due" title="Εκτιμώμενος χρόνος άφιξης στη στάση">
            <span class="ticker-due-sublabel">Άφιξη</span>
            ${dueDisplay}
          </div>
        </div>

        <!-- Bottom Section: Walking Time with Emoji, Commute Difference / Buffer, Alarm and Pin -->
        <div class="ticker-row-bottom">
          <div class="ticker-commute-group">
            <!-- Walking time with walking emoji -->
            <div class="ticker-walk-pill" title="${walk ? `Χρόνος περπατήματος μέχρι τη στάση: ${walk.minutes}λ • Απόσταση: ${walk.meters}μ` : 'Άγνωστη απόσταση περπατήματος'}">
              <span class="ticker-walk-emoji">🚶</span>
              <span class="ticker-walk-val">${walkMins !== null ? `${walkMins}λ` : '—'}</span>
              <span class="ticker-walk-label">περπάτημα</span>
            </div>

            <!-- Commute Buffer / Departure Timing Advice Badge -->
            <div class="ticker-commute-badge ${advice.className}" title="${advice.tooltip || 'Χρονικό περιθώριο αναχώρησης'}">
              ${advice.displayLabel || advice.label}
            </div>
          </div>

          <div class="ticker-cell-actions">
            <div class="ticker-cell-alarm">
              <button class="ticker-alarm-btn ${isAlarmSet ? 'active' : ''}" title="${isAlarmSet ? 'Ειδοποίηση ενεργή' : 'Ρύθμιση ειδοποίησης άφιξης'}" onclick="event.stopPropagation(); const notifDest = '${(arr.destination || safeDescr).replace(/'/g, "\\'")}'; window.App.openAlarmDialog('${arr.line_id}', '${arr.route_code}', ${busMins}, notifDest)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isAlarmSet ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </button>
            </div>

            <div class="ticker-cell-pin">
              <button class="ticker-pin-btn ${isPinned ? 'active' : ''}" title="${isPinned ? 'Καρφιτσωμένο (κλικ για αφαίρεση)' : 'Καρφίτσωμα άφιξης στις Καρφίτσες'}" onclick="event.stopPropagation(); window.PinnedTrips.togglePin(${JSON.stringify(arr).replace(/"/g, '&quot;')}, window.App.currentStop)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="17" x2="12" y2="22"></line>
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  toggleShowAllStops() {
    this.showAllStops = !this.showAllStops;
    this.render();
  }

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (!this.currentStop) {
      const rawStops = window.Search && Array.isArray(window.Search.nearbyStops) ? [...window.Search.nearbyStops] : [];
      // Prioritize starred/favourite stops with routes, active routes, and push stops without routes to the bottom
      rawStops.sort((a, b) => {
        const aHas = Array.isArray(a.serving_lines) && a.serving_lines.length > 0;
        const bHas = Array.isArray(b.serving_lines) && b.serving_lines.length > 0;

        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;

        const isFavA = window.Favorites && window.Favorites.isStopFav(a.StopCode);
        const isFavB = window.Favorites && window.Favorites.isStopFav(b.StopCode);

        if (isFavA && !isFavB) return -1;
        if (!isFavA && isFavB) return 1;

        return (a.distanceMeters || 0) - (b.distanceMeters || 0);
      });
      // Show all loaded stops without artificial cap of 20
      const displayStops = rawStops;

      // Prepare lines list
      let lines = [];
      if (window.Search && Array.isArray(window.Search.allLines) && window.Search.allLines.length > 0) {
        lines = window.Search.allLines;
      } else if (Array.isArray(this.allLines) && this.allLines.length > 0) {
        lines = this.allLines;
      } else {
        // Asynchronously load if not ready
        window.API.getLines().then(l => {
          if (Array.isArray(l) && l.length > 0) {
            this.allLines = l;
            if (this.activeView === 'lines' && !this.currentStop) {
              this.render();
            }
          }
        }).catch(() => {});
      }

      // Filter lines if query exists
      let displayLines = lines;
      if (this.linesFilterQuery && this.linesFilterQuery.trim().length > 0) {
        const normQ = (this.linesFilterQuery || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        displayLines = lines.filter(l => {
          const lId = (l.LineID || '').toLowerCase();
          const lDescr = (l.LineDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          const lCode = String(l.LineCode || '');
          return lId.includes(normQ) || lDescr.includes(normQ) || lCode.includes(normQ);
        });
      }

      // Header with view switcher (Στάσεις vs Γραμμές)
      const tabSwitcherHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; padding: 0.25rem 0.1rem;">
          <div style="display: inline-flex; background: var(--md-sys-color-surface-container-high); padding: 4px; border-radius: 9999px; border: 1px solid var(--md-sys-color-outline-variant);">
            <button class="m3-btn ${this.activeView === 'stops' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="font-size: 0.82rem; padding: 0.35rem 1rem; border-radius: 9999px; border: none; font-weight: 800; cursor: pointer;" onclick="window.App.ticker.setActiveView('stops')">
              🚏 Στάσεις ${displayStops.length > 0 ? `(${displayStops.length})` : ''}
            </button>
            <button class="m3-btn ${this.activeView === 'lines' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="font-size: 0.82rem; padding: 0.35rem 1rem; border-radius: 9999px; border: none; font-weight: 800; cursor: pointer;" onclick="window.App.ticker.setActiveView('lines')">
              🚌 Όλες οι Γραμμές ${lines.length > 0 ? `(${lines.length})` : ''}
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${this.activeView === 'stops' ? `
              <button class="m3-btn m3-btn-tonal" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;" onclick="window.Search.findNearbyStops()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                Ανανέωση
              </button>
            ` : `
              <div style="position: relative; display: flex; align-items: center;">
                <input type="text" placeholder="Φιλτράρισμα γραμμής..." value="${this.linesFilterQuery || ''}" oninput="window.App.ticker.setLinesFilterQuery(this.value)" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 9999px; background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface); outline: none; width: 160px;" />
              </div>
            `}
          </div>
        </div>
      `;

      if (this.activeView === 'lines') {
        let linesContent = '';
        if (displayLines.length > 0) {
          linesContent = `
            ${tabSwitcherHtml}
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.65rem;">
              ${displayLines.map(l => {
                const safeDescr = (l.LineDescr || '').replace(/'/g, "\\'");
                const isLineFav = window.Favorites && window.Favorites.isLineFav(l.LineCode);
                return `
                  <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.65rem; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); transition: transform 0.15s ease, border-color 0.15s ease;" onclick="window.App.openLineTimetableBothDirections('${l.LineCode}', '${l.LineID}', '${safeDescr}')" onmouseover="this.style.borderColor='var(--md-sys-color-primary)'" onmouseout="this.style.borderColor='var(--md-sys-color-outline-variant)'">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem;">
                      <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
                        <span class="ticker-line-badge" style="font-size: 0.95rem; min-width: 46px; flex-shrink: 0;">
                          ${l.LineID}
                        </span>
                        <div style="min-width: 0; flex: 1;">
                          <div style="font-weight: 800; font-size: 0.92rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${l.LineDescr}</div>
                          <div style="font-size: 0.74rem; color: var(--md-sys-color-outline); margin-top: 2px;">Γραμμή #${l.LineCode}</div>
                        </div>
                      </div>
                      <button class="m3-icon-btn" style="width: 36px; height: 36px; border: none; cursor: pointer; background: none; flex-shrink: 0;" title="Αποθήκευση γραμμής" onclick="event.stopPropagation(); const isFav = window.Favorites.toggleLine('${l.LineCode}', '${l.LineID}', '${safeDescr}'); this.querySelector('svg').setAttribute('fill', isFav ? '#eab308' : 'none'); this.querySelector('svg').setAttribute('stroke', isFav ? '#ca8a04' : '#64748b');">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="${isLineFav ? '#eab308' : 'none'}" stroke="${isLineFav ? '#ca8a04' : '#64748b'}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        } else {
          linesContent = `
            ${tabSwitcherHtml}
            <div class="m3-card" style="padding: 2.5rem 1.5rem; text-align: center; background: #ffffff; border: 1px solid var(--md-sys-color-outline-variant);">
              <div style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin-bottom: 0.4rem;">Δεν βρέθηκαν γραμμές</div>
              <div style="font-size: 0.8rem; color: #64748b;">Δοκιμάστε διαφορετικό όρο αναζήτησης.</div>
            </div>
          `;
        }
        container.innerHTML = linesContent;
        return;
      }

      // STOPS VIEW
      // If we have all stops loaded or search query, use master stops; otherwise combine with nearby stops
      let allStopsSource = [];
      if (Array.isArray(this.allStops) && this.allStops.length > 0) {
        allStopsSource = this.allStops;
      } else {
        // Asynchronously load all stops in the background
        this.loadAllStops();
        allStopsSource = rawStops;
      }

      // Filter stops if query exists
      let stopsToDisplay = allStopsSource;
      if (this.stopsFilterQuery && this.stopsFilterQuery.trim().length > 0) {
        const normQ = this.stopsFilterQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        stopsToDisplay = allStopsSource.filter(s => {
          const sCode = String(s.StopCode || '');
          const sName = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          const sStreet = (s.StopStreet || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          return sCode.includes(normQ) || sName.includes(normQ) || sStreet.includes(normQ);
        });
      } else if (allStopsSource === rawStops) {
        stopsToDisplay = rawStops;
      }

      // Prioritize favorites and active lines
      const sortedStops = [...stopsToDisplay].sort((a, b) => {
        const isFavA = window.Favorites && window.Favorites.isStopFav(a.StopCode);
        const isFavB = window.Favorites && window.Favorites.isStopFav(b.StopCode);
        if (isFavA && !isFavB) return -1;
        if (!isFavA && isFavB) return 1;

        const aHas = Array.isArray(a.serving_lines) && a.serving_lines.length > 0;
        const bHas = Array.isArray(b.serving_lines) && b.serving_lines.length > 0;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;

        return (a.distanceMeters || 0) - (b.distanceMeters || 0);
      });

      // Display up to 100 items at once for smooth rendering
      const paginatedStops = sortedStops.slice(0, 100);

      const stopsTabSwitcherHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; padding: 0.25rem 0.1rem;">
          <div style="display: inline-flex; background: var(--md-sys-color-surface-container-high); padding: 4px; border-radius: 9999px; border: 1px solid var(--md-sys-color-outline-variant);">
            <button class="m3-btn ${this.activeView === 'stops' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="font-size: 0.82rem; padding: 0.35rem 1rem; border-radius: 9999px; border: none; font-weight: 800; cursor: pointer;" onclick="window.App.ticker.setActiveView('stops')">
              🚏 Στάσεις ${sortedStops.length > 0 ? `(${sortedStops.length})` : ''}
            </button>
            <button class="m3-btn ${this.activeView === 'lines' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="font-size: 0.82rem; padding: 0.35rem 1rem; border-radius: 9999px; border: none; font-weight: 800; cursor: pointer;" onclick="window.App.ticker.setActiveView('lines')">
              🚌 Όλες οι Γραμμές ${lines.length > 0 ? `(${lines.length})` : ''}
            </button>
          </div>
        </div>
      `;

      let stopsContent = '';
      if (paginatedStops.length > 0) {
        stopsContent = `
          ${stopsTabSwitcherHtml}
          ${sortedStops.length > 100 ? `<div style="font-size: 0.75rem; color: #64748b; margin-bottom: 0.5rem; text-align: right;">Εμφάνιση 100 από ${sortedStops.length} στάσεις</div>` : ''}
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
            ${paginatedStops.map(s => {
              const sCode = s.StopCode;
              const isFav = window.Favorites && window.Favorites.isStopFav(sCode);
              const sTitle = s.StopDescr || ('Στάση #' + sCode);
              const safeTitle = sTitle.replace(/'/g, "\\'");
              const sStreet = s.StopStreet || '';
              const walk = this.getWalkMinutes(s.StopLat, s.StopLng);
              const distText = s.Distance ? `${Math.round(s.Distance)}m` : (walk ? `${walk.meters}m` : '');
              const walkText = walk ? `~${walk.minutes}λ` : '';
              
              const hasRoutes = Array.isArray(s.serving_lines) && s.serving_lines.length > 0;
              let linesPills = '';
              if (hasRoutes) {
                linesPills = s.serving_lines.slice(0, 6).map(l => `
                  <span class="m3-badge" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); font-size: 0.75rem; padding: 2px 7px; border: 1px solid var(--md-sys-color-outline-variant); margin-bottom: 2px;">
                    <strong style="color: var(--md-sys-color-primary);">${l.line_id}</strong>
                    <span style="color: var(--md-sys-color-outline); margin: 0 3px;">προς</span>
                    <span>${l.last_stop}</span>
                    ${l.direction ? `<span style="font-size: 0.68rem; color: #64748b; margin-left: 2px;">(${l.direction})</span>` : ''}
                  </span>
                `).join('');
                if (s.serving_lines.length > 6) {
                  linesPills += `<span style="font-size: 0.7rem; color: #64748b; font-weight: 700; align-self: center;">+${s.serving_lines.length - 6} ακόμη</span>`;
                }
              }

              return `
                <div class="m3-card stop-interactive-card" data-stop-code="${sCode}" data-stop-title="${safeTitle}" data-stop-lat="${s.StopLat}" data-stop-lng="${s.StopLng}" style="padding: 0.9rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.65rem; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; border: ${isFav ? '2px solid #eab308; background: #fffdf5;' : (hasRoutes ? '1px solid var(--md-sys-color-outline-variant); background: #ffffff;' : '1px dashed #cbd5e1; background: #f8fafc; opacity: 0.85;')}" onclick="window.App.selectStop('${sCode}', '${safeTitle}', ${s.StopLat}, ${s.StopLng})" onmouseover="this.style.borderColor='var(--md-sys-color-primary)'" onmouseout="this.style.borderColor='${isFav ? '#eab308' : (hasRoutes ? 'var(--md-sys-color-outline-variant)' : '#cbd5e1')}'">
                  <div>
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
                      <div style="font-weight: 800; font-size: 0.98rem; color: #0f172a; line-height: 1.25;">
                        ${sTitle}
                      </div>
                      <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                        ${isFav ? '<span class="m3-badge" style="background: #fef08a; color: #854d0e; font-size: 0.72rem; font-weight: 800; padding: 2px 6px;">⭐</span>' : ''}
                        <span class="m3-badge" style="font-size: 0.7rem; font-weight: 800; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;">
                          #${sCode}
                        </span>
                      </div>
                    </div>
                    ${sStreet ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">${sStreet}</div>` : ''}
                    ${(distText || walkText) ? `
                      <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #0284c7; font-weight: 700; margin-top: 4px;">
                        <span>🚶 ${distText}</span>
                        ${walkText ? `<span>• ${walkText}</span>` : ''}
                      </div>
                    ` : ''}
                  </div>

                  ${linesPills ? `
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding-top: 4px; border-top: 1px dashed #e2e8f0;">
                      <span style="font-size: 0.68rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Γραμμές:</span>
                      ${linesPills}
                    </div>
                  ` : `
                    <div style="padding-top: 4px; border-top: 1px dashed #e2e8f0; font-size: 0.72rem; color: #64748b; font-style: italic;">
                      ⚠️ Δεν διέρχονται ενεργές γραμμές
                    </div>
                  `}

                  <div style="display: flex; justify-content: flex-end; padding-top: 2px;">
                    <button class="m3-btn m3-btn-primary" style="font-size: 0.78rem; padding: 0.3rem 0.8rem; border-radius: 9999px; width: 100%; justify-content: center;" onclick="event.stopPropagation(); window.App.selectStop('${sCode}', '${safeTitle}', ${s.StopLat}, ${s.StopLng})">
                      Προβολή Αφίξεων ➜
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        stopsContent = `
          ${stopsTabSwitcherHtml}
          <div class="m3-card" style="padding: 2.5rem 1.5rem; text-align: center; background: #ffffff; border: 1px solid var(--md-sys-color-outline-variant);">
            <div style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin-bottom: 0.4rem;">Δεν βρέθηκαν στάσεις</div>
            <div style="font-size: 0.8rem; color: #64748b;">Δοκιμάστε διαφορετικό όνομα ή κωδικό στάσης.</div>
          </div>
        `;
      }

      container.innerHTML = stopsContent;
      return;
    }

    const stopName = this.currentStop.StopDescr || ('ΣΤΑΣΗ ' + this.currentStop.StopCode);
    const walk = this.getWalkMinutes(this.currentStop.StopLat, this.currentStop.StopLng);

    // Keep the top walking time pill in the stop banner perpetually synchronized
    const walkPill = document.getElementById('selected-stop-walk-pill');
    if (walkPill) {
      if (walk && typeof walk.minutes === 'number') {
        walkPill.style.display = 'inline-flex';
        walkPill.innerText = `🚶 ${walk.minutes}λ (${walk.meters}μ)`;
      } else {
        walkPill.style.display = 'none';
      }
    }

    // Extract unique line IDs for interactive show/hide filtering
    const uniqueLines = Array.from(new Set(this.arrivals.map(a => String(a.line_id || '').trim()).filter(Boolean)));
    
    // Filter arrivals by line visibility
    let visibleArrivals = this.arrivals.filter(a => !this.hiddenLines.has(String(a.line_id || '').trim()));
    
    // Filter arrivals by live vs scheduled mode
    if (this.modeFilter === 'live') {
      visibleArrivals = visibleArrivals.filter(a => a.is_live);
    } else if (this.modeFilter === 'scheduled') {
      visibleArrivals = visibleArrivals.filter(a => !a.is_live);
    }

    let rowsHtml = '';
    if (this.arrivals.length === 0) {
      rowsHtml = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem;">
          Δεν βρέθηκαν προγραμματισμένες αφίξεις για αυτή τη στάση.
        </div>
      `;
    } else if (this.modeFilter === 'live' && visibleArrivals.length === 0) {
      rowsHtml = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem;">
          ⚡ Δεν υπάρχουν ζωντανές αφίξεις με ενεργό GPS αυτή τη στιγμή.
        </div>
      `;
    } else if (this.modeFilter === 'scheduled' && visibleArrivals.length === 0) {
      rowsHtml = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem;">
          🕒 Δεν υπάρχουν προγραμματισμένες αφίξεις για την επιλεγμένη ημέρα.
        </div>
      `;
    } else if (visibleArrivals.length === 0) {
      rowsHtml = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem;">
          Όλες οι γραμμές έχουν αποκρυφθεί από το φίλτρο.
          <div style="margin-top: 0.5rem;">
            <button class="m3-btn m3-btn-outlined" style="font-size: 0.8rem; padding: 4px 12px;" onclick="window.App.ticker.showAllLines()">
              Επανεμφάνιση Όλων
            </button>
          </div>
        </div>
      `;
    } else {
      // Clean, ungrouped chronological arrival rows as modern cards
      rowsHtml = visibleArrivals.map((arr, arrIdx) => this.renderArrivalRow(arr, arrIdx, walk)).join('');
    }

    // Filter bar HTML when multiple lines serve this stop
    let filterBarHtml = '';
    if (uniqueLines.length > 1) {
      filterBarHtml = `
        <div class="ticker-filter-bar">
          <span class="ticker-filter-label">Γραμμές:</span>
          <div class="ticker-filter-pills">
            ${uniqueLines.map(lid => {
              const isHidden = this.hiddenLines.has(lid);
              return `
                <button class="ticker-filter-pill ${isHidden ? 'is-hidden' : 'is-active'}" 
                  onclick="event.stopPropagation(); window.App.ticker.toggleLine('${lid}')"
                  title="${isHidden ? 'Κάντε κλικ για εμφάνιση της γραμμής ' + lid : 'Κάντε κλικ για απόκρυψη της γραμμής ' + lid}">
                  <span class="ticker-filter-dot" style="background: ${isHidden ? '#94a3b8' : '#005ac1'};"></span>
                  ${lid}
                </button>
              `;
            }).join('')}
            ${this.hiddenLines.size > 0 ? `
              <button class="ticker-filter-reset" onclick="event.stopPropagation(); window.App.ticker.showAllLines()">
                Εμφάνιση Όλων
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="ticker-board">
        ${filterBarHtml}

        <div class="ticker-rows">
          ${rowsHtml}
        </div>
      </div>
    `;

    this.startClock();
  }

  toggleLine(lineId) {
    const lid = String(lineId).trim();
    if (this.hiddenLines.has(lid)) {
      this.hiddenLines.delete(lid);
    } else {
      this.hiddenLines.add(lid);
    }
    this.render();
  }

  showAllLines() {
    this.hiddenLines.clear();
    this.render();
  }

  startClock() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const updateTime = () => {
      const el = document.getElementById('ticker-live-clock');
      if (el) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('el-GR', {
          timeZone: 'Europe/Athens',
          hour12: false
        });
        el.innerHTML = this.renderSplitFlapDigits('global_clock', timeStr);
      }
    };
    updateTime();
    this.timerInterval = setInterval(updateTime, 1000);
  }
}

window.AirportTicker = AirportTicker;
