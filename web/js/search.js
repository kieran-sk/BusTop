/**
 * Instant Search Engine for Stops & Lines
 * Unified search in Greek across all 9,385 Athens stops, bus lines, timetables, and pedestrian distance.
 */

class SearchManager {
  constructor() {
    this.allLines = [];
    this.nearbyStops = [];
    this.showAllNearby = false;
    this.debounceTimer = null;
    this.init();
  }

  async init() {
    try {
      this.allLines = await window.API.getLines();
    } catch (err) {
      console.warn('Failed to prefetch lines for search:', err);
    }
  }

  normalize(str) {
    if (!str) return '';
    return str.toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  onSearchInput(rawQuery) {
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = rawQuery && rawQuery.trim().length > 0 ? 'flex' : 'none';
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.executeSearch(rawQuery);
    }, 200);
  }

  async executeSearch(rawQuery) {
    const query = this.normalize(rawQuery);
    const resultsContainer = document.getElementById('search-results');
    const nearbyContainer = document.getElementById('nearby-stops-container');
    if (!resultsContainer) return;

    const trimmed = (rawQuery || '').trim();

    if (!trimmed) {
      resultsContainer.innerHTML = '';
      if (nearbyContainer) {
        nearbyContainer.style.display = 'block';
      }
      return;
    }

    if (window.App && window.App.activeTab !== 'search') {
      window.App.switchTab('search');
    }
    if (nearbyContainer) {
      nearbyContainer.style.display = 'none';
    }

    resultsContainer.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: #64748b; font-size: 0.85rem;">
        Αναζήτηση γραμμών και στάσεων για "${trimmed}"...
      </div>
    `;

    // 1. Search Lines locally
    const matchingLines = (this.allLines || []).filter(l => {
      const id = this.normalize(l.LineID);
      const descr = this.normalize(l.LineDescr);
      const descrEng = this.normalize(l.LineDescrEng);
      return id.includes(query) || descr.includes(query) || descrEng.includes(query);
    }).slice(0, 15);

    // 2. Search Stops remotely via server master stops index (with Zero Data Mode offline fallback)
    let matchingStops = [];
    let isOfflineResults = false;
    try {
      const res = await fetch(`/api/stops/search?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        matchingStops = await res.json();
        // Cache stop results locally
        if (Array.isArray(matchingStops) && matchingStops.length > 0) {
          const stopCache = JSON.parse(localStorage.getItem('OASA_KNOWN_STOPS') || '{}');
          matchingStops.forEach(s => { stopCache[s.StopCode] = s; });
          localStorage.setItem('OASA_KNOWN_STOPS', JSON.stringify(stopCache));
        }
      } else {
        throw new Error('Search network response not ok');
      }
    } catch (e) {
      console.warn('Network stop search failed, switching to Zero Data Mode:', e);
      isOfflineResults = true;
      // Search in locally cached stops (from previous searches and favourites)
      const knownStops = Object.values(JSON.parse(localStorage.getItem('OASA_KNOWN_STOPS') || '{}'));
      const favStops = JSON.parse(localStorage.getItem('OASA_FAV_STOPS') || '[]');
      const allLocal = [...favStops, ...knownStops];
      const seen = new Set();

      matchingStops = allLocal.filter(s => {
        if (!s || !s.StopCode || seen.has(String(s.StopCode))) return false;
        seen.add(String(s.StopCode));
        const code = String(s.StopCode);
        const name = this.normalize(s.StopDescr || s.stopName || '');
        const street = this.normalize(s.StopStreet || s.stopStreet || '');
        return code.includes(query) || name.includes(query) || street.includes(query);
      }).slice(0, 15);
    }

    let html = '';

    // Render Lines
    if (matchingLines.length > 0) {
      html += `
        <div style="font-size: 0.82rem; font-weight: 800; color: var(--md-sys-color-primary); margin: 0.5rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">
          Γραμμές Λεωφορείων (${matchingLines.length})
        </div>
        <div style="display: grid; gap: 0.55rem; margin-bottom: 1.25rem;">
          ${matchingLines.map(l => {
            const safeDescr = (l.LineDescr || '').replace(/'/g, "\\'");
            const isLineFav = window.Favorites && window.Favorites.isLineFav(l.LineCode);
            return `
              <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.65rem; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);" onclick="window.App.openLineTimetableBothDirections('${l.LineCode}', '${l.LineID}', '${safeDescr}')">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem;">
                  <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
                    <span class="ticker-line-badge" style="font-size: 0.95rem; min-width: 46px; flex-shrink: 0;">
                      ${l.LineID}
                    </span>
                    <div style="min-width: 0; flex: 1;">
                      <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${l.LineDescr}</div>
                      <div style="font-size: 0.76rem; color: var(--md-sys-color-outline); margin-top: 2px;">Γραμμή #${l.LineCode}</div>
                    </div>
                  </div>
                  <button class="m3-icon-btn" style="width: 36px; height: 36px; border: none; cursor: pointer; background: none; flex-shrink: 0;" title="Αποθήκευση γραμμής" onclick="event.stopPropagation(); const isFav = window.Favorites.toggleLine('${l.LineCode}', '${l.LineID}', '${safeDescr}'); this.querySelector('svg').setAttribute('fill', isFav ? '#eab308' : 'none'); this.querySelector('svg').setAttribute('stroke', isFav ? '#ca8a04' : '#64748b');">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="${isLineFav ? '#eab308' : 'none'}" stroke="${isLineFav ? '#ca8a04' : '#64748b'}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  </button>
                </div>
                <div style="display: flex; align-items: center; justify-content: flex-end; border-top: 1px dashed var(--md-sys-color-outline-variant); padding-top: 0.45rem;">
                  <button class="m3-btn m3-btn-primary" style="padding: 0.35rem 0.85rem; font-size: 0.8rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;" onclick="event.stopPropagation(); window.App.openLineTimetableBothDirections('${l.LineCode}', '${l.LineID}', '${safeDescr}')">
                    🗺️ Δρομολόγιο &amp; Στάσεις ➜
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Render Stops
    if (matchingStops.length > 0) {
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; margin: 0.5rem 0 0.5rem;">
          <span style="font-size: 0.82rem; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">
            Στάσεις Λεωφορείων (${matchingStops.length})
          </span>
          ${isOfflineResults ? `
            <span class="m3-badge" style="background: #fef3c7; color: #b45309; font-size: 0.7rem; font-weight: 800; padding: 2px 6px;">
              💾 Zero Data (Offline Cache)
            </span>
          ` : ''}
        </div>
        <div style="display: grid; gap: 0.45rem;">
          ${matchingStops.map(s => {
            const stopTitle = s.StopDescr || `Στάση #${s.StopCode}`;
            const safeTitle = stopTitle.replace(/'/g, "\\'");
            return `
              <div class="m3-card stop-interactive-card" data-stop-code="${s.StopCode}" data-stop-title="${safeTitle}" data-stop-lat="${s.StopLat}" data-stop-lng="${s.StopLng}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);" onclick="window.App.selectStop('${s.StopCode}', '${safeTitle}', ${s.StopLat}, ${s.StopLng})">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div class="m3-icon-btn" style="width: 38px; height: 38px; background: #ecfdf5; color: #047857; border: 1.5px solid #a7f3d0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"></path>
                      <circle cx="12" cy="9" r="2.5"></circle>
                    </svg>
                  </div>
                  <div>
                    <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface);">${stopTitle}</div>
                    <div style="font-size: 0.78rem; color: var(--md-sys-color-outline); margin-top: 2px;">
                      ${s.StopStreet ? s.StopStreet + ' • ' : ''}Στάση #${s.StopCode}
                    </div>
                  </div>
                </div>
                <button class="m3-btn m3-btn-tonal" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border-radius: 9999px;">
                  Αφίξεις
                </button>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    if (matchingLines.length === 0 && matchingStops.length === 0) {
      html = `
        <div style="padding: 2.5rem; text-align: center; color: #64748b;">
          <div style="font-size: 1rem; font-weight: 700; margin-bottom: 0.25rem;">Δεν βρέθηκαν αποτελέσματα</div>
          <div style="font-size: 0.85rem;">Δοκιμάστε με αριθμό γραμμής (π.χ. 040, 306, X95) ή όνομα στάσης στα ελληνικά.</div>
        </div>
      `;
    }

    resultsContainer.innerHTML = html;
  }

  /**
   * "Near Me" GPS Radar
   */
  /**
   * "Near Me" GPS Radar
   */
  async findNearbyStops(silent = false) {
    const radarBtn = document.getElementById('radar-search-btn');
    const container = document.getElementById('nearby-stops-container');

    if (radarBtn) {
      radarBtn.classList.add('spin-animation');
      radarBtn.disabled = true;
    }

    // Switch to search/map tab if not active
    if (window.App && window.App.activeTab !== 'search') {
      window.App.switchTab('search');
    }

    // If user's location is already known, immediately fit map to area around user
    if (window.App && window.App.userLocation && window.App.mapManager) {
      window.App.mapManager.fitAreaAroundUser(
        window.App.userLocation.lat,
        window.App.userLocation.lng,
        this.nearbyStops,
        350
      );
    }

    // Smooth scroll to map container if not silent
    const mapCard = document.getElementById('map-container');
    if (mapCard && !silent) {
      mapCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const fallbackToCenter = async () => {
      const lat = 37.9845;
      const lng = 23.7335;
      if (window.App) window.App.setUserLocation(lat, lng);
      if (window.App && window.App.mapManager) {
        window.App.mapManager.fitAreaAroundUser(lat, lng, this.nearbyStops, 350);
      }
      try {
        const stops = await window.API.getClosestStops(lat, lng);
        this.nearbyStops = Array.isArray(stops) ? stops : [];
        this.sortStopsWithFavorites();
        this.renderNearbyStops(lat, lng);
        if (window.App && window.App.mapManager) {
          window.App.mapManager.renderNearbyStops(this.nearbyStops);
        }
        if (window.App && window.App.ticker && !window.App.currentStop) {
          window.App.ticker.render();
        }
      } catch (err) {
        if (container) {
          container.innerHTML = `<div class="m3-card" style="color: var(--md-sys-color-error); padding: 1rem;">Αδυναμία φόρτωσης κοντινών στάσεων: ${err.message}</div>`;
        }
      } finally {
        if (radarBtn) {
          radarBtn.classList.remove('spin-animation');
          radarBtn.disabled = false;
        }
      }
    };

    if (!navigator.geolocation) {
      if (!silent) alert('Η γεωγραφική τοποθεσία δεν υποστηρίζεται. Χρήση κέντρου Αθήνας.');
      await fallbackToCenter();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        if (window.App) {
          window.App.setUserLocation(latitude, longitude);
        }
        if (window.App && window.App.mapManager) {
          window.App.mapManager.fitAreaAroundUser(latitude, longitude, this.nearbyStops, 350);
        }

        try {
          const stops = await window.API.getClosestStops(latitude, longitude);
          this.nearbyStops = Array.isArray(stops) ? stops : [];
          this.sortStopsWithFavorites();
          this.renderNearbyStops(latitude, longitude);
          if (window.App && window.App.mapManager) {
            window.App.mapManager.renderNearbyStops(this.nearbyStops);
          }
          if (window.App && window.App.ticker && !window.App.currentStop) {
            window.App.ticker.render();
          }
        } catch (err) {
          if (container) {
            container.innerHTML = `
              <div class="m3-card" style="color: var(--md-sys-color-error); padding: 1rem;">
                Αδυναμία φόρτωσης κοντινών στάσεων: ${err.message}
              </div>
            `;
          }
        } finally {
          if (radarBtn) {
            radarBtn.classList.remove('spin-animation');
            radarBtn.disabled = false;
          }
        }
      },
      async (err) => {
        console.warn('Geolocation fallback to Athens center:', err.message);
        await fallbackToCenter();
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  /**
   * Sort stops: Favorites with routes first, then active routes, stops with no routes at the bottom
   */
  sortStopsWithFavorites() {
    if (!Array.isArray(this.nearbyStops)) return;
    this.nearbyStops.sort((a, b) => {
      const aHas = Array.isArray(a.serving_lines) && a.serving_lines.length > 0;
      const bHas = Array.isArray(b.serving_lines) && b.serving_lines.length > 0;

      // FIRST: Stops with NO routes/arrivals always go strictly to the bottom
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;

      const isFavA = window.Favorites && window.Favorites.isStopFav(a.StopCode);
      const isFavB = window.Favorites && window.Favorites.isStopFav(b.StopCode);

      if (isFavA && !isFavB) return -1;
      if (!isFavA && isFavB) return 1;

      // Sort by walking distance
      return (a.distanceMeters || 0) - (b.distanceMeters || 0);
    });

    // Strictly limit to 20 nearest stops
    if (this.nearbyStops.length > 20) {
      this.nearbyStops = this.nearbyStops.slice(0, 20);
    }
  }

  toggleShowAllNearby() {
    this.showAllNearby = !this.showAllNearby;
    const uLat = window.App && window.App.userLocation ? window.App.userLocation.lat : null;
    const uLng = window.App && window.App.userLocation ? window.App.userLocation.lng : null;
    this.renderNearbyStops(uLat, uLng);
  }

  /**
   * Reload stops for specific coordinates (e.g. when user moves the map)
   */
  async findNearbyStopsForCoords(lat, lng) {
    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (isNaN(pLat) || isNaN(pLng)) return;
    try {
      const stops = await window.API.getClosestStops(pLat, pLng);
      if (Array.isArray(stops) && stops.length > 0) {
        this.nearbyStops = stops;
        this.sortStopsWithFavorites();
        const uLat = window.App && window.App.userLocation ? window.App.userLocation.lat : pLat;
        const uLng = window.App && window.App.userLocation ? window.App.userLocation.lng : pLng;
        this.renderNearbyStops(uLat, uLng);
        if (window.App && window.App.mapManager) {
          window.App.mapManager.renderNearbyStops(this.nearbyStops);
        }
        if (window.App && window.App.ticker && !window.App.currentStop) {
          window.App.ticker.render();
        }
      }
    } catch (err) {
      console.warn('Failed to reload stops for coordinates:', err);
    }
  }

  renderNearbyStops(userLat, userLng) {
    const container = document.getElementById('nearby-stops-container');
    if (!container) return;

    if (this.nearbyStops.length === 0) {
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #64748b; font-size: 0.9rem;">
          Δεν βρέθηκαν στάσεις κοντά σας στην περιοχή Αθηνών.
        </div>
      `;
      return;
    }

    const displayStops = this.nearbyStops.slice(0, 20);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin: 0.5rem 0 0.75rem;">
        <div style="font-size: 0.85rem; font-weight: 800; color: var(--md-sys-color-primary); text-transform: uppercase; letter-spacing: 0.05em;">
          Στάσεις Κοντά Σας (${displayStops.length})
        </div>
      </div>
      <div style="display: grid; gap: 0.6rem;">
        ${displayStops.map(s => {
          const stopLat = parseFloat(s.StopLat);
          const stopLng = parseFloat(s.StopLng);
          let distanceMeters = 0;
          let walkMins = 2;
          if (userLat && userLng && !isNaN(stopLat) && !isNaN(stopLng)) {
            if (window.App && window.App.ticker && typeof window.App.ticker.calculateWalkingDistance === 'function') {
              distanceMeters = Math.round(window.App.ticker.calculateWalkingDistance(userLat, userLng, stopLat, stopLng));
            } else {
              const dLatM = Math.abs(stopLat - userLat) * 111139;
              const avgLat = ((userLat + stopLat) / 2) * Math.PI / 180;
              const dLngM = Math.abs(stopLng - userLng) * (111139 * Math.cos(avgLat));
              distanceMeters = Math.round((dLatM + dLngM) * 1.25);
            }
            walkMins = Math.ceil(distanceMeters / 75) + 2;
          }

          const stopTitle = s.StopDescr || ('Στάση #' + s.StopCode);
          const safeTitle = stopTitle.replace(/'/g, "\\'");

          const hasRoutes = Array.isArray(s.serving_lines) && s.serving_lines.length > 0;
          let linesHtml = '';
          if (hasRoutes) {
            linesHtml = `
              <div style="margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.35rem;">
                ${s.serving_lines.map(l => `
                  <span class="m3-badge" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); font-size: 0.75rem; padding: 2px 7px; border: 1px solid var(--md-sys-color-outline-variant);">
                    <strong style="color: var(--md-sys-color-primary);">${l.line_id}</strong>
                    <span style="color: var(--md-sys-color-outline); margin: 0 3px;">προς</span>
                    <span>${l.last_stop}</span>
                  </span>
                `).join('')}
              </div>
            `;
          } else {
            linesHtml = `
              <div style="margin-top: 0.45rem; display: flex; align-items: center; gap: 5px; font-size: 0.72rem; color: #94a3b8; font-style: italic;">
                <span>⚠️ Δεν διέρχονται ενεργές γραμμές</span>
              </div>
            `;
          }

          const isFav = window.Favorites && window.Favorites.isStopFav(s.StopCode);

          return `
            <div class="m3-card stop-interactive-card" data-stop-code="${s.StopCode}" data-stop-title="${safeTitle}" data-stop-lat="${s.StopLat}" data-stop-lng="${s.StopLng}" style="display: flex; flex-direction: column; padding: 0.9rem 1.1rem; cursor: pointer; background: ${isFav ? '#fffdf5' : (hasRoutes ? 'var(--md-sys-color-surface-container)' : '#f8fafc')}; margin-bottom: 0; border: ${isFav ? '2px solid #eab308' : (hasRoutes ? '1px solid var(--md-sys-color-outline-variant)' : '1px dashed #cbd5e1')}; opacity: ${hasRoutes ? '1' : '0.8'};" onclick="window.App.selectStop('${s.StopCode}', '${safeTitle}', '${s.StopLat}', '${s.StopLng}')">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
                <div style="min-width: 0; flex: 1;">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    ${isFav ? '<span class="m3-badge" style="background: #fef08a; color: #854d0e; font-size: 0.68rem; font-weight: 800;">⭐ Αγαπημένη</span>' : ''}
                    <div style="font-weight: 800; font-size: 0.94rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${stopTitle}</div>
                  </div>
                  <div style="font-size: 0.75rem; color: var(--md-sys-color-outline); margin-top: 3px;">
                    ${s.StopStreet ? s.StopStreet + ' • ' : ''}Στάση #${s.StopCode}
                  </div>
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                  <div style="font-weight: 800; font-size: 0.85rem; color: var(--md-sys-color-primary); background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 2px 8px;">
                    🚶 ${walkMins}λ
                  </div>
                  <div style="font-size: 0.7rem; color: var(--md-sys-color-outline); margin-top: 3px;">
                    ${distanceMeters}μ.
                  </div>
                </div>
              </div>
              ${linesHtml}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}

window.Search = new SearchManager();
