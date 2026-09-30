/**
 * Point-to-Point Journey Planner (A to B Multimodal Transit Routing)
 * Athens OASA Bus Suite
 */

class JourneyPlanner {
  constructor() {
    this.origin = null; // { name, lat, lng, isCurrentLocation, code }
    this.destination = null; // { name, lat, lng, code }
    this.itineraries = [];
    this.isSearching = false;
    this.activeSearchField = null; // 'origin' or 'dest'
    this.allStops = [];
    this.metroStations = [
      { id: 'm1-peiraias', name: 'Πειραιάς', lat: 37.9482, lng: 23.6428, mode: 'metro' },
      { id: 'm1-faliro', name: 'Φάληρο', lat: 37.9450, lng: 23.6669, mode: 'metro' },
      { id: 'm1-moschato', name: 'Μοσχάτο', lat: 37.9553, lng: 23.6800, mode: 'metro' },
      { id: 'm1-kallithea', name: 'Καλλιθέα', lat: 37.9608, lng: 23.6969, mode: 'metro' },
      { id: 'm1-tavros', name: 'Ταύρος', lat: 37.9637, lng: 23.7052, mode: 'metro' },
      { id: 'm1-petralona', name: 'Πετράλωνα', lat: 37.9685, lng: 23.7093, mode: 'metro' },
      { id: 'm1-thiseio', name: 'Θησείο', lat: 37.9770, lng: 23.7208, mode: 'metro' },
      { id: 'm1-monastiraki', name: 'Μοναστηράκι', lat: 37.9763, lng: 23.7256, mode: 'metro' },
      { id: 'm1-omonoia', name: 'Ομόνοια', lat: 37.9842, lng: 23.7280, mode: 'metro' },
      { id: 'm1-victoria', name: 'Βικτώρια', lat: 37.9931, lng: 23.7300, mode: 'metro' },
      { id: 'm1-attiki', name: 'Αττική', lat: 37.9989, lng: 23.7225, mode: 'metro' },
      { id: 'm1-agios-nikolaos', name: 'Άγιος Νικόλαος', lat: 38.0068, lng: 23.7277, mode: 'metro' },
      { id: 'm1-kato-patisia', name: 'Κάτω Πατήσια', lat: 38.0119, lng: 23.7288, mode: 'metro' },
      { id: 'm1-agios-eleftherios', name: 'Άγιος Ελευθέριος', lat: 38.0201, lng: 23.7321, mode: 'metro' },
      { id: 'm1-ano-patisia', name: 'Άνω Πατήσια', lat: 38.0235, lng: 23.7359, mode: 'metro' },
      { id: 'm1-perissos', name: 'Περισσός', lat: 38.0328, lng: 23.7450, mode: 'metro' },
      { id: 'm1-pefkakia', name: 'Πευκάκια', lat: 38.0369, lng: 23.7508, mode: 'metro' },
      { id: 'm1-nea-ionia', name: 'Νέα Ιωνία', lat: 38.0403, lng: 23.7558, mode: 'metro' },
      { id: 'm1-irakleio', name: 'Ηράκλειο', lat: 38.0461, lng: 23.7661, mode: 'metro' },
      { id: 'm1-eirini', name: 'Ειρήνη', lat: 38.0433, lng: 23.7844, mode: 'metro' },
      { id: 'm1-neratziotissa', name: 'Νερατζιώτισσα', lat: 38.0450, lng: 23.7936, mode: 'metro' },
      { id: 'm1-marousi', name: 'Μαρούσι', lat: 38.0561, lng: 23.8050, mode: 'metro' },
      { id: 'm1-kat', name: 'ΚΑΤ', lat: 38.0664, lng: 23.8067, mode: 'metro' },
      { id: 'm1-kifisia', name: 'Κηφισιά', lat: 38.0736, lng: 23.8081, mode: 'metro' },
      { id: 'm2-anthoupoli', name: 'Ανθούπολη', lat: 38.0175, lng: 23.6925, mode: 'metro' },
      { id: 'm2-peristeri', name: 'Περιστέρι', lat: 38.0133, lng: 23.6917, mode: 'metro' },
      { id: 'm2-agios-antonios', name: 'Άγιος Αντώνιος', lat: 38.0069, lng: 23.6997, mode: 'metro' },
      { id: 'm2-sepolia', name: 'Σεπόλια', lat: 38.0019, lng: 23.7087, mode: 'metro' },
      { id: 'm2-stathmos-larisis', name: 'Σταθμός Λαρίσης', lat: 37.9924, lng: 23.7210, mode: 'metro' },
      { id: 'm2-metaxourgeio', name: 'Μεταξουργείο', lat: 37.9859, lng: 23.7211, mode: 'metro' },
      { id: 'm2-panepistimio', name: 'Πανεπιστήμιο', lat: 37.9804, lng: 23.7332, mode: 'metro' },
      { id: 'm2-syntagma', name: 'Σύνταγμα', lat: 37.9753, lng: 23.7348, mode: 'metro' },
      { id: 'm2-akropoli', name: 'Ακρόπολη', lat: 37.9690, lng: 23.7297, mode: 'metro' },
      { id: 'm2-syngrou-fix', name: 'Συγγρού-Φιξ', lat: 37.9647, lng: 23.7269, mode: 'metro' },
      { id: 'm2-neos-kosmos', name: 'Νέος Κόσμος', lat: 37.9582, lng: 23.7284, mode: 'metro' },
      { id: 'm2-agios-ioannis', name: 'Άγιος Ιωάννης', lat: 37.9569, lng: 23.7350, mode: 'metro' },
      { id: 'm2-dafni', name: 'Δάφνη', lat: 37.9497, lng: 23.7378, mode: 'metro' },
      { id: 'm2-agios-dimitrios', name: 'Άγιος Δημήτριος', lat: 37.9405, lng: 23.7408, mode: 'metro' },
      { id: 'm2-ilioupoli', name: 'Ηλιούπολη', lat: 37.9308, lng: 23.7461, mode: 'metro' },
      { id: 'm2-alimos', name: 'Άλιμος', lat: 37.9189, lng: 23.7439, mode: 'metro' },
      { id: 'm2-argyroupoli', name: 'Αργυρούπολη', lat: 37.9108, lng: 23.7481, mode: 'metro' },
      { id: 'm2-elliniko', name: 'Ελληνικό', lat: 37.8994, lng: 23.7447, mode: 'metro' },
      { id: 'm3-dimotiko-theatro', name: 'Δημοτικό Θέατρο', lat: 37.9431, lng: 23.6469, mode: 'metro' },
      { id: 'm3-maniatika', name: 'Μανιάτικα', lat: 37.9575, lng: 23.6536, mode: 'metro' },
      { id: 'm3-nikaia', name: 'Νίκαια', lat: 37.9658, lng: 23.6467, mode: 'metro' },
      { id: 'm3-korydallos', name: 'Κορυδαλλός', lat: 37.9772, lng: 23.6508, mode: 'metro' },
      { id: 'm3-agia-varvara', name: 'Αγία Βαρβάρα', lat: 37.9897, lng: 23.6594, mode: 'metro' },
      { id: 'm3-agia-marina', name: 'Αγία Μαρίνα', lat: 37.9972, lng: 23.6681, mode: 'metro' },
      { id: 'm3-egaleo', name: 'Αιγάλεω', lat: 37.9922, lng: 23.6814, mode: 'metro' },
      { id: 'm3-elaionas', name: 'Ελαιώνας', lat: 37.9877, lng: 23.6941, mode: 'metro' },
      { id: 'm3-kerameikos', name: 'Κεραμεικός', lat: 37.9787, lng: 23.7112, mode: 'metro' },
      { id: 'm3-evangelismos', name: 'Ευαγγελισμός', lat: 37.9764, lng: 23.7480, mode: 'metro' },
      { id: 'm3-megaro-mousikis', name: 'Μέγαρο Μουσικής', lat: 37.9796, lng: 23.7545, mode: 'metro' },
      { id: 'm3-ambelokipi', name: 'Αμπελόκηποι', lat: 37.9870, lng: 23.7568, mode: 'metro' },
      { id: 'm3-panormou', name: 'Πανόρμου', lat: 37.9934, lng: 23.7637, mode: 'metro' },
      { id: 'm3-katehaki', name: 'Κατεχάκη', lat: 37.9932, lng: 23.7763, mode: 'metro' },
      { id: 'm3-ethniki-amyna', name: 'Εθνική Άμυνα', lat: 38.0006, lng: 23.7859, mode: 'metro' },
      { id: 'm3-holargos', name: 'Χολαργός', lat: 38.0047, lng: 23.7947, mode: 'metro' },
      { id: 'm3-nomismatokopio', name: 'Νομισματοκοπείο', lat: 38.0089, lng: 23.8058, mode: 'metro' },
      { id: 'm3-agia-paraskevi', name: 'Αγία Παρασκευή', lat: 38.0174, lng: 23.8127, mode: 'metro' },
      { id: 'm3-chalandri', name: 'Χαλάνδρι', lat: 38.0217, lng: 23.8211, mode: 'metro' },
      { id: 'm3-doukissis-plakentias', name: 'Δουκίσσης Πλακεντίας', lat: 38.0247, lng: 23.8331, mode: 'metro' },
      { id: 'm3-pallini', name: 'Παλλήνη', lat: 37.9925, lng: 23.8839, mode: 'metro' },
      { id: 'm3-paiania-kantza', name: 'Παιανία-Κάντζα', lat: 37.9358, lng: 23.8703, mode: 'metro' },
      { id: 'm3-koropi', name: 'Κορωπί', lat: 37.9125, lng: 23.8725, mode: 'metro' },
      { id: 'm3-aerodromio', name: 'Αεροδρόμιο', lat: 37.9367, lng: 23.9450, mode: 'metro' }
    ];
  }

