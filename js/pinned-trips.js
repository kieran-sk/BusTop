/**
 * Complex Trips & Multi-Stop Pinned Arrivals Manager
 * Allows pinning arrivals of multiple buses from different stops in one place for complex journeys.
 */

class PinnedTripsManager {
  constructor(containerId = 'pinned-trips-container') {
    this.containerId = containerId;
    this.pinnedItems = JSON.parse(localStorage.getItem('OASA_PINNED_ARRIVALS') || '[]');
    this.activePinId = localStorage.getItem('OASA_ACTIVE_PIN_ID') || null;
    this.liveArrivals = new Map(); // key -> arrival info
    this.failedStops = new Set(); // track stops with fetch errors
    this.timerInterval = null;
    this.previousDigitsMap = new Map();
  }

  save() {
    localStorage.setItem('OASA_PINNED_ARRIVALS', JSON.stringify(this.pinnedItems));
    if (this.activePinId) {
      localStorage.setItem('OASA_ACTIVE_PIN_ID', this.activePinId);
    } else {
      localStorage.removeItem('OASA_ACTIVE_PIN_ID');
    }
    this.renderUI();
  }

  setActivePin(pinId) {
    if (!pinId) return;
    this.activePinId = pinId;
    this.save();
    this.updateLiveAndroidNotification();
    const item = this.pinnedItems.find(p => p.id === pinId);
    if (item) {
      this.showToast(`Ενεργή παρακολούθηση: ${item.lineId}`);
    }
  }

  getArrivalKey(stopCode, arr) {
    if (!arr) return '';
    const sCode = String(stopCode || '').trim();
    const lId = String(arr.line_id || arr.LineID || 'BUS').trim().toUpperCase();
    const rCode = String(arr.route_code || arr.RouteCode || '').trim();

    if (arr.is_live && arr.veh_code) {
      return `${sCode}_${lId}_${rCode}_veh_${arr.veh_code}`;
    }
    const clockTime = arr.departure_time || arr.estimated_arrival_time;
    if (clockTime) {
      return `${sCode}_${lId}_${rCode}_t_${clockTime}`;
    }
    const mins = typeof arr.btime2 === 'number' ? arr.btime2 : 0;
    return `${sCode}_${lId}_${rCode}_m_${mins}`;
  }

  matchArrival(item, arr) {
    if (!item || !arr) return false;
    const sCode = String(item.stopCode || '').trim();
    const lId = String(item.lineId || '').trim().toUpperCase();
    const arrLid = String(arr.line_id || arr.LineID || '').trim().toUpperCase();
    if (lId !== arrLid) return false;

    // Check routeCode if both have it
    if (item.routeCode && arr.route_code && String(item.routeCode).trim() !== String(arr.route_code).trim()) {
      return false;
    }

    // 1. Vehicle code: if both have it, they MUST match! If either differs, definitely NOT this bus.
    if (item.vehCode && arr.veh_code) {
      return String(item.vehCode).trim() === String(arr.veh_code).trim();
    }

    // 2. Scheduled departure time: if both have it, they MUST match!
    if (item.departureTime && arr.departure_time) {
      return String(item.departureTime).trim() === String(arr.departure_time).trim();
    }

    // 3. Estimated arrival clock time: if both have it, they MUST match!
    if (item.estimatedArrivalTime && arr.estimated_arrival_time) {
      return String(item.estimatedArrivalTime).trim() === String(arr.estimated_arrival_time).trim();
    }

    // 4. Exact arrivalKey match
    const arrKey = this.getArrivalKey(sCode, arr);
    if (item.arrivalKey && arrKey && item.arrivalKey === arrKey) {
      return true;
    }

    // 5. Target arrival timestamp proximity (tight tolerance <= 3.5 mins to prevent grabbing other buses of same line)
    if (typeof arr.btime2 === 'number' && item.targetArrivalTimestamp) {
      const now = Date.now();
      const currentEst = now + (Math.max(0, arr.btime2) * 60 * 1000);
      const diffMs = Math.abs(item.targetArrivalTimestamp - currentEst);
      return diffMs <= 3.5 * 60 * 1000;
    }

    return false;
  }

