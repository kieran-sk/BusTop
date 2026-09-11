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

  isPinned(stopCode, lineId, routeCode) {
    return this.pinnedItems.some(item => 
      String(item.stopCode) === String(stopCode) && 
      String(item.lineId) === String(lineId) &&
      (!routeCode || !item.routeCode || String(item.routeCode) === String(routeCode))
    );
  }

  togglePin(arrival, stopInfo) {
    const stopCode = String(stopInfo.StopCode);
    const lineId = String(arrival.line_id || arrival.LineID || 'BUS');
    const routeCode = String(arrival.route_code || arrival.RouteCode || '');

    const existingIdx = this.pinnedItems.findIndex(item =>
      String(item.stopCode) === stopCode && String(item.lineId) === lineId
    );

    if (existingIdx !== -1) {
      this.pinnedItems.splice(existingIdx, 1);
      this.save();
      this.showToast(`Ξεκαρφιτσώθηκε η γραμμή ${lineId}`);
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
      if (window.Alarms) {
        window.Alarms.playTone(659.25, 0.12);
        setTimeout(() => window.Alarms.playTone(880, 0.15), 100);
      }

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
            0, // threshold 0 = quiet live tracking, no audible siren alarm!
            false, // ringUntilDismissed = false
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
    if (!stopInfo) return;
    const stopCode = String(stopInfo.StopCode);
    const lineId = String(arrival.line_id || arrival.LineID || 'BUS');
    const routeCode = String(arrival.route_code || arrival.RouteCode || '');

    const exists = this.isPinned(stopCode, lineId, routeCode);
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
    this.timerInterval = setInterval(() => this.fetchAllPinnedArrivals(), 15000);
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
          <div style="width: 54px; height: 54px; border-radius: 50%; background: #1e293b; color: var(--md-sys-color-primary); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"></line>
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
            </svg>
          </div>
          <h3 style="font-size: 1.2rem; font-weight: 800; color: var(--md-sys-color-on-surface); margin-bottom: 0.5rem;">
            Καρφίτσες • Καρφιτσωμένες Αφίξεις
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

      if (matchingArr) {
        const isLive = matchingArr.is_live;
        const mins = matchingArr.btime2;
        let dueText = '';
        if (isLive) {
          dueText = mins >= 60 ? this.formatMinutesHuman(mins) : `${String(mins).padStart(2, '0')}λ`;
        } else if (matchingArr.estimated_arrival_time) {
          dueText = matchingArr.estimated_arrival_time;
        } else if (typeof mins === 'number') {
          dueText = this.formatMinutesHuman(mins);
        } else {
          dueText = '--:--';
        }

        dueBadgeHtml = `
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
            ${this.renderSplitFlapDigits(`pin_due_${item.id}`, dueText)}
            <span style="font-size: 0.72rem; font-weight: 700; color: ${isLive ? '#008744' : '#64748b'};">
              ${isLive ? 'Ζωντανό GPS' : 'Προγραμματισμένο'}
            </span>
          </div>
        `;
      } else {
        dueBadgeHtml = `
          <div style="font-size: 0.82rem; font-weight: 700; color: #64748b;">
            Αναμονή...
          </div>
        `;
      }

      return `
        <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.75rem; padding: 1.1rem; background: var(--md-sys-color-surface-container); margin-bottom: 0.75rem; border: 1px solid var(--md-sys-color-outline-variant); border-left: 4px solid var(--md-sys-color-primary);">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span class="m3-badge" style="background: #334155; color: #f8fafc; font-weight: 800; font-size: 0.72rem;">
                Σκέλος ${idx + 1}
              </span>
              <span class="ticker-line-badge" style="font-size: 1rem;">
                ${item.lineId}
              </span>
              <div style="font-weight: 800; font-size: 1.05rem; color: var(--md-sys-color-on-surface);">
                ${item.stopName}
              </div>
            </div>
            ${dueBadgeHtml}
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; color: var(--md-sys-color-outline); flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <span style="font-weight: 700; color: var(--md-sys-color-on-surface);">${item.direction || 'Μετάβαση'}</span>
              ${item.lineDescr ? ` • ${item.lineDescr}` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-weight: 700; color: var(--md-sys-color-primary);">
                🚶 ${walkMins} λεπτά (${walkDistanceM}μ.)
              </span>
              <button class="m3-btn m3-btn-tonal" style="padding: 0.3rem 0.65rem; font-size: 0.75rem;" onclick="window.App.selectStop('${item.stopCode}', '${item.stopName.replace(/'/g, "\\'")}', ${item.stopLat || 'null'}, ${item.stopLng || 'null'})">
                Προβολή Στάσης
              </button>
              <button class="m3-icon-btn" title="Αφαίρεση καρφιτσώματος" style="width: 28px; height: 28px; color: var(--md-sys-color-error);" onclick="window.PinnedTrips.removePin('${item.id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="m3-card" style="margin-bottom: 1.25rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1px solid var(--md-sys-color-outline-variant); padding-bottom: 0.75rem;">
          <div>
            <h2 style="font-size: 1.25rem; font-weight: 900; color: var(--md-sys-color-on-surface); margin: 0;">
              Καρφίτσες • Καρφιτσωμένες Αφίξεις
            </h2>
            <div style="font-size: 0.8rem; color: var(--md-sys-color-outline); margin-top: 2px;">
              ${this.pinnedItems.length} καρφιτσωμένες γραμμές
            </div>
          </div>
          <button class="m3-btn m3-btn-tonal" style="color: var(--md-sys-color-error); font-size: 0.8rem; padding: 0.4rem 0.8rem;" onclick="window.PinnedTrips.clearAll()">
            Καθαρισμός
          </button>
        </div>

        <div style="display: flex; flex-direction: column;">
          ${itemsHtml}
        </div>
      </div>
    `;
  }
}

window.PinnedTrips = new PinnedTripsManager();
