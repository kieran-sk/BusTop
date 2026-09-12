/**
 * Favorites Manager for Lines and Stops
 * Persistent storage with clear differentiation between Lines and Stops via segmented tabs.
 */

class FavoritesManager {
  constructor() {
    this.favStops = JSON.parse(localStorage.getItem('OASA_FAV_STOPS') || '[]');
    this.favLines = JSON.parse(localStorage.getItem('OASA_FAV_LINES') || '[]');
    this.activeFilter = 'all'; // 'all', 'stops', 'lines'
    this.restoreFromNativeBridge();
  }

  restoreFromNativeBridge() {
    // If running in Android APK and localStorage is empty (e.g. fresh reinstall), restore from native SharedPreferences
    if (window.AndroidBridge && typeof window.AndroidBridge.getSavedFavorites === 'function') {
      try {
        const raw = window.AndroidBridge.getSavedFavorites();
        if (raw && raw !== '{}') {
          const parsed = JSON.parse(raw);
          const stops = typeof parsed.stops === 'string' ? JSON.parse(parsed.stops) : parsed.stops;
          const lines = typeof parsed.lines === 'string' ? JSON.parse(parsed.lines) : parsed.lines;
          let changed = false;
          if (this.favStops.length === 0 && Array.isArray(stops) && stops.length > 0) {
            this.favStops = stops;
            localStorage.setItem('OASA_FAV_STOPS', JSON.stringify(this.favStops));
            changed = true;
          }
          if (this.favLines.length === 0 && Array.isArray(lines) && lines.length > 0) {
            this.favLines = lines;
            localStorage.setItem('OASA_FAV_LINES', JSON.stringify(this.favLines));
            changed = true;
          }
          if (changed) {
            console.log('[Favorites] Restored from Android SharedPreferences auto-backup!');
          }
        }
      } catch (e) {
        console.warn('Could not restore favorites from native bridge:', e);
      }
    }
  }

  save() {
    localStorage.setItem('OASA_FAV_STOPS', JSON.stringify(this.favStops));
    localStorage.setItem('OASA_FAV_LINES', JSON.stringify(this.favLines));
    // Mirror to native Android SharedPreferences for automatic cloud backup
    if (window.AndroidBridge && typeof window.AndroidBridge.syncFavorites === 'function') {
      try {
        window.AndroidBridge.syncFavorites(
          JSON.stringify(this.favStops),
          JSON.stringify(this.favLines)
        );
      } catch (e) {}
    }
    this.render();
    // Quickly refresh other UI components so stars and favorite lists update immediately
    if (window.Search && typeof window.Search.sortStopsWithFavorites === 'function') {
      window.Search.sortStopsWithFavorites();
      const uLat = window.App && window.App.userLocation ? window.App.userLocation.lat : null;
      const uLng = window.App && window.App.userLocation ? window.App.userLocation.lng : null;
      if (typeof window.Search.renderNearbyStops === 'function' && document.getElementById('nearby-stops-container')) {
        window.Search.renderNearbyStops(uLat, uLng);
      }
    }
    if (window.App && window.App.ticker && !window.App.currentStop) {
      window.App.ticker.render();
    }
  }

