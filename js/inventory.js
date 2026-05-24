// inventory.js — Inventory page: derived stock view with listed toggle and notes

const Inventory = {
  table: null,
  _showOOS: false,   // show out-of-stock items
  _search: '',
  _cat: '',
  _initialized: false,

  CAT_COLORS: {
    'Pokemon': '#f59e0b', 'Coins': '#10b981',
    'Sports Cards': '#3b82f6', 'Sneakers': '#8b5cf6', 'Other': '#6b7280',
  },

  init() {
    if (!this._initialized) {
      this._initialized = true;
      this._populateCatFilter();
      this._initTable();
      this._bindToolbar();
    }
    this._refresh();
  },

  // ── Data ────────────────────────────────────────────────────────
  _getFilteredData() {
    const s = this._search.toLowerCase();
    return DB.getInventory().filter(item => {
      if (!this._showOOS && item.qtyInStock <= 0) return false;
      if (this._cat && item.category !== this._cat) return false;
      if (s && !((item.productName || '').toLowerCase().includes(s) ||
                 (item.sku         || '').toLowerCase().includes(s))) return false;
      return true;
    });
  },

  // ── Summary bar ─────────────────────────────────────────────────
  _renderSummary(data) {
    const el = document.getElementById('inv-summary');
    if (!el) return;
    const all      = DB.getInventory();
    const value    = data.reduce((a, i) => a + i.valueInStock, 0);
    const inStock  = data.filter(i => i.qtyInStock > 0).length;
    const listed   = data.filter(i => i.listed).length;
    const lowStock = data.filter(i => i.qtyInStock > 0 && i.qtyInStock <= 2).length;
    const oos      = all.filter(i => i.qtyInStock === 0).length;
    const oversold = all.filter(i => i.qtyInStock < 0).length;

    el.innerHTML = `
      <div class="summary-bar">
        <div class="summary-stat"><span class="summary-label">Inventory Value</span><span class="summary-value">$${value.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">SKUs in Stock</span><span class="summary-value">${inStock}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Listed</span><span class="summary-value">${listed} / ${inStock}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Low Stock</span><span class="summary-value ${lowStock > 0 ? 'c-yellow' : ''}">${lowStock}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Out of Stock</span><span class="summary-value ${oos > 0 ? 'c-red' : ''}">${oos}</span></div>
        ${oversold > 0 ? `
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">⚠ Oversold</span><span class="summary-value c-red">${oversold}</span></div>` : ''}
      </div>`;
  },

  // ── SimpleTable ─────────────────────────────────────────────────
  _initTable() {
    const C = this.CAT_COLORS;
    this.table = new SimpleTable('inv-table', [
      { title:'SKU', field:'sku', sortable:true },
      { title:'Product', field:'productName', sortable:true,
        formatter: v => `<span style="font-weight:600">${v||'—'}</span>` },
      { title:'Category', field:'category', sortable:true,
        formatter: v => { const c=C[v]||'#6b7280'; return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;background:${c}22;color:${c}">${v||'—'}</span>`; }},
      { title:'In Stock', field:'qtyInStock', align:'center', sortable:true,
        formatter: (v, row) => {
          const q = Number(v);
          if (q < 0) return `<strong style="color:var(--red)">⚠ ${q}</strong>`;
          const color = q === 0 ? 'var(--red)' : q <= 2 ? 'var(--yellow)' : 'var(--green)';
          return `<strong style="color:${color}">${q}</strong>`;
        }},
      { title:'Bought', field:'qtyBought', align:'right', sortable:true },
      { title:'Sold', field:'qtySold', align:'right', sortable:true },
      { title:'Unit Cost', field:'unitCost', align:'right', sortable:true,
        formatter: v => '$'+Number(v||0).toFixed(2) },
      { title:'Value', field:'valueInStock', align:'right', sortable:true,
        formatter: v => `<strong>$${Number(v||0).toFixed(2)}</strong>` },
      { title:'Listed?', field:'listed', align:'center', sortable:false,
        formatter: (v, row) => `<button class="listed-btn ${v ? 'is-listed' : ''}" data-action="toggle-listed" data-key="${row._key}" data-val="${v}">
          ${v ? '✅ Listed' : '⬜ Unlisted'}
        </button>` },
      { title:'Notes', field:'notes', sortable:false,
        formatter: (v, row) => {
          const bd = row.brokenDown ? '<span class="badge-bd">broken down</span> ' : '';
          return bd + `<span style="color:var(--text-muted);font-size:12px">${v||''}</span>`;
        }},
      { title:'', field:'_key', sortable:false, width:'72px', align:'center',
        formatter: (v, row) => `
          <div style="display:flex;gap:4px;justify-content:center">
            <button class="tbl-btn" data-action="quick-sell" data-key="${v}" title="Quick Sell"
              ${row.qtyInStock > 0 ? '' : 'disabled style="opacity:.3;cursor:not-allowed"'}>💰</button>
            <button class="tbl-btn" data-action="edit-notes" data-key="${v}" title="Edit notes">📝</button>
          </div>` },
    ], { pageSize:25, placeholder:'No inventory items. Add purchases to see your stock.' });

    // Event delegation
    document.getElementById('inv-table').addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const key = btn.dataset.key;
      if (btn.dataset.action === 'toggle-listed') {
        try {
          await DB.setInvMeta(key, { listed: btn.dataset.val === 'false' || btn.dataset.val === '' ? true : false });
          this._refresh();
        } catch (e) {
          Toast.error(e.body?.message || e.message);
        }
      }
      if (btn.dataset.action === 'quick-sell') {
        const item = DB.getInventory().find(i => i._key === key);
        if (!item || item.qtyInStock <= 0) { Toast.error('No stock available to sell.'); return; }
        Sales.openQuickSell(item);
      }
      if (btn.dataset.action === 'edit-notes') this._openNotesModal(key);
    });
  },

  _refresh() {
    const data = this._getFilteredData();
    this._renderSummary(data);
    this.table?.setData(data);
  },

  // ── Toolbar ─────────────────────────────────────────────────────
  _populateCatFilter() {
    const sel = document.getElementById('inv-filter-cat');
    if (!sel) return;
    DB.CATEGORIES.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  },

  _bindToolbar() {
    document.getElementById('inv-import').addEventListener('click', () => {
      Importer.open('purchases', () => this._refresh());
    });
    document.getElementById('inv-export').addEventListener('click', () => {
      this.table?.download('inventory.csv');
    });
    document.getElementById('inv-search').addEventListener('input', e => {
      this._search = e.target.value;
      this._refresh();
    });
    document.getElementById('inv-filter-cat').addEventListener('change', e => {
      this._cat = e.target.value;
      this._refresh();
    });
    document.getElementById('inv-show-oos').addEventListener('change', e => {
      this._showOOS = e.target.checked;
      this._refresh();
    });

    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.getElementById('page-inventory').classList.contains('active')) {
        e.preventDefault();
        document.getElementById('inv-search')?.focus();
      }
    });
  },

  // ── Notes / broken-down modal ────────────────────────────────────
  _openNotesModal(key) {
    const item = DB.getInventory().find(i => i._key === key);
    const meta = DB.getInvMeta()[key] || {};

    const body = `
      <div class="modal-form">
        <p style="font-weight:600;margin-bottom:4px">${item?.productName || key}</p>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:14px">SKU: ${item?.sku || '—'}</p>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="inv-notes" rows="3" placeholder="Storage location, condition, etc.">${meta.notes || ''}</textarea>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px">
            <input type="checkbox" id="inv-broken" ${meta.brokenDown ? 'checked' : ''} style="width:auto">
            Mark as broken down (e.g. booster box split into packs)
          </label>
        </div>
        <div class="form-group">
          <label>Manual Qty Adjustment</label>
          <input type="number" id="inv-adj" value="${meta.manualAdj || 0}" step="1"
            placeholder="0 = no adjustment (positive adds, negative removes)">
        </div>
      </div>`;

    Modal.open('Edit Item', body, async () => {
      try {
        await DB.setInvMeta(key, {
          notes:      document.getElementById('inv-notes').value,
          brokenDown: document.getElementById('inv-broken').checked,
          manualAdj:  parseInt(document.getElementById('inv-adj').value) || 0,
        });
        this._refresh();
        Toast.show('Item updated ✓');
        return true;
      } catch (e) {
        Toast.error(e.body?.message || e.message);
      }
    });
  },
};
