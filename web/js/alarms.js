/**
 * Custom Bus Proximity Alarm Manager
 * Web Audio API synthesizer chime, Notifications API, and vibration patterns.
 */

class AlarmManager {
  constructor() {
    this.alarms = JSON.parse(localStorage.getItem('OASA_ACTIVE_ALARMS') || '[]');
    this.audioCtx = null;
    this.checkInterval = null;
    this.init();
  }

  init() {
    // Request notification permission if supported
    if ('Notification' in window && Notification.permission === 'default') {
      // Will request upon setting first alarm
    }

    // Render active alarms immediately into UI
    this.renderUI();

    // Start background watcher
    this.startWatcher();
  }

  save() {
    localStorage.setItem('OASA_ACTIVE_ALARMS', JSON.stringify(this.alarms));
    this.renderUI();
  }

  async requestPermission() {
    if (window.AndroidBridge) {
      // In Android WebView, permissions are handled natively by the Android wrapper
      return;
    }
    if ('Notification' in window && Notification.permission !== 'granted') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('Notification permission error:', e);
      }
    }

    // Register Web Push subscription for iOS PWA and Safari/Chrome
    await this.registerWebPushSubscription();
  }

  async registerWebPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg || !reg.pushManager) return null;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const vapidPublicKey = 'BMFpVKCE4nWW4qSakggJbRvBp9DMvb4dDC_bDWsIERpb8dpRH7Oj5nv9Z69kGu1LTg05XqacAzLgArdt5xoz5QQ';
        const convertedVapidKey = this.urlBase64ToUint8Array(vapidPublicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey
        });
      }

      if (sub) {
        fetch('/api/push/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub, subscribedAt: Date.now() })
        }).catch(() => {});
      }
      return sub;
    } catch (err) {
      console.log('Web Push registration note:', err.message);
      return null;
    }
  }

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  unlockAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      // Play tiny inaudible buffer to authorize audio output in mobile browsers
      const buffer = this.audioCtx.createBuffer(1, 1, 22050);
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);
      source.start(0);
    } catch (e) {
      console.warn('Audio unlock warning:', e);
    }
  }

  /**
   * Loud Audible Alarm Siren: High-gain alternating two-tone transit alarm
   * Rings continuously until dismissed by the user!
   */
  startAlarmRinging() {
    this.stopAlarmRinging();
    this.isRinging = true;

    // If running inside Android APK (AndroidBridge present), only ring the native alarm!
    // Do not ring Web Audio oscillator siren or browser vibration to prevent dual/overlapping alarms.
    if (window.AndroidBridge) {
      return;
    }

    // 1. Aggressive repeating vibration pattern (800ms vibrate, 200ms pause)
    if ('vibrate' in navigator) {
      navigator.vibrate([800, 200, 800, 200, 800, 200, 1200]);
      this.vibrateInterval = setInterval(() => {
        if (this.isRinging && 'vibrate' in navigator) {
          navigator.vibrate([800, 200, 800, 200, 800, 200, 1200]);
        }
      }, 3500);
    }

    // 2. Loud alternating two-tone alarm siren
    const playSirenBurst = () => {
      if (!this.isRinging) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!this.audioCtx && AudioCtx) this.audioCtx = new AudioCtx();
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }

        const ctx = this.audioCtx;
        if (!ctx) return;

        const now = ctx.currentTime;
        const tones = [880, 1250, 880, 1250, 880, 1250]; // Distinct A5 to E6 siren
        tones.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square'; // Cutting transit alarm square wave
          osc.frequency.setValueAtTime(freq, now + idx * 0.22);
          gain.gain.setValueAtTime(0.75, now + idx * 0.22);
          gain.gain.exponentialRampToValueAtTime(0.01, now + (idx + 1) * 0.22);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.22);
          osc.stop(now + (idx + 1) * 0.22);
        });
      } catch (e) {
        console.warn('Alarm audio error:', e);
      }
    };

    playSirenBurst();
    this.sirenInterval = setInterval(playSirenBurst, 1800);

    // Auto-stop after 35 seconds to avoid battery drain if phone is unattended
    this.autoStopTimeout = setTimeout(() => {
      this.stopAlarmRinging();
    }, 35000);
  }

  stopAlarmRinging() {
    this.isRinging = false;
    if (this.sirenInterval) {
      clearInterval(this.sirenInterval);
      this.sirenInterval = null;
    }
    if (this.vibrateInterval) {
      clearInterval(this.vibrateInterval);
      this.vibrateInterval = null;
    }
    if (this.autoStopTimeout) {
      clearTimeout(this.autoStopTimeout);
      this.autoStopTimeout = null;
    }
    if ('vibrate' in navigator) {
      navigator.vibrate(0);
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.dismissAlarm === 'function') {
      try {
        window.AndroidBridge.dismissAlarm();
      } catch (e) {}
    }

    // Dismiss triggered alarms and clean up corresponding pinned trips
    const triggeredAlarms = this.alarms.filter(a => a.triggered);
    if (triggeredAlarms.length > 0) {
      triggeredAlarms.forEach(a => {
        this.clearLiveNotification(a.id);
        if (window.PinnedTrips && typeof window.PinnedTrips.removePinByStopAndLine === 'function') {
          window.PinnedTrips.removePinByStopAndLine(a.stopCode, a.lineId);
        }
      });
      this.alarms = this.alarms.filter(a => !a.triggered);
      this.save();
      this.renderUI();
    }
  }

  /**
   * Add a custom alarm
   * @param {Object} options { stopCode, stopName, lineId, routeCode, targetMinutes, thresholdMinutes }
   */
  async addAlarm(options) {
    this.unlockAudio();
    await this.requestPermission();

    const id = 'alarm_' + Date.now();
    const threshold = options.thresholdMinutes || 5;
    const initialMins = options.targetMinutes || 10;
    const destination = options.destination || '';
    const walkMinutes = options.walkMinutes || 0;
    const stopCodeStr = String(options.stopCode);
    const lineIdStr = String(options.lineId).trim();
    const createdAt = Date.now();
    const ringUntilDismissed = options.ringUntilDismissed !== false;

    // Check if an alarm already exists for this line and stop (deduplicate)
    const existingIdx = this.alarms.findIndex(a =>
      String(a.stopCode) === stopCodeStr &&
      String(a.lineId).trim().toUpperCase() === lineIdStr.toUpperCase()
    );

    let alarm;
    if (existingIdx !== -1) {
      alarm = this.alarms[existingIdx];
      alarm.stopName = options.stopName || alarm.stopName;
      alarm.routeCode = options.routeCode ? String(options.routeCode) : alarm.routeCode;
      alarm.destination = destination || alarm.destination;
      alarm.walkMinutes = walkMinutes || alarm.walkMinutes;
      alarm.initialMinutes = initialMins;
      alarm.thresholdMinutes = threshold;
      alarm.ringUntilDismissed = ringUntilDismissed;
      alarm.createdAt = createdAt;
      alarm.triggered = false;
      alarm.triggeredAt = null;
    } else {
      alarm = {
        id,
        stopCode: stopCodeStr,
        stopName: options.stopName,
        lineId: lineIdStr,
        routeCode: options.routeCode ? String(options.routeCode) : '',
        destination,
        walkMinutes,
        initialMinutes: initialMins,
        thresholdMinutes: threshold,
        ringUntilDismissed,
        createdAt,
        triggered: false
      };
      this.alarms.push(alarm);
    }

    this.save();

    // 1. Dispatch to Service Worker for background alerting even if app is closed
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SCHEDULE_ALARM',
        id,
        lineId: alarm.lineId,
        stopName: alarm.stopName,
        destination: alarm.destination,
        walkMinutes: alarm.walkMinutes,
        initialMinutes: initialMins,
        thresholdMinutes: threshold,
        ringUntilDismissed: alarm.ringUntilDismissed,
        createdAt
      });
    }

    // 2. Dispatch to Android native AlarmManager & Foreground LiveTrackingService
    if (window.AndroidBridge) {
      try {
        const triggerInSecs = Math.max(1, (initialMins - threshold) * 60);
        if (typeof window.AndroidBridge.scheduleAlarm === 'function') {
          window.AndroidBridge.scheduleAlarm(
            String(alarm.lineId),
            String(alarm.stopName),
            Number(threshold),
            Number(triggerInSecs),
            Boolean(ringUntilDismissed),
            String(alarm.stopCode)
          );
        }
        if (typeof window.AndroidBridge.startLiveTracking === 'function') {
          window.AndroidBridge.startLiveTracking(
            String(alarm.stopCode),
            String(alarm.lineId),
            String(alarm.routeCode || ''),
            String(alarm.stopName),
            String(alarm.destination || ''),
            Number(alarm.walkMinutes || 0),
            Number(threshold),
            Boolean(ringUntilDismissed),
            Number(initialMins)
          );
        }
      } catch (e) {
        console.warn('AndroidBridge schedule error:', e);
      }
    }

    // 3. Live Notification initialization immediately
    this.updateLiveNotification(alarm, initialMins);

    // Play subtle confirmation chime & haptic feedback
    this.playTone(523.25, 0.15); // C5
    setTimeout(() => this.playTone(659.25, 0.15), 150); // E5
    if (window.App && typeof window.App.triggerHaptic === 'function') {
      window.App.triggerHaptic('success');
    }

    // Re-render departures if ticker is visible
    if (window.App && window.App.ticker) {
      window.App.ticker.render();
    }

    return alarm;
  }

  updateLiveNotification(alarm, minutes) {
    // 1. Android Native Ongoing Live Notification
    if (window.AndroidBridge && typeof window.AndroidBridge.updateLiveArrivalNotification === 'function') {
      try {
        window.AndroidBridge.updateLiveArrivalNotification(
          String(alarm.lineId),
          Number(minutes),
          String(alarm.stopName),
          String(alarm.destination || ''),
          Number(alarm.walkMinutes || 0),
          String(alarm.stopCode),
          Number(alarm.initialMinutes || 10)
        );
      } catch (e) {}
    }

    // 2. Web Service Worker Live Notification
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const timeDisplay = this.formatMinutesHuman(minutes);
    const title = `🚍 ${alarm.lineId} σε ${timeDisplay}`;
    const body = `Στάση: ${alarm.stopName} • Ειδοποίηση στα ${this.formatMinutesHuman(alarm.thresholdMinutes)}`;
    const tag = `live_alarm_${alarm.id}`;
    const iconUrl = new URL('assets/icon-192.png', window.location.href).href;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          tag,
          icon: iconUrl,
          badge: iconUrl,
          silent: true,
          renotify: false,
          ongoing: true,
          data: { url: '/?tab=notifications' },
          actions: [
            { action: 'cancel', title: '✖ Ακύρωση' }
          ]
        });
      }).catch(() => {});
    }
  }

  clearLiveNotification(id) {
    if (window.AndroidBridge && typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
      try {
        window.AndroidBridge.clearLiveArrivalNotification();
      } catch (e) {}
    }
    const tag = `live_alarm_${id}`;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.getNotifications({ tag }).then(notifications => {
          notifications.forEach(n => n.close());
        });
      }).catch(() => {});
    }
  }

  firePushNotification(alarm, currentMinutes) {
    const title = `🚨 Το Λεωφορείο ${alarm.lineId} πλησιάζει!`;
    const body = `Η γραμμή ${alarm.lineId} απέχει ${currentMinutes} λεπτά από τη στάση ${alarm.stopName}. Ώρα για αναχώρηση!`;
    const tag = `bus_alarm_${alarm.id}`;
    const iconUrl = new URL('assets/icon-192.png', window.location.href).href;

    // Dismiss the ongoing live counter notification
    this.clearLiveNotification(alarm.id);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: iconUrl,
          badge: iconUrl,
          tag,
          vibrate: [800, 200, 800, 200, 800, 200, 1200],
          renotify: true,
          requireInteraction: true,
          silent: false,
          ongoing: false,
          data: { url: '/?tab=notifications' }
        });
      }).catch(() => {
        try {
          new Notification(title, { body, icon: iconUrl });
        } catch (e) {}
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: iconUrl });
      } catch (e) {}
    }
  }

  removeAlarm(id) {
    this.stopAlarmRinging();
    this.clearLiveNotification(id);
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CANCEL_ALARM', id });
    }
    this.alarms = this.alarms.filter(a => a.id !== id);
    this.save();
    if (window.App && typeof window.App.triggerHaptic === 'function') {
      window.App.triggerHaptic('light');
    }
  }

  formatMinutesHuman(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '--';
    if (mins < 60) return `${mins}λ`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}ω ${remMins}λ` : `${hours}ω`;
  }

  startWatcher() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    // Poll every 15 seconds for responsive countdown
    this.checkInterval = setInterval(() => this.checkAllAlarms(), 15000);
  }

  async checkAllAlarms() {
    const now = Date.now();

    // 1. Auto-dismiss triggered alerts 10 minutes (600,000 ms) after they go off
    const initialCount = this.alarms.length;
    this.alarms = this.alarms.filter(a => {
      if (a.triggered && a.triggeredAt) {
        const elapsedSinceTriggered = now - a.triggeredAt;
        if (elapsedSinceTriggered >= 10 * 60 * 1000) {
          // Clear any remaining notifications for this alarm
          this.clearLiveNotification(a.id);
          return false; // Remove from list
        }
      }
      return true;
    });

    if (this.alarms.length !== initialCount) {
      this.save();
    }

    const active = this.alarms.filter(a => !a.triggered);
    if (active.length === 0) return;

    for (const alarm of active) {
      let currentMins = null;

      // 1. Try real-time OASA telematics first
      try {
        const data = await window.API.getStopArrivals(alarm.stopCode);
        const arrivals = (data && data.arrivals) ? data.arrivals : [];
        const normLine = String(alarm.lineId || '').trim().toUpperCase();
        const elapsedMs = now - alarm.createdAt;
        const elapsedMins = Math.floor(elapsedMs / 60000);
        const expectedMins = Math.max(0, alarm.initialMinutes - elapsedMins);

        // Filter all arrivals matching this line
        const matchingArrivals = arrivals.filter(a => {
          const lId = String(a.line_id || '').trim().toUpperCase();
          if (lId !== normLine) return false;
          if (alarm.routeCode && a.route_code && String(a.route_code) !== String(alarm.routeCode)) return false;
          return typeof a.btime2 === 'number';
        });

        if (matchingArrivals.length > 0) {
          // Sort by proximity to expected remaining time so we don't pick a scheduled bus 5 hours away!
          matchingArrivals.sort((a, b) => Math.abs(a.btime2 - expectedMins) - Math.abs(b.btime2 - expectedMins));
          const best = matchingArrivals[0];
          if (Math.abs(best.btime2 - expectedMins) <= 20 || best.btime2 <= expectedMins + 15) {
            currentMins = best.btime2;
          }
        }
      } catch (err) {
        console.warn(`Live arrival check failed for stop ${alarm.stopCode}:`, err);
      }

      // 2. Reliable Fallback to elapsed time if GPS drops or vehicle changes schedule
      if (currentMins === null) {
        const elapsedMs = now - alarm.createdAt;
        const elapsedMins = Math.floor(elapsedMs / 60000);
        currentMins = Math.max(0, alarm.initialMinutes - elapsedMins);
      }

      // Save live minutes so notifications tab and notification remain perfectly synced
      alarm.currentMinutes = currentMins;
      alarm.lastUpdated = now;

      // 3. Trigger alarm if threshold is reached!
      if (typeof currentMins === 'number' && currentMins <= alarm.thresholdMinutes) {
        this.triggerAlarm(alarm, currentMins);
      } else {
        // Update live notification with updated countdown
        this.updateLiveNotification(alarm, currentMins);
      }
    }

    this.save();
    this.renderUI();
  }

  playTone(frequency, duration) {
    try {
      const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  triggerAlarm(alarm, currentMinutes) {
    alarm.triggered = true;
    alarm.triggeredAt = Date.now();
    this.save();

    // 1. Start loud audible ringing siren & vibration loop
    this.startAlarmRinging();

    // 2. Regular High-Priority Push Notification via Service Worker
    this.firePushNotification(alarm, currentMinutes);

    // 3. Modal Alert on screen with Dismiss button
    this.showAlertModal(alarm, currentMinutes);
  }

  showAlertModal(alarm, currentMinutes) {
    const modal = document.getElementById('alarm-alert-modal');
    if (!modal) return;

    modal.querySelector('#alarm-alert-title').innerText = `🚨 Το Λεωφορείο ${alarm.lineId} απέχει ${currentMinutes} λεπτά!`;
    modal.querySelector('#alarm-alert-desc').innerText = `Πλησιάζει τη στάση: ${alarm.stopName}. Ώρα για αναχώρηση!`;
    modal.classList.add('open');
  }

  clearAllAlarms() {
    this.stopAlarmRinging();
    if (window.AndroidBridge) {
      try {
        if (typeof window.AndroidBridge.clearLiveArrivalNotification === 'function') {
          window.AndroidBridge.clearLiveArrivalNotification();
        }
        if (typeof window.AndroidBridge.stopLiveTracking === 'function') {
          window.AndroidBridge.stopLiveTracking();
        }
      } catch (e) {}
    }
    this.alarms.forEach(a => this.clearLiveNotification(a.id));
    this.alarms = [];
    this.save();
  }

  renderUI(containerId = null) {
    const targets = containerId 
      ? [document.getElementById(containerId)].filter(Boolean)
      : [document.getElementById('notifications-container'), document.getElementById('active-alarms-list')].filter(Boolean);

    // Update bottom nav badge
    const badge = document.getElementById('nav-alarms-badge');
    const activeCount = this.alarms.filter(a => !a.triggered).length;
    if (badge) {
      badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
      badge.textContent = activeCount;
    }

    // Check battery optimization button visibility
    const batteryOptBtn = document.getElementById('btn-request-battery-opt');
    if (batteryOptBtn && window.AndroidBridge && typeof window.AndroidBridge.requestIgnoreBatteryOptimizations === 'function') {
      try {
        const isIgnored = typeof window.AndroidBridge.isIgnoringBatteryOptimizations === 'function'
          ? window.AndroidBridge.isIgnoringBatteryOptimizations()
          : false;
        batteryOptBtn.style.display = isIgnored ? 'none' : 'inline-flex';
      } catch (e) {
        batteryOptBtn.style.display = 'inline-flex';
      }
    }

    if (targets.length === 0) return;

    let contentHtml = '';
    if (this.alarms.length === 0) {
      contentHtml = `
        <div class="m3-card" style="text-align: center; padding: 2.5rem 1.25rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔔</div>
          <div style="font-weight: 800; font-size: 1.1rem; color: var(--md-sys-color-on-surface); margin-bottom: 0.4rem;">Δεν υπάρχουν ενεργές ειδοποιήσεις</div>
          <p style="color: var(--md-sys-color-outline); font-size: 0.85rem; max-width: 380px; margin: 0 auto 1.25rem; line-height: 1.4;">
            Πατήστε το κουδουνάκι δίπλα σε οποιαδήποτε άφιξη στον πίνακα για να ορίσετε ηχητική ειδοποίηση και δόνηση όταν πλησιάζει το λεωφορείο.
          </p>
          <button class="m3-btn m3-btn-primary" style="border-radius: 9999px; padding: 0.5rem 1.2rem; font-weight: 800;" onclick="window.App.switchTab('ticker')">
            Προβολή Αφίξεων ➜
          </button>
        </div>
      `;
    } else {
      contentHtml = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 0.75rem;">
          <button class="m3-btn m3-btn-outlined" style="font-size: 0.75rem; padding: 3px 10px; border-radius: 9999px; color: var(--md-sys-color-error); border-color: #ef4444;" onclick="window.Alarms.clearAllAlarms()">
            🗑️ Διαγραφή Όλων
          </button>
        </div>
        <div style="display: grid; gap: 0.65rem;">
          ${this.alarms.map(a => {
            const elapsedMs = Date.now() - a.createdAt;
            const elapsedMins = Math.floor(elapsedMs / 60000);
            const currentEstMins = (typeof a.currentMinutes === 'number')
              ? a.currentMinutes
              : Math.max(0, a.initialMinutes - elapsedMins);
            const isUrgent = currentEstMins <= a.thresholdMinutes;
            const formattedTime = this.formatMinutesHuman(currentEstMins);

            let triggeredNote = '';
            if (a.triggered && a.triggeredAt) {
              const minsSince = Math.floor((Date.now() - a.triggeredAt) / 60000);
              const remainingBeforeDismiss = Math.max(1, 10 - minsSince);
              triggeredNote = ` • Αυτόματη αφαίρεση σε ${remainingBeforeDismiss}λ`;
            }

            const cleanStopName = (a.stopName || '').replace(/'/g, "\\'");
            return `
              <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; margin-bottom: 0; background: ${a.triggered ? '#fef2f2' : 'var(--md-sys-color-surface-container)'}; border: 1px solid var(--md-sys-color-outline-variant); border-left: 4px solid ${a.triggered ? '#dc2626' : (isUrgent ? '#ea580c' : 'var(--md-sys-color-primary)')}; cursor: pointer;" onclick="window.App.switchTab('ticker'); window.App.selectStop('${a.stopCode}', '${cleanStopName}');">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
                  <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
                    <span class="ticker-line-badge" style="font-size: 1rem; min-width: 48px; flex-shrink: 0;">
                      ${a.lineId}
                    </span>
                    <div style="min-width: 0; flex: 1;">
                      <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${a.stopName}</div>
                      <div style="font-size: 0.76rem; color: var(--md-sys-color-outline); margin-top: 2px;">
                        ${a.destination ? `<strong style="color: var(--md-sys-color-primary); margin-right: 4px;">προς ${a.destination}</strong> • ` : ''}Στάση #${a.stopCode} • <span style="color: var(--md-sys-color-primary); text-decoration: underline;">Προβολή στάσης ➜</span>
                      </div>
                    </div>
                  </div>
                  <div style="text-align: right; flex-shrink: 0;">
                    <span class="m3-badge" style="background: ${a.triggered ? '#fee2e2' : '#e0f2fe'}; color: ${a.triggered ? '#b91c1c' : '#005ac1'}; font-size: 0.72rem; font-weight: 800; padding: 2px 7px;">
                      ${a.triggered ? '🚨 Συναγερμός' : `⏳ ~${formattedTime}`}
                    </span>
                  </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px dashed var(--md-sys-color-outline-variant); padding-top: 0.5rem; font-size: 0.8rem; color: var(--md-sys-color-outline);">
                  <div>
                    Όριο: <strong style="color: var(--md-sys-color-on-surface);">${this.formatMinutesHuman(a.thresholdMinutes)}</strong> πριν την άφιξη${triggeredNote}
                  </div>
                  <div style="display: flex; gap: 0.5rem;">
                    <button class="m3-btn m3-btn-tonal" onclick="event.stopPropagation(); window.Alarms.removeAlarm('${a.id}')" style="padding: 0.3rem 0.75rem; font-size: 0.78rem; border-radius: 9999px;">
                      ${a.triggered ? 'Διαγραφή' : 'Ακύρωση'}
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    targets.forEach(t => {
      t.innerHTML = contentHtml;
    });
  }
}

window.Alarms = new AlarmManager();
