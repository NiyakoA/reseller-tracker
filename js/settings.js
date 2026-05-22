// settings.js — Settings page: theme, backup/restore, categories, profit calculator

const Settings = {
  init() { this._render(); },

  _render() {
    const el = document.getElementById('page-settings');
    if (!el) return;
    el.innerHTML = `<div class="settings-grid">
      ${this._cardAppearance()}
      ${this._cardData()}
      ${this._cardBusiness()}
      ${this._cardCategories()}
      ${this._cardCalculator()}
      ${this._cardBreakEven()}
      ${this._cardDanger()}
    </div>`;
    this._bind();
  },

  // ── Card builders ────────────────────────────────────────────────
  _cardAppearance() {
    const theme = document.documentElement.getAttribute('data-theme');
    return `
      <div class="settings-card">
        <h3>🎨 Appearance</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">Color Theme</div>
            <div class="settings-sub">Changes the look across the entire app instantly.</div>
          </div>
          <div class="theme-seg">
            <button class="theme-seg-btn ${theme === 'dark'  ? 'active' : ''}" data-t="dark">🌙 Dark</button>
            <button class="theme-seg-btn ${theme === 'light' ? 'active' : ''}" data-t="light">☀️ Light</button>
          </div>
        </div>
      </div>`;
  },

  _cardData() {
    const pc = DB.getPurchases().length;
    const sc = DB.getSales().length;
    const oc = DB.getOverhead().length;
    const { used, cap, pct } = DB.getStorageInfo();
    const usedKB = (used / 1024).toFixed(1);
    const capMB  = (cap  / 1024 / 1024).toFixed(0);
    const barColor = pct >= 80 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--accent)';
    return `
      <div class="settings-card">
        <h3>💾 Data Management</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
          ${pc} purchase${pc !== 1 ? 's' : ''} · ${sc} sale${sc !== 1 ? 's' : ''} · ${oc} expense${oc !== 1 ? 's' : ''}
        </p>
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span style="font-weight:600;color:var(--text-muted)">Local Storage</span>
            <span style="color:${barColor};font-weight:700">${usedKB} KB / ~${capMB} MB (${pct.toFixed(1)}%)</span>
          </div>
          <div style="height:6px;background:var(--surface2);border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct.toFixed(1)}%;background:${barColor};border-radius:99px;transition:width .3s ease"></div>
          </div>
          ${pct >= 80 ? `<p style="font-size:11px;color:var(--red);margin-top:4px">⚠ Almost full — export a backup and consider clearing old data.</p>` : ''}
        </div>
        <div class="settings-action-list">
          <div class="settings-action-row">
            <div>
              <div class="settings-label">Export Backup</div>
              <div class="settings-sub">Download all data as a dated JSON file.</div>
            </div>
            <button id="s-export" class="btn-secondary" style="white-space:nowrap">⬇ Export JSON</button>
          </div>
          <div class="settings-action-row">
            <div>
              <div class="settings-label">Restore from Backup</div>
              <div class="settings-sub">Overwrites current data. Cannot be undone.</div>
            </div>
            <label class="btn-secondary" style="cursor:pointer;white-space:nowrap">
              ⬆ Restore JSON
              <input type="file" id="s-restore-input" accept=".json" style="display:none">
            </label>
          </div>
        </div>
      </div>`;
  },

  _cardCategories() {
    const custom   = DB.getSettings().customCategories || [];
    const builtin  = DB.CATEGORIES;
    return `
      <div class="settings-card">
        <h3>🏷️ Item Categories</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
          Custom categories appear in the Purchase add/edit form.
        </p>
        <div class="category-chips" style="margin-bottom:14px">
          ${builtin.map(c => `
            <span class="category-chip">
              ${c} <span style="color:var(--text-muted);font-size:10px;margin-left:2px">🔒</span>
            </span>`).join('')}
          ${custom.map(c => `
            <span class="category-chip custom">
              ${c}
              <button class="chip-remove" data-rm="${c}" title="Remove ${c}">×</button>
            </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <input type="text" id="s-new-cat" class="search-input" placeholder="New category name…" style="flex:1;min-width:0">
          <button id="s-add-cat" class="btn-primary">+ Add</button>
        </div>
      </div>`;
  },

  _cardCalculator() {
    return `
      <div class="settings-card">
        <h3>💰 Profit Calculator</h3>
        <div class="calc-grid">
          <div class="form-group">
            <label>Buy Price / Unit ($)</label>
            <input type="number" id="s-buy" class="calc-input" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Sell Price / Unit ($)</label>
            <input type="number" id="s-sell" class="calc-input" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Quantity</label>
            <input type="number" id="s-qty" class="calc-input" min="1" value="1">
          </div>
        </div>
        <div id="s-calc-result" class="calc-result">
          <div class="calc-stat"><span class="calc-label">Profit</span><span class="calc-value">—</span></div>
          <div class="calc-stat"><span class="calc-label">Margin</span><span class="calc-value">—</span></div>
          <div class="calc-stat"><span class="calc-label">ROI</span><span class="calc-value">—</span></div>
          <div class="calc-stat"><span class="calc-label">Revenue</span><span class="calc-value">—</span></div>
          <div class="calc-stat"><span class="calc-label">Total Cost</span><span class="calc-value">—</span></div>
        </div>
      </div>`;
  },

  _cardBusiness() {
    const s = DB.getSettings();
    const taxRate    = s.taxRate    ?? 25;
    const monthlyGoal = s.monthlyGoal ?? 0;
    return `
      <div class="settings-card">
        <h3>💼 Business Settings</h3>
        <div class="modal-form" style="gap:14px">
          <div class="form-group">
            <label>Tax Rate %</label>
            <input type="number" id="s-tax-rate" class="calc-input" min="0" max="100" step="0.1" value="${taxRate}" placeholder="25">
          </div>
          <div class="form-group">
            <label>Monthly Profit Goal ($)</label>
            <input type="number" id="s-monthly-goal" class="calc-input" min="0" step="1" value="${monthlyGoal}" placeholder="0">
          </div>
        </div>
      </div>`;
  },

  _cardBreakEven() {
    return `
      <div class="settings-card">
        <h3>📊 Break-Even Finder</h3>
        <div class="calc-grid" style="margin-bottom:14px">
          <div class="form-group">
            <label>Total Lot Cost ($)</label>
            <input type="number" id="be-cost" class="calc-input" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Platform Fee %</label>
            <input type="number" id="be-fee" class="calc-input" min="0" max="100" step="0.1" value="12.9">
          </div>
          <div class="form-group">
            <label>Shipping / Unit ($)</label>
            <input type="number" id="be-ship" class="calc-input" min="0" step="0.01" value="0" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Target Margin %</label>
            <input type="number" id="be-margin" class="calc-input" min="0" max="100" step="0.1" value="20">
          </div>
        </div>
        <div id="be-result" class="table-scroll"></div>
      </div>`;
  },

  _cardDanger() {
    return `
      <div class="settings-card danger-zone" style="grid-column:1/-1">
        <h3 style="color:var(--red)">⚠️ Danger Zone</h3>
        <div class="settings-action-row">
          <div>
            <div class="settings-label">Clear All Data</div>
            <div class="settings-sub">Permanently deletes all purchases, sales, overhead expenses, and inventory notes. Cannot be undone.</div>
          </div>
          <button id="s-clear-btn" class="btn-danger">Clear All Data</button>
        </div>
        <div id="s-clear-confirm" style="display:none;margin-top:16px;padding:16px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3);border-radius:8px">
          <p style="font-size:13px;margin-bottom:10px;color:var(--red)">
            Type <strong>DELETE</strong> in the box below to confirm. All data will be erased.
          </p>
          <div style="display:flex;gap:8px">
            <input type="text" id="s-clear-input" class="search-input" placeholder="Type DELETE…" style="flex:1">
            <button id="s-clear-go" class="btn-danger" disabled style="opacity:.4">Erase Everything</button>
          </div>
        </div>
      </div>`;
  },

  // ── Event binding ────────────────────────────────────────────────
  _bind() {
    // Theme
    document.querySelectorAll('.theme-seg-btn[data-t]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof applyTheme === 'function') applyTheme(btn.dataset.t);
        this._render();
      });
    });

    // Export backup
    document.getElementById('s-export')?.addEventListener('click', () => this._exportBackup());

    // Restore backup
    document.getElementById('s-restore-input')?.addEventListener('change', e => {
      if (e.target.files[0]) this._restoreBackup(e.target.files[0]);
    });

    // Add category
    const addCat = () => {
      const inp = document.getElementById('s-new-cat');
      const name = inp?.value.trim();
      if (!name) return;
      DB.addCategory(name);
      Toast.show(`Category "${name}" added ✓`);
      this._render();
    };
    document.getElementById('s-add-cat')?.addEventListener('click', addCat);
    document.getElementById('s-new-cat')?.addEventListener('keydown', e => { if (e.key === 'Enter') addCat(); });

    // Remove custom categories
    document.querySelectorAll('.chip-remove[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        DB.removeCustomCategory(btn.dataset.rm);
        Toast.show(`Category removed.`);
        this._render();
      });
    });

    // Business settings
    document.getElementById('s-tax-rate')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) DB.saveSetting('taxRate', v);
    });
    document.getElementById('s-monthly-goal')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) DB.saveSetting('monthlyGoal', v);
    });

    // Break-even calculator
    ['be-cost','be-fee','be-ship','be-margin'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => this._calcBreakEven());
    });
    this._calcBreakEven();

    // Profit calculator
    ['s-buy','s-sell','s-qty'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => this._calcProfit());
    });

    // Danger zone
    document.getElementById('s-clear-btn')?.addEventListener('click', () => {
      document.getElementById('s-clear-confirm').style.display = 'block';
      document.getElementById('s-clear-input')?.focus();
    });
    document.getElementById('s-clear-input')?.addEventListener('input', e => {
      const ok = e.target.value === 'DELETE';
      const btn = document.getElementById('s-clear-go');
      if (btn) { btn.disabled = !ok; btn.style.opacity = ok ? '1' : '.4'; }
    });
    document.getElementById('s-clear-go')?.addEventListener('click', () => {
      DB.clearAll();
      Toast.show('All data cleared. Reloading…');
      setTimeout(() => location.reload(), 1500);
    });
  },

  // ── Actions ──────────────────────────────────────────────────────
  _exportBackup() {
    const json = JSON.stringify(DB.exportBackup(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `reseller-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('Backup downloaded ✓');
  },

  _restoreBackup(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target.result);
        DB.importBackup(json);
        Toast.show('Backup restored ✓  Reloading…');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        Toast.error('Invalid backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
  },

  _calcBreakEven() {
    const lotCost  = parseFloat(document.getElementById('be-cost')?.value)   || 0;
    const feePct   = parseFloat(document.getElementById('be-fee')?.value)    || 0;
    const shipping = parseFloat(document.getElementById('be-ship')?.value)   || 0;
    const margin   = parseFloat(document.getElementById('be-margin')?.value) || 0;
    const el = document.getElementById('be-result');
    if (!el) return;

    const feeRate    = feePct  / 100;
    const marginRate = margin  / 100;
    const denom      = 1 - feeRate - marginRate;

    if (lotCost <= 0 || denom <= 0) {
      el.innerHTML = '<p class="empty-msg">Enter a lot cost (and ensure fee + margin < 100%).</p>';
      return;
    }

    const qtys = [1, 2, 3, 5, 10, 20, 50];
    const rows = qtys.map(qty => {
      const costPerUnit  = lotCost / qty;
      const minSell      = costPerUnit / denom + shipping;
      const profitPerUnit = minSell * (1 - feeRate) - costPerUnit - shipping;
      const totalProfit  = profitPerUnit * qty;
      return { qty, costPerUnit, minSell, profitPerUnit, totalProfit };
    });

    el.innerHTML = `
      <table class="mini-table">
        <thead><tr>
          <th>Qty</th><th>Cost/Unit</th><th>Min Sell Price</th><th>Profit/Unit</th><th>Total Profit</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="fw">${r.qty}</td>
            <td>$${r.costPerUnit.toFixed(2)}</td>
            <td style="font-weight:700">$${r.minSell.toFixed(2)}</td>
            <td class="${r.profitPerUnit >= 0 ? 'c-green' : 'c-red'}">$${r.profitPerUnit.toFixed(2)}</td>
            <td class="${r.totalProfit >= 0 ? 'c-green' : 'c-red'}" style="font-weight:700">$${r.totalProfit.toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  },

  _calcProfit() {
    const buy  = parseFloat(document.getElementById('s-buy')?.value)  || 0;
    const sell = parseFloat(document.getElementById('s-sell')?.value) || 0;
    const qty  = parseInt(document.getElementById('s-qty')?.value)    || 1;

    const cost   = buy  * qty;
    const rev    = sell * qty;
    const profit = rev  - cost;
    const margin = rev    > 0 ? (profit / rev  * 100) : 0;
    const roi    = cost   > 0 ? (profit / cost * 100) : 0;

    const fmt = (v, prefix = '$') => `${prefix}${Math.abs(v).toFixed(2)}`;
    const col = v => v >= 0 ? 'var(--green)' : 'var(--red)';

    document.getElementById('s-calc-result').innerHTML = `
      <div class="calc-stat">
        <span class="calc-label">Profit</span>
        <span class="calc-value" style="color:${col(profit)}">${profit < 0 ? '-' : ''}${fmt(profit)}</span>
      </div>
      <div class="calc-stat">
        <span class="calc-label">Margin</span>
        <span class="calc-value" style="color:${col(margin)}">${margin.toFixed(1)}%</span>
      </div>
      <div class="calc-stat">
        <span class="calc-label">ROI</span>
        <span class="calc-value" style="color:${col(roi)}">${roi.toFixed(1)}%</span>
      </div>
      <div class="calc-stat">
        <span class="calc-label">Revenue</span>
        <span class="calc-value">${fmt(rev)}</span>
      </div>
      <div class="calc-stat">
        <span class="calc-label">Total Cost</span>
        <span class="calc-value">${fmt(cost)}</span>
      </div>`;
  },
};