  exportBackup() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stops: this.favStops,
      lines: this.favLines
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bustop_favorites_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (window.App && typeof window.App.showPushNotification === 'function') {
      window.App.triggerHaptic('success');
    }
  }

  importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (Array.isArray(parsed.stops) || Array.isArray(parsed.lines)) {
          if (Array.isArray(parsed.stops)) {
            // Merge deduplicated stops
            parsed.stops.forEach(s => {
              if (s && s.code && !this.isStopFav(s.code)) {
                this.favStops.push(s);
              }
            });
          }
          if (Array.isArray(parsed.lines)) {
            // Merge deduplicated lines
            parsed.lines.forEach(l => {
              if (l && l.code && !this.isLineFav(l.code)) {
                this.favLines.push(l);
              }
            });
          }
          this.save();
          alert(`Επιτυχής επαναφορά! Αποθηκευμένες: ${this.favStops.length} στάσεις, ${this.favLines.length} γραμμές.`);
        } else {
          alert('Μη έγκυρη μορφή αντιγράφου ασφαλείας.');
        }
      } catch (err) {
        alert('Σφάλμα κατά την ανάγνωση του αρχείου.');
      }
    };
    reader.readAsText(file);
  }

  setFilter(filter) {
    this.activeFilter = filter;
    this.render();
  }

  isStopFav(stopCode) {
    return this.favStops.some(s => String(s.code) === String(stopCode));
  }

  isLineFav(lineCode) {
    return this.favLines.some(l => String(l.code) === String(lineCode));
  }

  toggleStop(stopCode, stopName, lat = null, lng = null) {
    const idx = this.favStops.findIndex(s => String(s.code) === String(stopCode));
    if (idx >= 0) {
      this.favStops.splice(idx, 1);
    } else {
      this.favStops.push({ code: stopCode, name: stopName, lat, lng });
    }
    this.save();
    return this.isStopFav(stopCode);
  }

  toggleLine(lineCode, lineId, lineDescr) {
    const idx = this.favLines.findIndex(l => String(l.code) === String(lineCode));
    if (idx >= 0) {
      this.favLines.splice(idx, 1);
    } else {
      this.favLines.push({ code: lineCode, id: lineId, descr: lineDescr });
    }
    this.save();
    return this.isLineFav(lineCode);
  }

  render(containerId = 'favorites-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalStops = this.favStops.length;
    const totalLines = this.favLines.length;
    const totalAll = totalStops + totalLines;

    // Segmented tab selector header differentiating Lines and Stops, plus Backup / Restore tools
    const tabsHeaderHtml = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.25rem;">
        <div style="display: flex; gap: 0.4rem; background: var(--md-sys-color-surface-container); padding: 4px; border-radius: 9999px; max-width: 420px; flex: 1;">
          <button class="m3-btn ${this.activeFilter === 'all' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="flex: 1; padding: 0.4rem 0.6rem; font-size: 0.8rem; border-radius: 9999px;" onclick="window.Favorites.setFilter('all')">
            Όλα (${totalAll})
          </button>
          <button class="m3-btn ${this.activeFilter === 'stops' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="flex: 1; padding: 0.4rem 0.6rem; font-size: 0.8rem; border-radius: 9999px;" onclick="window.Favorites.setFilter('stops')">
            🚏 Στάσεις (${totalStops})
          </button>
          <button class="m3-btn ${this.activeFilter === 'lines' ? 'm3-btn-primary' : 'm3-btn-tonal'}" style="flex: 1; padding: 0.4rem 0.6rem; font-size: 0.8rem; border-radius: 9999px;" onclick="window.Favorites.setFilter('lines')">
            🚌 Γραμμές (${totalLines})
          </button>
        </div>

        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <button class="m3-btn m3-btn-tonal" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.Favorites.exportBackup()" title="Εξαγωγή αντιγράφου ασφαλείας σε αρχείο .json">
            📤 Αντίγραφο
          </button>
          <label class="m3-btn m3-btn-tonal" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; margin-bottom: 0;" title="Επαναφορά από αρχείο αντιγράφου">
            📥 Επαναφορά
            <input type="file" accept=".json" style="display: none;" onchange="if (this.files[0]) window.Favorites.importBackup(this.files[0])">
          </label>
        </div>
      </div>
    `;

    if (totalAll === 0) {
      container.innerHTML = `
        ${tabsHeaderHtml}
        <div class="m3-card" style="text-align: center; padding: 2.5rem 1rem; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant);">
          <div style="font-weight: 800; font-size: 1.1rem; margin-bottom: 0.5rem; color: var(--md-sys-color-primary);">Δεν υπάρχουν αποθηκευμένα</div>
          <p style="color: var(--md-sys-color-outline); font-size: 0.875rem; max-width: 360px; margin: 0 auto;">
            Αποθηκεύστε τις αγαπημένες σας στάσεις και γραμμές για άμεση πρόσβαση σε αφίξεις και δρομολόγια.
          </p>
        </div>
      `;
      return;
    }

    let contentHtml = '';

    // 1. Render Stops Section
    if ((this.activeFilter === 'all' || this.activeFilter === 'stops') && totalStops > 0) {
      contentHtml += `
        <div style="font-size: 0.85rem; font-weight: 800; color: var(--md-sys-color-primary); margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;">
          <span>🚏 Αποθηκευμένες Στάσεις (${totalStops})</span>
        </div>
        <div style="display: grid; gap: 0.55rem; margin-bottom: 1.5rem;">
          ${this.favStops.map(s => {
            const safeName = (s.name || '').replace(/'/g, "\\'");
            return `
              <div class="m3-card stop-interactive-card" data-stop-code="${s.code}" data-stop-title="${safeName}" data-stop-lat="${s.lat || ''}" data-stop-lng="${s.lng || ''}" style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-left: 3.5px solid var(--md-sys-color-primary);" onclick="window.App.selectStop('${s.code}', '${safeName}', '${s.lat || ''}', '${s.lng || ''}')">
                <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 0; flex: 1;">
                  <div class="m3-icon-btn" style="width: 36px; height: 36px; background: #eff6ff; color: var(--md-sys-color-primary); border: 1.5px solid #bfdbfe; flex-shrink: 0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>
                  </div>
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${s.name}</div>
                    <div style="font-size: 0.75rem; color: var(--md-sys-color-outline); margin-top: 2px;">Στάση #${s.code}</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                  <span class="m3-badge" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-primary); font-size: 0.72rem; font-weight: 700;">
                    Αφίξεις ➔
                  </span>
                  <button class="m3-icon-btn" title="Αφαίρεση" style="width: 32px; height: 32px; color: var(--md-sys-color-error); flex-shrink: 0;" onclick="event.stopPropagation(); window.Favorites.toggleStop('${s.code}', '${safeName}');">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // 2. Render Lines Section
    if ((this.activeFilter === 'all' || this.activeFilter === 'lines') && totalLines > 0) {
      contentHtml += `
        <div style="font-size: 0.85rem; font-weight: 800; color: #10b981; margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;">
          <span>🚌 Αποθηκευμένες Γραμμές (${totalLines})</span>
        </div>
        <div style="display: grid; gap: 0.55rem;">
          ${this.favLines.map(l => {
            const safeDescr = (l.descr || '').replace(/'/g, "\\'");
            return `
              <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-left: 3.5px solid #10b981;" onclick="window.App.openLineTimetableBothDirections('${l.code}', '${l.id}', '${safeDescr}')">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem;">
                  <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
                    <span class="ticker-line-badge" style="font-size: 0.95rem; min-width: 48px; flex-shrink: 0;">
                      ${l.id}
                    </span>
                    <div style="min-width: 0; flex: 1;">
                      <div style="font-weight: 800; font-size: 0.95rem; color: var(--md-sys-color-on-surface); line-height: 1.3; word-break: break-word;">${l.descr}</div>
                      <div style="font-size: 0.75rem; color: var(--md-sys-color-outline); margin-top: 2px;">Γραμμή #${l.code}</div>
                    </div>
                  </div>
                  <button class="m3-icon-btn" title="Αφαίρεση" style="width: 32px; height: 32px; color: var(--md-sys-color-error); flex-shrink: 0;" onclick="event.stopPropagation(); window.Favorites.toggleLine('${l.code}', '${l.id}', '${safeDescr}');">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
                <div style="display: flex; align-items: center; justify-content: flex-end; border-top: 1px dashed var(--md-sys-color-outline-variant); padding-top: 0.4rem;">
                  <span class="m3-badge" style="background: #ecfdf5; color: #047857; font-size: 0.75rem; font-weight: 800; padding: 3px 10px; border-radius: 9999px;">
                    🗺️ Δρομολόγιο &amp; Στάσεις ➔
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    container.innerHTML = tabsHeaderHtml + contentHtml;
  }
}

window.Favorites = new FavoritesManager();
