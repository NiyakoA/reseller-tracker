// overhead.js — Overhead Expenses page

const Overhead = {
  table: null,
  editingId: null,
  rangeKey: 'rt_range_overhead',
  _search: '',
  _cat: '',
  _initialized: false,
  _selected: new Set(),

  CAT_COLORS: {
    'Bot': '#8b5cf6', 'Proxy': '#3b82f6', 'SMS': '#06b6d4',
    'Profile Builder': '#f59e0b', 'Whop/Discord Group': '#7c3aed',
    'Server': '#6366f1', 'eBay Fees': '#e53e3e', 'PayPal Fees': '#003087',
    'Shipping Supplies': '#10b981', 'Storage': '#78716c',
    'Ads': '#f97316', 'Software': '#84cc16', 'Other': '#6b7280',
  },

  init() {
    if (!this._initialized) {
      this._initialized = true;
      this._populateCatFilter();
      this._bindToolbar();
    }
    // Re-create the table if it was never set (e.g. first visit)
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
      const cs = localStorage.getItem('rt_oh_cs'), ce = localStorage.getItem('rt_oh_ce');
      return { start: cs ? new Date(cs + 'T00:00:00') : null, end: ce ? new Date(ce + 'T23:59:59') : null };
    }
    return { start: null, end: null };
  },

  _getFilteredData() {
    const { start, end } = this._computeDates();
    const s = this._search.toLowerCase();
    return DB.getOverhead().filter(r => {
      if (start || end) {
        const d = new Date(r.date + 'T12:00:00');
        if (start && d < start) return false;
        if (end   && d > end)   return false;
      }
      if (this._cat && r.category !== this._cat) return false;
      if (s && !((r.expenseName || '').toLowerCase().includes(s) ||
                 (r.category    || '').toLowerCase().includes(s))) return false;
      return true;
    });
  },

  // ── Time-range bar ──────────────────────────────────────────────
  _renderTimeRange() {
    const bar = document.getElementById('oh-time-range');
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
        <input type="date" id="oh-cs" value="${localStorage.getItem('rt_oh_cs') || ''}">
        <span style="color:var(--text-muted)">→</span>
        <input type="date" id="oh-ce" value="${localStorage.getItem('rt_oh_ce') || ''}">
        <button class="btn-sm" id="oh-apply">Apply</button>
      </div>`;

    bar.querySelectorAll('.range-pill').forEach(b => b.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, b.dataset.range);
      this._renderTimeRange();
      this._refresh();
    }));
    bar.querySelector('#oh-apply')?.addEventListener('click', () => {
      localStorage.setItem('rt_oh_cs', document.getElementById('oh-cs').value);
      localStorage.setItem('rt_oh_ce', document.getElementById('oh-ce').value);
      this._refresh();
    });
  },

  // ── Summary bar ─────────────────────────────────────────────────
  _renderSummary(data) {
    const el = document.getElementById('oh-summary');
    if (!el) return;
    const total     = data.reduce((a, r) => a + r.amount, 0);
    const recurring = data.filter(r => r.recurring).reduce((a, r) => a + r.amount, 0);
    const oneTime   = total - recurring;

    const catMap = {};
    data.forEach(r => { catMap[r.category] = (catMap[r.category] || 0) + r.amount; });
    const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];

    el.innerHTML = `
      <div class="summary-bar">
        <div class="summary-stat"><span class="summary-label">Total Overhead</span><span class="summary-value c-red">$${total.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Recurring</span><span class="summary-value">$${recurring.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">One-Time</span><span class="summary-value">$${oneTime.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Top Category</span><span class="summary-value" style="font-size:14px">${topCat ? topCat[0] : '—'}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Entries</span><span class="summary-value">${data.length}</span></div>
      </div>`;
  },

  // ── Bulk actions ────────────────────────────────────────────────
  _renderBulkBar() {
    const bar      = document.getElementById('oh-bulk');
    const countEl  = document.getElementById('oh-bulk-count');
    if (!bar) return;
    const n = this._selected?.size ?? 0;
    bar.classList.toggle('visible', n > 0);
    if (n > 0 && countEl) countEl.textContent = `${n} selected`;
  },

  _updateSelectAll() {
    const cb = document.getElementById('oh-sel-all');
    if (!cb) return;
    const data = this._getFilteredData();
    const allChecked = data.length > 0 && data.every(r => this._selected.has(r.id));
    cb.checked       = allChecked;
    cb.indeterminate = this._selected.size > 0 && !allChecked;
  },

  _bulkDelete() {
    const ids = [...this._selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} expense${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    ids.forEach(id => DB.deleteOverhead(id));
    this._selected.clear();
    this._refresh();
    Toast.show(`Deleted ${ids.length} expense${ids.length > 1 ? 's' : ''}.`);
  },

  _bulkEdit() {
    const ids = [...this._selected];
    if (!ids.length) return;
    const mkOpts = arr => arr.map(v => `<option value="${v}">${v}</option>`).join('');
    const fieldOpts = {
      category:      mkOpts(DB.OVERHEAD_CATS),
      paymentMethod: mkOpts(DB.PURCHASE_METHODS),
    };
    const body = `
      <div class="modal-form">
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:2px">
          Applying to <strong style="color:var(--text)">${ids.length} expense${ids.length > 1 ? 's' : ''}</strong>:
        </p>
        <div class="form-row">
          <div class="form-group">
            <label>Field to Update</label>
            <select id="be-field">
              <option value="category">Category</option>
              <option value="paymentMethod">Payment Method</option>
            </select>
          </div>
          <div class="form-group" id="be-val-wrap">
            <label>New Value</label>
            <select id="be-val">${fieldOpts.category}</select>
          </div>
        </div>
      </div>`;

    Modal.open('Bulk Edit Expenses', body, () => {
      const field = document.getElementById('be-field')?.value;
      const val   = document.getElementById('be-val')?.value;
      if (!field || val === undefined) return false;
      ids.forEach(id => DB.updateOverhead(id, { [field]: val }));
      this._selected.clear();
      this._refresh();
      Toast.show(`Updated ${ids.length} expense${ids.length > 1 ? 's' : ''} ✓`);
      return true;
    });

    document.getElementById('be-field')?.addEventListener('change', e => {
      const wrap = document.getElementById('be-val-wrap');
      if (wrap) wrap.innerHTML = `<label>New Value</label><select id="be-val">${fieldOpts[e.target.value] || ''}</select>`;
    });
  },

  // ── Quick-add recurring ─────────────────────────────────────────
  _openQuickAdd() {
    // Deduplicate recurring templates by name+category+amount+paymentMethod
    const seen = new Set();
    const templates = DB.getOverhead()
      .filter(r => r.recurring)
      .filter(r => {
        const key = `${r.expenseName}|${r.category}|${r.amount}|${r.paymentMethod}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (!templates.length) {
      Toast.error('No recurring expenses found. Add an expense and mark it as "Recurring" first.');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    this._qaTemplates = templates;

    const body = `
      <div class="modal-form">
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">
          Click <strong style="color:var(--text)">+ Add</strong> to log a recurring charge with the date below.
        </p>
        <div class="form-row" style="margin-bottom:4px">
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="qa-date" value="${today}">
          </div>
          <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" id="qa-notes" placeholder="Optional…">
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${templates.map((t, i) => `
            <div style="display:flex;align-items:center;padding:10px 12px;background:var(--surface2);border-radius:6px;gap:10px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.expenseName}</div>
                <div style="font-size:11px;color:var(--text-muted)">${t.category} · ${t.paymentMethod}</div>
              </div>
              <strong style="color:var(--red);flex-shrink:0">$${Number(t.amount).toFixed(2)}</strong>
              <button class="btn-sm" data-action="qa-add" data-qi="${i}" style="flex-shrink:0">+ Add</button>
            </div>`).join('')}
        </div>
      </div>`;

    // Refresh table when Done is clicked (once, cleanly, after modal closes)
    Modal.open('Quick Add Recurring', body, () => {
      this._refresh();
      return true;
    });
    const saveBtn = document.getElementById('modal-save');
    if (saveBtn) saveBtn.textContent = 'Done';
  },

  // Called from _bindToolbar — single permanent listener handles all qa-add clicks
  _handleQaAdd(e) {
    const btn = e.target.closest('[data-action="qa-add"]');
    if (!btn || btn.disabled) return;
    const idx      = parseInt(btn.dataset.qi);
    const template = this._qaTemplates?.[idx];
    if (!template) return;
    const today = new Date().toISOString().split('T')[0];
    const date  = document.getElementById('qa-date')?.value  || today;
    const notes = document.getElementById('qa-notes')?.value || '';
    DB.addOverhead({
      date,
      expenseName:   template.expenseName,
      category:      template.category,
      amount:        template.amount,
      paymentMethod: template.paymentMethod,
      recurring:     true,
      notes,
    });
    btn.textContent      = '✓ Added';
    btn.disabled         = true;
    btn.style.background = 'var(--green)';
    Toast.show(`${template.expenseName} added ✓`);
  },

  // ── SimpleTable ─────────────────────────────────────────────────
  _initTable() {
    const C = this.CAT_COLORS;
    this.table = new SimpleTable('oh-table', [
      { title: '<input type="checkbox" id="oh-sel-all" style="cursor:pointer" title="Select all">',
        field: 'id', sortable: false, width: '36px', align: 'center',
        formatter: (v, row) => `<input type="checkbox" class="row-cb" data-id="${row.id}" ${this._selected.has(row.id) ? 'checked' : ''} style="cursor:pointer">` },
      { title:'#', field:'id', width:'52px', align:'center', sortable:true },
      { title:'Date', field:'date', sortable:true,
        formatter: v => v ? new Date(v+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—' },
      { title:'Expense', field:'expenseName', sortable:true,
        formatter: v => `<span style="font-weight:600">${v||'—'}</span>` },
      { title:'Category', field:'category', sortable:true,
        formatter: v => { const c=C[v]||'#6b7280'; return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;background:${c}22;color:${c}">${v||'—'}</span>`; }},
      { title:'Amount', field:'amount', align:'right', sortable:true,
        formatter: v => `<strong style="color:var(--red)">$${Number(v||0).toFixed(2)}</strong>` },
      { title:'Method', field:'paymentMethod', sortable:true },
      { title:'Recurring', field:'recurring', align:'center', sortable:false,
        formatter: (v, row) => {
          if (!v) return `<span style="color:var(--text-muted);font-size:12px">—</span>`;
          const labels = { monthly:'Monthly', quarterly:'Quarterly', annually:'Annual' };
          const cycle = labels[row.renewalCycle || 'monthly'] || 'Monthly';
          return `<span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;background:rgba(99,102,241,.2);color:#818cf8">↻ ${cycle}</span>`;
        }},
      { title:'Notes', field:'notes', sortable:false,
        formatter: v => `<span style="color:var(--text-muted);font-size:12px">${v||''}</span>` },
      { title:'', field:'id', sortable:false, width:'72px', align:'center',
        formatter: (v,row) => `<div style="display:flex;gap:5px;justify-content:center"><button class="tbl-btn" data-action="edit" data-id="${row.id}">✏️</button><button class="tbl-btn" data-action="del" data-id="${row.id}">🗑️</button></div>` },
    ], { pageSize:20, placeholder:'No overhead expenses yet. Click "+ Add Expense" to get started.' });

    document.getElementById('oh-table').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'edit') this.openModal(id);
      if (btn.dataset.action === 'del')  this._confirmDelete(id);
    });

    document.getElementById('oh-table').addEventListener('change', e => {
      if (e.target.classList.contains('row-cb')) {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) this._selected.add(id);
        else                  this._selected.delete(id);
        this._renderBulkBar();
        this._updateSelectAll();
      } else if (e.target.id === 'oh-sel-all') {
        if (e.target.checked) this._getFilteredData().forEach(r => this._selected.add(r.id));
        else                  this._selected.clear();
        this._refresh();
      }
    });
  },

  _refresh() {
    const data     = this._getFilteredData();
    const total    = DB.getOverhead().length;
    const rk       = this._getRange();

    // When the range filters everything out but data exists, swap placeholder
    if (this.table) {
      this.table.opts.placeholder = (data.length === 0 && total > 0 && rk !== 'lifetime')
        ? `No expenses in this date range — <button id="oh-reset-range" style="background:none;border:none;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-decoration:underline">show all time</button>`
        : 'No overhead expenses yet. Click "+ Add Expense" to get started.';
    }

    this._renderSummary(data);
    this.table?.setData(data);

    // Bind the "show all time" link if it rendered
    document.getElementById('oh-reset-range')?.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, 'lifetime');
      this._renderTimeRange();
      this._refresh();
    });

    this._renderBulkBar();
    this._updateSelectAll();
  },

  // ── Toolbar ─────────────────────────────────────────────────────
  _populateCatFilter() {
    const sel = document.getElementById('oh-filter-cat');
    if (!sel) return;
    DB.OVERHEAD_CATS.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  },

  _bindToolbar() {
    document.getElementById('oh-add').addEventListener('click',       () => this.openModal(null));
    document.getElementById('oh-quick-add').addEventListener('click', () => this._openQuickAdd());
    document.getElementById('oh-import').addEventListener('click',    () => Importer.open('overhead', () => this._refresh()));
    // Single permanent listener for quick-add template buttons (never accumulates)
    document.getElementById('modal-body').addEventListener('click', e => this._handleQaAdd(e));
    document.getElementById('oh-export').addEventListener('click',    () => { this.table?.download('overhead.csv'); });
    document.getElementById('oh-search').addEventListener('input', e => { this._search = e.target.value; this._refresh(); });
    document.getElementById('oh-filter-cat').addEventListener('change', e => { this._cat = e.target.value; this._refresh(); });

    document.getElementById('oh-bulk-del')?.addEventListener('click',   () => this._bulkDelete());
    document.getElementById('oh-bulk-edit')?.addEventListener('click',  () => this._bulkEdit());
    document.getElementById('oh-bulk-clear')?.addEventListener('click', () => { this._selected.clear(); this._refresh(); });

    document.addEventListener('keydown', e => {
      const onPage = document.getElementById('page-overhead').classList.contains('active');
      if (!onPage) return;
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName === 'BODY') this.openModal(null);
      if (e.key === '/') { e.preventDefault(); document.getElementById('oh-search')?.focus(); }
    });
  },

  // ── Modal ───────────────────────────────────────────────────────
  openModal(id) {
    // Reset button label in case quick-add modal changed it to "Done"
    const saveBtn = document.getElementById('modal-save');
    if (saveBtn) saveBtn.textContent = 'Save';

    this.editingId = id;
    const r   = id ? DB.getOverhead().find(o => o.id === id) : null;
    const v   = f => r?.[f] ?? '';
    const sel = (arr, field) => arr.map(o =>
      `<option value="${o}"${v(field) === o ? ' selected' : ''}>${o}</option>`).join('');

    const body = `
      <form id="oh-form" class="modal-form" onsubmit="return false">
        <div class="form-row">
          <div class="form-group">
            <label>Date *</label>
            <input type="date" name="date" value="${v('date')}" required>
          </div>
          <div class="form-group">
            <label>Amount ($) *</label>
            <input type="number" name="amount" value="${v('amount')}" min="0" step="0.01" required placeholder="0.00">
          </div>
        </div>
        <div class="form-group">
          <label>Expense Name *</label>
          <input type="text" name="expenseName" value="${v('expenseName')}" required placeholder="e.g. Kodai Bot Subscription">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Category</label>
            <select name="category">${sel(DB.OVERHEAD_CATS, 'category')}</select>
          </div>
          <div class="form-group">
            <label>Payment Method</label>
            <select name="paymentMethod">${sel(DB.PURCHASE_METHODS, 'paymentMethod')}</select>
          </div>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px">
            <input type="checkbox" name="recurring" id="oh-recurring" ${v('recurring') ? 'checked' : ''} style="width:auto">
            Recurring expense
          </label>
        </div>
        <div class="form-group" id="oh-cycle-wrap" style="${v('recurring') ? '' : 'display:none'}">
          <label>Renewal Cycle</label>
          <select name="renewalCycle" id="oh-cycle">
            <option value="monthly"   ${(v('renewalCycle')||'monthly') === 'monthly'   ? 'selected':''}>Monthly</option>
            <option value="quarterly" ${v('renewalCycle') === 'quarterly' ? 'selected':''}>Quarterly (every 3 months)</option>
            <option value="annually"  ${v('renewalCycle') === 'annually'  ? 'selected':''}>Annually (once a year)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes" rows="2" placeholder="Optional notes…">${v('notes')}</textarea>
        </div>
      </form>`;

    Modal.open(id ? 'Edit Expense' : 'New Expense', body, () => this._saveModal());

    document.getElementById('oh-recurring')?.addEventListener('change', e => {
      const wrap = document.getElementById('oh-cycle-wrap');
      if (wrap) wrap.style.display = e.target.checked ? '' : 'none';
    });
  },

  _saveModal() {
    const form = document.getElementById('oh-form');
    if (!form?.checkValidity()) { form?.reportValidity(); return false; }
    const data = Object.fromEntries(new FormData(form).entries());
    data.recurring = document.getElementById('oh-recurring')?.checked || false;

    if (this.editingId) {
      DB.updateOverhead(this.editingId, data);
      Toast.show('Expense updated ✓');
    } else {
      DB.addOverhead(data);
      Toast.show('Expense added ✓');
    }
    this.editingId = null;
    this._refresh();
    return true;
  },

  _confirmDelete(id) {
    const row = DB.getOverhead().find(o => o.id === id);
    if (!row) return;
    if (confirm(`Delete "${row.expenseName}"?\n\nThis cannot be undone.`)) {
      DB.deleteOverhead(id);
      this._selected.delete(id);
      this._refresh();
      Toast.show('Expense deleted.');
    }
  },
};
