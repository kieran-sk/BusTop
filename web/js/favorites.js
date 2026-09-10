/**
 * Favorites Manager for Lines and Stops
 * Persistent storage with clear differentiation between Lines and Stops via segmented tabs.
 */

class FavoritesManager {
  constructor() {
    this.favStops = JSON.parse(localStorage.getItem('OASA_FAV_STOPS') || '[]');
    this.favLines = JSON.parse(localStorage.getItem('OASA_FAV_LINES') || '[]');
    this.activeFilter = 'all'; // 'all', 'stops', 'lines'
  }

  save() {
    localStorage.setItem('OASA_FAV_STOPS', JSON.stringify(this.favStops));
    localStorage.setItem('OASA_FAV_LINES', JSON.stringify(this.favLines));
    this.render();
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

    // Segmented tab selector header differentiating Lines and Stops
    const tabsHeaderHtml = `
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; background: var(--md-sys-color-surface-container); padding: 4px; border-radius: 9999px; max-width: 420px;">
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
    `;

    if (totalAll === 0) {
      container.innerHTML = `
        ${tabsHeaderHtml}
        <div class="m3-card" style="text-align: center; padding: 2.5rem 1rem; background: #ffffff;">
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
              <div class="m3-card" style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: #ffffff; border-left: 3.5px solid var(--md-sys-color-primary);" onclick="window.App.selectStop('${s.code}', '${safeName}', '${s.lat || ''}', '${s.lng || ''}')">
                <div style="display: flex; align-items: center; gap: 0.75rem; min-width: 0; flex: 1;">
                  <div class="m3-icon-btn" style="width: 36px; height: 36px; background: #eff6ff; color: var(--md-sys-color-primary); border: 1.5px solid #bfdbfe; flex-shrink: 0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>
                  </div>
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-weight: 800; font-size: 0.95rem; color: #0f172a; line-height: 1.3; word-break: break-word;">${s.name}</div>
                    <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">Στάση #${s.code}</div>
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
        <div style="font-size: 0.85rem; font-weight: 800; color: #047857; margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between;">
          <span>🚌 Αποθηκευμένες Γραμμές (${totalLines})</span>
        </div>
        <div style="display: grid; gap: 0.55rem;">
          ${this.favLines.map(l => {
            const safeDescr = (l.descr || '').replace(/'/g, "\\'");
            return `
              <div class="m3-card" style="display: flex; flex-direction: column; gap: 0.6rem; padding: 0.85rem 1rem; margin-bottom: 0; cursor: pointer; background: #ffffff; border-left: 3.5px solid #047857;" onclick="window.App.openLineTimetableBothDirections('${l.code}', '${l.id}', '${safeDescr}')">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.65rem;">
                  <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
                    <span class="ticker-line-badge" style="font-size: 0.95rem; min-width: 48px; flex-shrink: 0;">
                      ${l.id}
                    </span>
                    <div style="min-width: 0; flex: 1;">
                      <div style="font-weight: 800; font-size: 0.95rem; color: #0f172a; line-height: 1.3; word-break: break-word;">${l.descr}</div>
                      <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">Γραμμή #${l.code}</div>
                    </div>
                  </div>
                  <button class="m3-icon-btn" title="Αφαίρεση" style="width: 32px; height: 32px; color: var(--md-sys-color-error); flex-shrink: 0;" onclick="event.stopPropagation(); window.Favorites.toggleLine('${l.code}', '${l.id}', '${safeDescr}');">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
                <div style="display: flex; align-items: center; justify-content: flex-end; border-top: 1px dashed #e2e8f0; padding-top: 0.4rem;">
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
