/**
 * Point-to-Point Journey Planner (A to B Multimodal Transit Routing)
 * Athens OASA Bus Suite
 */

class JourneyPlanner {
  constructor() {
    this.origin = null; // { name, lat, lng, isCurrentLocation }
    this.destination = null; // { name, lat, lng }
    this.itineraries = [];
    this.isSearching = false;
    this.activeSearchField = null; // 'origin' or 'dest'
    this.allStops = [];
  }

  async init() {
    // Attempt to load all stops for fast client-side autocomplete
    if (window.Search && Array.isArray(window.Search.allStops) && window.Search.allStops.length > 0) {
      this.allStops = window.Search.allStops;
    } else {
      try {
        const stops = await window.API.getAllStops();
        if (Array.isArray(stops) && stops.length > 0) {
          this.allStops = stops;
        }
      } catch (e) {}
    }

    this.initDefaultOrigin();
  }

  initDefaultOrigin() {
    if (window.App && window.App.userLocation) {
      this.origin = {
        name: '📍 Η τοποθεσία μου',
        lat: window.App.userLocation.lat,
        lng: window.App.userLocation.lng,
        isCurrentLocation: true
      };
    }
  }

  renderTab() {
    this.initDefaultOrigin();
    this.renderUI('journey-tab-content');
  }

  openModal() {
    const modal = document.getElementById('journey-planner-modal');
    if (!modal) return;
    this.initDefaultOrigin();
    this.renderUI('journey-planner-content');
    modal.classList.add('open');
    if (window.App) window.App.updateBackButtonsVisibility();
  }

  closeModal() {
    const modal = document.getElementById('journey-planner-modal');
    if (modal) {
      modal.classList.remove('open');
    }
    if (window.App) window.App.updateBackButtonsVisibility();
  }

