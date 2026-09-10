/**
 * Athens Metro & Tram Manager (ΣΤΑΣΥ)
 * Interactive Leaflet Map with GeoJSON tracks from data.gov.gr & City of Athens,
 * Station progression, headway timetables, and intermodal bus links.
 */

class MetroManager {
  constructor() {
    this.networkData = null;
    this.map = null;
    this.trackLayer = null;
    this.stationMarkerLayer = null;
    this.selectedLine = 'ALL';
    this.searchQuery = '';
    this.sortMode = 'line'; // 'line' or 'nearby'
    this.currentStation = null;
    this.userLocation = null;
    this.isMapInitialized = false;
    this.stationMarkers = new Map();
    this.departuresTickerTimer = null;
  }

  async init() {
    console.log('[MetroManager] Initializing Athens Metro & Tram System in Greek...');
    await this.loadNetwork();
    this.renderLinePills();
    this.renderStationsDirectory();
    this.setupListeners();
    this.startDeparturesTicker();
  }

  startDeparturesTicker() {
    if (this.departuresTickerTimer) clearInterval(this.departuresTickerTimer);
    this.departuresTickerTimer = setInterval(() => {
      const metroSec = document.getElementById('section-metro');
      if (metroSec && metroSec.style.display !== 'none') {
        this.renderStationsDirectory();
      }
    }, 30000);
  }

  async loadNetwork() {
    try {
      const res = await fetch('/api/metro/network');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.networkData = await res.json();
    } catch (e) {
      console.error('[MetroManager] Failed to load metro network:', e);
    }
  }

  initMap() {
    if (this.isMapInitialized || !this.networkData) return;
    const container = document.getElementById('metro-map-container');
    if (!container) return;

    // Center on Athens center
    this.map = L.map('metro-map-container', {
      center: [37.9838, 23.7275],
      zoom: 12,
      zoomControl: true
    });

    // Standard OpenStreetMap tiles (No API key required, no watermarks)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.trackLayer = L.featureGroup().addTo(this.map);
    this.stationMarkerLayer = L.featureGroup().addTo(this.map);

    this.renderMapElements();
    this.isMapInitialized = true;
  }

  onTabActivated() {
    if (!this.isMapInitialized) {
      this.initMap();
    } else if (this.map) {
      setTimeout(() => {
        this.map.invalidateSize();
      }, 150);
    }
  }

  setUserLocation(lat, lng) {
    this.userLocation = { lat, lng };
    this.renderStationsDirectory();
  }

  renderMapElements() {
    if (!this.map || !this.networkData) return;

    this.trackLayer.clearLayers();
    this.stationMarkerLayer.clearLayers();
    this.stationMarkers.clear();

    const features = this.networkData.features || [];

    // 1. Render Tracks
    features.filter(f => f.properties.kind === 'track').forEach(f => {
      const line = f.properties.line;
      if (this.selectedLine !== 'ALL' && this.selectedLine !== line) return;

      const poly = L.geoJSON(f, {
        style: {
          color: f.properties.color || '#005ac1',
          weight: f.properties.weight || 5,
          opacity: f.properties.opacity || 0.9,
          dashArray: f.properties.dashArray || null,
          lineJoin: 'round',
          lineCap: 'round'
        }
      });
      poly.bindTooltip(`<strong>${f.properties.line_name}</strong>`, { sticky: true });
      this.trackLayer.addLayer(poly);
    });

    // 2. Render Stations
    features.filter(f => f.properties.kind === 'station').forEach(f => {
      const props = f.properties;
      const isVisible = this.selectedLine === 'ALL' || (props.lines && props.lines.includes(this.selectedLine));
      if (!isVisible) return;

      const [lng, lat] = f.geometry.coordinates;
      const isInterchange = props.is_interchange;
      const primaryColor = props.color || '#005ac1';

      // Custom SVG / HTML divIcon
      const markerHtml = `
        <div class="metro-map-pin ${isInterchange ? 'interchange' : ''}" style="border-color: ${primaryColor};">
          <div class="metro-pin-inner" style="background: ${primaryColor};"></div>
        </div>
      `;

      const icon = L.divIcon({
        html: markerHtml,
        className: 'metro-div-icon',
        iconSize: isInterchange ? [26, 26] : [20, 20],
        iconAnchor: isInterchange ? [13, 13] : [10, 10]
      });

      const marker = L.marker([lat, lng], { icon });

      // Click to inspect station
      marker.on('click', () => {
        this.openStationModal(props.id);
      });

      // Tooltip in Greek
      marker.bindTooltip(`
        <div style="font-family: inherit; font-size: 0.85rem; padding: 2px 4px;">
          <strong>${props.name}</strong>
          <div style="font-size: 0.75rem; color: #555; margin-top: 2px;">
            ${props.lines.map(l => `<span class="badge-${l.toLowerCase()}">${l}</span>`).join(' ')}
          </div>
        </div>
      `, { direction: 'top', offset: [0, -10] });

      this.stationMarkerLayer.addLayer(marker);
      this.stationMarkers.set(props.id, marker);
    });
  }