  findBestArrivalMatch(item, arrs) {
    if (!item || !Array.isArray(arrs) || arrs.length === 0) return null;
    const sCode = String(item.stopCode || '').trim();
    const lId = String(item.lineId || '').trim().toUpperCase();

    // Candidates matching line and routeCode
    const candidates = arrs.filter(arr => {
      const arrLid = String(arr.line_id || arr.LineID || '').trim().toUpperCase();
      if (lId !== arrLid) return false;
      if (item.routeCode && arr.route_code && String(item.routeCode).trim() !== String(arr.route_code).trim()) {
        return false;
      }
      // Disqualify if vehCode conflict
      if (item.vehCode && arr.veh_code && String(item.vehCode).trim() !== String(arr.veh_code).trim()) {
        return false;
      }
      // Disqualify if departureTime conflict
      if (item.departureTime && arr.departure_time && String(item.departureTime).trim() !== String(arr.departure_time).trim()) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) return null;

    // 1. Direct vehCode match
    if (item.vehCode) {
      const vMatch = candidates.find(a => a.veh_code && String(a.veh_code).trim() === String(item.vehCode).trim());
      if (vMatch) return vMatch;
    }

    // 2. Direct departureTime match
    if (item.departureTime) {
      const dMatch = candidates.find(a => a.departure_time && String(a.departure_time).trim() === String(item.departureTime).trim());
      if (dMatch) return dMatch;
    }

    // 3. Direct arrivalKey match
    if (item.arrivalKey) {
      const kMatch = candidates.find(a => this.getArrivalKey(sCode, a) === item.arrivalKey);
      if (kMatch) return kMatch;
    }

    // 4. Closest ETA to expected target arrival timestamp
    const now = Date.now();
    const expectedRemainingMins = item.targetArrivalTimestamp
      ? Math.max(0, Math.round((item.targetArrivalTimestamp - now) / 60000))
      : (typeof item.initialMinutes === 'number' ? item.initialMinutes : 10);

    let bestCandidate = null;
    let minDiff = Infinity;

    for (const cand of candidates) {
      const mins = typeof cand.btime2 === 'number' ? cand.btime2 : 999;
      const diff = Math.abs(mins - expectedRemainingMins);
      if (diff < minDiff && (diff <= 8 || candidates.length === 1)) {
        minDiff = diff;
        bestCandidate = cand;
      }
    }

    return bestCandidate;
  }

  isArrivalPinned(stopCode, arrival) {
    if (!stopCode || !arrival) return false;
    const sCode = String(stopCode).trim();
    return this.pinnedItems.some(item =>
      String(item.stopCode).trim() === sCode &&
      this.matchArrival(item, arrival)
    );
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

  getCleanDestination(item) {
    if (!item) return '';
    let d = item.destination || item.departure_terminal || item.lineDescr || item.route_descr || item.line_descr || '';
    d = d.replace(/[⬅️➡️←→🔄▲▼]/g, '').trim();
    if (d === 'Μετάβαση' || d === 'Επιστροφή' || d === 'Τέρμα') {
      d = (item.lineDescr || item.route_descr || item.line_descr || '').replace(/[⬅️➡️←→🔄▲▼]/g, '').trim();
    }
    return d;
  }

  togglePin(arrival, stopInfo) {
    const currentStop = stopInfo || (window.App && window.App.ticker && window.App.ticker.currentStop) || (window.App && window.App.currentStop);
    if (!currentStop || !arrival) return;
    const stopCode = String(currentStop.StopCode || currentStop.code || '').trim();
    const lineId = String(arrival.line_id || arrival.LineID || 'BUS').trim();
    const routeCode = String(arrival.route_code || arrival.RouteCode || '').trim();

    // Find if this SPECIFIC arrival is already pinned
    const existingIdx = this.pinnedItems.findIndex(item =>
      String(item.stopCode).trim() === stopCode &&
      this.matchArrival(item, arrival)
    );

    if (existingIdx !== -1) {
      const removed = this.pinnedItems.splice(existingIdx, 1)[0];
      if (this.activePinId === removed.id) {
        this.activePinId = this.pinnedItems.length > 0 ? this.pinnedItems[this.pinnedItems.length - 1].id : null;
      }
      this.save();
      this.showToast(`Ξεκαρφιτσώθηκε η άφιξη ${lineId}`);
      if (window.Alarms && typeof window.Alarms.removeAlarmByStopAndLine === 'function') {
        window.Alarms.removeAlarmByStopAndLine(stopCode, lineId);
      }
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
      const busMins = (arrival && typeof arrival.btime2 === 'number') ? arrival.btime2 : 10;
      const arrivalKey = this.getArrivalKey(stopCode, arrival);
      const now = Date.now();
      const targetArrivalTimestamp = now + (Math.max(0, busMins) * 60 * 1000);
      const cleanDest = this.getCleanDestination(arrival) || arrival.route_descr || '';

      const newItem = {
        id: 'pin_' + now + '_' + Math.random().toString(36).substr(2, 5),
        stopCode,
        stopName: currentStop.StopDescr || currentStop.name || `Στάση #${stopCode}`,
        stopStreet: currentStop.StopStreet || '',
        stopLat: currentStop.StopLat || currentStop.lat,
        stopLng: currentStop.StopLng || currentStop.lng,
        lineId,
        lineDescr: arrival.route_descr || arrival.line_descr || '',
        routeCode,
        direction: arrival.direction || 'Μετάβαση',
        destination: cleanDest,
        vehCode: arrival.veh_code || null,
        departureTime: arrival.departure_time || null,
        estimatedArrivalTime: arrival.estimated_arrival_time || null,
        isLive: !!arrival.is_live,
        initialMinutes: Math.max(0, busMins),
        targetArrivalTimestamp,
        arrivalKey,
        pinnedAt: now
      };
      this.pinnedItems.push(newItem);
      this.activePinId = newItem.id;
      this.save();

      const timeLabel = arrival.departure_time ? ` (${arrival.departure_time})` : (typeof busMins === 'number' ? (busMins === 0 ? ' (ΤΩΡΑ)' : ` (σε ${busMins}')`) : '');
      this.showToast(`📌 Καρφιτσώθηκε: ${lineId}${timeLabel}`);
      if (window.App && typeof window.App.triggerHaptic === 'function') {
        window.App.triggerHaptic('success');
      }

      // Pinned trips are purely for visual/board monitoring and MUST NEVER set or trigger an alarm
      const threshold = 0;
      const ringUntilDismissed = false;

      // Disarm and remove any active or pending alarm for this line & stop so pinning is 100% passive
      if (window.Alarms && typeof window.Alarms.removeAlarmByStopAndLine === 'function') {
        window.Alarms.removeAlarmByStopAndLine(stopCode, lineId);
      }

      // Start Android Live Tracking Notification for this pinned bus only if no active alarm is running
      const hasActiveAlarm = (window.Alarms && Array.isArray(window.Alarms.alarms))
        ? window.Alarms.alarms.some(a => !a.triggered && typeof a.thresholdMinutes === 'number' && a.thresholdMinutes > 0)
        : false;

      if (!hasActiveAlarm && window.AndroidBridge && typeof window.AndroidBridge.startLiveTracking === 'function') {
        try {
          let walkMins = 0;
          if (currentStop.distanceMeters) {
            walkMins = Math.ceil(currentStop.distanceMeters / 80) + 2;
          }
          window.AndroidBridge.startLiveTracking(
            String(stopCode),
            String(lineId),
            String(routeCode || ''),
            String(newItem.stopName),
            String(cleanDest),
            Number(walkMins),
            0,
            false,
            Number(busMins),
            String(newItem.vehCode || ''),
            String(newItem.departureTime || ''),
            String(newItem.estimatedArrivalTime || '')
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
    const item = this.pinnedItems.find(p => p.id === pinId);
    this.pinnedItems = this.pinnedItems.filter(p => p.id !== pinId);
    if (this.activePinId === pinId) {
      this.activePinId = this.pinnedItems.length > 0 ? this.pinnedItems[this.pinnedItems.length - 1].id : null;
    }
    this.save();
    this.showToast('Το σκέλος αφαιρέθηκε');
    if (this.pinnedItems.length === 0) {
      if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
        try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
        try { window.AndroidBridge.clearLiveArrivalNotification(); } catch (e) {}
      }
    }
    this.updateLiveAndroidNotification();
    if (window.App && window.App.ticker) {
      window.App.ticker.render();
    }
  }

  removePinByStopAndLine(stopCode, lineId) {
    const normStop = String(stopCode || '').trim();
    const normLine = String(lineId || '').trim().toUpperCase();
    const initialCount = this.pinnedItems.length;
    this.pinnedItems = this.pinnedItems.filter(p => {
      const match = (String(p.stopCode).trim() === normStop && String(p.lineId).trim().toUpperCase() === normLine);
      if (match && this.activePinId === p.id) {
        this.activePinId = null;
      }
      return !match;
    });
    if (!this.activePinId && this.pinnedItems.length > 0) {
      this.activePinId = this.pinnedItems[this.pinnedItems.length - 1].id;
    }
    if (this.pinnedItems.length !== initialCount) {
      this.save();
      if (this.pinnedItems.length === 0) {
        if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
          try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
        }
        if (window.AndroidBridge && typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
          try { window.AndroidBridge.clearLiveArrivalNotification(); } catch (e) {}
        }
      }
      this.updateLiveAndroidNotification();
      if (window.App && window.App.ticker) {
        window.App.ticker.render();
      }
    }
  }

  clearAll() {
    if (this.pinnedItems.length === 0) return;
    if (confirm('Θέλετε να αφαιρέσετε όλες τις καρφιτσωμένες αφίξεις;')) {
      const removedItems = [...this.pinnedItems];
      this.pinnedItems = [];
      this.activePinId = null;
      this.save();
      if (window.Alarms && typeof window.Alarms.removeAlarmByStopAndLine === 'function') {
        removedItems.forEach(item => {
          window.Alarms.removeAlarmByStopAndLine(item.stopCode, item.lineId);
        });
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
        try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
        try { window.AndroidBridge.clearLiveArrivalNotification(); } catch (e) {}
      }
      this.updateLiveAndroidNotification();
      if (window.App && window.App.ticker) {
        window.App.ticker.render();
      }
    }
  }

  clearAllSilently() {
    if (this.pinnedItems.length === 0) return;
    const removedItems = [...this.pinnedItems];
    this.pinnedItems = [];
    this.activePinId = null;
    this.save();
    if (window.Alarms && typeof window.Alarms.removeAlarmByStopAndLine === 'function') {
      removedItems.forEach(item => {
        window.Alarms.removeAlarmByStopAndLine(item.stopCode, item.lineId);
      });
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
      try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
      try { window.AndroidBridge.clearLiveArrivalNotification(); } catch (e) {}
    }
    this.updateLiveAndroidNotification();
    if (window.App && window.App.ticker) {
      window.App.ticker.render();
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
          this.failedStops.delete(code);
        }
      } catch (e) {
        console.warn(`Could not refresh pinned stop ${code}:`, e);
        this.failedStops.add(code);
      }
    }));

    // Auto-dismiss pinned trips when the specific bus arrives/departs or has passed
    let autoDismissed = false;
    const now = Date.now();

    for (const item of [...this.pinnedItems]) {
      const arrs = this.liveArrivals.get(item.stopCode) || [];
      const stopFetched = !this.failedStops.has(item.stopCode);
      const match = this.findBestArrivalMatch(item, arrs);

      let shouldUnpin = false;

      if (match) {
        if (typeof match.btime2 === 'number') {
          // Keep targetArrivalTimestamp updated with live telematics
          item.targetArrivalTimestamp = now + (Math.max(0, match.btime2) * 60 * 1000);
          if (match.veh_code) item.vehCode = match.veh_code;
          if (match.is_live) item.isLive = true;
          if (match.estimated_arrival_time) item.estimatedArrivalTime = match.estimated_arrival_time;

          // Only auto-unpin if the bus is explicitly recorded as departed / negative
          if (match.btime2 < 0) {
            shouldUnpin = true;
          }
        }
      } else if (stopFetched) {
        // Stop was successfully queried, but this specific bus is no longer in upcoming arrivals.
        // It has truly departed if its expected arrival time plus 90 seconds grace period has elapsed.
        const expectedPassed = item.targetArrivalTimestamp && (now >= item.targetArrivalTimestamp + 90000);
        const staleTimeout = (now - item.pinnedAt) > 90 * 60 * 1000;
        if (expectedPassed || staleTimeout) {
          shouldUnpin = true;
        }
      } else {
        // If fetch failed, allow up to 15 minutes past target arrival before dismissing
        if (item.targetArrivalTimestamp && now > (item.targetArrivalTimestamp + 15 * 60 * 1000)) {
          shouldUnpin = true;
        }
      }

      if (shouldUnpin) {
        console.log(`Auto-unpinning passed arrival: ${item.lineId} at stop ${item.stopCode}`);
        this.pinnedItems = this.pinnedItems.filter(p => p.id !== item.id);
        autoDismissed = true;
      }
    }

    if (autoDismissed) {
      this.save();
      if (this.pinnedItems.length === 0) {
        if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
          try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
        }
      }
      if (window.App && window.App.ticker) {
        window.App.ticker.render();
      }
    }

