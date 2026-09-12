/**
 * Complex Trips & Multi-Stop Pinned Arrivals Manager
 * Allows pinning arrivals of multiple buses from different stops in one place for complex journeys.
 */

class PinnedTripsManager {
  constructor(containerId = 'pinned-trips-container') {
    this.containerId = containerId;
    this.pinnedItems = JSON.parse(localStorage.getItem('OASA_PINNED_ARRIVALS') || '[]');
    this.liveArrivals = new Map(); // key -> arrival info
    this.timerInterval = null;
    this.previousDigitsMap = new Map();
  }

  save() {
    localStorage.setItem('OASA_PINNED_ARRIVALS', JSON.stringify(this.pinnedItems));
    this.renderUI();
  }

  isPinned(stopCode, lineId) {
    if (!stopCode || !lineId) return false;
    const sCode = String(stopCode).trim();
    const lId = String(lineId).trim().toUpperCase();
    return this.pinnedItems.some(item => 
      String(item.stopCode).trim() === sCode && 
      String(item.lineId).trim().toUpperCase() === lId
    );
  }

  togglePin(arrival, stopInfo) {
    if (!stopInfo || !arrival) return;
    const stopCode = String(stopInfo.StopCode).trim();
    const lineId = String(arrival.line_id || arrival.LineID || 'BUS').trim();
    const routeCode = String(arrival.route_code || arrival.RouteCode || '').trim();

    const existingIdx = this.pinnedItems.findIndex(item =>
      String(item.stopCode).trim() === stopCode &&
      String(item.lineId).trim().toUpperCase() === lineId.toUpperCase()
    );

    if (existingIdx !== -1) {
      this.pinnedItems.splice(existingIdx, 1);
      this.save();
      this.showToast(`Ξεκαρφιτσώθηκε η γραμμή ${lineId}`);
      if (window.App && typeof window.App.triggerHaptic === 'function') {
        window.App.triggerHaptic('light');
      }
      if (this.pinnedItems.length === 0) {
        if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
          try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
        }
      }
      this.updateLiveAndroidNotification();
    } else {
      const newItem = {
        id: 'pin_' + Date.now(),
        stopCode,
        stopName: stopInfo.StopDescr || `Στάση #${stopCode}`,
        stopStreet: stopInfo.StopStreet || '',
        stopLat: stopInfo.StopLat,
        stopLng: stopInfo.StopLng,
        lineId,
        lineDescr: arrival.route_descr || arrival.line_descr || '',
        routeCode,
        direction: arrival.direction || 'Μετάβαση',
        pinnedAt: Date.now()
      };
      this.pinnedItems.push(newItem);
      this.save();
      this.showToast(`📌 Ζωντανή παρακολούθηση: ${lineId} (${newItem.stopName})`);
      if (window.App && typeof window.App.triggerHaptic === 'function') {
        window.App.triggerHaptic('success');
      }
      if (window.Alarms) {
        window.Alarms.playTone(659.25, 0.12);
        setTimeout(() => window.Alarms.playTone(880, 0.15), 100);
      }

      // Check if an active alarm exists for this stop and line to preserve threshold & ringing!
      const activeAlarm = (window.Alarms && Array.isArray(window.Alarms.alarms))
        ? window.Alarms.alarms.find(a => !a.triggered && String(a.stopCode).trim() === stopCode && String(a.lineId).trim().toUpperCase() === lineId.toUpperCase())
        : null;

      const threshold = activeAlarm ? (activeAlarm.thresholdMinutes || 5) : 0;
      const ringUntilDismissed = activeAlarm ? (activeAlarm.ringUntilDismissed !== false) : false;

      // Start Android Live Tracking Notification immediately for this pinned bus
      if (window.AndroidBridge && typeof window.AndroidBridge.startLiveTracking === 'function') {
        try {
          const busMins = (arrival && typeof arrival.btime2 === 'number') ? arrival.btime2 : 10;
          let walkMins = 0;
          if (stopInfo.distanceMeters) {
            walkMins = Math.ceil(stopInfo.distanceMeters / 80) + 2;
          }
          window.AndroidBridge.startLiveTracking(
            String(stopCode),
            String(lineId),
            String(routeCode || ''),
            String(newItem.stopName),
            String(arrival.destination || arrival.route_descr || ''),
            Number(walkMins),
            Number(threshold),
            Boolean(ringUntilDismissed),
            Number(busMins)
          );
        } catch (e) {
          console.warn('AndroidBridge startLiveTracking error:', e);
        }
      }

      this.updateLiveAndroidNotification();
    }

