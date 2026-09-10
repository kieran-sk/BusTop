/**
 * Interactive OpenStreetMap & Leaflet Map View of Stops Near Me
 * Displays all stops near user with name, lines, direction, and option to open expanded view.
 */

class MapManager {
  constructor(containerId = 'map-container') {
    this.containerId = containerId;
    this.map = null;
    this.stopsLayer = null;
    this.busLayer = null;
    this.routeLayer = null;
    this.userMarker = null;
    this.userLocation = null;
    this.isLoaded = false;
    this.moveDebounceTimer = null;
    this.stopMarkersMap = new Map();
  }

  async init() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (typeof L === 'undefined') {
      console.warn('Leaflet not loaded yet, waiting...');
      return;
    }

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    // Default to Athens center
    const defaultCenter = [37.9845, 23.7335];
    const initialCenter = (this.userLocation && !isNaN(this.userLocation.lat) && !isNaN(this.userLocation.lng)) 
      ? [this.userLocation.lat, this.userLocation.lng] 
      : defaultCenter;

    this.map = L.map(this.containerId, {
      center: initialCenter,
      zoom: 15,
      zoomControl: false
    });

    // Add zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // OpenStreetMap Tile Layer (Crisp, light mode)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    // Layer groups
    this.stopsLayer = L.layerGroup().addTo(this.map);
    this.busLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);

    if (this.userLocation && !isNaN(this.userLocation.lat) && !isNaN(this.userLocation.lng)) {
      this.setUserLocation(this.userLocation.lat, this.userLocation.lng);
    }

    // Dynamic stop discovery on zoom and pan
    this.map.on('moveend', () => {
      this.onViewportChanged();
    });

    this.isLoaded = true;

    // If nearby stops already exist in Search, render them now
    if (window.Search && window.Search.nearbyStops && window.Search.nearbyStops.length > 0) {
      this.renderNearbyStops(window.Search.nearbyStops);
    } else {
      this.onViewportChanged();
    }
  }

  invalidateSize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }

  setUserLocation(lat, lng) {
    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (isNaN(pLat) || isNaN(pLng)) return;

    this.userLocation = { lat: pLat, lng: pLng };
    if (!this.map) return;

    if (this.userMarker) {
      this.userMarker.setLatLng([pLat, pLng]);
    } else {
      const userIcon = L.divIcon({
        className: 'user-location-pulse-marker',
        html: `
          <div style="position: relative; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;">
            <span class="m3-pulse-dot" style="width: 22px; height: 22px; background: rgba(0, 90, 193, 0.25); position: absolute;"></span>
            <span style="width: 12px; height: 12px; border-radius: 50%; background: #005ac1; border: 2.5px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.3); z-index: 2;"></span>
          </div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      this.userMarker = L.marker([pLat, pLng], { icon: userIcon }).addTo(this.map);
      this.userMarker.bindTooltip('Η τοποθεσία σας', { direction: 'top', offset: [0, -10] });
    }
  }

  /**
   * Viewport-driven stop discovery: triggers when user zooms or pans the map
   */
  onViewportChanged() {
    if (!this.map) return;
    if (this.moveDebounceTimer) clearTimeout(this.moveDebounceTimer);

    this.moveDebounceTimer = setTimeout(async () => {
      const zoom = this.map.getZoom();
      if (zoom < 13) return;

      const center = this.map.getCenter();
      if (window.Search && typeof window.Search.findNearbyStopsForCoords === 'function') {
        window.Search.findNearbyStopsForCoords(center.lat, center.lng);
      }
    }, 450);
  }

  /**
   * Clear and render stops discovered around user or center
   */
  renderNearbyStops(stops = [], shouldFit = false) {
    if (!this.map || !this.stopsLayer) return;
    this.stopsLayer.clearLayers();
    this.stopMarkersMap.clear();

    if (!Array.isArray(stops) || stops.length === 0) return;

    stops.forEach(s => {
      const sCode = String(s.StopCode);
      const marker = this.createStopMarker(s);
      if (marker) {
        marker.addTo(this.stopsLayer);
        this.stopMarkersMap.set(sCode, marker);
      }
    });

    // Also fetch live buses traveling around nearby stops
    this.loadBusesForNearbyStops(stops);

    if (shouldFit) {
      if (this.userLocation) {
        this.fitAreaAroundUser(this.userLocation.lat, this.userLocation.lng, stops, 350);
      } else {
        const bounds = L.latLngBounds();
        stops.forEach(s => {
          const lat = parseFloat(s.StopLat);
          const lng = parseFloat(s.StopLng);
          if (!isNaN(lat) && !isNaN(lng)) bounds.extend([lat, lng]);
        });
        if (bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
        }
      }
    }
  }

  /**
   * Fetch and display live moving buses for lines serving nearby stops
   */
  async loadBusesForNearbyStops(stops = []) {
    if (!this.map || !this.busLayer) return;
    try {
      const linesToQuery = new Set();
      for (const s of stops.slice(0, 10)) {
        if (Array.isArray(s.serving_lines)) {
          for (const l of s.serving_lines) {
            if (l.line_id) linesToQuery.add(l.line_id);
            if (linesToQuery.size >= 6) break;
          }
        }
        if (linesToQuery.size >= 6) break;
      }

      if (linesToQuery.size === 0) return;

      const promises = Array.from(linesToQuery).map(async (lid) => {
        try {
          const res = await window.API.resolveLine(lid);
          if (res && res.line_code) {
            const routes = await window.API.getRoutes(res.line_code);
            if (Array.isArray(routes) && routes.length > 0) {
              const rCode = routes[0].RouteCode;
              const buses = await window.API.getLiveBuses(rCode);
              if (Array.isArray(buses)) {
                return buses.map(b => ({ ...b, line_id: lid }));
              }
            }
          }
        } catch (e) {}
        return [];
      });

      const resList = await Promise.all(promises);
      const allBuses = resList.flat();
      if (allBuses.length > 0) {
        this.updateBuses(allBuses);
      }
    } catch (err) {
      console.warn('Failed to load live buses around user:', err);
    }
  }

  /**
   * Render stops discovered within the viewport smoothly
   */
  renderViewportStops(stops = []) {
    if (!this.map || !this.stopsLayer) return;

    stops.forEach(s => {
      const sCode = String(s.StopCode);
      if (this.stopMarkersMap.has(sCode)) return; // Already rendered

      const marker = this.createStopMarker(s);
      if (marker) {
        marker.addTo(this.stopsLayer);
        this.stopMarkersMap.set(sCode, marker);
      }
    });

    // Prune markers that are way outside the expanded viewport
    if (this.stopMarkersMap.size > 80) {
      const currentBounds = this.map.getBounds().pad(0.5);
      for (const [code, marker] of this.stopMarkersMap.entries()) {
        const latLng = marker.getLatLng();
        if (!currentBounds.contains(latLng)) {
          this.stopsLayer.removeLayer(marker);
          this.stopMarkersMap.delete(code);
        }
      }
    }
  }

  /**
   * Helper to create an interactive bus stop pin marker with small name below bubble
   */
  createStopMarker(s) {
    const lat = parseFloat(s.StopLat);
    const lng = parseFloat(s.StopLng);
    if (isNaN(lat) || isNaN(lng)) return null;

    const isFav = window.Favorites && window.Favorites.isStopFav(s.StopCode);
    const stopTitle = s.StopDescr || `Στάση #${s.StopCode}`;
    const safeTitle = stopTitle.replace(/'/g, "\\'");

    // Custom Bus Stop Pin Icon - Distinct station pole/shelter design (NOT confusing vehicle)
    const pinColor = isFav ? '#d97706' : '#005ac1';
    const pinIcon = L.divIcon({
      className: 'map-bus-stop-icon',
      html: `
        <div style="display: flex; flex-direction: column; align-items: center; width: 120px; margin-left: -48px; pointer-events: auto; cursor: pointer;">
          <div style="background: ${pinColor}; width: 24px; height: 24px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.28); border: 2px solid #ffffff;">
            ${isFav ? `
              <span style="transform: rotate(45deg); font-size: 11px; line-height: 1;">⭐</span>
            ` : `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff" style="transform: rotate(45deg);">
                <circle cx="12" cy="12" r="8" stroke="#ffffff" stroke-width="2" fill="none"/>
                <rect x="11" y="4" width="2" height="16" fill="#ffffff"/>
                <rect x="7" y="7" width="10" height="4" rx="1" fill="#ffffff"/>
              </svg>
            `}
          </div>
          <div style="margin-top: 3px; font-size: 0.65rem; font-weight: 800; color: #0f172a; background: ${isFav ? '#fef9c3' : 'rgba(255,255,255,0.95)'}; padding: 1px 6px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 115px; border: 1px solid ${isFav ? '#fde047' : 'rgba(0,0,0,0.1)'}; text-align: center; line-height: 1.25;">
            ${isFav ? '⭐ ' : ''}${stopTitle}
          </div>
        </div>
      `,
      iconSize: [24, 40],
      iconAnchor: [12, 24],
      popupAnchor: [0, -22]
    });

    const marker = L.marker([lat, lng], { icon: pinIcon });

    // Initial Popup Content in Greek
    let linesHtml = '<div style="font-size: 0.75rem; color: #64748b;">Φόρτωση διερχόμενων γραμμών...</div>';
    if (Array.isArray(s.serving_lines) && s.serving_lines.length > 0) {
      linesHtml = s.serving_lines.map(l => `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px dashed #e2e8f0; font-size: 0.75rem;">
          <span style="font-weight: 800; color: #005ac1; background: #e0f2fe; padding: 1px 5px; border-radius: 4px;">${l.line_id}</span>
          <span style="flex: 1; margin: 0 4px; color: #0f172a; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">προς ${l.last_stop}</span>
          <span style="font-size: 0.65rem; color: #64748b;">${l.direction || ''}</span>
        </div>
      `).join('');
    }

    const popupContent = `
      <div style="font-family: 'Inter', 'Noto Sans', sans-serif; min-width: 210px; max-width: 260px; padding: 2px;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #0f172a; margin-bottom: 2px; line-height: 1.25;">
          ${stopTitle}
        </div>
        <div style="font-size: 0.72rem; color: #64748b; margin-bottom: 6px;">
          ${s.StopStreet ? s.StopStreet + ' • ' : ''}Στάση #${s.StopCode}
        </div>
        <div style="font-size: 0.7rem; font-weight: 800; color: #005ac1; text-transform: uppercase; margin-bottom: 3px; letter-spacing: 0.04em;">
          Γραμμές &amp; Κατευθύνσεις
        </div>
        <div id="popup-lines-${s.StopCode}" style="max-height: 110px; overflow-y: auto; margin-bottom: 8px;">
          ${linesHtml}
        </div>
        <button class="m3-btn m3-btn-primary" style="width: 100%; padding: 0.45rem 0.8rem; font-size: 0.85rem; border-radius: 9999px;" onclick="window.App.selectStop('${s.StopCode}', '${safeTitle}', ${lat}, ${lng});">
          Προβολή Αφίξεων Στάσης
        </button>
      </div>
    `;

    marker.bindPopup(popupContent);

    // Dynamically fetch lines when user taps the popup if not pre-populated
    marker.on('popupopen', async () => {
      const containerEl = document.getElementById(`popup-lines-${s.StopCode}`);
      if (!containerEl) return;

      try {
        const routes = await window.API.getStopRoutes(s.StopCode);
        if (containerEl && Array.isArray(routes)) {
          const linesMap = new Map();
          for (const r of routes) {
            const lid = r.LineID;
            if (!lid) continue;
            let lastStop = r.cleanDestination;
            if (!lastStop) {
              let raw = (r.RouteDescr || r.LineDescr || '').trim();
              raw = raw.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ').replace(/^[*+\s]+/, '');
              const parts = raw.split(/[-–—/]/).map(x => x.trim()).filter(Boolean);
              lastStop = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || raw);
              lastStop = lastStop.replace(/\bΣΤ\.?\s*/g, 'ΣΤ. ').replace(/\s+/g, ' ').trim();
            }
            const isCirc = /κυκλικη|circular/i.test(r.RouteDescr || '') || /κυκλικη|circular/i.test(r.LineDescr || '') || r.directionLabel === 'Κυκλική';
            const direction = isCirc ? 'Κυκλική' : (r.directionLabel || (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση'));

            if (!linesMap.has(lid)) {
              linesMap.set(lid, {
                line_id: lid,
                last_stop: lastStop,
                direction
              });
            }
          }
          const lines = Array.from(linesMap.values());
          if (lines.length > 0) {
            containerEl.innerHTML = lines.map(l => `
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px dashed #e2e8f0; font-size: 0.8rem;">
                <span style="font-weight: 800; color: #005ac1; background: #e0f2fe; padding: 1px 6px; border-radius: 4px;">${l.line_id}</span>
                <span style="flex: 1; margin: 0 4px; color: #0f172a; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">προς ${l.last_stop}</span>
                <span style="font-size: 0.7rem; color: #64748b;">${l.direction}</span>
              </div>
            `).join('');
          } else {
            containerEl.innerHTML = '<div style="font-size: 0.75rem; color: #64748b;">Δεν βρέθηκαν διερχόμενες γραμμές.</div>';
          }
        }
      } catch (e) {
        console.warn('Failed to load popup lines:', e);
      }
    });

    return marker;
  }

  /**
   * Fit map viewport to a comfortable area around the user (~500m walking radius + nearby stops)
   * @param {number} lat - User latitude
   * @param {number} lng - User longitude
   * @param {Array} [nearbyStops] - Optional list of nearby stops to include in bounds
   * @param {number} [radiusMeters=500] - Radius around user in meters
   */
  fitAreaAroundUser(lat, lng, nearbyStops = [], radiusMeters = 350) {
    if (!this.map) return;
    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (isNaN(pLat) || isNaN(pLng)) return;

    this.map.invalidateSize();
    this.setUserLocation(pLat, pLng);

    if (this.userMarker) {
      if (typeof this.userMarker.setZIndexOffset === 'function') {
        this.userMarker.setZIndexOffset(1000);
      }
      this.userMarker.openTooltip();
      setTimeout(() => {
        if (this.userMarker) this.userMarker.closeTooltip();
      }, 3500);
    }

    // Calculate bounding box for radiusMeters around user
    const deltaLat = radiusMeters / 111320;
    const latRad = (pLat * Math.PI) / 180;
    const deltaLng = radiusMeters / (111320 * Math.max(0.1, Math.cos(latRad)));

    const bounds = L.latLngBounds(
      [pLat - deltaLat, pLng - deltaLng],
      [pLat + deltaLat, pLng + deltaLng]
    );

    // If nearby stops are available, include any within walkable reach (~850m)
    if (Array.isArray(nearbyStops) && nearbyStops.length > 0) {
      nearbyStops.forEach(s => {
        const sLat = parseFloat(s.StopLat);
        const sLng = parseFloat(s.StopLng);
        if (!isNaN(sLat) && !isNaN(sLng)) {
          const dLatM = Math.abs(sLat - pLat) * 111320;
          const dLngM = Math.abs(sLng - pLng) * 111320 * Math.cos(latRad);
          const dist = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
          if (dist <= 850) {
            bounds.extend([sLat, sLng]);
          }
        }
      });
    }

    const doFit = () => {
      if (!this.map) return;
      this.map.invalidateSize();
      if (typeof this.map.flyToBounds === 'function') {
        this.map.flyToBounds(bounds, { padding: [35, 35], maxZoom: 17, duration: 0.8 });
      } else {
        this.map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17, animate: true });
      }
    };

    doFit();
    // Safety timeout in case DOM tab switch animation was finishing
    setTimeout(doFit, 150);
  }

  focusStop(lat, lng, stopName = '') {
    if (!this.map) return;
    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (isNaN(pLat) || isNaN(pLng)) return;

    this.map.setView([pLat, pLng], 16, { animate: true });
  }

  renderPolyline(coordinates = []) {
    if (!this.map || !this.routeLayer) return;
    this.routeLayer.clearLayers();

    if (!Array.isArray(coordinates) || coordinates.length === 0) return;

    const latLngs = coordinates.map(c => [parseFloat(c.RouteDetailsLat), parseFloat(c.RouteDetailsLng)]);
    const line = L.polyline(latLngs, {
      color: '#005ac1',
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.routeLayer);

    this.map.fitBounds(line.getBounds(), { padding: [20, 20] });
  }

  renderRouteStops(stops = []) {
    this.renderNearbyStops(stops, false);
  }

  /**
   * Redesigned Live Bus Vehicle Marker - Highly distinct glowing 3D capsule with pulse beacon
   */
  updateBuses(buses = [], defaultLineId = 'BUS') {
    if (!this.map || !this.busLayer) return;
    this.busLayer.clearLayers();

    buses.forEach(b => {
      const lat = parseFloat(b.CS_LAT);
      const lng = parseFloat(b.CS_LNG);
      if (isNaN(lat) || isNaN(lng)) return;

      const lineId = b.line_id || b.LINE_ID || defaultLineId;
      const vehNo = b.VEH_NO || '';

      const busIcon = L.divIcon({
        className: 'map-live-bus-icon',
        html: `
          <div style="display: flex; flex-direction: column; align-items: center; pointer-events: auto; cursor: pointer; transform: translateZ(0);">
            <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: #ffffff; padding: 2.5px 8px; border-radius: 9999px; font-weight: 900; font-size: 0.78rem; box-shadow: 0 3px 8px rgba(0,0,0,0.35); border: 2px solid #ffffff; display: flex; align-items: center; gap: 4px; letter-spacing: 0.02em;">
              <span class="m3-pulse-dot" style="background: #ffffff; width: 6px; height: 6px; box-shadow: 0 0 5px #ffffff;"></span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg>
              <span>${lineId}</span>
            </div>
            ${vehNo ? `
              <div style="margin-top: 2px; font-size: 0.62rem; font-weight: 800; color: #166534; background: rgba(240,253,244,0.96); padding: 0 4px; border-radius: 3px; border: 1px solid #bbf7d0; box-shadow: 0 1px 2px rgba(0,0,0,0.15);">
                #${vehNo}
              </div>
            ` : ''}
          </div>
        `,
        iconSize: [56, 36],
        iconAnchor: [28, 18]
      });

      L.marker([lat, lng], { icon: busIcon }).addTo(this.busLayer)
        .bindTooltip(`🚍 Λεωφορείο ${lineId} (Όχημα #${vehNo})`, { direction: 'top' });
    });
  }

  clearAll() {
    if (this.routeLayer) this.routeLayer.clearLayers();
    if (this.busLayer) this.busLayer.clearLayers();
  }
}

window.MapManager = MapManager;
window.GoogleMapManager = MapManager;