  async init() {
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

    // Close autocomplete on outside clicks
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#journey-inputs-card')) {
        this.hideDropdown();
      }
    });
  }

  initDefaultOrigin() {
    if (window.App && window.App.userLocation && !isNaN(window.App.userLocation.lat)) {
      this.origin = {
        name: '📍 Η τοποθεσία μου',
        lat: window.App.userLocation.lat,
        lng: window.App.userLocation.lng,
        isCurrentLocation: true
      };
    } else if (!this.origin) {
      this.origin = {
        name: '📍 Η τοποθεσία μου',
        lat: 37.9753,
        lng: 23.7361,
        isCurrentLocation: true
      };
    }
  }

  renderTab() {
    this.initDefaultOrigin();
    this.renderUI('journey-tab-content');
  }

  renderUI(containerId = 'journey-tab-content') {
    this.activeContainerId = containerId;
    const container = document.getElementById(containerId);
    if (!container) return;

    const originVal = this.origin ? this.origin.name : '📍 Η τοποθεσία μου';
    const destVal = this.destination ? this.destination.name : '';

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        
        <!-- Inputs Card -->
        <div id="journey-inputs-card" class="m3-card" style="padding: 1rem; border: 1.5px solid var(--md-sys-color-outline-variant); background: #ffffff; border-radius: 18px; position: relative; box-shadow: 0 4px 14px rgba(0,0,0,0.04);">
          
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <!-- Indicator Dots -->
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 0;">
              <div style="width: 13px; height: 13px; border-radius: 50%; background: #15803d; border: 2.5px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);"></div>
              <div style="width: 2px; height: 32px; background: #cbd5e1;"></div>
              <div style="width: 13px; height: 13px; border-radius: 50%; background: #dc2626; border: 2.5px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.3);"></div>
            </div>

            <!-- Fields -->
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.65rem;">
              <div style="position: relative;">
                <input type="text" id="journey-origin-input" class="m3-input" 
                       value="${originVal}" placeholder="Αφετηρία (π.χ. Η τοποθεσία μου, Σύνταγμα)" 
                       oninput="window.JourneyPlanner.onInput('origin', this.value)" 
                       onfocus="window.JourneyPlanner.onFocus('origin', this.value)"
                       onkeydown="if(event.key==='Enter') window.JourneyPlanner.calculateRoute()"
                       autocomplete="off"
                       style="padding: 0.6rem 0.8rem; font-size: 0.92rem; font-weight: 600; width: 100%; border-radius: 12px; border: 1.5px solid #cbd5e1; background: #f8fafc;" />
              </div>
              <div style="position: relative;">
                <input type="text" id="journey-dest-input" class="m3-input" 
                       value="${destVal}" placeholder="Προορισμός (π.χ. Ομόνοια, Κηφισιά, Πειραιάς, Στάση)" 
                       oninput="window.JourneyPlanner.onInput('dest', this.value)" 
                       onfocus="window.JourneyPlanner.onFocus('dest', this.value)"
                       onkeydown="if(event.key==='Enter') window.JourneyPlanner.calculateRoute()"
                       autocomplete="off"
                       style="padding: 0.6rem 0.8rem; font-size: 0.92rem; font-weight: 600; width: 100%; border-radius: 12px; border: 1.5px solid #cbd5e1; background: #ffffff;" />
              </div>
            </div>

            <!-- Swap button -->
            <button class="m3-icon-btn" title="Αντιστροφή Αφετηρίας / Προορισμού" aria-label="Αντιστροφή" 
                    onclick="window.JourneyPlanner.swapLocations()" 
                    style="width: 40px; height: 40px; border-radius: 50%; border: 1px solid #cbd5e1; background: #f1f5f9; color: #005ac1; cursor: pointer; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
                <polyline points="17 14 12 9 7 14"></polyline>
                <line x1="12" y1="9" x2="12" y2="21"></line>
              </svg>
            </button>
          </div>

          <!-- Autocomplete Dropdown List -->
          <div id="journey-autocomplete-dropdown" style="display: none; position: absolute; left: 1rem; right: 1rem; top: calc(100% + 6px); z-index: 3500; background: #ffffff; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); border: 1px solid #cbd5e1; max-height: 260px; overflow-y: auto; padding: 0.4rem;"></div>
        </div>

        <!-- Quick Current Location Pill & Action Button -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
          <button class="m3-btn m3-btn-tonal" style="font-size: 0.78rem; font-weight: 700; padding: 0.45rem 0.85rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px;" onclick="window.JourneyPlanner.useCurrentLocationForOrigin()">
            📍 Χρήση Τοποθεσίας μου
          </button>
          <button class="m3-btn m3-btn-primary" id="journey-search-btn" style="padding: 0.55rem 1.4rem; font-size: 0.92rem; font-weight: 800; border-radius: 9999px; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(0,90,193,0.25);" onclick="window.JourneyPlanner.calculateRoute()">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
            Εύρεση Διαδρομής
          </button>
        </div>

        <!-- Feedback & Itineraries Results Container -->
        <div id="journey-results-container" style="margin-top: 0.5rem;">
          ${this.itineraries.length === 0 ? `
            <div class="m3-card" style="text-align: center; padding: 2.25rem 1.25rem; border: 1px dashed #cbd5e1; border-radius: 16px; background: #f8fafc;">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">🧭</div>
              <div style="font-weight: 800; color: #0f172a; font-size: 0.98rem; margin-bottom: 0.35rem;">Έτοιμοι για μετακίνηση;</div>
              <div style="color: #64748b; font-size: 0.85rem; line-height: 1.4; max-width: 380px; margin: 0 auto;">
                Επιλέξτε προορισμό και πατήστε <strong>Εύρεση Διαδρομής</strong> για τον ταχύτερο συνδυασμό Λεωφορείων, Τρόλεϊ &amp; Μετρό.
              </div>
            </div>
          ` : this.renderItinerariesHtml()}
        </div>

      </div>
    `;
  }

  useCurrentLocationForOrigin() {
    if (window.App && window.App.userLocation && !isNaN(window.App.userLocation.lat)) {
      this.origin = {
        name: '📍 Η τοποθεσία μου',
        lat: window.App.userLocation.lat,
        lng: window.App.userLocation.lng,
        isCurrentLocation: true
      };
      const input = document.getElementById('journey-origin-input');
      if (input) input.value = this.origin.name;
      if (window.App && typeof window.App.triggerHaptic === 'function') window.App.triggerHaptic('light');
    } else if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (window.App) window.App.handleLocationChange(pos.coords.latitude, pos.coords.longitude, true);
          this.origin = {
            name: '📍 Η τοποθεσία μου',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            isCurrentLocation: true
          };
          const input = document.getElementById('journey-origin-input');
          if (input) input.value = this.origin.name;
        },
        (err) => {
          this.origin = {
            name: '📍 Κέντρο Αθήνας (Σύνταγμα)',
            lat: 37.9753,
            lng: 23.7361,
            isCurrentLocation: true
          };
          const input = document.getElementById('journey-origin-input');
          if (input) input.value = this.origin.name;
        }
      );
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

    if (window.App && typeof window.App.triggerHaptic === 'function') window.App.triggerHaptic('selection');
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

  hideDropdown() {
    const dropdown = document.getElementById('journey-autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
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

    // Check Metro stations first
    const metroMatches = this.metroStations.filter(st => {
      const norm = st.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return norm.includes(q);
    }).map(st => ({
      name: `🚇 Σταθμός Μετρό ${st.name}`,
      displayName: st.name,
      lat: st.lat,
      lng: st.lng,
      code: st.id,
      isMetro: true
    }));

    // Check Bus Stops
    const busMatches = stopsSource.filter(s => {
      const code = String(s.StopCode || '');
      const descr = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const street = (s.StopStreet || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return code.includes(q) || descr.includes(q) || street.includes(q);
    }).slice(0, 7).map(s => ({
      name: s.StopDescr || `Στάση #${s.StopCode}`,
      street: s.StopStreet ? `${s.StopStreet} • ` : '',
      lat: parseFloat(s.StopLat),
      lng: parseFloat(s.StopLng),
      code: s.StopCode,
      isMetro: false
    }));

    const combined = [...metroMatches, ...busMatches].slice(0, 8);

    if (combined.length === 0) {
      dropdown.innerHTML = `<div style="padding: 0.65rem; font-size: 0.82rem; color: #94a3b8; text-align: center;">Δεν βρέθηκαν στάσεις.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = combined.map(item => {
      const icon = item.isMetro ? '🚇' : '🚏';
      const safeName = item.name.replace(/'/g, "\\'");
      const subtitle = item.isMetro ? 'Σταθμός Μετρό' : `${item.street || ''}#${item.code}`;
      return `
        <div style="padding: 0.6rem 0.75rem; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
             onpointerdown="window.JourneyPlanner.selectStop('${safeName}', ${item.lat}, ${item.lng}, '${item.code}')"
             onclick="window.JourneyPlanner.selectStop('${safeName}', ${item.lat}, ${item.lng}, '${item.code}')">
          <div style="font-size: 0.88rem; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">
            ${icon} ${item.name}
            <div style="font-size: 0.72rem; color: #64748b; font-weight: 500;">${subtitle}</div>
          </div>
          <span style="font-size: 0.75rem; color: #005ac1; font-weight: 800;">Επιλογή</span>
        </div>
      `;
    }).join('');

    dropdown.style.display = 'block';
  }

  selectStop(name, lat, lng, code) {
    this.hideDropdown();
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

  resolveLocation(queryText) {
    const q = (queryText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!q || q.includes('τοποθεσια')) {
      if (window.App && window.App.userLocation && !isNaN(window.App.userLocation.lat)) {
        return { name: '📍 Η τοποθεσία μου', lat: window.App.userLocation.lat, lng: window.App.userLocation.lng, isCurrentLocation: true };
      }
      return { name: '📍 Κέντρο Αθήνας (Σύνταγμα)', lat: 37.9753, lng: 23.7361, isCurrentLocation: true };
    }

    // 1. Check Metro stations
    const metro = this.metroStations.find(st => {
      const norm = st.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return norm === q || norm.includes(q) || q.includes(norm);
    });
    if (metro) {
      return { name: `🚇 Σταθμός Μετρό ${metro.name}`, lat: metro.lat, lng: metro.lng, code: metro.id };
    }

    // 2. Check Bus Stops
    const stopsSource = (this.allStops && this.allStops.length > 0)
      ? this.allStops
      : (window.Search && window.Search.allStops ? window.Search.allStops : []);

    let best = stopsSource.find(s => String(s.StopCode) === q);
    if (!best) {
      best = stopsSource.find(s => {
        const descr = (s.StopDescr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return descr === q || descr.startsWith(q) || descr.includes(q);
      });
    }

    if (best) {
      return {
        name: best.StopDescr || `Στάση #${best.StopCode}`,
        lat: parseFloat(best.StopLat),
        lng: parseFloat(best.StopLng),
        code: best.StopCode
      };
    }

    return null;
  }

  async calculateRoute() {
    this.hideDropdown();
    const container = document.getElementById('journey-results-container');
    const oInput = document.getElementById('journey-origin-input');
    const dInput = document.getElementById('journey-dest-input');

    const oText = oInput ? oInput.value.trim() : '';
    const dText = dInput ? dInput.value.trim() : '';

    // Auto-resolve typed text if not selected via dropdown
    if (!this.origin || (oText && this.origin.name !== oText && !this.origin.isCurrentLocation)) {
      this.origin = this.resolveLocation(oText || 'τοποθεσια');
    }
    if (!this.destination || (dText && this.destination.name !== dText)) {
      this.destination = this.resolveLocation(dText);
    }

    if (!this.destination) {
      if (container) {
        container.innerHTML = `
          <div class="m3-card" style="padding: 1.25rem; text-align: center; border: 1.5px solid #fed7aa; background: #fffaf0; border-radius: 14px;">
            <div style="font-weight: 800; color: #c2410c; margin-bottom: 0.35rem;">⚠️ Παρακαλώ συμπληρώστε προορισμό</div>
            <div style="font-size: 0.82rem; color: #7c2d12;">Πληκτρολογήστε όνομα σταθμού, πλατείας ή στάσης (π.χ. Σύνταγμα, Ομόνοια, Κηφισιά).</div>
          </div>
        `;
      }
      if (dInput) dInput.focus();
      return;
    }

    if (!this.origin) {
      this.origin = { name: '📍 Κέντρο Αθήνας', lat: 37.9753, lng: 23.7361, isCurrentLocation: true };
    }

    const btn = document.getElementById('journey-search-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spin-animation" style="display:inline-block;">⌛</span> Υπολογισμός...`;
    }

    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: #005ac1; font-weight: 700; font-size: 0.95rem;">
          <div class="m3-pulse-dot" style="width: 22px; height: 22px; background: #005ac1; margin: 0 auto 0.75rem;"></div>
          Υπολογισμός διαδρομών &amp; ζωντανών συνδέσεων...
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
      if (window.App && typeof window.App.triggerHaptic === 'function') window.App.triggerHaptic('light');
    } catch (err) {
      console.error('Journey planning failed:', err);
      if (container) {
        container.innerHTML = `
          <div class="m3-card" style="padding: 1.5rem; text-align: center; border: 1.5px solid #fecaca; background: #fef2f2; border-radius: 14px;">
            <div style="font-weight: 800; color: #dc2626; margin-bottom: 0.5rem;">Δεν κατέστη δυνατός ο απευθείας υπολογισμός</div>
            <div style="font-size: 0.82rem; color: #7f1d1d; margin-bottom: 1rem;">Μπορείτε να ανοίξετε άμεσα τις διαδρομές συγκοινωνιών στο Google Maps:</div>
            <button class="m3-btn m3-btn-primary" onclick="window.JourneyPlanner.openGoogleMapsTransit()" style="border-radius: 9999px; padding: 0.6rem 1.4rem; font-weight: 800;">
              🧭 Άνοιγμα στο Google Maps Transit
            </button>
          </div>
        `;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
          Εύρεση Διαδρομής
        `;
      }
    }
  }

  openGoogleMapsTransit() {
    if (!this.origin || !this.destination) return;
    const gMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${this.origin.lat},${this.origin.lng}&destination=${this.destination.lat},${this.destination.lng}&travelmode=transit`;
    
    if (window.AndroidBridge && typeof window.AndroidBridge.openExternalUrl === 'function') {
      try {
        window.AndroidBridge.openExternalUrl(gMapsUrl);
        return;
      } catch (e) {}
    }
    window.open(gMapsUrl, '_blank', 'noopener,noreferrer');
  }

  renderItinerariesHtml() {
    const gMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${this.origin.lat},${this.origin.lng}&destination=${this.destination.lat},${this.destination.lng}&travelmode=transit`;

    if (this.itineraries.length === 0) {
      return `
        <div class="m3-card" style="padding: 1.5rem; text-align: center; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 16px;">
          <div style="font-size: 1.6rem; margin-bottom: 0.35rem;">🗺️</div>
          <div style="font-weight: 800; color: #003366; font-size: 1rem; margin-bottom: 0.4rem;">Δεν βρέθηκε απευθείας γραμμή</div>
          <div style="font-size: 0.84rem; color: #1e40af; line-height: 1.45; margin-bottom: 1.25rem;">
            Η διαδρομή μεταξύ <strong>${this.origin.name}</strong> και <strong>${this.destination.name}</strong> απαιτεί συνδυασμό μετεπιβιβάσεων. Δείτε τις επιλογές απευθείας στο Google Maps Transit:
          </div>
          <button class="m3-btn m3-btn-primary" onclick="window.JourneyPlanner.openGoogleMapsTransit()" style="width: 100%; border-radius: 9999px; font-weight: 800; padding: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
            Πλοήγηση με Google Maps Transit ➔
          </button>
        </div>
      `;
    }

    const cardsHtml = this.itineraries.map((itin, idx) => {
      const isDirectBus = itin.type === 'direct_bus';
      const isMetro = itin.type === 'direct_metro';
      const isWalk = itin.type === 'walk_only';

      let badgeBg = '#005ac1';
      let badgeLabel = `🚌 ${itin.lineId}`;
      if (isMetro) {
        badgeBg = itin.lineId === 'M1' ? '#008751' : (itin.lineId === 'M2' ? '#da291c' : '#0066b2');
        badgeLabel = `🚇 ${itin.lineId}`;
      } else if (isWalk) {
        badgeBg = '#15803d';
        badgeLabel = `🚶 Περπάτημα`;
      }

      const liveEtaPill = (typeof itin.liveEtaMinutes === 'number') ? `
        <span style="font-size: 0.72rem; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
          <span class="m3-pulse-dot" style="width: 6px; height: 6px; background: #059669;"></span>
          Άφιξη σε ${itin.liveEtaMinutes}'
        </span>
      ` : '';

      const stepsHtml = (itin.steps || []).map(s => {
        const icon = s.kind === 'walk' ? '🚶' : (s.mode === 'metro' ? '🚇' : '🚌');
        return `
          <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.84rem; color: #334155; padding: 4px 0;">
            <span style="font-size: 1rem; line-height: 1;">${icon}</span>
            <div style="flex: 1; line-height: 1.35;">${s.instruction || `${s.lineDescr || s.lineId} (${s.durationMinutes}')`}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="m3-card" style="padding: 1.1rem; border: 1.5px solid var(--md-sys-color-outline-variant); background: #ffffff; border-radius: 18px; margin-bottom: 0.85rem; box-shadow: 0 3px 10px rgba(0,0,0,0.04);">
          
          <!-- Card Header: Duration & Badge -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="m3-badge" style="background: ${badgeBg}; color: #ffffff; font-size: 0.88rem; font-weight: 900; padding: 3px 9px; border-radius: 8px;">${badgeLabel}</span>
              <span style="font-size: 1.1rem; font-weight: 900; color: #0f172a;">~${itin.totalDurationMinutes} λεπτά</span>
            </div>
            ${liveEtaPill}
          </div>

          <!-- Step by Step Timeline -->
          <div style="padding-left: 8px; border-left: 2px dashed #cbd5e1; margin-left: 8px; margin-bottom: 0.85rem; display: flex; flex-direction: column; gap: 4px;">
            ${stepsHtml}
          </div>

          <!-- Actions -->
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #f1f5f9;">
            <button class="m3-btn m3-btn-tonal" onclick="window.JourneyPlanner.openGoogleMapsTransit()" style="font-size: 0.76rem; padding: 0.4rem 0.8rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; color: #475569;">
              Google Maps
            </button>
            <button class="m3-btn m3-btn-primary" style="font-size: 0.76rem; padding: 0.4rem 0.95rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px;" onclick="window.JourneyPlanner.previewOnMap(${idx})">
              🗺️ Προβολή στον Χάρτη
            </button>
          </div>

        </div>
      `;
    }).join('');

    return `
      <div>
        ${cardsHtml}
        
        <!-- Google Maps Transit alternative banner -->
        <div style="text-align: center; margin-top: 1rem; padding: 0.5rem;">
          <button class="m3-btn m3-btn-tonal" onclick="window.JourneyPlanner.openGoogleMapsTransit()" style="font-size: 0.8rem; font-weight: 700; border-radius: 9999px; padding: 0.45rem 1.1rem; display: inline-flex; align-items: center; gap: 6px;">
            🧭 Άνοιγμα εναλλακτικών διαδρομών στο Google Maps
          </button>
        </div>
      </div>
    `;
  }

  previewOnMap(itinIndex) {
    const itin = this.itineraries[itinIndex];
    if (!itin || !window.App || !window.App.mapManager) return;

    // Switch to map tab
    if (window.App.activeTab !== 'search') {
      window.App.switchTab('search');
    }

    // Render journey pins & lines on Leaflet map
    window.App.mapManager.renderJourneyRoute(itin, this.origin, this.destination);

    // Smooth scroll to map
    setTimeout(() => {
      const mapEl = document.getElementById('map-container');
      if (mapEl) {
        mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 150);
  }
}

window.JourneyPlanner = new JourneyPlanner();