  renderUI(containerId = 'journey-planner-content') {
    this.activeContainerId = containerId;
    const container = document.getElementById(containerId);
    if (!container) return;

    const originVal = this.origin ? this.origin.name : '';
    const destVal = this.destination ? this.destination.name : '';

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        
        <!-- Inputs Card -->
        <div class="m3-card" style="padding: 1rem; border: 1px solid var(--md-sys-color-outline-variant); background: #ffffff; border-radius: 16px; position: relative;">
          
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <!-- Indicator Dots -->
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 0;">
              <div style="width: 12px; height: 12px; border-radius: 50%; background: #15803d; border: 2px solid #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>
              <div style="width: 2px; height: 26px; background: #cbd5e1;"></div>
              <div style="width: 12px; height: 12px; border-radius: 50%; background: #dc2626; border: 2px solid #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>
            </div>

            <!-- Fields -->
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.6rem;">
              <div style="position: relative;">
                <input type="text" id="journey-origin-input" class="m3-input" 
                       value="${originVal}" placeholder="Αφετηρία (π.χ. Η τοποθεσία μου, Σύνταγμα)" 
                       oninput="window.JourneyPlanner.onInput('origin', this.value)" 
                       onfocus="window.JourneyPlanner.onFocus('origin', this.value)"
                       style="padding: 0.55rem 0.75rem; font-size: 0.88rem; width: 100%; border-radius: 10px; border: 1px solid #cbd5e1;" />
              </div>
              <div style="position: relative;">
                <input type="text" id="journey-dest-input" class="m3-input" 
                       value="${destVal}" placeholder="Προορισμός (π.χ. Καλλιθέα, Κηφισιά, Στάση)" 
                       oninput="window.JourneyPlanner.onInput('dest', this.value)" 
                       onfocus="window.JourneyPlanner.onFocus('dest', this.value)"
                       style="padding: 0.55rem 0.75rem; font-size: 0.88rem; width: 100%; border-radius: 10px; border: 1px solid #cbd5e1;" />
              </div>
            </div>

            <!-- Swap button -->
            <button class="m3-icon-btn" title="Αντιστροφή Αφετηρίας / Προορισμού" aria-label="Αντιστροφή" 
                    onclick="window.JourneyPlanner.swapLocations()" 
                    style="width: 38px; height: 38px; border-radius: 50%; border: 1px solid #e2e8f0; background: #f8fafc; color: #005ac1; cursor: pointer; flex-shrink: 0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
                <polyline points="17 14 12 9 7 14"></polyline>
                <line x1="12" y1="9" x2="12" y2="21"></line>
              </svg>
            </button>
          </div>

          <!-- Autocomplete Dropdown List -->
          <div id="journey-autocomplete-dropdown" style="display: none; position: absolute; left: 1rem; right: 1rem; top: calc(100% + 4px); z-index: 3000; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); border: 1px solid #e2e8f0; max-height: 240px; overflow-y: auto; padding: 0.5rem;"></div>
        </div>

        <!-- Quick Current Location Pill & Action Button -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
          <button class="m3-btn m3-btn-tonal" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.JourneyPlanner.useCurrentLocationForOrigin()">
            📍 Χρήση Τοποθεσίας μου
          </button>
          <button class="m3-btn m3-btn-primary" id="journey-search-btn" style="padding: 0.55rem 1.4rem; font-size: 0.88rem; font-weight: 800; border-radius: 9999px; display: inline-flex; align-items: center; gap: 6px;" onclick="window.JourneyPlanner.calculateRoute()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
            Εύρεση Διαδρομής
          </button>
        </div>

        <!-- Itineraries Results Container -->
        <div id="journey-results-container" style="margin-top: 0.5rem;">
          ${this.itineraries.length === 0 ? `
            <div style="text-align: center; padding: 2rem 1rem; color: #64748b; font-size: 0.85rem;">
              Επιλέξτε αφετηρία και προορισμό για να υπολογίσετε την ταχύτερη συγκοινωνιακή διαδρομή στην Αθήνα.
            </div>
          ` : this.renderItinerariesHtml()}
        </div>

      </div>
    `;
  }

  useCurrentLocationForOrigin() {
    if (window.App && window.App.userLocation) {
      this.origin = {
        name: '📍 Η τοποθεσία μου',
        lat: window.App.userLocation.lat,
        lng: window.App.userLocation.lng,
        isCurrentLocation: true
      };
      const input = document.getElementById('journey-origin-input');
      if (input) input.value = this.origin.name;
    } else {
      alert('Δεν έχει εντοπιστεί η γεωγραφική θέση σας ακόμα.');
    }
  }

  swapLocations() {
    const temp = this.origin;
    this.origin = this.destination;
    this.destination = temp;

    const oInput = document.getElementById('journey-origin-input');
    const dInput = document.getElementById('journey-dest-input');
    if (oInput) oInput.value = this.origin ? this.origin.name : '';
    if (dInput) dInput.value = this.destination ? this.destination.name : '';

    if (this.origin && this.destination) {
      this.calculateRoute();
    }
  }

  onFocus(field, query) {
    this.activeSearchField = field;
    this.searchStops(query);
  }

  onInput(field, query) {
    this.activeSearchField = field;
    this.searchStops(query);
  }

  searchStops(query = '') {
    const dropdown = document.getElementById('journey-autocomplete-dropdown');
    if (!dropdown) return;

    const q = (query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!q || q.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    const stopsSource = (this.allStops && this.allStops.length > 0)
      ? this.allStops
      : (window.Search && window.Search.allStops ? window.Search.allStops : []);

    const matches = stopsSource.filter(s => {
      const code = String(s.StopCode || '');
      const descr = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const street = (s.StopStreet || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return code.includes(q) || descr.includes(q) || street.includes(q);
    }).slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div style="padding: 0.5rem; font-size: 0.8rem; color: #94a3b8; text-align: center;">Δεν βρέθηκαν στάσεις.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches.map(s => {
      const name = s.StopDescr || `Στάση #${s.StopCode}`;
      const safeName = name.replace(/'/g, "\\'");
      const street = s.StopStreet ? `${s.StopStreet} • ` : '';
      return `
        <div style="padding: 0.5rem 0.65rem; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
             onmousedown="window.JourneyPlanner.selectStop('${safeName}', ${s.StopLat}, ${s.StopLng}, '${s.StopCode}')">
          <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;">
            🚏 ${name}
            <div style="font-size: 0.72rem; color: #64748b; font-weight: 500;">${street}#${s.StopCode}</div>
          </div>
          <span style="font-size: 0.72rem; color: #005ac1; font-weight: 800;">Επιλογή</span>
        </div>
      `;
    }).join('');

