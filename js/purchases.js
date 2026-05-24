// purchases.js — Purchases page: table, add/edit modal, search/filter

const Purchases = {
  table: null,
  editingId: null,
  rangeKey: 'rt_range_purchases',
  _search: '',
  _cat: '',
  _initialized: false,
  _selected: new Set(),

  CAT_COLORS: {
    'Pokemon': '#f59e0b', 'Coins': '#10b981',
    'Sports Cards': '#3b82f6', 'Sneakers': '#8b5cf6', 'Other': '#6b7280',
  },

  init() {
    if (!this._initialized) {
      this._initialized = true;
      this._populateCatFilter();
      this._bindToolbar();
    }
    if (!this.table) this._initTable();
    this._renderTimeRange();
    this._refresh();
  },

  // ── Date range ──────────────────────────────────────────────────
  _getRange() { return localStorage.getItem(this.rangeKey) || 'lifetime'; },

  _computeDates() {
    const rk = this._getRange();
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (rk === '1w')  { const s = new Date(today); s.setDate(s.getDate() - 7);   s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === '1m')  { const s = new Date(today); s.setDate(s.getDate() - 30);  s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === '3m')  { const s = new Date(today); s.setMonth(s.getMonth() - 3); s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === '6m')  { const s = new Date(today); s.setMonth(s.getMonth() - 6); s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === 'ytd') { return { start: new Date(today.getFullYear(), 0, 1), end: today }; }
    if (rk === '1y')  { const s = new Date(today); s.setFullYear(s.getFullYear() - 1); s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === 'custom') {
      const cs = localStorage.getItem('rt_purch_cs'), ce = localStorage.getItem('rt_purch_ce');
      return { start: cs ? new Date(cs + 'T00:00:00') : null, end: ce ? new Date(ce + 'T23:59:59') : null };
    }
    return { start: null, end: null };
  },

  _getFilteredData() {
    const { start, end } = this._computeDates();
    const s = this._search.toLowerCase();
    return DB.getPurchases().filter(p => {
      if (start || end) {
        const d = new Date(p.dateBought + 'T12:00:00');
        if (start && d < start) return false;
        if (end   && d > end)   return false;
      }
      if (this._cat && p.category !== this._cat) return false;
      if (s && !((p.productName || '').toLowerCase().includes(s) ||
                 (p.sku  || '').toLowerCase().includes(s) ||
                 (p.store || '').toLowerCase().includes(s))) return false;
      return true;
    });
  },

  // ── Time-range bar ──────────────────────────────────────────────
  _renderTimeRange() {
    const bar = document.getElementById('purch-time-range');
    if (!bar) return;
    const active = this._getRange();
    const opts = [
      { key: '1w', label: '1W' }, { key: '1m', label: '1M' },
      { key: '3m', label: '3M' }, { key: '6m', label: '6M' }, { key: 'ytd', label: 'YTD' },
      { key: '1y', label: '1Y' }, { key: 'lifetime', label: 'Lifetime' }, { key: 'custom', label: 'Custom' },
    ];
    bar.innerHTML = `
      <div class="time-range-pills">
        ${opts.map(o => `<button class="range-pill ${active === o.key ? 'active' : ''}" data-range="${o.key}">${o.label}</button>`).join('')}
      </div>
      <div class="custom-range-inputs ${active === 'custom' ? '' : 'hidden'}">
        <input type="date" id="purch-cs" value="${localStorage.getItem('rt_purch_cs') || ''}">
        <span style="color:var(--text-muted)">→</span>
        <input type="date" id="purch-ce" value="${localStorage.getItem('rt_purch_ce') || ''}">
        <button class="btn-sm" id="purch-apply">Apply</button>
      </div>`;

    bar.querySelectorAll('.range-pill').forEach(b => b.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, b.dataset.range);
      this._renderTimeRange();
      this._refresh();
    }));
    bar.querySelector('#purch-apply')?.addEventListener('click', () => {
      localStorage.setItem('rt_purch_cs', document.getElementById('purch-cs').value);
      localStorage.setItem('rt_purch_ce', document.getElementById('purch-ce').value);
      this._refresh();
    });
  },

  // ── Summary bar ─────────────────────────────────────────────────
  _renderSummary(data) {
    const el = document.getElementById('purch-summary');
    if (!el) return;
    const spent = data.reduce((a, p) => a + p.totalCost, 0);
    const items = data.reduce((a, p) => a + p.qtyBought, 0);
    const avg   = items > 0 ? spent / items : 0;
    el.innerHTML = `
      <div class="summary-bar">
        <div class="summary-stat"><span class="summary-label">Total Spent</span><span class="summary-value">$${spent.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Total Items</span><span class="summary-value">${items.toLocaleString()}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Avg Unit Cost</span><span class="summary-value">$${avg.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Entries</span><span class="summary-value">${data.length}</span></div>
      </div>`;
  },

  // ── Bulk actions ────────────────────────────────────────────────
  _renderBulkBar() {
    const bar     = document.getElementById('purch-bulk');
    const countEl = document.getElementById('purch-bulk-count');
    if (!bar) return;
    const n = this._selected?.size ?? 0;
    bar.classList.toggle('visible', n > 0);
    if (n > 0 && countEl) countEl.textContent = `${n} selected`;
  },

  _updateSelectAll() {
    const cb = document.getElementById('purch-sel-all');
    if (!cb) return;
    const data = this._getFilteredData();
    const allChecked = data.length > 0 && data.every(r => this._selected.has(r.id));
    cb.checked       = allChecked;
    cb.indeterminate = this._selected.size > 0 && !allChecked;
  },

  async _bulkDelete() {
    const ids = [...this._selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} purchase${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await Promise.all(ids.map(id => DB.deletePurchase(id)));
      this._selected.clear();
      this._refresh();
      Toast.show(`Deleted ${ids.length} purchase${ids.length > 1 ? 's' : ''}.`);
    } catch (e) {
      Toast.error(e.body?.message || e.message);
    }
  },

  _bulkEdit() {
    const ids = [...this._selected];
    if (!ids.length) return;
    const mkOpts = arr => arr.map(v => `<option value="${v}">${v}</option>`).join('');
    const fieldOpts = {
      category:       mkOpts(DB.getCategories()),
      store:          mkOpts(DB.STORES),
      purchaseMethod: mkOpts(DB.PURCHASE_METHODS),
      condition:      mkOpts(DB.CONDITIONS),
    };
    const body = `
      <div class="modal-form">
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:2px">
          Applying to <strong style="color:var(--text)">${ids.length} purchase${ids.length > 1 ? 's' : ''}</strong>:
        </p>
        <div class="form-row">
          <div class="form-group">
            <label>Field to Update</label>
            <select id="be-field">
              <option value="category">Category</option>
              <option value="store">Store / Source</option>
              <option value="purchaseMethod">Purchase Method</option>
              <option value="condition">Condition</option>
            </select>
          </div>
          <div class="form-group" id="be-val-wrap">
            <label>New Value</label>
            <select id="be-val">${fieldOpts.category}</select>
          </div>
        </div>
      </div>`;

    Modal.open(`Bulk Edit Purchases`, body, async () => {
      const field = document.getElementById('be-field')?.value;
      const val   = document.getElementById('be-val')?.value;
      if (!field || val === undefined) return false;
      try {
        await Promise.all(ids.map(id => DB.updatePurchase(id, { [field]: val })));
        this._selected.clear();
        this._refresh();
        Toast.show(`Updated ${ids.length} purchase${ids.length > 1 ? 's' : ''} ✓`);
      } catch (e) {
        Toast.error(e.body?.message || e.message);
      }
      return true;
    });

    document.getElementById('be-field')?.addEventListener('change', e => {
      const wrap = document.getElementById('be-val-wrap');
      if (wrap) wrap.innerHTML = `<label>New Value</label><select id="be-val">${fieldOpts[e.target.value] || ''}</select>`;
    });
  },

  // ── SimpleTable ─────────────────────────────────────────────────
  _initTable() {
    const C = this.CAT_COLORS;
    this.table = new SimpleTable('purch-table', [
      { title: '<input type="checkbox" id="purch-sel-all" style="cursor:pointer" title="Select all">',
        field: 'id', sortable: false, width: '36px', align: 'center',
        formatter: (v, row) => `<input type="checkbox" class="row-cb" data-id="${row.id}" ${this._selected.has(row.id) ? 'checked' : ''} style="cursor:pointer">` },
      { title:'#', field:'id', width:'52px', align:'center', sortable:true },
      { title:'Date', field:'dateBought', sortable:true,
        formatter: v => v ? new Date(v+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—' },
      { title:'Product', field:'productName', sortable:true,
        formatter: v => `<span style="font-weight:600">${v||'—'}</span>` },
      { title:'Category', field:'category', sortable:true,
        formatter: v => { const c=C[v]||'#6b7280'; return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;background:${c}22;color:${c}">${v||'—'}</span>`; }},
      { title:'SKU', field:'sku', sortable:true },
      { title:'Qty', field:'qtyBought', align:'right', sortable:true },
      { title:'Unit $', field:'unitCost', align:'right', sortable:true, formatter: v => '$'+Number(v||0).toFixed(2) },
      { title:'Total', field:'totalCost', align:'right', sortable:true, formatter: v => `<strong>$${Number(v||0).toFixed(2)}</strong>` },
      { title:'Store', field:'store', sortable:true },
      { title:'Method', field:'purchaseMethod', sortable:true },
      { title:'Cond.', field:'condition', sortable:true },
      { title:'Notes', field:'notes', sortable:false, formatter: v => `<span style="color:var(--text-muted);font-size:12px">${v||''}</span>` },
      { title:'💰', field:'category', width:'44px', align:'center', sortable:false,
        formatter: (v, row) => v === 'Pokemon'
          ? `<button class="tbl-btn" data-action="price" data-id="${row.id}" title="Look up price" style="font-size:16px">🔍</button>`
          : '' },
      { title:'', field:'id', sortable:false, width:'72px', align:'center',
        formatter: (v,row) => `<div style="display:flex;gap:5px;justify-content:center"><button class="tbl-btn" data-action="edit" data-id="${row.id}">✏️</button><button class="tbl-btn" data-action="del" data-id="${row.id}">🗑️</button></div>` },
    ], { pageSize:20, placeholder:'No purchases yet. Click "+ Add Purchase" to get started.' });

    document.getElementById('purch-table').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'edit')  this.openModal(id);
      if (btn.dataset.action === 'del')   this._confirmDelete(id);
      if (btn.dataset.action === 'price') {
        const row = DB.getPurchases().find(p => p.id === id);
        if (row) PriceCheck.open(row.productName, row.sku);
      }
    });

    document.getElementById('purch-table').addEventListener('change', e => {
      if (e.target.classList.contains('row-cb')) {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) this._selected.add(id);
        else                  this._selected.delete(id);
        this._renderBulkBar();
        this._updateSelectAll();
      } else if (e.target.id === 'purch-sel-all') {
        if (e.target.checked) this._getFilteredData().forEach(r => this._selected.add(r.id));
        else                  this._selected.clear();
        this._refresh();
      }
    });
  },

  _refresh() {
    const data  = this._getFilteredData();
    const total = DB.getPurchases().length;
    const rk    = this._getRange();

    if (this.table) {
      this.table.opts.placeholder = (data.length === 0 && total > 0 && rk !== 'lifetime')
        ? `No purchases in this date range — <button id="purch-reset-range" style="background:none;border:none;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-decoration:underline">show all time</button>`
        : 'No purchases yet. Click "+ Add Purchase" to get started.';
    }

    this._renderSummary(data);
    this.table?.setData(data);

    document.getElementById('purch-reset-range')?.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, 'lifetime');
      this._renderTimeRange();
      this._refresh();
    });

    this._renderBulkBar();
    this._updateSelectAll();
  },

  // ── Toolbar ─────────────────────────────────────────────────────
  _populateCatFilter() {
    const sel = document.getElementById('purch-filter-cat');
    if (!sel) return;
    DB.CATEGORIES.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  },

  _bindToolbar() {
    document.getElementById('purch-add').addEventListener('click',    () => this.openModal(null));
    document.getElementById('purch-import').addEventListener('click', () => Importer.open('purchases', () => this._refresh()));
    document.getElementById('purch-export').addEventListener('click', () => { this.table?.download('purchases.csv'); });
    document.getElementById('purch-search').addEventListener('input', e => { this._search = e.target.value; this._refresh(); });
    document.getElementById('purch-filter-cat').addEventListener('change', e => { this._cat = e.target.value; this._refresh(); });

    document.getElementById('purch-bulk-del')?.addEventListener('click',   () => this._bulkDelete());
    document.getElementById('purch-bulk-edit')?.addEventListener('click',  () => this._bulkEdit());
    document.getElementById('purch-bulk-clear')?.addEventListener('click', () => { this._selected.clear(); this._refresh(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey &&
          document.getElementById('page-purchases').classList.contains('active') &&
          document.activeElement.tagName === 'BODY') {
        this.openModal(null);
      }
      if (e.key === '/' && document.getElementById('page-purchases').classList.contains('active')) {
        e.preventDefault();
        document.getElementById('purch-search')?.focus();
      }
    });
  },

  // ── Modal ───────────────────────────────────────────────────────
  openModal(id) {
    this.editingId = id;
    const r   = id ? DB.getPurchases().find(p => p.id === id) : null;
    const v   = f => r?.[f] ?? '';
    const sel = (arr, field) => arr.map(o =>
      `<option value="${o}"${v(field) === o ? ' selected' : ''}>${o}</option>`).join('');
    const skus = [...new Set(DB.getPurchases().map(p => p.sku).filter(Boolean))];

    const body = `
      <form id="purch-form" class="modal-form" onsubmit="return false">
        <div class="form-row">
          <div class="form-group">
            <label>Date Bought *</label>
            <input type="date" name="dateBought" value="${v('dateBought')}" required>
          </div>
          <div class="form-group">
            <label>SKU / Item ID</label>
            <input type="text" name="sku" id="p-sku" value="${v('sku')}" list="purch-sku-dl" placeholder="e.g. PKM-001" autocomplete="off">
            <datalist id="purch-sku-dl">${skus.map(s => `<option value="${s}">`).join('')}</datalist>
            <div id="p-sku-warn" style="display:none;margin-top:6px;padding:7px 10px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);border-radius:6px;font-size:12px;align-items:center;justify-content:space-between;gap:8px"></div>
          </div>
        </div>
        <div class="form-group">
          <label>Product Name *</label>
          <input type="text" name="productName" value="${v('productName')}" required placeholder="e.g. Pokemon SV Booster Box">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Category</label>
            <select name="category">${sel(DB.getCategories(), 'category')}</select>
          </div>
          <div class="form-group">
            <label>Condition</label>
            <select name="condition">${sel(DB.CONDITIONS, 'condition')}</select>
          </div>
        </div>
        <div class="form-row three">
          <div class="form-group">
            <label>Quantity *</label>
            <input type="number" name="qtyBought" id="m-qty" value="${v('qtyBought') || 1}" min="1" required>
          </div>
          <div class="form-group">
            <label>Unit Cost ($) *</label>
            <input type="number" name="unitCost" id="m-cost" value="${v('unitCost')}" min="0" step="0.01" required placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Total Cost</label>
            <input type="text" id="m-total" readonly
              value="$${((Number(v('unitCost')) || 0) * (Number(v('qtyBought')) || 1)).toFixed(2)}"
              style="background:var(--surface2);color:var(--text-muted);cursor:default">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Store / Source</label>
            <input type="text" name="store" value="${v('store')}" list="purch-store-dl" placeholder="e.g. Target">
            <datalist id="purch-store-dl">${DB.STORES.map(s => `<option value="${s}">`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label>Purchase Method</label>
            <select name="purchaseMethod">${sel(DB.PURCHASE_METHODS, 'purchaseMethod')}</select>
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes" rows="2" placeholder="Optional notes…">${v('notes')}</textarea>
        </div>
      </form>`;

    Modal.open(id ? 'Edit Purchase' : 'New Purchase', body, () => this._saveModal());

    const calc = () => {
      const q = parseFloat(document.getElementById('m-qty')?.value)  || 0;
      const c = parseFloat(document.getElementById('m-cost')?.value) || 0;
      const t = document.getElementById('m-total');
      if (t) t.value = '$' + (q * c).toFixed(2);
    };
    document.getElementById('m-qty')?.addEventListener('input', calc);
    document.getElementById('m-cost')?.addEventListener('input', calc);

    if (!id) {
      const skuInput = document.getElementById('p-sku');
      const skuWarn  = document.getElementById('p-sku-warn');
      const checkDup = () => {
        if (!skuInput || !skuWarn) return;
        const val = skuInput.value.trim();
        if (!val) { skuWarn.style.display = 'none'; return; }
        const matches = DB.getPurchases().filter(p => p.sku === val);
        if (!matches.length) { skuWarn.style.display = 'none'; return; }
        const latest = matches[matches.length - 1];
        skuWarn.style.display = 'flex';
        skuWarn.innerHTML = `
          <span>⚠ <strong>${val}</strong> already exists — ${latest.productName}</span>
          <button class="btn-sm" id="p-sku-goto" style="font-size:11px;white-space:nowrap">Open existing →</button>`;
        document.getElementById('p-sku-goto')?.addEventListener('click', () => {
          Modal.close();
          this.openModal(latest.id);
        });
      };
      skuInput?.addEventListener('input',  checkDup);
      skuInput?.addEventListener('change', checkDup);
    }
  },

  async _saveModal() {
    const form = document.getElementById('purch-form');
    if (!form?.checkValidity()) { form?.reportValidity(); return false; }
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (this.editingId) {
        await DB.updatePurchase(this.editingId, data);
        Toast.show('Purchase updated ✓');
      } else {
        await DB.addPurchase(data);
        Toast.show('Purchase added ✓');
      }
      this.editingId = null;
      this._refresh();
      return true;
    } catch (e) {
      Toast.error(e.body?.message || e.message);
      return false;
    }
  },

  async _confirmDelete(id) {
    const row = DB.getPurchases().find(p => p.id === id);
    if (!row) return;
    if (confirm(`Delete "${row.productName}"?\n\nThis cannot be undone.`)) {
      try {
        await DB.deletePurchase(id);
        this._selected.delete(id);
        this._refresh();
        Toast.show('Purchase deleted.');
      } catch (e) {
        Toast.error(e.body?.message || e.message);
      }
    }
  },
};