  renderLinePills() {
    const container = document.getElementById('metro-line-pills');
    if (!container || !this.networkData) return;

    const lines = [
      { id: 'ALL', name: 'Όλες οι Γραμμές', color: 'var(--md-sys-color-primary)', bg: 'var(--md-sys-color-primary-container)' },
      { id: 'M1', name: 'Γραμμή 1 (Πράσινη)', color: '#008751', bg: '#e6f4ea' },
      { id: 'M2', name: 'Γραμμή 2 (Κόκκινη)', color: '#DA291C', bg: '#fce8e6' },
      { id: 'M3', name: 'Γραμμή 3 (Μπλε)', color: '#0066B2', bg: '#e8f0fe' },
      { id: 'TRAM', name: 'Τραμ (T6/T7)', color: '#b37400', bg: '#fef7e0' }
    ];

    container.innerHTML = lines.map(l => `
      <button class="m3-filter-chip ${this.selectedLine === l.id ? 'active' : ''}" 
              data-line="${l.id}" 
              style="${this.selectedLine === l.id ? `background: ${l.bg}; color: ${l.color}; border-color: ${l.color}; font-weight: 800;` : ''}">
        <span class="m3-filter-chip-dot" style="background: ${l.color};"></span>
        ${l.name}
      </button>
    `).join('');

    container.querySelectorAll('.m3-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedLine = btn.dataset.line;
        this.renderLinePills();
        this.renderMapElements();
        this.renderStationsDirectory();
      });
    });
  }

  setupListeners() {
    const searchInput = document.getElementById('metro-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.renderStationsDirectory();
      });
    }
  }

  normalizeGreek(str) {
    if (!str) return '';
    return str.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ά/g, 'α').replace(/έ/g, 'ε').replace(/ή/g, 'η')
      .replace(/ί/g, 'ι').replace(/ό/g, 'ο').replace(/ύ/g, 'υ').replace(/ώ/g, 'ω');
  }

  focusStationOnMap(stationId, lng, lat) {
    if (!this.map) {
      this.initMap();
    }
    if (this.map) {
      this.map.setView([lat, lng], 15, { animate: true });
      const marker = this.stationMarkers.get(stationId);
      if (marker) {
        marker.openTooltip();
      }
      const mapContainer = document.getElementById('metro-map-container');
      if (mapContainer) {
        mapContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  setSortMode(mode) {
    this.sortMode = mode;
    this.renderStationsDirectory();
  }

  getLineName(lineKey) {
    if (lineKey === 'M1') return 'Γραμμή 1 (ΗΣΑΠ)';
    if (lineKey === 'M2') return 'Γραμμή 2 (Κόκκινη)';
    if (lineKey === 'M3') return 'Γραμμή 3 (Μπλε)';
    if (lineKey === 'TRAM') return 'Τραμ (T6 / T7)';
    return 'Δίκτυο Σταθερών Συγκοινωνιών';
  }

  getLineColor(lineKey) {
    if (lineKey === 'M1') return '#008751';
    if (lineKey === 'M2') return '#DA291C';
    if (lineKey === 'M3') return '#0066B2';
    if (lineKey === 'TRAM') return '#b37400';
    return '#005ac1';
  }

  getStationDepartures(p) {
    if (p.timetable && Array.isArray(p.timetable.departures) && p.timetable.departures.length > 0) {
      const now = new Date();
      return p.timetable.departures.map(d => {
        const time = new Date(now.getTime() + d.estimated_in_minutes * 60000).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
        return {
          ...d,
          time
        };
      });
    }

    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const lineId = p.primary_line || (p.lines && p.lines[0]) || 'M1';
    const headway = lineId === 'TRAM' ? 12 : (lineId === 'M1' ? 6 : 4.5);
    const offset1 = (hours * 60 + minutes) % headway;
    const mins1 = Math.max(1, Math.round(headway - offset1));
    const time1 = new Date(now.getTime() + mins1 * 60000).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });

    return [
      { direction: 'Επόμενος συρμός', estimated_in_minutes: mins1, time: time1, headway_minutes: headway }
    ];
  }

  renderStationsDirectory() {
    const container = document.getElementById('metro-stations-list');
    if (!container || !this.networkData) return;

    const features = this.networkData.features || [];
    const stationFeatures = features.filter(f => f.properties.kind === 'station');

    // Filter by line and search query
    const normQuery = this.normalizeGreek(this.searchQuery);
    const filtered = stationFeatures.filter(f => {
      const p = f.properties;
      const matchesLine = this.selectedLine === 'ALL' || (p.lines && p.lines.includes(this.selectedLine));
      if (!matchesLine) return false;
      if (!normQuery) return true;
      return this.normalizeGreek(p.name).includes(normQuery) ||
             (p.interchanges && p.interchanges.some(ic => this.normalizeGreek(ic).includes(normQuery)));
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--md-sys-color-outline);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 0.5rem; opacity: 0.6;">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <div style="font-size: 0.95rem; font-weight: 700;">Δεν βρέθηκαν σταθμοί</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Δοκιμάστε διαφορετική αναζήτηση ή επιλέξτε «Όλες οι Γραμμές».</div>
        </div>
      `;
      return;
    }

    // Top Controls Bar: Count, Info & Organization Sort Mode
    const controlsHtml = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; padding: 0 0.25rem;">
        <div>
          <span style="font-size: 0.88rem; font-weight: 900; color: #0f172a;">
            ${this.selectedLine === 'ALL' ? 'Όλοι οι Σταθμοί' : this.getLineName(this.selectedLine)} (${filtered.length})
          </span>
          <div style="font-size: 0.75rem; color: #64748b;">Προγραμματισμένες αφίξεις &amp; συχνότητες ανά σταθμό</div>
        </div>
        <div style="display: flex; gap: 0.4rem;">
          <button class="m3-filter-chip ${this.sortMode === 'line' ? 'active' : ''}" onclick="window.Metro.setSortMode('line')" style="font-size: 0.75rem; padding: 4px 10px;">
            🛣️ Σειρά Διαδρομής
          </button>
          <button class="m3-filter-chip ${this.sortMode === 'nearby' ? 'active' : ''}" onclick="window.Metro.setSortMode('nearby')" style="font-size: 0.75rem; padding: 4px 10px;">
            📍 Κοντινότεροι
          </button>
        </div>
      </div>
    `;

    // Helper to render an individual station card with live scheduled arrivals
    const renderStationCard = (f, index) => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const primaryLine = p.primary_line || (p.lines && p.lines[0]) || 'M1';
      const lineColor = p.color || this.getLineColor(primaryLine);

      const lineBadges = (p.lines || [primaryLine]).map(l => {
        let bg = '#0066B2', fg = '#fff', label = l;
        if (l === 'M1') { bg = '#008751'; label = 'Γραμμή 1'; }
        else if (l === 'M2') { bg = '#DA291C'; label = 'Γραμμή 2'; }
        else if (l === 'M3') { bg = '#0066B2'; label = 'Γραμμή 3'; }
        else if (l === 'TRAM') { bg = '#FFB81C'; fg = '#000'; label = 'Τραμ'; }
        return `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; background: ${bg}; color: ${fg}; font-size: 0.7rem; font-weight: 800;">${label}</span>`;
      }).join(' ');

      const interchangeBadges = (p.interchanges || []).map(ic => 
        `<span style="padding: 2px 6px; border-radius: 4px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); font-size: 0.68rem; font-weight: 600;">🔄 ${ic}</span>`
      ).join(' ');

      // Distance from user
      let distHtml = '';
      if (this.userLocation) {
        const dLat = (lat - this.userLocation.lat) * 111139;
        const avgLat = ((lat + this.userLocation.lat) / 2) * Math.PI / 180;
        const dLng = (lng - this.userLocation.lng) * 111139 * Math.cos(avgLat);
        const distMeters = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
        const walkMins = Math.ceil(distMeters / 75) + 2;
        distHtml = `
          <div style="display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #64748b; margin-top: 4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>${distMeters > 1000 ? (distMeters / 1000).toFixed(1) + ' χλμ.' : distMeters + ' μ.'}</span>
            <span>• ~${walkMins}λ. με τα πόδια</span>
          </div>
        `;
      }

      // Scheduled Arrivals calculation
      const departures = this.getStationDepartures(p);

      const departuresHtml = departures.length > 0 ? `
        <div style="margin-top: 0.65rem; padding: 0.55rem 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
          <div style="font-size: 0.68rem; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 0.4rem; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span class="m3-pulse-dot" style="background: #16a34a; width: 6px; height: 6px;"></span>
              <span>Επόμενες Αφίξεις Συρμών (O2 Hub)</span>
            </div>
            ${p.timetable && p.timetable.current_headway_minutes ? `<span style="font-size: 0.65rem; color: #64748b;">ανά ~${p.timetable.current_headway_minutes}'</span>` : ''}
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.35rem;">
            ${departures.map(d => `
              <div style="display: flex; align-items: center; justify-content: space-between; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.4rem 0.65rem; font-size: 0.8rem;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                  <span style="color: ${lineColor}; font-weight: 900; font-size: 0.85rem;">➔</span>
                  <span style="font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${d.direction}</span>
                  ${d.isAirport || d.badge ? `<span class="m3-badge" style="background: #e0f2fe; color: #005ac1; font-size: 0.62rem; padding: 1px 4px;">✈️ Αεροδρόμιο</span>` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                  <span style="font-family: 'Roboto Mono', monospace; font-weight: 800; color: #005ac1; font-size: 0.85rem;">${d.time}</span>
                  <span class="m3-badge m3-badge-live" style="font-size: 0.68rem; padding: 1px 6px;">σε ~${d.estimated_in_minutes || d.mins}'</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      return `
        <div class="metro-station-card" style="border-left: 4.5px solid ${lineColor}; cursor: pointer; padding: 1rem; margin-bottom: 0.75rem; background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; border-left: 4.5px solid ${lineColor};" onclick="window.Metro.openStationModal('${p.id}')">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border-radius: 50%; background: ${lineColor}; color: #ffffff; font-size: 0.72rem; font-weight: 900; flex-shrink: 0; padding: 0 4px;">
                  ${p.order || (index + 1)}
                </span>
                <h4 style="font-size: 1.1rem; font-weight: 900; color: #0f172a; margin: 0; line-height: 1.25;">
                  ${p.name}
                </h4>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; margin-left: 32px;">
                ${lineBadges}
                ${interchangeBadges}
              </div>
              <div style="margin-left: 32px;">
                ${distHtml}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.35rem;" onclick="event.stopPropagation();">
              <button class="m3-btn m3-btn-tonal" style="padding: 4px 8px; font-size: 0.72rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.Metro.focusStationOnMap('${p.id}', ${lng}, ${lat})" title="Προβολή στον Χάρτη">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
                <span>Χάρτης</span>
              </button>
              <button class="m3-icon-btn" style="width: 32px; height: 32px; flex-shrink: 0; background: var(--md-sys-color-surface-container-high); border: none; color: var(--md-sys-color-primary);" onclick="window.Metro.openStationModal('${p.id}')" title="Αναλυτικά στοιχεία & Λεωφορεία">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </div>
          ${departuresHtml}
        </div>
      `;
    };

    let contentHtml = '';

    if (this.sortMode === 'nearby') {
      // Sort all filtered stations by distance to user
      const sorted = [...filtered].sort((a, b) => {
        if (!this.userLocation) return (a.properties.order || 0) - (b.properties.order || 0);
        const [aLng, aLat] = a.geometry.coordinates;
        const [bLng, bLat] = b.geometry.coordinates;
        const distA = Math.hypot(aLat - this.userLocation.lat, aLng - this.userLocation.lng);
        const distB = Math.hypot(bLat - this.userLocation.lat, bLng - this.userLocation.lng);
        return distA - distB;
      });

      contentHtml = `
        <div style="display: flex; flex-direction: column; gap: 0.65rem;">
          ${sorted.map((f, i) => renderStationCard(f, i)).join('')}
        </div>
      `;
    } else {
      // Group by line in sequential order
      const lineOrder = ['M1', 'M2', 'M3', 'TRAM'];
      const activeLines = this.selectedLine === 'ALL' ? lineOrder : [this.selectedLine];

      contentHtml = activeLines.map(lineKey => {
        const lineStations = filtered.filter(f => {
          const p = f.properties;
          return p.primary_line === lineKey || (p.lines && p.lines.includes(lineKey));
        }).sort((a, b) => (a.properties.order || 0) - (b.properties.order || 0));

        if (lineStations.length === 0) return '';

        const lineMeta = (this.networkData.lines && this.networkData.lines[lineKey]) || {};
        const lineColor = lineMeta.color || this.getLineColor(lineKey);
        const lineName = lineMeta.name || lineKey;
        const termini = lineMeta.termini || [];
        const terminiText = termini.length >= 2 ? `${termini[0]} ➔ ${termini[termini.length - 1]}` : '';

        return `
          <div style="margin-bottom: 1.5rem;">
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-left: 5px solid ${lineColor}; border-radius: 12px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.4rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="background: ${lineColor}; color: #ffffff; padding: 2px 8px; border-radius: 9999px; font-weight: 900; font-size: 0.72rem;">${lineKey}</span>
                  <h3 style="margin: 0; font-size: 1.05rem; font-weight: 900; color: #0f172a;">${lineName}</h3>
                </div>
                ${terminiText ? `
                  <div style="font-size: 0.78rem; color: #64748b; margin-top: 3px;">
                    ${terminiText} • ${lineStations.length} Σταθμοί • Συχνότητα: ${lineMeta.frequency_peak || 'κάθε ~4.5\''}
                  </div>
                ` : ''}
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.65rem;">
              ${lineStations.map((f, idx) => renderStationCard(f, idx)).join('')}
            </div>
          </div>
        `;
      }).join('');
    }

    container.innerHTML = controlsHtml + contentHtml;
  }

  async openStationModal(stationId) {
    const modal = document.getElementById('metro-station-modal');
    if (!modal) return;

    modal.classList.add('active');
    modal.classList.add('open');
    if (window.App && typeof window.App.updateBackButtonsVisibility === 'function') {
      window.App.updateBackButtonsVisibility();
    }
    const content = document.getElementById('metro-station-modal-body');
    content.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <div class="m3-spinner" style="width: 32px; height: 32px; margin: 0 auto 1rem; border: 3px solid #ccc; border-top-color: var(--md-sys-color-primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div>Φόρτωση δρομολογίων σταθμού &amp; συνδέσεων...</div>
      </div>
    `;

    try {
      const res = await fetch(`/api/metro/station/${encodeURIComponent(stationId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.renderStationModalContent(data);

      // Center map on station if initialized
      if (this.map && data.station) {
        this.map.setView([data.station.lat, data.station.lng], 15, { animate: true });
      }
    } catch (e) {
      content.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--md-sys-color-error);">
          <div style="font-weight: 800; font-size: 1.1rem; margin-bottom: 0.5rem;">Αδυναμία φόρτωσης στοιχείων</div>
          <p style="font-size: 0.85rem;">${e.message}</p>
        </div>
      `;
    }
  }

  renderStationModalContent(data) {
    const content = document.getElementById('metro-station-modal-body');
    if (!content) return;

    const s = data.station;
    const tt = data.timetable || {};
    const busConn = data.bus_connections || [];

    const lineMeta = data.line_info || {};
    const primaryColor = lineMeta.color || '#005ac1';

    // Departures HTML
    const departuresHtml = (tt.departures || []).map(d => `
      <div style="background: var(--md-sys-color-surface-container); padding: 0.85rem 1rem; border-radius: var(--md-sys-shape-corner-medium); border-left: 4px solid ${primaryColor}; margin-bottom: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface);">
            ${d.direction}
          </div>
          <span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: var(--md-sys-color-live-green-container); color: var(--md-sys-color-live-green); font-weight: 800;">
            ${d.status}
          </span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 6px;">
          <div>
            <div style="font-size: 1.35rem; font-weight: 900; color: var(--md-sys-color-primary);">
              σε ~${d.estimated_in_minutes} λεπτά
            </div>
            <div style="font-size: 0.75rem; color: var(--md-sys-color-outline);">
              Επόμενος συρμός: σε ~${d.next_estimated_in_minutes} λεπτά
            </div>
          </div>
          <div style="font-size: 0.72rem; color: var(--md-sys-color-outline); text-align: right;">
            Συχνότητα: ~${d.headway_minutes}'
          </div>
        </div>
      </div>
    `).join('');

    // First and last train info
    const firstLastHtml = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.75rem;">
        <div style="background: var(--md-sys-color-surface-container-low); padding: 0.65rem 0.75rem; border-radius: var(--md-sys-shape-corner-small); border: 1px solid var(--md-sys-color-outline-variant);">
          <div style="font-size: 0.7rem; font-weight: 700; color: var(--md-sys-color-outline); text-transform: uppercase;">
            Πρώτος Συρμός
          </div>
          <div style="font-size: 0.95rem; font-weight: 800; color: var(--md-sys-color-on-surface); margin-top: 2px;">
            ${s.firstTrain ? (s.firstTrain.toTerminus1 || s.firstTrain.toTerminus2 || '05:30') : '05:30'}
          </div>
        </div>
        <div style="background: var(--md-sys-color-surface-container-low); padding: 0.65rem 0.75rem; border-radius: var(--md-sys-shape-corner-small); border: 1px solid var(--md-sys-color-outline-variant);">
          <div style="font-size: 0.7rem; font-weight: 700; color: var(--md-sys-color-outline); text-transform: uppercase;">
            Τελευταίος Συρμός
          </div>
          <div style="font-size: 0.95rem; font-weight: 800; color: var(--md-sys-color-on-surface); margin-top: 2px;">
            ${s.lastTrain ? (s.lastTrain.toTerminus1 || s.lastTrain.toTerminus2 || '00:05') : '00:05'}
          </div>
        </div>
      </div>
    `;

    // Connecting bus routes HTML
    let busConnectionsHtml = '';
    if (busConn.length > 0) {
      busConnectionsHtml = `
        <div style="margin-top: 1.25rem;">
          <h4 style="font-size: 0.85rem; font-weight: 800; color: var(--md-sys-color-outline); text-transform: uppercase; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>
            Ανταποκρίσεις με Λεωφορεία ΟΑΣΑ (${busConn.length} στάσεις έξω από το σταθμό)
          </h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${busConn.map(bc => `
              <div class="m3-card" style="padding: 0.75rem; background: var(--md-sys-color-surface-container-lowest); border: 1.5px solid var(--md-sys-color-outline-variant); cursor: pointer;" onclick="window.Metro.selectBusStop('${bc.stop_code}', '${bc.stop_name.replace(/'/g, "\\'")}')">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-primary);">
                      Στάση: ${bc.stop_name}
                    </div>
                    ${bc.street ? `<div style="font-size: 0.75rem; color: var(--md-sys-color-outline);">${bc.street}</div>` : ''}
                  </div>
                  <span style="font-size: 0.75rem; font-weight: 700; color: var(--md-sys-color-outline); background: var(--md-sys-color-surface-container); padding: 2px 8px; border-radius: 9999px;">
                    ${bc.distance_meters} μ.
                  </span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px;">
                  ${bc.lines.map(l => `<span class="m3-badge m3-badge-primary" style="font-size: 0.72rem; padding: 2px 6px;">${l.line_id}</span>`).join(' ')}
                </div>
                <div style="font-size: 0.72rem; color: var(--md-sys-color-primary); font-weight: 700; margin-top: 6px; display: flex; align-items: center; gap: 4px;">
                  <span>Προβολή ζωντανών αφίξεων λεωφορείων &rarr;</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      busConnectionsHtml = `
        <div style="margin-top: 1rem; font-size: 0.8rem; color: var(--md-sys-color-outline); text-align: center; padding: 1rem; background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-corner-medium);">
          Δεν εντοπίστηκαν άμεσες στάσεις λεωφορείων σε ακτίνα 250 μέτρων.
        </div>
      `;
    }

    content.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="font-size: 1.35rem; font-weight: 900; color: var(--md-sys-color-on-surface);">
            ${s.name}
          </h3>
          <span style="padding: 2px 8px; border-radius: 9999px; background: ${primaryColor}; color: #fff; font-size: 0.75rem; font-weight: 800;">
            ${lineMeta.name_short || s.line}
          </span>
        </div>
        ${s.interchanges && s.interchanges.length > 0 ? `
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
            ${s.interchanges.map(ic => `<span style="padding: 2px 8px; border-radius: 4px; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); font-size: 0.72rem; font-weight: 700;">🔄 ${ic}</span>`).join('')}
          </div>
        ` : ''}
      </div>

      <div style="margin-bottom: 0.75rem;">
        <div style="font-size: 0.75rem; font-weight: 800; color: var(--md-sys-color-outline); text-transform: uppercase; margin-bottom: 0.5rem;">
          Εκτιμώμενες Διελεύσεις Συρμών (O2 Hub / ΣΤΑΣΥ)
        </div>
        <div style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant); margin-bottom: 0.5rem;">
          ${tt.status_message}
        </div>
        ${departuresHtml}
        ${firstLastHtml}
      </div>

      ${busConnectionsHtml}
    `;
  }

  selectBusStop(stopCode, stopName) {
    // Close metro modal
    const modal = document.getElementById('metro-station-modal');
    if (modal) {
      modal.classList.remove('active');
      modal.classList.remove('open');
    }

    // Switch to Arrivals tab and select stop
    if (window.App && window.App.selectStop) {
      window.App.selectStop(stopCode, stopName, null, null, true);
    }
  }

  closeModal() {
    const modal = document.getElementById('metro-station-modal');
    if (modal) {
      modal.classList.remove('active');
      modal.classList.remove('open');
    }
    if (window.App && typeof window.App.updateBackButtonsVisibility === 'function') {
      window.App.updateBackButtonsVisibility();
    }
  }
}

window.Metro = new MetroManager();
