// sales.js — Sales Log page: table, add/edit modal, search/filter

const Sales = {
  table: null,
  editingId: null,
  rangeKey: 'rt_range_sales',
  _search: '',
  _plat: '',
  _initialized: false,
  _selected: new Set(),

  PLATFORM_FEES: {
    'eBay': 13.25, 'Facebook Marketplace': 5, 'Mercari': 10,
    'OfferUp': 7.9, 'Poshmark': 20, 'Depop': 10,
    'Amazon': 15, 'Etsy': 6.5, 'Tradepost': 0,
    'Marketplace': 0, 'In-Person': 0, 'Other': 0,
  },

  PLAT_COLORS: {
    'eBay': '#e53e3e', 'Facebook Marketplace': '#1877f2', 'Mercari': '#ff2d55',
    'OfferUp': '#6ebe49', 'Poshmark': '#d0274e', 'Depop': '#ff2e55',
    'Amazon': '#ff9900', 'Etsy': '#f56400', 'Tradepost': '#6b7280',
    'Marketplace': '#0866ff', 'In-Person': '#10b981', 'Other': '#6b7280',
  },

  init() {
    if (!this._initialized) {
      this._initialized = true;
      this._populatePlatFilter();
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
      const cs = localStorage.getItem('rt_sales_cs'), ce = localStorage.getItem('rt_sales_ce');
      return { start: cs ? new Date(cs + 'T00:00:00') : null, end: ce ? new Date(ce + 'T23:59:59') : null };
    }
    return { start: null, end: null };
  },

  _getFilteredData() {
    const { start, end } = this._computeDates();
    const s = this._search.toLowerCase();
    return DB.getSales().filter(r => {
      if (start || end) {
        const d = new Date(r.dateSold + 'T12:00:00');
        if (start && d < start) return false;
        if (end   && d > end)   return false;
      }
      if (this._plat && r.platform !== this._plat) return false;
      if (s && !((r.productName || '').toLowerCase().includes(s) ||
                 (r.sku          || '').toLowerCase().includes(s) ||
                 (r.platform     || '').toLowerCase().includes(s))) return false;
      return true;
    });
  },

  // ── Time-range bar ──────────────────────────────────────────────
  _renderTimeRange() {
    const bar = document.getElementById('sales-time-range');
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
        <input type="date" id="sales-cs" value="${localStorage.getItem('rt_sales_cs') || ''}">
        <span style="color:var(--text-muted)">→</span>
        <input type="date" id="sales-ce" value="${localStorage.getItem('rt_sales_ce') || ''}">
        <button class="btn-sm" id="sales-apply">Apply</button>
      </div>`;

    bar.querySelectorAll('.range-pill').forEach(b => b.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, b.dataset.range);
      this._renderTimeRange();
      this._refresh();
    }));
    bar.querySelector('#sales-apply')?.addEventListener('click', () => {
      localStorage.setItem('rt_sales_cs', document.getElementById('sales-cs').value);
      localStorage.setItem('rt_sales_ce', document.getElementById('sales-ce').value);
      this._refresh();
    });
  },

  // ── Summary bar ─────────────────────────────────────────────────
  _renderSummary(data) {
    const el = document.getElementById('sales-summary');
    if (!el) return;
    const rev    = data.reduce((a, r) => a + r.grossRevenue, 0);
    const profit = data.reduce((a, r) => a + r.netProfit,    0);
    const units  = data.reduce((a, r) => a + r.qtySold,      0);
    const margin = rev > 0 ? (profit / rev) * 100 : 0;
    el.innerHTML = `
      <div class="summary-bar">
        <div class="summary-stat"><span class="summary-label">Total Revenue</span><span class="summary-value">$${rev.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat">
          <span class="summary-label">Net Profit</span>
          <span class="summary-value ${profit >= 0 ? 'c-green' : 'c-red'}">$${profit.toFixed(2)}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-stat">
          <span class="summary-label">Avg Margin</span>
          <span class="summary-value ${margin >= 0 ? 'c-green' : 'c-red'}">${margin.toFixed(1)}%</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Units Sold</span><span class="summary-value">${units.toLocaleString()}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Entries</span><span class="summary-value">${data.length}</span></div>
      </div>`;
  },

  // ── Bulk actions ────────────────────────────────────────────────
  _renderBulkBar() {
    const bar     = document.getElementById('sales-bulk');
    const countEl = document.getElementById('sales-bulk-count');
    if (!bar) return;
    const n = this._selected?.size ?? 0;
    bar.classList.toggle('visible', n > 0);
    if (n > 0 && countEl) countEl.textContent = `${n} selected`;
  },

  _updateSelectAll() {
    const cb = document.getElementById('sales-sel-all');
    if (!cb) return;
    const data = this._getFilteredData();
    const allChecked = data.length > 0 && data.every(r => this._selected.has(r.id));
    cb.checked       = allChecked;
    cb.indeterminate = this._selected.size > 0 && !allChecked;
  },

  async _bulkDelete() {
    const ids = [...this._selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} sale${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await Promise.all(ids.map(id => DB.deleteSale(id)));
      this._selected.clear();
      this._refresh();
      Toast.show(`Deleted ${ids.length} sale${ids.length > 1 ? 's' : ''}.`);
    } catch (e) {
      Toast.error(e.body?.message || e.message);
    }
  },

  _bulkEdit() {
    const ids = [...this._selected];
    if (!ids.length) return;
    const mkOpts = arr => arr.map(v => `<option value="${v}">${v}</option>`).join('');
    const fieldOpts = {
      platform:   mkOpts(DB.PLATFORMS),
      saleMethod: mkOpts(DB.SALE_METHODS),
    };
    const body = `
      <div class="modal-form">
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:2px">
          Applying to <strong style="color:var(--text)">${ids.length} sale${ids.length > 1 ? 's' : ''}</strong>:
        </p>
        <div class="form-row">
          <div class="form-group">
            <label>Field to Update</label>
            <select id="be-field">
              <option value="platform">Platform</option>
              <option value="saleMethod">Sale Method</option>
            </select>
          </div>
          <div class="form-group" id="be-val-wrap">
            <label>New Value</label>
            <select id="be-val">${fieldOpts.platform}</select>
          </div>
        </div>
      </div>`;

    Modal.open('Bulk Edit Sales', body, async () => {
      const field = document.getElementById('be-field')?.value;
      const val   = document.getElementById('be-val')?.value;
      if (!field || val === undefined) return false;
      try {
        await Promise.all(ids.map(id => DB.updateSale(id, { [field]: val })));
        this._selected.clear();
        this._refresh();
        Toast.show(`Updated ${ids.length} sale${ids.length > 1 ? 's' : ''} ✓`);
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
    const P = this.PLAT_COLORS;
    this.table = new SimpleTable('sales-table', [
      { title: '<input type="checkbox" id="sales-sel-all" style="cursor:pointer" title="Select all">',
        field: 'id', sortable: false, width: '36px', align: 'center',
        formatter: (v, row) => `<input type="checkbox" class="row-cb" data-id="${row.id}" ${this._selected.has(row.id) ? 'checked' : ''} style="cursor:pointer">` },
      { title:'#', field:'id', width:'52px', align:'center', sortable:true },
      { title:'Date', field:'dateSold', sortable:true,
        formatter: v => v ? new Date(v+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—' },
      { title:'Product', field:'productName', sortable:true,
        formatter: v => `<span style="font-weight:600">${v||'—'}</span>` },
      { title:'SKU', field:'sku', sortable:true },
      { title:'Qty', field:'qtySold', align:'right', sortable:true },
      { title:'Sale$/Unit', field:'salePricePerUnit', align:'right', sortable:true,
        formatter: v => '$'+Number(v||0).toFixed(2) },
      { title:'Revenue', field:'grossRevenue', align:'right', sortable:true,
        formatter: v => `<strong>$${Number(v||0).toFixed(2)}</strong>` },
      { title:'Platform', field:'platform', sortable:true,
        formatter: v => { const c=P[v]||'#6b7280'; return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;background:${c}22;color:${c}">${v||'—'}</span>`; }},
      { title:'Method', field:'saleMethod', sortable:true },
      { title:'Unit Cost', field:'unitCost', align:'right', sortable:true,
        formatter: v => '$'+Number(v||0).toFixed(2) },
      { title:'Profit', field:'netProfit', align:'right', sortable:true,
        formatter: v => { const n=Number(v||0); return `<strong style="color:${n>=0?'var(--green)':'var(--red)'}">$${n.toFixed(2)}</strong>`; }},
      { title:'Margin%', field:'margin', align:'right', sortable:true,
        formatter: v => { const n=Number(v||0); return `<span style="color:${n>=0?'var(--green)':'var(--red)'}">${n.toFixed(1)}%</span>`; }},
      { title:'Notes', field:'notes', sortable:false,
        formatter: v => `<span style="color:var(--text-muted);font-size:12px">${v||''}</span>` },
      { title:'', field:'id', sortable:false, width:'72px', align:'center',
        formatter: (v,row) => `<div style="display:flex;gap:5px;justify-content:center"><button class="tbl-btn" data-action="edit" data-id="${row.id}">✏️</button><button class="tbl-btn" data-action="del" data-id="${row.id}">🗑️</button></div>` },
    ], { pageSize:20, placeholder:'No sales yet. Click "+ Add Sale" to log your first sale.' });

    document.getElementById('sales-table').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'edit') this.openModal(id);
      if (btn.dataset.action === 'del')  this._confirmDelete(id);
    });

    document.getElementById('sales-table').addEventListener('change', e => {
      if (e.target.classList.contains('row-cb')) {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) this._selected.add(id);
        else                  this._selected.delete(id);
        this._renderBulkBar();
        this._updateSelectAll();
      } else if (e.target.id === 'sales-sel-all') {
        if (e.target.checked) this._getFilteredData().forEach(r => this._selected.add(r.id));
        else                  this._selected.clear();
        this._refresh();
      }
    });
  },

  _refresh() {
    const data  = this._getFilteredData();
    const total = DB.getSales().length;
    const rk    = this._getRange();

    if (this.table) {
      this.table.opts.placeholder = (data.length === 0 && total > 0 && rk !== 'lifetime')
        ? `No sales in this date range — <button id="sales-reset-range" style="background:none;border:none;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-decoration:underline">show all time</button>`
        : 'No sales yet. Click "+ Add Sale" to log your first sale.';
    }

    this._renderSummary(data);
    this.table?.setData(data);

    document.getElementById('sales-reset-range')?.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, 'lifetime');
      this._renderTimeRange();
      this._refresh();
    });

    this._renderBulkBar();
    this._updateSelectAll();
  },

  // ── Toolbar ─────────────────────────────────────────────────────
  _populatePlatFilter() {
    const sel = document.getElementById('sales-filter-plat');
    if (!sel) return;
    DB.PLATFORMS.forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    });
  },

  _bindToolbar() {
    document.getElementById('sales-add').addEventListener('click',    () => this.openModal(null));
    document.getElementById('sales-import').addEventListener('click', () => Importer.open('sales', () => this._refresh()));
    document.getElementById('sales-export').addEventListener('click', () => { this.table?.download('sales.csv'); });
    document.getElementById('sales-search').addEventListener('input', e => { this._search = e.target.value; this._refresh(); });
    document.getElementById('sales-filter-plat').addEventListener('change', e => { this._plat = e.target.value; this._refresh(); });

    document.getElementById('sales-bulk-del')?.addEventListener('click',   () => this._bulkDelete());
    document.getElementById('sales-bulk-edit')?.addEventListener('click',  () => this._bulkEdit());
    document.getElementById('sales-bulk-clear')?.addEventListener('click', () => { this._selected.clear(); this._refresh(); });

    document.addEventListener('keydown', e => {
      const onSales = document.getElementById('page-sales').classList.contains('active');
      if (!onSales) return;
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName === 'BODY') this.openModal(null);
      if (e.key === '/') { e.preventDefault(); document.getElementById('sales-search')?.focus(); }
    });
  },

  // ── Quick Sell (pre-filled from Inventory) ──────────────────────
  openQuickSell(item) {
    const today = new Date().toISOString().split('T')[0];
    this.openModal(null, {
      dateSold:    today,
      sku:         item.sku         || '',
      productName: item.productName || '',
      unitCost:    item.unitCost    || 0,
    });
    setTimeout(() => document.getElementById('s-price')?.focus(), 80);
  },

  // ── Modal ───────────────────────────────────────────────────────
  openModal(id, prefill = null) {
    this.editingId = id;
    const r   = id ? DB.getSales().find(s => s.id === id) : null;
    const v   = f => prefill?.[f] ?? r?.[f] ?? '';
    const sel = (arr, field) => arr.map(o =>
      `<option value="${o}"${v(field) === o ? ' selected' : ''}>${o}</option>`).join('');

    const skuMap = {};
    DB.getPurchases().forEach(p => { if (p.sku) skuMap[p.sku] = p; });
    const skuList = Object.values(skuMap);

    const qty     = Number(v('qtySold'))          || 1;
    const price   = Number(v('salePricePerUnit')) || 0;
    const cost    = Number(v('unitCost'))          || 0;
    const feePct  = Number(v('platformFeePct'))   || 0;
    const ship    = Number(v('shippingCost'))     || 0;
    const rev     = qty * price;
    const cogs    = qty * cost;
    const feeAmt  = rev * (feePct / 100);
    const profit  = rev - cogs - feeAmt - ship;
    const margin  = rev > 0 ? (profit / rev * 100) : 0;

    const body = `
      <form id="sales-form" class="modal-form" onsubmit="return false">
        <div class="form-row">
          <div class="form-group">
            <label>Date Sold *</label>
            <input type="date" name="dateSold" value="${v('dateSold')}" required>
          </div>
          <div class="form-group">
            <label>SKU / Item ID</label>
            <input type="text" name="sku" id="s-sku" value="${v('sku')}" list="sales-sku-dl" placeholder="type SKU or pick from list" autocomplete="off">
            <datalist id="sales-sku-dl">
              ${skuList.map(p => `<option value="${p.sku}">${p.sku} — ${p.productName}</option>`).join('')}
            </datalist>
          </div>
        </div>
        <div class="form-group">
          <label>Product Name *</label>
          <input type="text" name="productName" id="s-name" value="${v('productName')}" required
            placeholder="e.g. Jordan 4 Retro" list="sales-name-dl" autocomplete="off">
          <datalist id="sales-name-dl">
            ${[...new Set(DB.getPurchases().map(p => p.productName).filter(Boolean))].map(n =>
              `<option value="${n}">`).join('')}
          </datalist>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Platform *</label>
            <select name="platform">${sel(DB.PLATFORMS, 'platform')}</select>
          </div>
          <div class="form-group">
            <label>Sale Method</label>
            <select name="saleMethod">${sel(DB.SALE_METHODS, 'saleMethod')}</select>
          </div>
        </div>
        <div class="form-row three">
          <div class="form-group">
            <label>Qty Sold *</label>
            <input type="number" name="qtySold" id="s-qty" value="${qty}" min="1" required>
          </div>
          <div class="form-group">
            <label>Sale Price / Unit ($) *</label>
            <input type="number" name="salePricePerUnit" id="s-price" value="${price || ''}" min="0" step="0.01" required placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Gross Revenue</label>
            <input type="text" id="s-rev" readonly value="$${rev.toFixed(2)}" style="background:var(--surface2);color:var(--text-muted);cursor:default">
          </div>
        </div>
        <div class="form-row three">
          <div class="form-group">
            <label>Unit Cost ($)</label>
            <input type="number" name="unitCost" id="s-cost" value="${cost || ''}" min="0" step="0.01" placeholder="Auto from SKU">
          </div>
          <div class="form-group">
            <label>Platform Fee %</label>
            <input type="number" name="platformFeePct" id="s-fee-pct" value="${feePct || ''}" min="0" max="100" step="0.01" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>Shipping ($)</label>
            <input type="number" name="shippingCost" id="s-ship" value="${ship || ''}" min="0" step="0.01" placeholder="0.00">
          </div>
        </div>
        <div class="form-row three">
          <div class="form-group">
            <label>Fee Amount</label>
            <input type="text" id="s-fee-amt" readonly value="$${feeAmt.toFixed(2)}" style="background:var(--surface2);color:var(--text-muted);cursor:default">
          </div>
          <div class="form-group">
            <label>Net Profit</label>
            <input type="text" id="s-profit" readonly value="$${profit.toFixed(2)}" style="background:var(--surface2);color:${profit>=0?'var(--green)':'var(--red)'};cursor:default;font-weight:700">
          </div>
          <div class="form-group">
            <label>Margin %</label>
            <input type="text" id="s-margin" readonly value="${margin.toFixed(1)}%" style="background:var(--surface2);color:${margin>=0?'var(--green)':'var(--red)'};cursor:default;font-weight:700">
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes" rows="2" placeholder="Optional notes…">${v('notes')}</textarea>
        </div>
      </form>`;

    Modal.open(
      id      ? 'Edit Sale' :
      prefill ? `Quick Sell — ${prefill.productName}` :
                'New Sale',
      body, () => this._saveModal()
    );
    this._bindModalCalc();
  },

  _bindModalCalc() {
    const $     = id => document.getElementById(id);
    const sku    = $('s-sku');
    const name   = $('s-name');
    const qty    = $('s-qty');
    const price  = $('s-price');
    const cost   = $('s-cost');
    const feePct = $('s-fee-pct');
    const ship   = $('s-ship');
    const rev    = $('s-rev');
    const feeAmt = $('s-fee-amt');
    const profit = $('s-profit');
    const margin = $('s-margin');
    const platSel = document.querySelector('#sales-form [name="platform"]');

    const recalc = () => {
      const q  = parseFloat(qty?.value)    || 0;
      const p  = parseFloat(price?.value)  || 0;
      const c  = parseFloat(cost?.value)   || 0;
      const fp = parseFloat(feePct?.value) || 0;
      const sh = parseFloat(ship?.value)   || 0;
      const r  = q * p;
      const fa = r * (fp / 100);
      const pr = r - q * c - fa - sh;
      const mg = r > 0 ? (pr / r * 100) : 0;
      if (rev)    { rev.value    = '$' + r.toFixed(2); }
      if (feeAmt) { feeAmt.value = '$' + fa.toFixed(2); }
      if (profit) {
        profit.value = '$' + pr.toFixed(2);
        profit.style.color = pr >= 0 ? 'var(--green)' : 'var(--red)';
      }
      if (margin) {
        margin.value = mg.toFixed(1) + '%';
        margin.style.color = mg >= 0 ? 'var(--green)' : 'var(--red)';
      }
    };

    const skuLookup = () => {
      const skuVal = sku?.value?.trim();
      if (!skuVal) return;
      const purchase = DB.getPurchases().find(p => p.sku === skuVal);
      if (purchase) {
        if (name) name.value = purchase.productName;
        if (cost) {
          const q    = parseFloat(qty?.value) || 1;
          const fifo = DB.getFIFOCost(skuVal, q);
          cost.value = fifo > 0 ? fifo.toFixed(2) : purchase.unitCost;
        }
        recalc();
      }
    };

    const nameLookup = () => {
      const nameVal = name?.value?.trim();
      if (!nameVal) return;
      const purchase = DB.getPurchases().slice().reverse().find(p => p.productName === nameVal);
      if (!purchase) return;
      if (sku  && !sku.value)  sku.value  = purchase.sku || '';
      if (cost && !cost.value) {
        const q    = parseFloat(qty?.value) || 1;
        const fifo = DB.getFIFOCost(purchase.sku, q);
        cost.value = fifo > 0 ? fifo.toFixed(2) : purchase.unitCost;
      }
      recalc();
    };

    const platLookup = () => {
      if (!feePct) return;
      const rate = Sales.PLATFORM_FEES[platSel?.value] ?? 0;
      feePct.value = rate || '';
      recalc();
    };

    sku?.addEventListener('input',    skuLookup);
    sku?.addEventListener('change',   skuLookup);
    name?.addEventListener('input',   nameLookup);
    qty?.addEventListener('input',    recalc);
    price?.addEventListener('input',  recalc);
    cost?.addEventListener('input',   recalc);
    feePct?.addEventListener('input', recalc);
    ship?.addEventListener('input',   recalc);
    platSel?.addEventListener('change', platLookup);

    if (!this.editingId) platLookup();
  },

  async _saveModal() {
    const form = document.getElementById('sales-form');
    if (!form?.checkValidity()) { form?.reportValidity(); return false; }
    const data = Object.fromEntries(new FormData(form).entries());
    const isEdit = !!this.editingId;
    try {
      let saved;
      if (isEdit) {
        saved = await DB.updateSale(this.editingId, data);
      } else {
        saved = await DB.addSale(data);
      }
      const np = saved ? saved.netProfit : 0;
      if (np < 0) {
        Toast.error('⚠️ Sale logged at a LOSS of -$' + Math.abs(np).toFixed(2));
      } else if (np === 0) {
        Toast.show('Sale logged at break-even.');
      } else {
        Toast.show(isEdit ? 'Sale updated ✓' : 'Sale added ✓');
      }

      if (saved?.sku) {
        const inv = DB.getInventory().find(i => i._key === saved.sku);
        if (inv && inv.qtyInStock < 0) {
          setTimeout(() => Toast.error(
            `⚠ "${saved.productName}" is oversold by ${Math.abs(inv.qtyInStock)} unit${Math.abs(inv.qtyInStock) !== 1 ? 's' : ''} — check your purchases.`
          ), 150);
        }
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
    const row = DB.getSales().find(s => s.id === id);
    if (!row) return;
    if (confirm(`Delete sale of "${row.productName}"?\n\nThis cannot be undone.`)) {
      try {
        await DB.deleteSale(id);
        this._selected.delete(id);
        this._refresh();
        Toast.show('Sale deleted.');
      } catch (e) {
        Toast.error(e.body?.message || e.message);
      }
    }
  },
};