    dropdown.style.display = 'block';
  }

  selectStop(name, lat, lng, code) {
    const dropdown = document.getElementById('journey-autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';

    const locationObj = { name, lat: parseFloat(lat), lng: parseFloat(lng), code };

    if (this.activeSearchField === 'origin') {
      this.origin = locationObj;
      const input = document.getElementById('journey-origin-input');
      if (input) input.value = name;
    } else {
      this.destination = locationObj;
      const input = document.getElementById('journey-dest-input');
      if (input) input.value = name;
    }
  }

  async calculateRoute() {
    if (!this.origin || !this.destination) {
      alert('Παρακαλώ συμπληρώστε αφετηρία και προορισμό.');
      return;
    }

    const btn = document.getElementById('journey-search-btn');
    const container = document.getElementById('journey-results-container');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spin-animation" style="display:inline-block;">⌛</span> Υπολογισμός...`;
    }

    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #005ac1; font-weight: 700; font-size: 0.9rem;">
          <div class="m3-pulse-dot" style="width: 18px; height: 18px; background: #005ac1; margin: 0 auto 0.5rem;"></div>
          Υπολογισμός διαδρομών &amp; ζωντανών αφίξεων...
        </div>
      `;
    }

    try {
      const plan = await window.API.planJourney(
        this.origin.lat, this.origin.lng,
        this.destination.lat, this.destination.lng
      );

      this.itineraries = (plan && Array.isArray(plan.itineraries)) ? plan.itineraries : [];
      if (container) {
        container.innerHTML = this.renderItinerariesHtml();
      }
    } catch (err) {
      console.error('Journey planning failed:', err);
      if (container) {
        container.innerHTML = `
          <div style="padding: 1.5rem; text-align: center; color: #dc2626; font-size: 0.85rem;">
            Δεν κατέστη δυνατός ο αυτόματος υπολογισμός διαδρομής.
          </div>
        `;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
          Εύρεση Διαδρομής
        `;
      }
    }
  }

  renderItinerariesHtml() {
    if (this.itineraries.length === 0) {
      return `
        <div style="text-align: center; padding: 1.5rem; color: #64748b; font-size: 0.85rem;">
          Δεν βρέθηκε απευθείας συγκοινωνία μεταξύ των δύο σημείων. Δοκιμάστε να επιλέξετε κεντρικότερες στάσεις.
        </div>
      `;
    }

    return this.itineraries.map((itin, idx) => {
      const isDirectBus = itin.type === 'direct_bus';
      const isMetro = itin.type === 'direct_metro';
      const badgeBg = isMetro ? '#008751' : '#005ac1';
      const badgeLabel = isMetro ? `🚇 Μετρό ${itin.lineId}` : `🚌 ${itin.lineId}`;

      const liveEtaPill = (typeof itin.liveEtaMinutes === 'number') ? `
        <span style="font-size: 0.72rem; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;">
          <span class="m3-pulse-dot" style="width: 6px; height: 6px; background: #059669;"></span>
          Άφιξη σε ${itin.liveEtaMinutes}'
        </span>
      ` : '';

      const stepsHtml = (itin.steps || []).map(s => {
        const icon = s.kind === 'walk' ? '🚶' : (s.mode === 'metro' ? '🚇' : '🚌');
        return `
          <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.82rem; color: #334155; padding: 3px 0;">
            <span style="font-size: 0.95rem; line-height: 1;">${icon}</span>
            <div style="flex: 1; line-height: 1.35;">${s.instruction || `${s.lineDescr || s.lineId} (${s.durationMinutes}')`}</div>
          </div>
        `;
      }).join('');

      const gMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${this.origin.lat},${this.origin.lng}&destination=${this.destination.lat},${this.destination.lng}&travelmode=transit`;

      return `
        <div class="m3-card" style="padding: 1rem; border: 1px solid var(--md-sys-color-outline-variant); background: #ffffff; border-radius: 16px; margin-bottom: 0.75rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
          
          <!-- Card Header: Duration & Badge -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="m3-badge" style="background: ${badgeBg}; color: #ffffff; font-size: 0.85rem; font-weight: 900; padding: 3px 8px; border-radius: 6px;">${badgeLabel}</span>
              <span style="font-size: 1.05rem; font-weight: 900; color: #0f172a;">~${itin.totalDurationMinutes} λεπτά</span>
            </div>
            ${liveEtaPill}
          </div>

          <!-- Step by Step Timeline -->
          <div style="padding-left: 4px; border-left: 2px dashed #e2e8f0; margin-left: 8px; margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 4px;">
            ${stepsHtml}
          </div>

          <!-- Actions -->
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; padding-top: 0.4rem; border-top: 1px solid #f1f5f9;">
            <a href="${gMapsUrl}" target="_blank" rel="noopener noreferrer" class="m3-btn m3-btn-tonal" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-radius: 9999px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; color: #475569;">
              Google Maps
            </a>
            <button class="m3-btn m3-btn-primary" style="font-size: 0.75rem; padding: 0.35rem 0.85rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.JourneyPlanner.previewOnMap(${idx})">
              🗺️ Προβολή στον Χάρτη
            </button>
          </div>

        </div>
      `;
    }).join('');
  }

  previewOnMap(itinIndex) {
    const itin = this.itineraries[itinIndex];
    if (!itin || !window.App || !window.App.mapManager) return;

    this.closeModal();

    // Switch to map tab
    if (window.App.activeTab !== 'search') {
      window.App.switchTab('search');
    }

    // Render journey pins & lines on Leaflet map
    window.App.mapManager.renderJourneyRoute(itin, this.origin, this.destination);

    // Smooth scroll to map
    const mapEl = document.getElementById('map-container');
    if (mapEl) {
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

window.JourneyPlanner = new JourneyPlanner();
