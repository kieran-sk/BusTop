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
    try {
      this.userLocation = JSON.parse(localStorage.getItem('OASA_LAST_USER_LOCATION') || 'null');
    } catch (e) {
      this.userLocation = null;
    }
    this.pollInterval = null;
    this.mapManager = null;
    this.ticker = null;
    this.currentStopRequestId = 0;
    this.stopNotifActive = new Set(JSON.parse(localStorage.getItem('OASA_STOP_NOTIF') || '[]'));
    this.notifiedBuses = new Set();
    this.navHistory = [];
    this.arrivalsTargetDay = 'today';
  }

  /**
   * System Haptic Vibration Feedback
   * Uses AndroidBridge native vibrator when available, or Web Vibration API
   */
  triggerHaptic(type = 'light') {
    const patterns = {
      light: 35,
      medium: 65,
      heavy: 110,
      success: [35, 50, 45],
      warning: [60, 60, 60]
    };
    const pattern = patterns[type] || 35;
    if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
      try {
        const ms = Array.isArray(pattern) ? pattern[0] : pattern;
        window.AndroidBridge.vibrate(Number(ms));
      } catch (e) {}
    }
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.add('open');
      this.syncBatterySaverUI();
      this.updateOfflineCacheCount();
      this.updateBackButtonsVisibility();
    }
  }

  updateOfflineCacheCount() {
    const countEl = document.getElementById('offline-cache-count');
    if (!countEl) return;
    try {
      const knownStops = Object.keys(JSON.parse(localStorage.getItem('OASA_KNOWN_STOPS') || '{}')).length;
      const favStops = (JSON.parse(localStorage.getItem('OASA_FAV_STOPS') || '[]')).length;
      const total = knownStops + favStops;
      countEl.innerText = `${total} στάσεις αποθηκευμένες`;
    } catch (e) {
      countEl.innerText = `Ενεργό`;
    }
  }

  isBatterySaverEnabled() {
    return localStorage.getItem('OASA_BATTERY_SAVER') === 'true';
  }

  toggleBatterySaver(enabled) {
    localStorage.setItem('OASA_BATTERY_SAVER', enabled ? 'true' : 'false');
    this.syncBatterySaverUI();
    this.applyBatterySaverPolicy(enabled);
    this.triggerHaptic('light');
  }

  syncBatterySaverUI() {
    const enabled = this.isBatterySaverEnabled();
    const toggle = document.getElementById('battery-saver-toggle');
    const badge = document.getElementById('battery-saver-badge');
    const slider = document.getElementById('battery-saver-slider');
    if (toggle) toggle.checked = enabled;
    if (badge) badge.style.display = enabled ? 'inline-block' : 'none';
    if (slider) {
      slider.style.backgroundColor = enabled ? '#10b981' : '#cbd5e1';
    }
  }

  applyBatterySaverPolicy(enabled) {
    // If enabled, throttle live polling interval in pinned trips and ticker
    if (window.PinnedTrips) {
      window.PinnedTrips.stopPolling();
      const intervalMs = enabled ? 35000 : 15000;
      window.PinnedTrips.timerInterval = setInterval(() => {
        if (!document.hidden) {
          window.PinnedTrips.fetchAllPinnedArrivals();
        }
      }, intervalMs);
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
    }
    this.updateBackButtonsVisibility();
  }

  setThemeMode(mode) {
    const isMatrix = mode === 'matrix';
    const link = document.getElementById('theme-dot-matrix');
    if (link) {
      link.disabled = !isMatrix;
    }
    localStorage.setItem('OASA_DOT_MATRIX_THEME', isMatrix ? 'true' : 'false');
    this.updateThemeButtonsUI(isMatrix);
    this.triggerHaptic('light');
  }

  updateThemeButtonsUI(isMatrix) {
    const btnM3 = document.getElementById('theme-btn-m3');
    const btnMatrix = document.getElementById('theme-btn-matrix');
    if (btnM3 && btnMatrix) {
      if (isMatrix) {
        btnM3.className = 'm3-btn m3-btn-tonal';
        btnMatrix.className = 'm3-btn m3-btn-primary';
      } else {
        btnM3.className = 'm3-btn m3-btn-primary';
        btnMatrix.className = 'm3-btn m3-btn-tonal';
      }
    }
  }

  toggleDotMatrixTheme() {
    const link = document.getElementById('theme-dot-matrix');
    if (!link) return;
    const isEnabled = !link.disabled;
    const nextState = !isEnabled;
    this.setThemeMode(nextState ? 'matrix' : 'm3');
  }

  applyStoredTheme() {
    const isExpUrl = window.location.hostname.includes('experimental') || 
                     window.location.search.includes('theme=matrix') || 
                     window.location.pathname.includes('experimental');
    const stored = localStorage.getItem('OASA_DOT_MATRIX_THEME');
    const shouldEnableMatrix = stored === 'true' || (stored === null && isExpUrl);
    const link = document.getElementById('theme-dot-matrix');
    if (link) {
      link.disabled = !shouldEnableMatrix;
    }
    this.updateThemeButtonsUI(shouldEnableMatrix);
  }

  async init() {
    console.log('[Athens OASA Bus Suite] Initializing Material 3 Expressive & Leaflet Map in Greek...');
    this.applyStoredTheme();

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

    // Setup stop card long-press handler (quick actions / favorites / focus on map)
    this.setupStopLongPressListener();

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
    try {
      localStorage.setItem('OASA_LAST_USER_LOCATION', JSON.stringify({ lat, lng }));
    } catch (e) {}
    if (this.ticker) {
      this.ticker.setUserLocation(lat, lng);
    }
    if (this.mapManager) {
      this.mapManager.setUserLocation(lat, lng);
    }
    if (window.PinnedTrips) {
      window.PinnedTrips.renderUI();
    }
    // Update selected stop walk pill if stop is active
    if (this.currentStop && this.ticker) {
      const walk = this.ticker.getWalkMinutes(this.currentStop.StopLat, this.currentStop.StopLng);
      const walkPill = document.getElementById('selected-stop-walk-pill');
      if (walkPill) {
        if (walk && typeof walk.minutes === 'number') {
          walkPill.style.display = 'inline-flex';
          walkPill.innerText = `🚶 ${walk.minutes}λ (${walk.meters}μ)`;
        } else {
          walkPill.style.display = 'none';
        }
      }
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

    // Show search bar when viewing all stops / lines
    const searchBar = document.querySelector('.m3-search-container');
    if (searchBar) searchBar.style.display = '';

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

    const searchBar = document.querySelector('.m3-search-container');

    // When switching to Arrivals / Stops & Lines tab
    if (tabId === 'ticker') {
      const banner = document.getElementById('selected-stop-banner');
      const optBar = document.getElementById('arrivals-options-bar');
      if (!this.currentStop) {
        if (banner) banner.style.display = 'none';
        if (optBar) optBar.style.display = 'none';
        if (searchBar) searchBar.style.display = '';
        if (this.ticker) this.ticker.render();
        if (window.Search && (!window.Search.nearbyStops || window.Search.nearbyStops.length === 0)) {
          window.Search.findNearbyStops(true);
        }
      } else {
        if (banner) banner.style.display = 'flex';
        if (optBar) optBar.style.display = 'flex';
        if (searchBar) searchBar.style.display = 'none';
      }
    } else {
      // In all other tabs, show search bar
      if (searchBar) searchBar.style.display = '';
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
      <div style="background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 9999px; padding: 3px 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 0.78rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: pointer;" onclick="window.App.openLineTimetableBothDirections('${r.LineCode}', '${r.LineID}', '${r.cleanDestination}')">
        <span style="font-weight: 800; color: var(--md-sys-color-primary);">${r.LineID || 'BUS'}</span>
        <span style="color: var(--md-sys-color-outline);">προς</span>
        <span style="color: var(--md-sys-color-on-surface); max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;">${r.cleanDestination}</span>
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

    let parsedLat = parseFloat(lat);
    let parsedLng = parseFloat(lng);
    const stopCodeStr = String(stopCode).trim();

    if ((isNaN(parsedLat) || isNaN(parsedLng))) {
      try {
        const cachedCoords = JSON.parse(localStorage.getItem('OASA_STOP_COORDS_' + stopCodeStr) || 'null');
        if (cachedCoords && cachedCoords.lat && cachedCoords.lng) {
          parsedLat = parseFloat(cachedCoords.lat);
          parsedLng = parseFloat(cachedCoords.lng);
        }
      } catch (e) {}

      if ((isNaN(parsedLat) || isNaN(parsedLng)) && window.Search && Array.isArray(window.Search.nearbyStops)) {
        const found = window.Search.nearbyStops.find(s => String(s.StopCode) === stopCodeStr);
        if (found && found.StopLat && found.StopLng) {
          parsedLat = parseFloat(found.StopLat);
          parsedLng = parseFloat(found.StopLng);
        }
      }
    }

    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      try {
        localStorage.setItem('OASA_STOP_COORDS_' + stopCodeStr, JSON.stringify({ lat: parsedLat, lng: parsedLng }));
      } catch (e) {}
    }

    this.currentStop = {
      StopCode: stopCodeStr,
      StopDescr: stopName,
      StopLat: !isNaN(parsedLat) ? parsedLat : null,
      StopLng: !isNaN(parsedLng) ? parsedLng : null,
      distanceMeters: null
    };

    // Update stop banner immediately with new stop info
    const banner = document.getElementById('selected-stop-banner');
    if (banner) {
      banner.style.display = 'flex';
      banner.querySelector('#selected-stop-title').innerText = stopName;
      banner.querySelector('#selected-stop-code').innerText = `Στάση #${stopCodeStr}`;

      // Populate walking time pill if user location is available
      const walkPill = banner.querySelector('#selected-stop-walk-pill');
      if (walkPill) {
        let walkInfo = null;
        if (this.ticker && typeof this.ticker.getWalkMinutes === 'function') {
          walkInfo = this.ticker.getWalkMinutes(parsedLat, parsedLng);
        }
        if (walkInfo && typeof walkInfo.minutes === 'number') {
          this.currentStop.distanceMeters = walkInfo.meters;
          walkPill.style.display = 'inline-flex';
          walkPill.innerText = `🚶 ${walkInfo.minutes}λ (${walkInfo.meters}μ)`;
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

      // Dynamically re-evaluate walking distance based on latest user location
      if (this.currentStop) {
        let sLat = this.currentStop.StopLat;
        let sLng = this.currentStop.StopLng;
        if ((!sLat || !sLng) && this.ticker) {
          try {
            const cached = JSON.parse(localStorage.getItem('OASA_STOP_COORDS_' + currentCode) || 'null');
            if (cached && cached.lat && cached.lng) {
              sLat = cached.lat;
              sLng = cached.lng;
              this.currentStop.StopLat = sLat;
              this.currentStop.StopLng = sLng;
            }
          } catch (e) {}
        }
        if (sLat && sLng && this.ticker && typeof this.ticker.getWalkMinutes === 'function') {
          const walk = this.ticker.getWalkMinutes(sLat, sLng);
          if (walk && typeof walk.minutes === 'number') {
            this.currentStop.distanceMeters = walk.meters;
            const walkPill = document.getElementById('selected-stop-walk-pill');
            if (walkPill) {
              walkPill.style.display = 'inline-flex';
              walkPill.innerText = `🚶 ${walk.minutes}λ (${walk.meters}μ)`;
            }
          }
        }
      }

      // Hide telematics banner if it was previously visible
      const connBanner = document.getElementById('connection-status-banner');
      if (connBanner && navigator.onLine) {
        connBanner.style.display = 'none';
      }

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
      const connBanner = document.getElementById('connection-status-banner');
      const connText = document.getElementById('connection-status-text');
      if (connBanner && connText) {
        connText.innerText = '⚡ Προσωρινή καθυστέρηση τηλεματικής ΟΑΣΑ: Προβολή προηγούμενων αφίξεων';
        connBanner.style.display = 'flex';
      }
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
    const dueMins = parseInt(modal.dataset.dueMins, 10) || 10;
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

    // 1. Automatically pin the notification first (without triggering alarm noise)
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

    // 2. Set alarm with user's threshold and ring settings (arms the alarm)
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

    this.closeModal('set-alarm-modal');
  }

  /**
   * Stop Quick Action Dialog (triggered on Long-Press of any stop card)
   * Allows adding/removing from favourites or focusing stop on map.
   */
  openStopActionModal(stopCode, stopName, lat = null, lng = null) {
    const modal = document.getElementById('stop-actions-modal');
    if (!modal) return;

    const sCode = String(stopCode || '').trim();
    const sName = (stopName || `Στάση #${sCode}`).replace(/^[⭐\s]+/, '');
    let sLat = parseFloat(lat);
    let sLng = parseFloat(lng);

    if (isNaN(sLat) || isNaN(sLng)) {
      try {
        const cached = JSON.parse(localStorage.getItem('OASA_STOP_COORDS_' + sCode) || 'null');
        if (cached && cached.lat && cached.lng) {
          sLat = parseFloat(cached.lat);
          sLng = parseFloat(cached.lng);
        }
      } catch (e) {}
    }

    modal.querySelector('#stop-action-title').innerText = sName;
    modal.querySelector('#stop-action-code').innerText = `Στάση #${sCode}`;

    // 1. Favorite button setup
    const favBtn = modal.querySelector('#stop-action-fav-btn');
    const favText = modal.querySelector('#stop-action-fav-text');
    const isFav = window.Favorites ? window.Favorites.isStopFav(sCode) : false;
    if (favText) {
      favText.innerText = isFav ? 'Αφαίρεση από τα Αγαπημένα' : 'Αποθήκευση στα Αγαπημένα';
    }
    if (favBtn) {
      favBtn.onclick = () => {
        if (window.Favorites) {
          window.Favorites.toggleStop(sCode, sName, !isNaN(sLat) ? sLat : null, !isNaN(sLng) ? sLng : null);
          this.triggerHaptic('success');
          if (window.PinnedTrips && typeof window.PinnedTrips.showToast === 'function') {
            window.PinnedTrips.showToast(window.Favorites.isStopFav(sCode) ? '⭐ Αποθηκεύτηκε στα Αγαπημένα' : 'Αφαιρέθηκε από τα Αγαπημένα');
          }
        }
        this.closeModal('stop-actions-modal');
      };
    }

    // 2. Map Focus button setup
    const mapBtn = modal.querySelector('#stop-action-map-btn');
    if (mapBtn) {
      mapBtn.onclick = () => {
        this.closeModal('stop-actions-modal');
        this.triggerHaptic('light');
        this.switchTab('search');
        if (!isNaN(sLat) && !isNaN(sLng) && this.mapManager) {
          this.mapManager.focusStop(sLat, sLng, sName);
        }
        const mapCard = document.getElementById('map-container');
        if (mapCard) mapCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
    }

    // 3. Arrivals button setup
    const arrBtn = modal.querySelector('#stop-action-arrivals-btn');
    if (arrBtn) {
      arrBtn.onclick = () => {
        this.closeModal('stop-actions-modal');
        this.triggerHaptic('light');
        this.selectStop(sCode, sName, !isNaN(sLat) ? sLat : null, !isNaN(sLng) ? sLng : null);
      };
    }

    modal.classList.add('open');
    this.updateBackButtonsVisibility();
  }

  setupStopLongPressListener() {
    let pressTimer = null;
    let longPressed = false;
    let startPoint = { x: 0, y: 0 };

    const clearPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    document.addEventListener('pointerdown', (e) => {
      // Don't trigger if user clicked an explicit button or input
      if (e.target.closest('button, input, select, a, .ticker-alarm-btn, .ticker-pin-btn')) {
        return;
      }
      const card = e.target.closest('.stop-interactive-card, [data-stop-code], .route-stop-item');
      if (!card) return;

      startPoint = { x: e.clientX, y: e.clientY };
      longPressed = false;

      clearPress();
      pressTimer = setTimeout(() => {
        longPressed = true;
        this.triggerHaptic('medium');
        const code = card.dataset.stopCode;
        const title = card.dataset.stopTitle || card.querySelector('div, h2, h3, span')?.innerText || 'Στάση';
        const lat = card.dataset.stopLat;
        const lng = card.dataset.stopLng;
        if (code) {
          this.openStopActionModal(code, title, lat, lng);
        }
      }, 480);
    }, { passive: true });

    document.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      if (Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y) > 12) {
        clearPress();
      }
    }, { passive: true });

    document.addEventListener('pointerup', () => {
      clearPress();
      if (longPressed) {
        setTimeout(() => { longPressed = false; }, 120);
      }
    }, { passive: true });

    document.addEventListener('pointercancel', () => {
      clearPress();
      longPressed = false;
    }, { passive: true });

    // Intercept click if long-press triggered
    document.addEventListener('click', (e) => {
      if (longPressed) {
        e.preventDefault();
        e.stopPropagation();
        longPressed = false;
      }
    }, true);
  }

}

document.addEventListener('DOMContentLoaded', () => {
  window.App = new AppController();
  window.App.init();
});
