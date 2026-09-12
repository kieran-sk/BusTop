/**
 * Google Maps Platform Integration for Athens OASA Bus Suite
 * Follows Google Maps Platform best practices:
 * - AdvancedMarkerElement & PinElement
 * - solutionChannel: 'GMP_guides_agentskills_v1'
 * - internalUsageAttributionIds: ['gmp_git_agentskills_v1']
 * - DEMO_MAP_ID support for zero-cost prototyping
 */

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
  }

  async init() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Check if Leaflet is loaded
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
    const initialCenter = this.userLocation ? [this.userLocation.lat, this.userLocation.lng] : defaultCenter;

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

    if (this.userLocation) {
      this.setUserLocation(this.userLocation.lat, this.userLocation.lng);
    }

    this.isLoaded = true;

    // If nearby stops already exist in Search, render them now
    if (window.Search && window.Search.nearbyStops && window.Search.nearbyStops.length > 0) {
      this.renderNearbyStops(window.Search.nearbyStops);
    }
  }

  invalidateSize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }

  setUserLocation(lat, lng) {
    this.userLocation = { lat, lng };
    if (!this.map) return;

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
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

      this.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(this.map);
      this.userMarker.bindTooltip('Your Location', { direction: 'top', offset: [0, -10] });
    }
  }

  /**
   * Plot all stops near the user on the map with custom pins & expanded view popup
   */
  renderNearbyStops(stops = []) {
    if (!this.map || !this.stopsLayer) return;
    this.stopsLayer.clearLayers();

    if (!Array.isArray(stops) || stops.length === 0) return;

    const bounds = L.latLngBounds();
    if (this.userLocation) {
      bounds.extend([this.userLocation.lat, this.userLocation.lng]);
    }

    stops.forEach((s) => {
      const lat = parseFloat(s.StopLat);
      const lng = parseFloat(s.StopLng);
      if (isNaN(lat) || isNaN(lng)) return;

      bounds.extend([lat, lng]);

      const stopTitle = s.StopDescr || `Στάση #${s.StopCode}`;
      const safeTitle = stopTitle.replace(/'/g, "\\'");

      // Custom Bus Stop Pin Icon
      const pinIcon = L.divIcon({
        className: 'map-bus-stop-icon',
        html: `
          <div style="background: #005ac1; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.25); border: 2px solid #ffffff; cursor: pointer;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" style="transform: rotate(45deg);"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -32]
      });

      const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(this.stopsLayer);

      // Popup Content: Name, lines & direction, and option to open expanded view
      let linesHtml = '<div style="font-size: 0.8rem; color: #64748b;">Loading serving lines...</div>';
      if (Array.isArray(s.serving_lines) && s.serving_lines.length > 0) {
        linesHtml = s.serving_lines.map(l => `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px dashed #e2e8f0; font-size: 0.8rem;">
            <span style="font-weight: 800; color: #005ac1; background: #e0f2fe; padding: 1px 6px; border-radius: 4px;">${l.line_id}</span>
            <span style="flex: 1; margin: 0 4px; color: #0f172a; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">to ${l.last_stop}</span>
            <span style="font-size: 0.7rem; color: #64748b;">${l.direction || ''}</span>
          </div>
        `).join('');
      }

      const popupContent = `
        <div style="font-family: 'Inter', 'Noto Sans', sans-serif; min-width: 230px; max-width: 280px; padding: 4px;">
          <div style="font-size: 1.05rem; font-weight: 900; color: #0f172a; margin-bottom: 2px; line-height: 1.25;">
            ${stopTitle}
          </div>
          <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 8px;">
            ${s.StopStreet ? s.StopStreet + ' • ' : ''}Στάση #${s.StopCode}
          </div>
          <div style="font-size: 0.75rem; font-weight: 800; color: #005ac1; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.04em;">
            Γραμμές &amp; Κατευθύνσεις
          </div>
          <div id="popup-lines-${s.StopCode}" style="max-height: 120px; overflow-y: auto; margin-bottom: 10px;">
            ${linesHtml}
          </div>
          <button class="m3-btn m3-btn-primary" style="width: 100%; padding: 0.45rem 0.8rem; font-size: 0.85rem; border-radius: 9999px;" onclick="window.App.selectStop('${s.StopCode}', '${safeTitle}', ${lat}, ${lng});">
            Προβολή Αναχωρήσεων Στάσης
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);

      // Dynamically fetch lines if not present
      if (!s.serving_lines || s.serving_lines.length === 0) {
        marker.on('popupopen', async () => {
          try {
            const routes = await window.API.getStopRoutes(s.StopCode);
            const containerEl = document.getElementById(`popup-lines-${s.StopCode}`);
            if (containerEl && Array.isArray(routes)) {
              const linesMap = new Map();
              for (const r of routes) {
                const lid = r.LineID;
                let lastStop = r.cleanDestination;
                if (!lastStop) {
                  let raw = (r.RouteDescr || r.LineDescr || '').trim();
                  raw = raw.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ').replace(/^[*+\s]+/, '');
                  const parts = raw.split(/[-–—/]/).map(x => x.trim()).filter(Boolean);
                  lastStop = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || raw);
                  lastStop = lastStop.replace(/\bΣΤ\.?\s*/g, 'ΣΤ. ').replace(/\s+/g, ' ').trim();
                }
                const isCirc = /κυκλικη|circular/i.test(r.RouteDescr || '') || /κυκλικη|circular/i.test(r.LineDescr || '') || r.directionLabel === 'Κυκλική';
                const dirLabel = isCirc ? 'Κυκλική' : (r.directionLabel || (r.RouteType === '2' ? 'Επιστροφή' : 'Μετάβαση'));
                if (!linesMap.has(lid)) {
                  linesMap.set(lid, {
                    line_id: lid,
                    last_stop: lastStop,
                    direction: dirLabel
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
      }
    });

    if (stops.length > 0 && bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
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
    this.renderNearbyStops(stops);
  }

  updateBuses(buses = [], lineId = 'BUS') {
    if (!this.map || !this.busLayer) return;
    this.busLayer.clearLayers();

    buses.forEach(b => {
      const lat = parseFloat(b.CS_LAT);
      const lng = parseFloat(b.CS_LNG);
      if (isNaN(lat) || isNaN(lng)) return;

      const busIcon = L.divIcon({
        className: 'map-live-bus-icon',
        html: `
          <div style="background: #16a34a; color: #ffffff; padding: 2px 7px; border-radius: 9999px; font-weight: 800; font-size: 0.75rem; box-shadow: 0 2px 5px rgba(0,0,0,0.3); border: 2px solid #ffffff; display: flex; align-items: center; gap: 4px;">
            <span class="m3-pulse-dot" style="background: #ffffff; width: 6px; height: 6px;"></span>
            ${lineId}
          </div>
        `,
        iconSize: [48, 24],
        iconAnchor: [24, 12]
      });

      L.marker([lat, lng], { icon: busIcon }).addTo(this.busLayer)
        .bindTooltip(`Live Bus #${b.VEH_NO || ''}`, { direction: 'top' });
    });
  }

  clearAll() {
    if (this.routeLayer) this.routeLayer.clearLayers();
    if (this.busLayer) this.busLayer.clearLayers();
  }
}

window.MapManager = MapManager;
window.GoogleMapManager = MapManager; // Backward compatibility