    // Refresh departures board if open so pin button state updates
    if (window.App && window.App.ticker) {
      window.App.ticker.render();
    }
  }

  pinArrival(arrival, stopInfo) {
    if (!stopInfo || !arrival) return;
    const stopCode = String(stopInfo.StopCode).trim();
    const lineId = String(arrival.line_id || arrival.LineID || 'BUS').trim();

    const exists = this.isPinned(stopCode, lineId);
    if (!exists) {
      this.togglePin(arrival, stopInfo);
    }
  }

  removePin(pinId) {
    this.pinnedItems = this.pinnedItems.filter(p => p.id !== pinId);
    this.save();
    this.showToast('Το σκέλος αφαιρέθηκε');
    this.updateLiveAndroidNotification();
    if (window.App && window.App.ticker) {
      window.App.ticker.render();
    }
  }

  clearAll() {
    if (this.pinnedItems.length === 0) return;
    if (confirm('Θέλετε να αφαιρέσετε όλες τις καρφιτσωμένες αφίξεις;')) {
      this.pinnedItems = [];
      this.save();
      if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
        try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
      }
      this.updateLiveAndroidNotification();
      if (window.App && window.App.ticker) {
        window.App.ticker.render();
      }
    }
  }

  showToast(msg) {
    if (window.AndroidBridge && window.AndroidBridge.showToast) {
      window.AndroidBridge.showToast(msg);
      return;
    }
    const existing = document.getElementById('oasa-pinned-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'oasa-pinned-toast';
    toast.style.cssText = 'position: fixed; bottom: 85px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #ffffff; padding: 10px 20px; border-radius: 9999px; font-size: 0.85rem; font-weight: 700; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.25); pointer-events: none; transition: opacity 0.3s;';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  async fetchAllPinnedArrivals() {
    if (this.pinnedItems.length === 0) return;

    // Distinct stop codes to fetch in parallel
    const distinctStops = [...new Set(this.pinnedItems.map(p => p.stopCode))];
    await Promise.all(distinctStops.map(async (code) => {
      try {
        const data = await window.API.getStopArrivals(code);
        if (data && Array.isArray(data.arrivals)) {
          this.liveArrivals.set(code, data.arrivals);
        }
      } catch (e) {
        console.warn(`Could not refresh pinned stop ${code}:`, e);
      }
    }));

    this.renderUI();
    this.updateLiveAndroidNotification();
  }

  updateLiveAndroidNotification() {
    if (this.pinnedItems.length === 0) {
      if (window.AndroidBridge && typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
        try { window.AndroidBridge.clearLiveArrivalNotification(); } catch (e) {}
      }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_PINNED_LIVE_NOTIFICATION' });
      }
      if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(() => {});
      }
      return;
    }

    // Find the closest upcoming pinned arrival
    let closestItem = null;
    let minMins = 9999;

    for (const item of this.pinnedItems) {
      const arrs = this.liveArrivals.get(item.stopCode) || [];
      const match = arrs.find(a => 
        String(a.line_id || a.LineID) === String(item.lineId) &&
        (!item.routeCode || String(a.route_code) === String(item.routeCode))
      );
      if (match && typeof match.btime2 === 'number') {
        if (match.btime2 < minMins) {
          minMins = match.btime2;
          closestItem = { item, match, mins: match.btime2 };
        }
      }
    }

    if (closestItem) {
      const { item, match, mins } = closestItem;
      const title = `🚌 ${item.lineId}: Άφιξη σε ${mins}λ`;
      const body = `${item.stopName} • ${item.lineDescr || 'Διαδρομή'}${match.is_live ? ' (Ζωντανό GPS)' : ''}`;

      // Update Service Worker Live Ongoing Notification
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'UPDATE_PINNED_LIVE_NOTIFICATION',
          title,
          body,
          tag: 'live-pinned-bus-tracker',
          badgeCount: mins
        });
      }

      // Update Native App Badge if supported
      if ('setAppBadge' in navigator) {
        navigator.setAppBadge(mins).catch(() => {});
      }

      // Android Bridge Hook if running inside Android APK WebView
      if (window.AndroidBridge) {
        try {
          const dest = item.direction || item.destination || item.lineDescr || '';
          if (typeof window.AndroidBridge.updateLiveArrivalNotification === 'function') {
            window.AndroidBridge.updateLiveArrivalNotification(item.lineId, mins, item.stopName, dest, item.walkMinutes || 0, item.stopCode, 10);
          }
          if (typeof window.AndroidBridge.startLiveTracking === 'function') {
            window.AndroidBridge.startLiveTracking(item.stopCode, item.lineId, item.routeCode || '', item.stopName, dest, item.walkMinutes || 0, 0, false, mins);
          }
        } catch (e) {}
      }
    }
  }

  startPolling() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.fetchAllPinnedArrivals();
    const isBatterySaver = window.App && typeof window.App.isBatterySaverEnabled === 'function' 
      ? window.App.isBatterySaverEnabled() 
      : (localStorage.getItem('OASA_BATTERY_SAVER') === 'true');
    const intervalMs = isBatterySaver ? 35000 : 15000;
    this.timerInterval = setInterval(() => {
      if (!document.hidden) {
        this.fetchAllPinnedArrivals();
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatMinutesHuman(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '--';
    if (mins < 60) return `${mins}λ`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}ω ${remMins}λ` : `${hours}ω`;
  }

  renderSplitFlapDigits(key, text) {
    const chars = String(text).split('');
    const prevChars = (this.previousDigitsMap.get(key) || '').split('');
    this.previousDigitsMap.set(key, String(text));

    const html = chars.map((ch, idx) => {
      if (ch === ':' || ch === '.' || ch === '-') {
        return `<span class="flap-separator">${ch}</span>`;
      } else if (ch === ' ') {
        return `<span class="flap-separator" style="width: 6px; display: inline-block;"> </span>`;
      } else if (/[a-zA-Z\u0370-\u03ff]/.test(ch)) {
        return `<span class="flap-unit">${ch}</span>`;
      } else {
        const changed = prevChars.length > 0 && prevChars[idx] !== ch;
        return `<span class="flap-digit-box ${changed ? 'flap-flip' : ''}" data-digit="${ch}">${ch}</span>`;
      }
    }).join('');

    return `<div class="split-flap-board">${html}</div>`;
  }

  renderUI() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (this.pinnedItems.length === 0) {
      container.innerHTML = `
        <div class="m3-card" style="text-align: center; padding: 3rem 1.5rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);">
          <div style="width: 54px; height: 54px; border-radius: 50%; background: #eff6ff; color: var(--md-sys-color-primary); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"></line>
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
            </svg>
          </div>
          <h3 style="font-size: 1.2rem; font-weight: 800; color: var(--md-sys-color-on-surface); margin-bottom: 0.5rem;">
            Καρφιτσωμένες Αφίξεις
          </h3>
          <p style="font-size: 0.9rem; color: var(--md-sys-color-outline); max-width: 440px; margin: 0 auto 1.5rem; line-height: 1.5;">
            Καρφιτσώστε λεωφορεία από οποιαδήποτε στάση για να παρακολουθείτε ζωντανά τις αφίξεις τους σε έναν συγκεντρωτικό πίνακα!
          </p>
          <div style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; color: var(--md-sys-color-primary); background: var(--md-sys-color-surface-container-high); padding: 8px 16px; border-radius: 9999px;">
            <span>Πατήστε το εικονίδιο</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4H17V2H7V4H8V12L6 14V16H11V22H13V16H18V14L16 12Z"/></svg>
            <span>σε οποιαδήποτε άφιξη</span>
          </div>
        </div>
      `;
      return;
    }

    const itemsHtml = this.pinnedItems.map((item, idx) => {
      const arrivalsForStop = this.liveArrivals.get(item.stopCode) || [];
      const matchingArr = arrivalsForStop.find(a => 
        String(a.line_id || a.LineID) === String(item.lineId) &&
        (!item.routeCode || String(a.route_code) === String(item.routeCode))
      );

      let dueBadgeHtml = '';
      let walkMins = 3;
      let walkDistanceM = 180;
      if (window.App && window.App.userLocation && item.stopLat && item.stopLng) {
        const uLat = window.App.userLocation.lat;
        const uLng = window.App.userLocation.lng;
        const sLat = parseFloat(item.stopLat);
        const sLng = parseFloat(item.stopLng);
        if (window.App.ticker && typeof window.App.ticker.calculateWalkingDistance === 'function') {
          walkDistanceM = Math.round(window.App.ticker.calculateWalkingDistance(uLat, uLng, sLat, sLng));
        } else {
          const dLatM = Math.abs(sLat - uLat) * 111139;
          const avgLat = ((uLat + sLat) / 2) * Math.PI / 180;
          const dLngM = Math.abs(sLng - uLng) * (111139 * Math.cos(avgLat));
          walkDistanceM = Math.round((dLatM + dLngM) * 1.25);
        }
        walkMins = Math.ceil(walkDistanceM / 75) + 2;
      }

      const isLive = matchingArr && matchingArr.is_live;
      const isUrgent = (matchingArr && typeof matchingArr.btime2 === 'number' && matchingArr.btime2 <= 5);
      const cleanStopName = (item.stopName || '').replace(/'/g, "\\'");
      const cleanLineDescr = (item.lineDescr || '').replace(/'/g, "\\'");
      const displayMinutes = (matchingArr && typeof matchingArr.btime2 === 'number') ? matchingArr.btime2 : null;
      const formattedTime = displayMinutes !== null ? this.formatMinutesHuman(displayMinutes) : (matchingArr && matchingArr.estimated_arrival_time ? matchingArr.estimated_arrival_time : '--');

      return `
        <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; margin-bottom: 0.65rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-left: 4px solid ${isUrgent ? '#ea580c' : 'var(--md-sys-color-primary)'}; cursor: pointer;" onclick="window.App.switchTab('ticker'); window.App.selectStop('${item.stopCode}', '${cleanStopName}', ${item.stopLat || 'null'}, ${item.stopLng || 'null'});">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
              <span class="ticker-line-badge" style="font-size: 1rem; min-width: 48px; flex-shrink: 0;">
                ${item.lineId}
              </span>
              <div style="min-width: 0; flex: 1;">
                <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${item.stopName}</div>
                <div style="font-size: 0.76rem; color: var(--md-sys-color-outline); margin-top: 2px;">
                  ${item.direction ? `<strong style="color: var(--md-sys-color-primary); margin-right: 4px;">${item.direction}</strong> • ` : ''}Στάση #${item.stopCode} • <span style="color: var(--md-sys-color-primary); text-decoration: underline;">Προβολή στάσης ➜</span>
                </div>
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <span class="m3-badge" style="background: ${isLive ? '#dcfce7' : '#e0f2fe'}; color: ${isLive ? '#15803d' : '#005ac1'}; font-size: 0.72rem; font-weight: 800; padding: 2px 7px;">
                ${isLive ? `⚡ ~${formattedTime}` : (displayMinutes !== null ? `🕒 ~${formattedTime}` : '⏳ Αναμονή')}
              </span>
            </div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px dashed var(--md-sys-color-outline-variant); padding-top: 0.5rem; font-size: 0.8rem; color: var(--md-sys-color-outline);">
            <div>
              🚶 <strong style="color: var(--md-sys-color-on-surface);">${walkMins}λ</strong> (${walkDistanceM}μ. περπάτημα)
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="m3-btn m3-btn-tonal" onclick="event.stopPropagation(); window.PinnedTrips.removePin('${item.id}')" style="padding: 0.3rem 0.75rem; font-size: 0.78rem; border-radius: 9999px; color: var(--md-sys-color-error);">
                Ξεκαρφίτσωμα
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.25rem; font-weight: 800; margin: 0; color: #0f172a;">📌 Καρφιτσωμένες Αφίξεις</h2>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">${this.pinnedItems.length} καρφιτσωμένες γραμμές για γρήγορη παρακολούθηση</div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <button class="m3-btn m3-btn-outlined" style="font-size: 0.75rem; padding: 3px 10px; border-radius: 9999px; color: var(--md-sys-color-error); border-color: #ef4444;" onclick="window.PinnedTrips.clearAll()">
            🗑️ Καθαρισμός
          </button>
        </div>
      </div>
      <div style="display: grid; gap: 0.65rem;">
        ${itemsHtml}
      </div>
    `;
  }
}

window.PinnedTrips = new PinnedTripsManager();
