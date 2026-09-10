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

    // Start background watcher
    this.startWatcher();
  }

  save() {
    localStorage.setItem('OASA_ACTIVE_ALARMS', JSON.stringify(this.alarms));
    this.renderUI();
  }

  async requestPermission() {
    if ('Notification' in window && Notification.permission !== 'granted') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('Notification permission error:', e);
      }
    }
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
    const ringUntilDismissed = options.ringUntilDismissed !== false;
    const createdAt = Date.now();

    const alarm = {
      id,
      stopCode: String(options.stopCode),
      stopName: options.stopName,
      lineId: String(options.lineId).trim(),
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
          window.AndroidBridge.scheduleAlarm(alarm.lineId, alarm.stopName, threshold, triggerInSecs, ringUntilDismissed);
        }
        if (typeof window.AndroidBridge.startLiveTracking === 'function') {
          window.AndroidBridge.startLiveTracking(
            alarm.stopCode,
            alarm.lineId,
            alarm.routeCode || '',
            alarm.stopName,
            alarm.destination || '',
            alarm.walkMinutes || 0,
            threshold,
            ringUntilDismissed
          );
        }
      } catch (e) {
        console.warn('AndroidBridge schedule error:', e);
      }
    }

    // 3. Live Notification initialization immediately
    this.updateLiveNotification(alarm, initialMins);

    // Play subtle confirmation chime
    this.playTone(523.25, 0.15); // C5
    setTimeout(() => this.playTone(659.25, 0.15), 150); // E5

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
          alarm.lineId,
          minutes,
          alarm.stopName,
          alarm.destination || '',
          alarm.walkMinutes || 0
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
        
        // Flexible matching by line and route
        const match = arrivals.find(a => 
          String(a.line_id || '').trim().toUpperCase() === normLine &&
          (!alarm.routeCode || String(a.route_code || '') === String(alarm.routeCode))
        ) || arrivals.find(a => 
          String(a.line_id || '').trim().toUpperCase() === normLine
        );

        if (match && typeof match.btime2 === 'number') {
          currentMins = match.btime2;
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

      // 3. Trigger alarm if threshold is reached!
      if (currentMins <= alarm.thresholdMinutes) {
        this.triggerAlarm(alarm, currentMins);
      } else {
        // Update live notification with updated countdown
        this.updateLiveNotification(alarm, currentMins);
      }
    }
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

    if (targets.length === 0) return;

    let contentHtml = '';
    if (this.alarms.length === 0) {
      contentHtml = `
        <div class="m3-card" style="text-align: center; padding: 2.5rem 1.25rem; background: #ffffff;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔔</div>
          <div style="font-weight: 800; font-size: 1.1rem; color: #0f172a; margin-bottom: 0.4rem;">Δεν υπάρχουν ενεργές ειδοποιήσεις</div>
          <p style="color: #64748b; font-size: 0.85rem; max-width: 380px; margin: 0 auto 1.25rem; line-height: 1.4;">
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
          <button class="m3-btn m3-btn-outlined" style="font-size: 0.75rem; padding: 3px 10px; border-radius: 9999px; color: var(--md-sys-color-error); border-color: #fca5a5;" onclick="window.Alarms.clearAllAlarms()">
            🗑️ Διαγραφή Όλων
          </button>
        </div>
        <div style="display: grid; gap: 0.65rem;">
          ${this.alarms.map(a => {
            const elapsedMs = Date.now() - a.createdAt;
            const elapsedMins = Math.floor(elapsedMs / 60000);
            const currentEstMins = Math.max(0, a.initialMinutes - elapsedMins);
            const isUrgent = currentEstMins <= a.thresholdMinutes;
            const formattedTime = this.formatMinutesHuman(currentEstMins);

            let triggeredNote = '';
            if (a.triggered && a.triggeredAt) {
              const minsSince = Math.floor((Date.now() - a.triggeredAt) / 60000);
              const remainingBeforeDismiss = Math.max(1, 10 - minsSince);
              triggeredNote = ` • Αυτόματη αφαίρεση σε ${remainingBeforeDismiss}λ`;
            }

            return `
              <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; margin-bottom: 0; background: ${a.triggered ? '#fef2f2' : '#ffffff'}; border-left: 4px solid ${a.triggered ? '#dc2626' : (isUrgent ? '#ea580c' : '#005ac1')};">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
                  <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
                    <span class="ticker-line-badge" style="font-size: 1rem; min-width: 48px; flex-shrink: 0;">
                      ${a.lineId}
                    </span>
                    <div style="min-width: 0; flex: 1;">
                      <div style="font-weight: 800; font-size: 0.95rem; color: #0f172a; line-height: 1.3; word-break: break-word;">${a.stopName}</div>
                      <div style="font-size: 0.76rem; color: #64748b; margin-top: 2px;">Στάση #${a.stopCode}</div>
                    </div>
                  </div>
                  <div style="text-align: right; flex-shrink: 0;">
                    <span class="m3-badge" style="background: ${a.triggered ? '#fee2e2' : '#e0f2fe'}; color: ${a.triggered ? '#b91c1c' : '#005ac1'}; font-size: 0.72rem; font-weight: 800; padding: 2px 7px;">
                      ${a.triggered ? '🚨 Συναγερμός' : `⏳ ~${formattedTime}`}
                    </span>
                  </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px dashed #e2e8f0; padding-top: 0.5rem; font-size: 0.8rem; color: #64748b;">
                  <div>
                    Όριο: <strong style="color: #0f172a;">${this.formatMinutesHuman(a.thresholdMinutes)}</strong> πριν την άφιξη${triggeredNote}
                  </div>
                  <div style="display: flex; gap: 0.5rem;">
                    <button class="m3-btn m3-btn-tonal" onclick="window.Alarms.removeAlarm('${a.id}')" style="padding: 0.3rem 0.75rem; font-size: 0.78rem; border-radius: 9999px;">
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
