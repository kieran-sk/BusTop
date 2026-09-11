/**
 * Main Application Controller for Athens OASA Bus Suite
 * Material 3 Expressive UI, state management, Leaflet map integration,
 * background alarms, and complex trips pinned manager.
 */

class AppController {
  constructor() {
    this.activeTab = 'search'; // Default to 'search' (Stops Near Me & Explorer)
    this.currentStop = null;
    this.currentLine = null;
    this.currentRoute = null;
    this.userLocation = null;
    this.pollInterval = null;
    this.mapManager = null;
    this.ticker = null;
    this.currentStopRequestId = 0;
    this.stopNotifActive = new Set(JSON.parse(localStorage.getItem('OASA_STOP_NOTIF') || '[]'));
    this.notifiedBuses = new Set();
    this.navHistory = [];
    this.arrivalsTargetDay = 'today';
  }

  async init() {
    console.log('[Athens OASA Bus Suite] Initializing Material 3 Expressive & Leaflet Map in Greek...');

    // Initialize Ticker
    this.ticker = new AirportTicker('ticker-container');

    // Initialize Map Manager (Leaflet + OpenStreetMap)
    this.mapManager = new MapManager('map-container');
    await this.mapManager.init();

    // Geolocation detection
    this.initGeolocation();

    // Render Favorites & Alarms UI
    window.Favorites.render();
    window.Alarms.renderUI();
    if (window.PinnedTrips) {
      window.PinnedTrips.renderUI();
    }



    // Default: Scan and display stops near me immediately
    if (window.Search) {
      window.Search.findNearbyStops(true);
    }

    // Switch to search/nearby tab as default landing view
    this.switchTab('search');

    // Setup global window resize
    window.addEventListener('resize', () => {
      if (this.mapManager) {
        this.mapManager.invalidateSize();
      }

    });

    // Restore variant grouping checkbox state
    const groupCheckbox = document.getElementById('toggle-group-variants');
    if (groupCheckbox) {
      groupCheckbox.checked = localStorage.getItem('OASA_GROUP_VARIANTS') === 'true';
    }

    // Setup connection status detection & automatic re-sync on reconnect
    const updateOnlineStatus = () => {
      const banner = document.getElementById('connection-status-banner');
      if (banner) {
        if (navigator.onLine) {
          banner.style.display = 'none';
          if (this.currentStop) {
            this.refreshStopArrivals(this.currentStopRequestId);
          }
        } else {
          banner.style.display = 'flex';
        }
      }
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Register Service Worker for background notifications and offline caching
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Force immediate check for worker update on every page load
        reg.update().catch(() => {});
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                console.log('New service worker activated - reloading for updates');
                window.location.reload();
              }
            });
          }
        });
      }).catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    }

    // Setup Android back gesture & browser popstate listener for phone navigation
    window.addEventListener('popstate', (e) => {
      this.handlePopState(e);
    });

    // Update back button initial state
    this.updateBackButtonsVisibility();
  }

  initGeolocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.setUserLocation(pos.coords.latitude, pos.coords.longitude);
          // Center map immediately on user on app open
          if (this.mapManager) {
            const stops = window.Search ? window.Search.nearbyStops : [];
            this.mapManager.fitAreaAroundUser(pos.coords.latitude, pos.coords.longitude, stops, 350);
          }
        },
        (err) => {
          console.log('Default geolocation fallback (Athens Center):', err.message);
          this.setUserLocation(37.9845, 23.7335);
          if (this.mapManager) {
            this.mapManager.setView(37.9845, 23.7335, 15);
          }
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }

  setUserLocation(lat, lng) {
    this.userLocation = { lat, lng };
    if (this.ticker) {
      this.ticker.setUserLocation(lat, lng);
    }
    if (this.mapManager) {
      this.mapManager.setUserLocation(lat, lng);
    }
    if (window.PinnedTrips) {
      window.PinnedTrips.renderUI();
    }

  }

  fitMapToUserArea(radiusMeters = 500) {
    if (this.mapManager && this.userLocation) {
      const stops = window.Search ? window.Search.nearbyStops : [];
      this.mapManager.fitAreaAroundUser(this.userLocation.lat, this.userLocation.lng, stops, radiusMeters);
    }
  }

  pushNavState(state) {
    if (!state) return;
    this.navHistory.push(state);
    if (this.navHistory.length > 50) {
      this.navHistory.shift();
    }
    window.history.pushState({ appNav: true, depth: this.navHistory.length }, '');
    this.updateBackButtonsVisibility();
  }

  handlePopState(event) {
    this.goBack(false);
  }

  goBack(popBrowserHistory = true) {
    const backBtn = document.getElementById('global-back-btn');
    if (backBtn) backBtn.blur();

    // 1. If any modal dialog is currently open, close it first
    const openDialog = document.querySelector('.m3-dialog-backdrop.open');
    if (openDialog) {
      openDialog.classList.remove('open');
      this.updateBackButtonsVisibility();
      return;
    }

    // If on ticker and viewing a specific stop, going back returns to all stops view!
    if (this.activeTab === 'ticker' && this.currentStop) {
      this.showAllStopsInArrivals();
      return;
    }

    // 2. If we have internal history entries, pop and restore previous screen
    if (this.navHistory.length > 0) {
      const prev = this.navHistory.pop();
      if (prev) {
        if (prev.tab === 'timetable' && prev.line) {
          this.openLineTimetableBothDirections(prev.line.lineCode, prev.line.lineId, prev.line.lineDescr, false);
        } else if (prev.tab === 'ticker' && prev.stop) {
          this.selectStop(prev.stop.StopCode, prev.stop.StopDescr, prev.stop.StopLat, prev.stop.StopLng, true, false);
        } else {
          this.switchTab(prev.tab || 'search', false);
        }
      }
    } else if (this.activeTab !== 'search') {
      // Fallback: return to search / stops near me root
      this.switchTab('search', false);
    }

    this.updateBackButtonsVisibility();
  }

  showAllStopsInArrivals() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.currentStop = null;
    const banner = document.getElementById('selected-stop-banner');
    if (banner) banner.style.display = 'none';
    const optBar = document.getElementById('arrivals-options-bar');
    if (optBar) optBar.style.display = 'none';
    if (this.ticker) {
      this.ticker.currentStop = null;
      this.ticker.render();
    }
    if (window.Search) {
      window.Search.findNearbyStops(true);
    }
    this.updateBackButtonsVisibility();
  }

  updateBackButtonsVisibility() {
    const canGoBack = this.navHistory.length > 0 || 
                      this.activeTab === 'timetable' || 
                      (this.activeTab === 'ticker' && !!this.currentStop) || 
                      (this.activeTab !== 'search') ||
                      !!document.querySelector('.m3-dialog-backdrop.open');

    const globalBackBtn = document.getElementById('global-back-btn');
    if (globalBackBtn) {
      globalBackBtn.style.display = canGoBack ? 'inline-flex' : 'none';
    }
  }

  switchTab(tabId, pushHistory = true) {
    if (pushHistory && tabId !== this.activeTab) {
      this.pushNavState({
        tab: this.activeTab,
        stop: this.currentStop ? { ...this.currentStop } : null,
        line: this.currentLine ? { ...this.currentLine } : null
      });
    }

    this.activeTab = tabId;

    // Update bottom nav bar active state
    document.querySelectorAll('.m3-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update section visibility
    document.querySelectorAll('.app-section').forEach(sec => {
      sec.style.display = sec.id === `section-${tabId}` ? 'block' : 'none';
    });

    // When switching to Arrivals tab, show all stops if no stop is explicitly selected
    if (tabId === 'ticker') {
      const banner = document.getElementById('selected-stop-banner');
      const optBar = document.getElementById('arrivals-options-bar');
      if (!this.currentStop) {
        if (banner) banner.style.display = 'none';
        if (optBar) optBar.style.display = 'none';
        if (this.ticker) this.ticker.render();
        if (window.Search && (!window.Search.nearbyStops || window.Search.nearbyStops.length === 0)) {
          window.Search.findNearbyStops(true);
        }
      } else {
        if (banner) banner.style.display = 'flex';
        if (optBar) optBar.style.display = 'flex';
      }
    }

    // Invalidate Leaflet Map size if on search / map tab
    if ((tabId === 'map' || tabId === 'search') && this.mapManager) {
      setTimeout(() => {
        this.mapManager.invalidateSize();
      }, 150);
    }

    // Handle Pinned Trips Polling
    if (tabId === 'pinned') {
      if (window.PinnedTrips) window.PinnedTrips.startPolling();
    } else {
      if (window.PinnedTrips) window.PinnedTrips.stopPolling();
    }

    // Render Notifications Tab if selected
    if (tabId === 'notifications' && window.Alarms) {
      window.Alarms.renderUI('notifications-container');
      window.Alarms.checkAllAlarms();
    }

    // Re-render favorites if selected
    if (tabId === 'favorites') {
      window.Favorites.render();
      if (window.Alarms) window.Alarms.renderUI();
    }

    this.updateBackButtonsVisibility();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Cleans raw route description to yield the true final destination stop
   */
  cleanClientDestination(r) {
    if (r.cleanDestination) return r.cleanDestination;
    let descr = (r.RouteDescr || r.LineDescr || '').trim();
    // Strip bracketed remarks like [ΠΑΝΟΡΑΜΑ] or [VIA PANORAMA-NTRAFI]
    descr = descr.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
    // Strip leading asterisks or variant markers
    descr = descr.replace(/^[*+\s]+/, '');
    const parts = descr.split(/[-–—/]/).map(s => s.trim()).filter(Boolean);
    let dest = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || descr);
    // Replace abbreviations and normalize whitespace
    dest = dest.replace(/\bΣΤ\.?\s*/g, 'ΣΤ. ').replace(/\s+/g, ' ').trim();
    return dest;
  }

  /**
   * Render cached or freshly fetched routes overview chips
   */
  renderRoutesOverview(routesListEl, routes) {
    if (!routesListEl) return;
    if (!Array.isArray(routes) || routes.length === 0) {
      routesListEl.innerHTML = '<span style="color: var(--md-sys-color-outline); font-size: 0.8rem;">Δεν βρέθηκαν γραμμές για αυτή τη στάση.</span>';
      return;
    }
    const seen = new Set();
    const uniqueRoutes = [];
    for (const r of routes) {
      const lid = r.LineID || 'BUS';
      const cleanDest = this.cleanClientDestination(r);
      const isCirc = /κυκλικη|circular/i.test(r.RouteDescr || '') || /κυκλικη|circular/i.test(r.LineDescr || '') || r.directionLabel === 'Κυκλική';
      const dir = isCirc ? 'Κυκλική' : (r.directionLabel || (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση'));
      const key = `${lid}|${cleanDest}|${dir}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRoutes.push({ ...r, cleanDestination: cleanDest, directionLabel: dir });
      }
    }

    routesListEl.innerHTML = uniqueRoutes.map(r => `
      <div style="background: #ffffff; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 9999px; padding: 3px 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 0.78rem; box-shadow: 0 1px 2px rgba(0,0,0,0.03); cursor: pointer;" onclick="window.App.openLineTimetableBothDirections('${r.LineCode}', '${r.LineID}', '${r.cleanDestination}')">
        <span style="font-weight: 800; color: var(--md-sys-color-primary);">${r.LineID || 'BUS'}</span>
        <span style="color: var(--md-sys-color-outline);">προς</span>
        <span style="color: #0f172a; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;">${r.cleanDestination}</span>
        <span class="m3-badge" style="background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); font-size: 0.65rem; padding: 1px 6px;">${r.directionLabel}</span>
      </div>
    `).join('');
  }

  /**
   * Select and inspect a specific stop
   * FIX: Immediately clears ticker and renders loading skeleton for this exact stop
   * to guarantee previous stop's arrivals are NEVER shown!
   */
  async selectStop(stopCode, stopName, lat = null, lng = null, shouldSwitchTab = true, pushHistory = true) {
    if (pushHistory) {
      this.pushNavState({
        tab: this.activeTab,
        stop: this.currentStop ? { ...this.currentStop } : null,
        line: this.currentLine ? { ...this.currentLine } : null
      });
    }

    this.currentStopRequestId++;
    const reqId = this.currentStopRequestId;

    this.currentStop = {
      StopCode: String(stopCode),
      StopDescr: stopName,
      StopLat: lat,
      StopLng: lng
    };

    // Update stop banner immediately with new stop info
    const banner = document.getElementById('selected-stop-banner');
    if (banner) {
      banner.style.display = 'flex';
      banner.querySelector('#selected-stop-title').innerText = stopName;
      banner.querySelector('#selected-stop-code').innerText = `Στάση #${stopCode}`;

      // Populate walking time pill if user location is available
      const walkPill = banner.querySelector('#selected-stop-walk-pill');
      if (walkPill) {
        let walkInfo = null;
        if (this.ticker && typeof this.ticker.getWalkMinutes === 'function') {
          walkInfo = this.ticker.getWalkMinutes(lat, lng);
        }
        if (walkInfo && typeof walkInfo.minutes === 'number') {
          walkPill.style.display = 'inline-flex';
          walkPill.innerText = `🚶 ${walkInfo.minutes}λ περπάτημα (${walkInfo.meters}μ)`;
        } else {
          walkPill.style.display = 'none';
        }
      }
      
      const optBar = document.getElementById('arrivals-options-bar');
      if (optBar) {
        optBar.style.display = 'flex';
      }

      // Dynamic Save / Favorite Button State (Star Icon)
      const starBtn = banner.querySelector('#selected-stop-star');
      const starSvg = banner.querySelector('#star-icon-svg');
      const updateStarIcon = () => {
        const isFav = window.Favorites.isStopFav(stopCode);
        if (starSvg) {
          if (isFav) {
            starSvg.setAttribute('fill', '#eab308');
            starSvg.setAttribute('stroke', '#ca8a04');
            starBtn.title = 'Αποθηκευμένο στα αγαπημένα (κλικ για αφαίρεση)';
          } else {
            starSvg.setAttribute('fill', 'none');
            starSvg.setAttribute('stroke', 'currentColor');
            starBtn.title = 'Αποθήκευση στάσης στα αγαπημένα';
          }
        }
      };
      updateStarIcon();
      if (starBtn) {
        starBtn.onclick = () => {
          window.Favorites.toggleStop(stopCode, stopName, lat, lng);
          updateStarIcon();
        };
      }
    }

    // Populate deduplicated line directions overview (with offline cache first)
    const routesListEl = document.getElementById('selected-stop-routes-list');
    if (routesListEl) {
      const cached = localStorage.getItem('OASA_STOP_ROUTES_' + stopCode);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          this.renderRoutesOverview(routesListEl, parsed);
        } catch (e) {}
      } else {
        routesListEl.innerHTML = '<span style="color: var(--md-sys-color-outline); font-size: 0.8rem;">Φόρτωση γραμμών...</span>';
      }

      window.API.getStopRoutes(stopCode).then(routes => {
        if (Array.isArray(routes) && routes.length > 0) {
          localStorage.setItem('OASA_STOP_ROUTES_' + stopCode, JSON.stringify(routes));
          this.renderRoutesOverview(routesListEl, routes);
        } else if (!cached) {
          routesListEl.innerHTML = '<span style="color: var(--md-sys-color-outline); font-size: 0.8rem;">Δεν βρέθηκαν γραμμές για αυτή τη στάση.</span>';
        }
      }).catch(() => {
        if (!cached) {
          routesListEl.innerHTML = '<span style="color: var(--md-sys-color-outline); font-size: 0.8rem;">Επισκόπηση γραμμών μη διαθέσιμη (εκτός σύνδεσης).</span>';
        }
      });
    }

    // IMMEDIATELY set loading state on ticker so previous stop's arrivals vanish instantly
    if (this.ticker) {
      this.ticker.setStopLoading(this.currentStop);
    }

    // If map is loaded, focus stop
    if (lat && lng && this.mapManager) {
      this.mapManager.focusStop(lat, lng, stopName);
    }

    // Switch to Arrivals ticker tab immediately without waiting for network!
    if (shouldSwitchTab) {
      this.switchTab('ticker', false);
    }
    this.updateBackButtonsVisibility();

    // Fetch and render arrivals with token check
    await this.refreshStopArrivals(reqId);

    // Start live auto-polling every 15s for this stop
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.refreshStopArrivals(this.currentStopRequestId), 15000);
  }



  showPushNotification(title, options = {}) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          icon: '/assets/icon-192.png',
          badge: '/assets/icon-192.png',
          ...options
        });
      }).catch(() => {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, options);
          }
        } catch (e) {}
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, options);
      } catch (e) {}
    }
  }

  setArrivalsDay(day) {
    this.arrivalsTargetDay = day;
    const todayBtn = document.getElementById('day-today-btn');
    const tomorrowBtn = document.getElementById('day-tomorrow-btn');
    if (todayBtn && tomorrowBtn) {
      if (day === 'tomorrow') {
        todayBtn.className = 'm3-btn m3-btn-tonal';
        tomorrowBtn.className = 'm3-btn m3-btn-primary';
      } else {
        todayBtn.className = 'm3-btn m3-btn-primary';
        tomorrowBtn.className = 'm3-btn m3-btn-tonal';
      }
    }
    this.refreshStopArrivals(this.currentStopRequestId);
  }

  async refreshStopArrivals(reqId = null) {
    if (!this.currentStop) return;
    const currentCode = String(this.currentStop.StopCode);

    // Animate dynamic refresh spinner
    const refreshSvg = document.getElementById('refresh-icon-svg');
    if (refreshSvg) {
      refreshSvg.classList.add('spin-animation');
      setTimeout(() => refreshSvg.classList.remove('spin-animation'), 700);
    }

    try {
      const data = await window.API.getStopArrivals(currentCode, this.arrivalsTargetDay || 'today');
      
      // Token check: Discard response if user clicked another stop while this was fetching
      if (reqId !== null && reqId !== this.currentStopRequestId) {
        return;
      }
      if (String(this.currentStop.StopCode) !== currentCode) {
        return;
      }

      const arrivals = data.arrivals || [];

      // Update Airport Ticker with fresh arrivals for this exact stop
      this.ticker.setStopAndArrivals(this.currentStop, arrivals);

      // Check Live Stop Notifications
      if (this.stopNotifActive.has(this.currentStop.StopCode) && 'Notification' in window && Notification.permission === 'granted') {
        for (const arr of arrivals) {
          const mins = arr.btime2;
          const busKey = `${this.currentStop.StopCode}_${arr.line_id}_${arr.veh_code || 'bus'}_${mins}`;
          if (mins <= 5 && !this.notifiedBuses.has(busKey)) {
            this.notifiedBuses.add(busKey);
            this.showPushNotification(`Το Λεωφορείο ${arr.line_id} πλησιάζει!`, {
              body: `Η γραμμή ${arr.line_id} (${arr.route_descr || ''}) απέχει ${mins} λεπτά από τη στάση ${this.currentStop.StopDescr}.`,
              tag: `live_stop_bus_${busKey}`,
              vibrate: [300, 150, 300, 150, 400],
              renotify: true
            });
            if (window.Alarms) {
              window.Alarms.playChime();
            }
          }
        }
      }
    } catch (err) {
      console.warn('Failed to refresh arrivals:', err);
    }
  }

  /**
   * Open full timetable and stop list for the selected bus line for both directions
   */
  openLineTimetableBothDirections(lineCode, lineId, lineDescr, pushHistory = true) {
    if (pushHistory) {
      this.pushNavState({
        tab: this.activeTab,
        stop: this.currentStop ? { ...this.currentStop } : null,
        line: this.currentLine ? { ...this.currentLine } : null
      });
    }

    if (!lineCode || lineCode === 'undefined' || lineCode === 'null' || lineCode === '') {
      if (lineId && window.Search && Array.isArray(window.Search.allLines)) {
        const found = window.Search.allLines.find(l => String(l.LineID).trim().toLowerCase() === String(lineId).trim().toLowerCase());
        if (found) {
          lineCode = found.LineCode;
          lineDescr = lineDescr || found.LineDescr;
        }
      }
    }
    this.currentLine = { lineCode, lineId, lineDescr };
    if (window.Timetable) {
      window.Timetable.loadLine(lineCode, lineId, lineDescr);
    }
    this.switchTab('timetable', false);
    this.updateBackButtonsVisibility();
  }

  async selectLine(lineCode, lineId, lineDescr) {
    this.openLineTimetableBothDirections(lineCode, lineId, lineDescr);
  }

  openAlarmDialog(lineId, routeCode, busMinutes, lineDescr = '') {
    const modal = document.getElementById('set-alarm-modal');
    if (!modal) return;

    modal.querySelector('#modal-alarm-line').innerText = lineId;
    modal.querySelector('#modal-alarm-due').innerText = `${busMinutes} λεπτά`;
    modal.dataset.lineId = lineId;
    modal.dataset.routeCode = routeCode;
    modal.dataset.dueMins = busMinutes;
    modal.dataset.lineDescr = lineDescr || '';
    modal.dataset.stopCode = this.currentStop ? this.currentStop.StopCode : '';
    modal.dataset.stopName = this.currentStop ? (this.currentStop.StopDescr || '') : '';

    // Reset preset chips to default 5 mins
    this.selectAlarmPreset(5);

    // Default continuous alarm to checked
    const continuousCheck = document.getElementById('alarm-ring-until-dismissed');
    if (continuousCheck) continuousCheck.checked = true;

    modal.classList.add('open');
    this.updateBackButtonsVisibility();
  }

  selectAlarmPreset(mins) {
    const input = document.getElementById('alarm-threshold-custom');
    if (input) input.value = mins;
    document.querySelectorAll('#set-alarm-modal .m3-filter-chip').forEach(btn => {
      const txt = btn.textContent.trim();
      btn.classList.toggle('active', txt === `${mins} λεπτά` || txt === `${mins} λ`);
    });
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
    this.updateBackButtonsVisibility();
  }

  confirmSetAlarm() {
    const modal = document.getElementById('set-alarm-modal');
    if (!modal) return;

    const lineId = modal.dataset.lineId;
    const routeCode = modal.dataset.routeCode;
    const dueMins = parseInt(modal.dataset.dueMins, 10);
    const lineDescr = modal.dataset.lineDescr || '';
    const stopCode = modal.dataset.stopCode || (this.currentStop ? this.currentStop.StopCode : '');
    const stopName = modal.dataset.stopName || (this.currentStop ? this.currentStop.StopDescr : '') || 'Στάση ΟΑΣΑ';
    const customInput = document.getElementById('alarm-threshold-custom');
    const threshold = customInput ? (parseInt(customInput.value, 10) || 5) : 5;
    const ringUntilDismissed = true; // Always trigger loud siren alarm when threshold is reached

    if (window.Alarms) {
      window.Alarms.unlockAudio();
    }

    // Walking time to current stop if available
    let walkMins = 0;
    if (this.currentStop && this.currentStop.distanceMeters) {
      walkMins = Math.ceil(this.currentStop.distanceMeters / 80) + 2;
    }

    if (window.Alarms) {
      window.Alarms.addAlarm({
        stopCode: stopCode,
        stopName: stopName,
        lineId,
        routeCode,
        destination: lineDescr,
        walkMinutes: walkMins,
        targetMinutes: dueMins,
        thresholdMinutes: threshold,
        ringUntilDismissed: ringUntilDismissed
      });
    }

    // Automatically pin the notification when setting an alarm
    if (window.PinnedTrips && typeof window.PinnedTrips.pinArrival === 'function') {
      try {
        window.PinnedTrips.pinArrival({
          line_id: lineId,
          route_code: routeCode,
          destination: lineDescr,
          route_descr: lineDescr,
          btime2: dueMins
        }, {
          StopCode: stopCode,
          StopDescr: stopName,
          distanceMeters: this.currentStop ? this.currentStop.distanceMeters : null,
          StopLat: this.currentStop ? this.currentStop.StopLat : null,
          StopLng: this.currentStop ? this.currentStop.StopLng : null
        });
      } catch (e) {
        console.warn('Could not auto-pin arrival for alarm:', e);
      }
    }

    this.closeModal('set-alarm-modal');
  }

}

document.addEventListener('DOMContentLoaded', () => {
  window.App = new AppController();
  window.App.init();
});
