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
    window.Ticker = this;
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
          <div class="ticker-clock" id="ticker-live-clock">--:--:--</div>
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
    if (!this.userLocation || !stopLat || !stopLng) return null;
    const meters = this.calculateWalkingDistance(
      this.userLocation.lat,
      this.userLocation.lng,
      parseFloat(stopLat),
      parseFloat(stopLng)
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
    if (walkMinutes === null) {
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
        tooltip: `Περιθώριο αναχώρησης: Έχετε ${formattedBuf} διαθέσιμα πριν ξεκινήσετε για να προλάβετε το λεωφορείο!`,
        className: 'commute-relax',
        buffer
      };
    } else if (buffer >= 0) {
      return {
        label: sign,
        displayLabel: `⚡ ${sign}`,
        tooltip: `Ξεκινήστε τώρα! Το λεωφορείο φτάνει σχεδόν ταυτόχρονα με εσάς (${sign}).`,
        className: 'commute-leave-now',
        buffer
      };
    } else {
      return {
        label: sign,
        displayLabel: `⚠️ ${sign}`,
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

    // Due time display: Separate split-flap digit tiles with urgency styling (colors preserved)
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
      // If arrival has estimated arrival clock or departure time, display it; otherwise format btime2
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
    const isAlarmSet = window.Alarms && window.Alarms.alarms && window.Alarms.alarms.some(a => a.stopCode === this.currentStop.StopCode && a.lineId === arr.line_id && !a.triggered);

    // Check if pinned for complex trips
    const isPinned = window.PinnedTrips && window.PinnedTrips.isPinned(this.currentStop.StopCode, arr.line_id, arr.route_code);

    // Live location report latency string
    const reportAgo = arr.last_contact_ago_gr || arr.last_contact_ago;

    return `
      <div class="ticker-row" onclick="window.App.openLineTimetableBothDirections('${arr.line_code}', '${arr.line_id}', '${safeDescr}')" title="Κλικ για προβολή πλήρους δρομολογίου και στάσεων">
        <!-- 1. Line Badge -->
        <div class="ticker-cell-line">
          <span class="ticker-line-badge">
            ${arr.line_id}
          </span>
        </div>

        <!-- 2. Destination & Direction on Line 1, Live Status & Latency on Line 2 -->
        <div class="ticker-cell-dest ticker-dest">
          <!-- Line 1: Destination & Direction Badge -->
          <div class="ticker-dest-title" style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
            <span style="color: #0f172a; font-weight: 900; font-size: 0.95rem;">${arr.destination || lineDescr}</span>
            <span class="m3-badge" style="background: #e0f2fe; color: #005ac1; font-weight: 800; font-size: 0.68rem; padding: 1px 6px;">${directionText}</span>
          </div>
          <!-- Line 2: Dedicated Live Status (GPS and last ping report) -->
          <div class="ticker-dest-sub" style="margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${isLive ? `
              <span class="m3-badge m3-badge-live" style="font-size: 0.66rem; padding: 1px 6px; font-weight: 800;">
                <span class="m3-pulse-dot" style="width: 5px; height: 5px;"></span>
                Ζωντανό GPS
              </span>
              ${reportAgo ? `<span class="ticker-contact-ping" style="font-size: 0.72rem; color: #059669; font-weight: 600;">(Στίγμα: ${reportAgo})</span>` : ''}
              ${arr.veh_code ? `<span style="font-size: 0.7rem; color: #64748b;">#${arr.veh_code}</span>` : ''}
            ` : `
              <span class="m3-badge m3-badge-scheduled" style="font-size: 0.66rem; padding: 1px 6px; font-weight: 700;">
                🕒 Προγραμματισμένο
              </span>
              ${arr.departure_time ? `<span style="font-size: 0.72rem; color: #64748b;">(Αναχ. ${arr.departure_time})</span>` : ''}
            `}
            ${lineDescr && arr.destination && lineDescr !== arr.destination ? `<span style="font-size: 0.7rem; color: #94a3b8;">• ${lineDescr}</span>` : ''}
          </div>
        </div>

        <!-- 3. Due Time with Split-Flap (Arrival Countdown / Due Time) -->
        <div class="ticker-cell-due ticker-due" title="Εκτιμώμενος χρόνος άφιξης λεωφορείου στη στάση">
          ${dueDisplay}
        </div>

        <!-- 4. Commute Difference / Margin Column -->
        <div class="ticker-cell-commute" title="${advice.tooltip || 'Χρονικό περιθώριο αναχώρησης'}">
          <span class="ticker-commute-badge ${advice.className}">
            ${advice.displayLabel || advice.label}
          </span>
        </div>

        <!-- 5. Dedicated Alarm & Pin Actions (Grouped so buttons never shift across rows) -->
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

        // FIRST: Stops with NO routes/arrivals always go strictly to the bottom
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;

        const isFavA = window.Favorites && window.Favorites.isStopFav(a.StopCode);
        const isFavB = window.Favorites && window.Favorites.isStopFav(b.StopCode);

        if (isFavA && !isFavB) return -1;
        if (!isFavA && isFavB) return 1;

        return (a.distanceMeters || 0) - (b.distanceMeters || 0);
      });
      const stops = rawStops.slice(0, 20);
      const displayStops = stops;
      
      let stopsContent = '';
      if (stops.length > 0) {
        stopsContent = `
          <div style="margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; padding: 0 0.25rem;">
            <div>
              <h2 style="font-size: 1.15rem; font-weight: 900; color: #0f172a; margin: 0;">📍 Κοντινές Στάσεις (${displayStops.length})</h2>
              <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">Επιλέξτε στάση για να δείτε ζωντανές αφίξεις και διερχόμενες γραμμές</div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <button class="m3-btn m3-btn-tonal" style="font-size: 0.78rem; padding: 0.35rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;" onclick="window.Search.findNearbyStops()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                Ανανέωση
              </button>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
            ${displayStops.map(s => {
              const sCode = s.StopCode;
              const isFav = window.Favorites && window.Favorites.isStopFav(sCode);
              const sTitle = s.StopDescr || ('Στάση #' + sCode);
              const safeTitle = sTitle.replace(/'/g, "\\'");
              const sStreet = s.StopStreet || '';
              const walk = this.getWalkMinutes(s.StopLat, s.StopLng);
              const distText = s.Distance ? `${Math.round(s.Distance)}m` : (walk ? `${walk.meters}m` : '');
              const walkText = walk ? `~${walk.minutes}λ περπάτημα` : '';
              
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
                <div class="m3-card" style="padding: 0.9rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.65rem; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; border: ${isFav ? '2px solid #eab308; background: #fffdf5;' : (hasRoutes ? '1px solid var(--md-sys-color-outline-variant);' : '1px dashed #cbd5e1; background: #f8fafc; opacity: 0.85;')}" onclick="window.App.selectStop('${sCode}', '${safeTitle}', ${s.StopLat}, ${s.StopLng})" onmouseover="this.style.borderColor='var(--md-sys-color-primary)'" onmouseout="this.style.borderColor='${isFav ? '#eab308' : (hasRoutes ? 'var(--md-sys-color-outline-variant)' : '#cbd5e1')}'">
                  <div>
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
                      <div style="font-weight: 800; font-size: 0.98rem; color: #0f172a; line-height: 1.25;">
                        ${isFav ? '<span style="color: #ca8a04; margin-right: 4px;">⭐</span>' : ''}${sTitle}
                      </div>
                      <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                        ${isFav ? '<span class="m3-badge" style="background: #fef08a; color: #854d0e; font-size: 0.68rem; font-weight: 800;">Αγαπημένη</span>' : ''}
                        <span class="m3-badge" style="font-size: 0.7rem; font-weight: 800; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">
                          #${sCode}
                        </span>
                      </div>
                    </div>
                    ${sStreet ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">${sStreet}</div>` : ''}
                    ${(distText || walkText) ? `
                      <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #0369a1; font-weight: 700; margin-top: 4px;">
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
                    <div style="padding-top: 4px; border-top: 1px dashed #e2e8f0; font-size: 0.72rem; color: #94a3b8; font-style: italic;">
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
          <div class="m3-card" style="padding: 2.5rem 1.5rem; text-align: center; background: #ffffff;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: #e0f2fe; color: #005ac1; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
            </div>
            <div style="font-size: 1.15rem; font-weight: 900; color: #0f172a; margin-bottom: 0.4rem;">Όλες οι Στάσεις</div>
            <div style="font-size: 0.85rem; color: #64748b; max-width: 380px; margin: 0 auto 1.25rem; line-height: 1.4;">
              Εντοπίστε αυτόματα όλες τις στάσεις γύρω σας ή αναζητήστε γραμμή από την αναζήτηση.
            </div>
            <div style="display: flex; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">
              <button class="m3-btn m3-btn-primary" style="padding: 0.5rem 1.2rem; font-weight: 800; border-radius: 9999px;" onclick="window.Search.findNearbyStops()">
                📍 Εντοπισμός Στάσεων Κοντά μου
              </button>
              <button class="m3-btn m3-btn-outlined" style="padding: 0.5rem 1.2rem; font-weight: 700; border-radius: 9999px;" onclick="window.App.switchTab('search')">
                🔍 Αναζήτηση Στάσης
              </button>
            </div>
          </div>
        `;
      }

      container.innerHTML = stopsContent;
      return;
    }

    const stopName = this.currentStop.StopDescr || ('ΣΤΑΣΗ ' + this.currentStop.StopCode);
    const walk = this.getWalkMinutes(this.currentStop.StopLat, this.currentStop.StopLng);

    // Extract unique line IDs for interactive show/hide filtering
    const uniqueLines = Array.from(new Set(this.arrivals.map(a => String(a.line_id || '').trim()).filter(Boolean)));
    const visibleArrivals = this.arrivals.filter(a => !this.hiddenLines.has(String(a.line_id || '').trim()));

    let rowsHtml = '';
    if (this.arrivals.length === 0) {
      rowsHtml = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: #64748b; font-size: 0.9rem;">
          Δεν βρέθηκαν προγραμματισμένες αφίξεις για αυτή τη στάση.
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
      // Clean, ungrouped chronological arrival rows
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
        <div class="ticker-board-header">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button class="m3-btn m3-btn-outlined" style="font-size: 0.75rem; padding: 3px 10px; border-radius: 9999px; font-weight: 700; background: #ffffff;" onclick="event.stopPropagation(); window.App.showAllStopsInArrivals();" title="Επιστροφή σε όλες τις στάσεις">
              ⬅ Όλες οι Στάσεις
            </button>
            <div class="ticker-board-title">
              <span class="m3-pulse-dot" style="background: var(--md-sys-color-primary);"></span>
              ${stopName.toUpperCase()} • ΑΦΙΞΕΙΣ
            </div>
            ${walk ? `
              <span class="m3-badge" style="background: #e0f2fe; color: #005ac1; font-weight: 800; font-size: 0.72rem; padding: 2px 8px; border: 1px solid #bae6fd;">
                🚶 ${walk.minutes}λ περπάτημα (${walk.meters}μ)
              </span>
            ` : ''}
          </div>
          <div class="ticker-clock" id="ticker-live-clock">--:--:--</div>
        </div>

        ${filterBarHtml}

        <div class="ticker-col-headers">
          <div>ΓΡΑΜΜΗ</div>
          <div>ΠΡΟΟΡΙΣΜΟΣ &amp; ΚΑΤΕΥΘΥΝΣΗ</div>
          <div title="Χρόνος άφιξης λεωφορείου στη στάση">ΑΦΙΞΗ</div>
          <div title="Χρονικό περιθώριο αναχώρησης">ΔΙΑΦΟΡΑ</div>
          <div style="text-align: center;" title="Ειδοποίηση / Ξυπνητήρι">ΕΙΔ/ΣΗ</div>
          <div style="text-align: center;" title="Καρφίτσωμα άφιξης">📌</div>
        </div>

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