    this.renderUI();
    this.updateLiveAndroidNotification();
  }

  checkExpiredPins() {
    if (this.pinnedItems.length === 0) return;
    const now = Date.now();
    let changed = false;
    for (const item of [...this.pinnedItems]) {
      const arrs = this.liveArrivals.get(item.stopCode);
      const stopFetched = !this.failedStops.has(item.stopCode);
      // Only expire if stop was queried, arrival is absent, and 90s grace period after target arrival passed
      if (stopFetched && Array.isArray(arrs) && arrs.length > 0 && !this.findBestArrivalMatch(item, arrs)) {
        if (item.targetArrivalTimestamp && now >= (item.targetArrivalTimestamp + 90000)) {
          this.pinnedItems = this.pinnedItems.filter(p => p.id !== item.id);
          changed = true;
        }
      }
    }
    if (changed) {
      this.save();
      if (this.pinnedItems.length === 0) {
        if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
          try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
        }
      }
      if (window.App && window.App.ticker) {
        window.App.ticker.render();
      }
      this.updateLiveAndroidNotification();
    }
  }

  updateLiveAndroidNotification() {
    if (this.pinnedItems.length === 0) {
      if (window.AndroidBridge && typeof window.AndroidBridge.stopLiveTracking === 'function') {
        try { window.AndroidBridge.stopLiveTracking(); } catch (e) {}
      }
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

    // Prioritize active pinned arrival or the most recently pinned arrival
    let targetItem = null;
    let targetMatch = null;
    let targetMins = null;

    const preferredPin = (this.activePinId && this.pinnedItems.find(p => p.id === this.activePinId))
      || this.pinnedItems[this.pinnedItems.length - 1];

    if (preferredPin) {
      targetItem = preferredPin;
      const arrs = this.liveArrivals.get(preferredPin.stopCode) || [];
      const match = this.findBestArrivalMatch(preferredPin, arrs);
      if (match && typeof match.btime2 === 'number') {
        targetMatch = match;
        targetMins = match.btime2;
      } else {
        targetMins = typeof preferredPin.initialMinutes === 'number' ? preferredPin.initialMinutes : 10;
      }
    }

    if (targetItem) {
      const item = targetItem;
      const match = targetMatch;
      const mins = targetMins;
      const cleanDest = this.getCleanDestination(item);
      const dirPart = cleanDest ? ' προς ' + cleanDest : '';
      const title = isDueNow ? `🚨 ${item.lineId}${dirPart} • Έφτασε!` : `🚍 ${item.lineId}${dirPart} • ${timeStr}`;

      const totalSegs = 8;
      const initM = typeof item.initialMinutes === 'number' && item.initialMinutes > 0 ? item.initialMinutes : 10;
      const ratio = Math.max(0, Math.min(1, (initM - mins) / initM));
      const busIdx = Math.max(0, Math.min(totalSegs - 1, Math.floor(ratio * (totalSegs - 1))));
      let track = '●';
      for (let i = 0; i < totalSegs; i++) {
        track += (i === busIdx) ? '🚍' : '━';
      }
      track += '📍';
      if (mins <= 0) track = '━━━━━━━🚍📍 Έφτασε στη στάση!';
      const walkInfo = (item.walkMinutes && item.walkMinutes > 0) ? ` (🚶 ${item.walkMinutes}' περπάτημα)` : '';
      const body = `${track}\n📍 Στάση: ${item.stopName}${walkInfo}`;

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

      // Android Bridge Hook if running inside Android APK WebView (only if no active alarm is running)
      if (window.AndroidBridge) {
        try {
          const dest = this.getCleanDestination(item);
          const hasActiveAlarm = (window.Alarms && Array.isArray(window.Alarms.alarms))
            ? window.Alarms.alarms.some(a => !a.triggered && typeof a.thresholdMinutes === 'number' && a.thresholdMinutes > 0)
            : false;

          if (!hasActiveAlarm) {
            const initMins = typeof item.initialMinutes === 'number' ? item.initialMinutes : (typeof mins === 'number' ? mins : 10);
            if (typeof window.AndroidBridge.updateLiveArrivalNotification === 'function') {
              window.AndroidBridge.updateLiveArrivalNotification(
                item.lineId,
                mins,
                item.stopName,
                dest,
                item.walkMinutes || 0,
                item.stopCode,
                initMins
              );
            }
            if (typeof window.AndroidBridge.startLiveTracking === 'function') {
              window.AndroidBridge.startLiveTracking(
                item.stopCode,
                item.lineId,
                item.routeCode || '',
                item.stopName,
                dest,
                item.walkMinutes || 0,
                0,
                false,
                initMins,
                item.vehCode || '',
                item.departureTime || '',
                item.estimatedArrivalTime || ''
              );
            }
          }
        } catch (e) {}
      }
    }
  }

  startPolling() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.localCheckInterval) clearInterval(this.localCheckInterval);
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
    this.localCheckInterval = setInterval(() => {
      if (!document.hidden) {
        this.checkExpiredPins();
      }
    }, 5000);
  }

  stopPolling() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.localCheckInterval) {
      clearInterval(this.localCheckInterval);
      this.localCheckInterval = null;
    }
  }

  formatMinutesHuman(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '--';
    if (mins < 60) return `${mins}'`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}ʰ ${remMins}'` : `${hours}ʰ`;
  }

  renderSplitFlapDigits(key, text) {
    const chars = String(text).split('');
    const prevChars = (this.previousDigitsMap.get(key) || '').split('');
    if (this.previousDigitsMap.size > 100) {
      const oldestKey = this.previousDigitsMap.keys().next().value;
      if (oldestKey) this.previousDigitsMap.delete(oldestKey);
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
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h2 style="font-size: 1.25rem; font-weight: 800; margin: 0; color: #0f172a;">📌 Καρφιτσωμένες Αφίξεις</h2>
            <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Ζωντανή παρακολούθηση επιλεγμένων αφίξεων σε συγκεντρωτικό πίνακα</div>
          </div>
        </div>
        <div class="m3-card" style="text-align: center; padding: 2.5rem 1.25rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📌</div>
          <div style="font-weight: 800; font-size: 1.1rem; color: var(--md-sys-color-on-surface); margin-bottom: 0.4rem;">Δεν υπάρχουν καρφιτσωμένες αφίξεις</div>
          <p style="color: var(--md-sys-color-outline); font-size: 0.85rem; max-width: 380px; margin: 0 auto 1.25rem; line-height: 1.4;">
            Πατήστε το εικονίδιο καρφίτσας δίπλα σε οποιαδήποτε άφιξη στον πίνακα για να παρακολουθείτε ζωντανά το λεωφορείο σας.
          </p>
          <button class="m3-btn m3-btn-primary" style="border-radius: 9999px; padding: 0.5rem 1.2rem; font-weight: 800;" onclick="window.App.switchTab('ticker')">
            Προβολή Αφίξεων ➜
          </button>
        </div>
      `;
      return;
    }

    const itemsHtml = this.pinnedItems.map((item, idx) => {
      const arrivalsForStop = this.liveArrivals.get(item.stopCode) || [];
      const matchingArr = this.findBestArrivalMatch(item, arrivalsForStop);

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

      const isLive = matchingArr ? matchingArr.is_live : item.isLive;
      const isUrgent = (matchingArr && typeof matchingArr.btime2 === 'number' && matchingArr.btime2 <= 5);
      const cleanStopName = (item.stopName || '').replace(/'/g, "\\'");
      const cleanLineDescr = (item.lineDescr || '').replace(/'/g, "\\'");
      const displayMinutes = (matchingArr && typeof matchingArr.btime2 === 'number') ? matchingArr.btime2 : null;
      const isDueNow = displayMinutes === 0;
      const formattedTime = isDueNow
        ? 'ΤΩΡΑ'
        : (displayMinutes !== null 
            ? this.formatMinutesHuman(displayMinutes) 
            : (matchingArr && matchingArr.estimated_arrival_time 
                ? matchingArr.estimated_arrival_time 
                : (item.departureTime || item.estimatedArrivalTime || '--')));

      const isActiveTracked = (item.id === this.activePinId) || (!this.activePinId && idx === this.pinnedItems.length - 1);

      return `
        <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; margin-bottom: 0; background: ${isActiveTracked ? '#f0fdf4' : 'var(--md-sys-color-surface-container)'}; border: 1px solid ${isActiveTracked ? '#86efac' : 'var(--md-sys-color-outline-variant)'}; border-left: 4px solid ${isActiveTracked ? '#16a34a' : (isUrgent ? '#ea580c' : 'var(--md-sys-color-primary)')}; cursor: pointer;" onclick="window.App.switchTab('ticker'); window.App.selectStop('${item.stopCode}', '${cleanStopName}', ${item.stopLat || 'null'}, ${item.stopLng || 'null'});">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
              <span class="ticker-line-badge" style="font-size: 1rem; min-width: 48px; flex-shrink: 0; ${isActiveTracked ? 'background: #15803d;' : ''}">
                ${item.lineId}
              </span>
              <div style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: normal; overflow-wrap: normal; hyphens: none;">${item.stopName}</div>
                  ${isActiveTracked ? `<span class="m3-badge" style="background: #dcfce7; color: #166534; font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border: 1px solid #bbf7d0;">🔔 Σε παρακολούθηση</span>` : ''}
                </div>
                <div style="font-size: 0.76rem; color: var(--md-sys-color-outline); margin-top: 2px;">
                  ${item.direction ? `<strong style="color: var(--md-sys-color-primary); margin-right: 4px;">${item.direction}</strong> • ` : ''}${item.departureTime ? `<strong style="color: #475569; margin-right: 4px;">🕒 Αναχώρηση: ${item.departureTime}</strong> • ` : ''}Στάση #${item.stopCode} • <span style="color: var(--md-sys-color-primary); text-decoration: underline;">Προβολή στάσης ➜</span>
                </div>
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <span class="m3-badge" style="background: ${isLive ? '#dcfce7' : '#e0f2fe'}; color: ${isLive ? '#15803d' : '#005ac1'}; font-size: 0.72rem; font-weight: 800; padding: 2px 7px;">
                ${isLive ? `⚡ ${isDueNow ? 'ΤΩΡΑ' : `~${formattedTime}`}` : (displayMinutes !== null ? `🕒 ${isDueNow ? 'ΤΩΡΑ' : `~${formattedTime}`}` : (item.departureTime ? `🕒 ${item.departureTime}` : '⏳ Αναμονή'))}
              </span>
            </div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px dashed var(--md-sys-color-outline-variant); padding-top: 0.5rem; font-size: 0.8rem; color: var(--md-sys-color-outline);">
            <div>
              🚶 <strong style="color: var(--md-sys-color-on-surface);">${walkMins}'</strong> (${walkDistanceM}μ. περπάτημα)
            </div>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              ${!isActiveTracked ? `
                <button class="m3-btn m3-btn-outlined" onclick="event.stopPropagation(); window.PinnedTrips.setActivePin('${item.id}')" style="padding: 0.25rem 0.65rem; font-size: 0.74rem; border-radius: 9999px; border-color: #10b981; color: #047857;" title="Εμφάνιση αυτής της γραμμής στην ειδοποίηση Android">
                  🔔 Παρακολούθηση
                </button>
              ` : ''}
              <button class="m3-btn m3-btn-tonal" onclick="event.stopPropagation(); window.PinnedTrips.removePin('${item.id}')" style="padding: 0.25rem 0.7rem; font-size: 0.74rem; border-radius: 9999px;">
                Ξεκαρφίτσωμα
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    let chipNoticeHtml = '';
    if (window.AndroidBridge && typeof window.AndroidBridge.canPostPromotedNotifications === 'function') {
      try {
        const canPromote = window.AndroidBridge.canPostPromotedNotifications();
        if (!canPromote) {
          chipNoticeHtml = `
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 0.75rem 0.9rem; margin-bottom: 0.85rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
              <div style="font-size: 0.78rem; color: #1e3a8a; line-height: 1.35;">
                <strong>💊 System Status Bar Chip:</strong><br>
                Για να εμφανίζεται η αντίστροφη μέτρηση δίπλα στο ρολόι, ενεργοποιήστε τις <em>«Ζωντανές ενημερώσεις»</em> στο Android.
              </div>
              <button class="m3-btn m3-btn-primary" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-radius: 9999px; white-space: nowrap; flex-shrink: 0;" onclick="event.stopPropagation(); window.AndroidBridge.openLiveUpdatesSettings();">
                Ενεργοποίηση ⚙️
              </button>
            </div>
          `;
        }
      } catch (e) {}
    }

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 style="font-size: 1.25rem; font-weight: 800; margin: 0; color: #0f172a;">📌 Καρφιτσωμένες Αφίξεις</h2>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">${this.pinnedItems.length} καρφιτσωμένες γραμμές για γρήγορη παρακολούθηση</div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <button class="m3-btn m3-btn-outlined" style="font-size: 0.75rem; padding: 3px 10px; border-radius: 9999px; color: var(--md-sys-color-error); border-color: #ef4444;" onclick="window.PinnedTrips.clearAll()">
            🗑️ Διαγραφή Όλων
          </button>
        </div>
      </div>
      ${chipNoticeHtml}
      <div style="display: grid; gap: 0.65rem;">
        ${itemsHtml}
      </div>
    `;
  }
}

window.PinnedTrips = new PinnedTripsManager();
