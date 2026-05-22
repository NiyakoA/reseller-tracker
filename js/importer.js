// importer.js — CSV/XLSX import wizard (file → map columns → preview → import)

const Importer = {
  _target:  null,   // 'purchases' | 'sales' | 'overhead'
  _fields:  null,
  _onDone:  null,
  _parsed:  null,   // { headers: string[], rows: any[][] }
  _mapping: {},     // { fieldKey: columnIndex }
  _results: null,   // [{ obj, issues, skip }]

  // ── Field definitions per target ────────────────────────────────
  FIELDS: {
    purchases: [
      { key: 'dateBought',     label: 'Date Bought',      required: true,  type: 'date'   },
      { key: 'productName',    label: 'Product Name',     required: true,  type: 'string' },
      { key: 'sku',            label: 'SKU / Item ID',    required: false, type: 'string' },
      { key: 'category',       label: 'Category',         required: false, type: 'string' },
      { key: 'qtyBought',      label: 'Quantity',         required: false, type: 'number' },
      { key: 'unitCost',       label: 'Unit Cost ($)',     required: true,  type: 'number' },
      { key: 'store',          label: 'Store / Source',   required: false, type: 'string' },
      { key: 'purchaseMethod', label: 'Purchase Method',  required: false, type: 'string' },
      { key: 'condition',      label: 'Condition',        required: false, type: 'string' },
      { key: 'notes',          label: 'Notes',            required: false, type: 'string' },
    ],
    sales: [
      { key: 'dateSold',         label: 'Date Sold',         required: true,  type: 'date'   },
      { key: 'productName',      label: 'Product Name',      required: true,  type: 'string' },
      { key: 'sku',              label: 'SKU / Item ID',     required: false, type: 'string' },
      { key: 'qtySold',          label: 'Qty Sold',          required: false, type: 'number' },
      { key: 'salePricePerUnit', label: 'Sale Price / Unit', required: false, type: 'number' },
      { key: 'grossRevenue',     label: 'Total Revenue ($)',  required: false, type: 'number' },
      { key: 'platform',         label: 'Platform',          required: false, type: 'string' },
      { key: 'saleMethod',       label: 'Sale Method',       required: false, type: 'string' },
      { key: 'unitCost',         label: 'Unit Cost ($)',      required: false, type: 'number' },
      { key: 'notes',            label: 'Notes',             required: false, type: 'string' },
    ],
    overhead: [
      { key: 'date',          label: 'Date',           required: true,  type: 'date'    },
      { key: 'expenseName',   label: 'Expense Name',   required: true,  type: 'string'  },
      { key: 'category',      label: 'Category',       required: false, type: 'string'  },
      { key: 'amount',        label: 'Amount ($)',      required: true,  type: 'number'  },
      { key: 'paymentMethod', label: 'Payment Method', required: false, type: 'string'  },
      { key: 'recurring',     label: 'Recurring',      required: false, type: 'boolean' },
      { key: 'notes',         label: 'Notes',          required: false, type: 'string'  },
    ],
  },

  // Header synonyms for auto-detection (lower-case)
  SYNONYMS: {
    dateBought:      ['date bought','purchase date','date','bought on','buy date','order date','purchased'],
    dateSold:        ['date sold','sale date','sold date','sold on','date','transaction date'],
    date:            ['date','expense date','transaction date','when'],
    productName:     ['product','product name','item','item name','name','title','product title'],
    expenseName:     ['expense','expense name','name','description','item','service'],
    category:        ['category','cat','type','group'],
    qtyBought:       ['qty','quantity','qty bought','units','count','units purchased'],
    qtySold:         ['qty sold','quantity sold','units sold','count','qty','quantity'],
    unitCost:        ['unit cost','cost','cost each','buy price','purchase price','cost per unit','paid each','cogs'],
    salePricePerUnit:['sale price','sell price','unit price','sold for','price per unit','selling price','price'],
    grossRevenue:    ['revenue','gross revenue','total revenue','total','gross sales','gross'],
    store:           ['store','source','vendor','retailer','supplier','from','shop','bought from'],
    purchaseMethod:  ['purchase method','payment method','paid with','pay method','method'],
    saleMethod:      ['sale method','payment method','received via','payout method','method'],
    platform:        ['platform','marketplace','sold on','channel','site','sold via'],
    sku:             ['sku','item id','id','upc','asin','barcode','item#','product id','ref','sku/id'],
    condition:       ['condition','state','quality','item condition'],
    amount:          ['amount','cost','expense','total','fee','charge','value','price'],
    paymentMethod:   ['payment method','paid with','pay method','method'],
    recurring:       ['recurring','repeat','subscription','monthly','auto-renew'],
    notes:           ['notes','note','memo','comments','details','remarks','info'],
  },

  // ── Lifecycle ────────────────────────────────────────────────────
  init() {
    document.getElementById('import-close')?.addEventListener('click', () => this.close());
    document.getElementById('import-overlay')?.addEventListener('click', e => {
      if (e.target === document.getElementById('import-overlay')) this.close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('import-overlay').classList.contains('hidden')) this.close();
    });
  },

  open(target, onDone) {
    this._target  = target;
    this._fields  = this.FIELDS[target];
    this._onDone  = onDone;
    this._parsed  = null;
    this._mapping = {};
    this._results = null;

    const titles = { purchases: 'Purchases', sales: 'Sales Log', overhead: 'Overhead Expenses' };
    document.getElementById('import-title').textContent = `Import ${titles[target] || target}`;
    document.getElementById('import-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this._setStep(1);
    this._renderStep1();
  },

  close() {
    document.getElementById('import-overlay').classList.add('hidden');
    document.body.style.overflow = '';
  },

  // ── Step management ──────────────────────────────────────────────
  _setStep(n) {
    document.querySelectorAll('.progress-step').forEach((el, i) => {
      el.classList.toggle('active', i + 1 === n);
      el.classList.toggle('done',   i + 1 < n);
    });
  },

  _renderFooter(buttons) {
    const el = document.getElementById('import-footer');
    if (!el) return;
    el.innerHTML = buttons.map(b =>
      `<button class="${b.cls}" data-ia="${b.action}">${b.label}</button>`).join('');
    el.querySelectorAll('[data-ia]').forEach(btn => {
      btn.addEventListener('click', () => {
        ({ back: () => this._goBack(), next: () => this._goNext(),
           import: () => this._doImport(), close: () => this.close(),
        }[btn.dataset.ia] || (() => {}))();
      });
    });
  },

  // ── Step 1: File selection ────────────────────────────────────────
  _renderStep1() {
    document.getElementById('import-body').innerHTML = `
      <div class="drop-zone" id="imp-drop">
        <p>📂</p>
        <p style="font-size:15px;font-weight:700;color:var(--text)">Drop your CSV or XLSX file here</p>
        <p>or <label for="imp-file-in" style="color:var(--accent);cursor:pointer;text-decoration:underline">browse files</label></p>
        <input type="file" id="imp-file-in" accept=".csv,.xlsx,.xls" style="display:none">
        <p style="font-size:11px;margin-top:8px">Supports .csv, .xlsx, .xls — first row must be headers</p>
      </div>
      <div id="imp-file-info" style="display:none" class="file-info"></div>`;

    this._renderFooter([
      { label: 'Cancel', action: 'close', cls: 'btn-ghost' },
      { label: 'Next: Map Columns →', action: 'next', cls: 'btn-primary', id: 'imp-next' },
    ]);
    document.querySelector('[data-ia="next"]').disabled = true;
    document.querySelector('[data-ia="next"]').style.opacity = '.45';

    const drop  = document.getElementById('imp-drop');
    const input = document.getElementById('imp-file-in');

    input.addEventListener('change', e => { if (e.target.files[0]) this._loadFile(e.target.files[0]); });
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) this._loadFile(e.dataTransfer.files[0]);
    });
  },

  _loadFile(file) {
    const info = document.getElementById('imp-file-info');
    info.style.display = 'block';
    info.textContent = `Loading "${file.name}"…`;

    const ext = file.name.split('.').pop().toLowerCase();
    const parser = ext === 'csv' ? this._parseCSV(file) : this._parseXLSX(file);

    parser.then(parsed => {
      if (!parsed.rows.length) { info.textContent = '⚠️ File appears empty or has no data rows after the header.'; return; }
      this._parsed = parsed;
      const hi = (parsed.headerRowIndex ?? 0) + 1;
      info.innerHTML = `✅ <strong>${file.name}</strong> — ${parsed.rows.length} data rows · ${parsed.headers.length} columns · headers on row ${hi}`;
      const btn = document.querySelector('[data-ia="next"]');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }).catch(err => {
      info.textContent = `❌ Error parsing file: ${err.message}`;
    });
  },

  // ── Header row auto-detection ─────────────────────────────────────
  // Finds the first row that looks like column headers:
  // - At least 3 non-empty cells
  // - Majority of cells are strings (not numbers/dates)
  _detectHeaderRow(data) {
    for (let i = 0; i < Math.min(6, data.length); i++) {
      const row = data[i].filter(c => c !== '' && c !== null && c !== undefined);
      const strings = row.filter(c => typeof c === 'string' && isNaN(Number(c)));
      if (row.length >= 3 && strings.length >= Math.floor(row.length * 0.5)) return i;
    }
    return 0;
  },

  // ── Parsers ───────────────────────────────────────────────────────
  _parseCSV(file) {
    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') { reject(new Error('PapaParse not loaded.')); return; }
      Papa.parse(file, {
        header: false,
        skipEmptyLines: false,
        dynamicTyping: false,
        delimiter: '',
        complete: r => {
          const all = r.data;
          if (all.length < 2) { reject(new Error('File needs at least 2 rows (header + data).')); return; }
          const hi   = this._detectHeaderRow(all);
          const headers = all[hi].map(String);
          const rows    = all.slice(hi + 1).filter(row => row.some(c => c !== '' && c !== null));
          resolve({ headers, rows, headerRowIndex: hi });
        },
        error: err => reject(new Error(err.message)),
      });
    });
  },

  _parseXLSX(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') { reject(new Error('SheetJS not loaded.')); return; }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb   = XLSX.read(e.target.result, { type: 'binary', raw: true });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          // raw:true keeps dates as serial numbers so we can convert them properly
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (data.length < 2) { reject(new Error('Sheet needs at least 2 rows.')); return; }
          const hi   = this._detectHeaderRow(data);
          const headers = data[hi].map(String);
          const rows    = data.slice(hi + 1).filter(row => row.some(c => c !== '' && c !== null));
          resolve({ headers, rows, headerRowIndex: hi });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsBinaryString(file);
    });
  },

  // ── Step 2: Column mapping ────────────────────────────────────────
  _autoDetect(headers) {
    const map = {}, used = new Set();
    const lc = headers.map(h => h.toLowerCase().trim());
    this._fields.forEach(field => {
      const syns = this.SYNONYMS[field.key] || [field.key.toLowerCase()];
      for (const syn of syns) {
        const idx = lc.findIndex((h, i) => h === syn && !used.has(i));
        if (idx !== -1) { map[field.key] = idx; used.add(idx); break; }
      }
    });
    return map;
  },

  _goNext() {
    if (!this._parsed) return;
    this._mapping = this._autoDetect(this._parsed.headers);
    this._setStep(2);
    this._renderStep2();
  },

  _goBack() {
    this._setStep(1);
    this._renderStep1();
  },

  _renderStep2() {
    const { headers, rows } = this._parsed;
    const preview = rows[0] || [];

    document.getElementById('import-body').innerHTML = `
      <div style="padding:10px 12px;background:var(--surface2);border-radius:6px;margin-bottom:14px;font-size:12px">
        <strong>Detected ${headers.length} column${headers.length!==1?'s':''}:</strong>
        ${headers.length ? headers.join(' · ') : '<span style="color:var(--red)">No headers found — make sure row 1 of your file contains column names</span>'}
      </div>
      <p class="import-info"><strong>${rows.length}</strong> rows found. Match your file's columns to the app's fields:</p>
      <div class="mapping-table">
        <div class="mapping-header"><span>App Field</span><span>Your Column</span><span>Preview (row 1)</span></div>
        ${this._fields.map(f => `
          <div class="mapping-row ${f.required ? 'required' : ''}">
            <span class="field-label">${f.label}</span>
            <select class="col-select" data-field="${f.key}">
              <option value="">— Skip —</option>
              ${headers.map((h, i) => `<option value="${i}" ${this._mapping[f.key] === i ? 'selected' : ''}>${h}</option>`).join('')}
            </select>
            <span class="preview-val" id="mprev-${f.key}">
              ${this._mapping[f.key] !== undefined ? (String(preview[this._mapping[f.key]] ?? '') || '—') : '—'}
            </span>
          </div>`).join('')}
      </div>`;

    // Live preview updates
    document.querySelectorAll('.col-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.field;
        const idx = sel.value !== '' ? parseInt(sel.value) : undefined;
        this._mapping[key] = idx;
        const pv = document.getElementById(`mprev-${key}`);
        if (pv) pv.textContent = idx !== undefined ? (String(preview[idx] ?? '') || '—') : '—';
      });
    });

    this._renderFooter([
      { label: '← Back', action: 'back', cls: 'btn-ghost' },
      { label: 'Preview →', action: 'next', cls: 'btn-primary' },
    ]);
  },

  // ── Step 3: Preview & validation ─────────────────────────────────
  _mapRow(row) {
    const obj = {};
    this._fields.forEach(f => {
      const idx = this._mapping[f.key];
      if (idx !== undefined) {
        let val = String(row[idx] ?? '').trim();
        if (f.type === 'date')    val = this._normalizeDate(val);
        if (f.type === 'number')  val = this._normalizeNumber(val);
        if (f.type === 'boolean') val = /^(yes|true|1|y)$/i.test(val);
        obj[f.key] = val;
      }
    });
    // For sales: derive salePricePerUnit from grossRevenue / qtySold if not mapped
    if (this._target === 'sales' && (!obj.salePricePerUnit || obj.salePricePerUnit === '')) {
      const rev = parseFloat(obj.grossRevenue) || 0;
      const qty = parseFloat(obj.qtySold)      || 1;
      if (rev > 0) obj.salePricePerUnit = String(rev / qty);
    }
    return obj;
  },

  _validateRow(obj) {
    const issues = [];
    this._fields.filter(f => f.required).forEach(f => {
      if (obj[f.key] === undefined || obj[f.key] === '') issues.push(`Missing: ${f.label}`);
    });
    // Sales: require at least one of salePricePerUnit or grossRevenue
    if (this._target === 'sales') {
      const hasPrice = obj.salePricePerUnit !== undefined && obj.salePricePerUnit !== '';
      const hasRev   = obj.grossRevenue     !== undefined && obj.grossRevenue     !== '';
      if (!hasPrice && !hasRev) issues.push('Missing: Sale Price / Unit or Total Revenue');
    }
    ['dateBought','dateSold','date'].forEach(k => {
      if (obj[k] && isNaN(new Date(obj[k]))) issues.push(`Bad date: "${obj[k]}"`);
    });
    ['unitCost','qtyBought','qtySold','salePricePerUnit','grossRevenue','amount'].forEach(k => {
      if (obj[k] !== undefined && obj[k] !== '' && isNaN(Number(obj[k]))) issues.push(`Not a number: ${k}`);
    });
    return issues;
  },

  _renderStep3() {
    // Sync mapping from current selects before computing
    document.querySelectorAll('.col-select').forEach(sel => {
      if (sel.value !== '') this._mapping[sel.dataset.field] = parseInt(sel.value);
      else delete this._mapping[sel.dataset.field];
    });

    const missing = this._fields.filter(f => f.required && this._mapping[f.key] === undefined);
    if (missing.length) {
      Toast.error(`Map required fields first: ${missing.map(f => f.label).join(', ')}`);
      return;
    }

    this._results = this._parsed.rows.map(row => {
      const obj = this._mapRow(row);
      return { obj, issues: this._validateRow(obj) };
    });

    const ok      = this._results.filter(r => !r.issues.length).length;
    const flagged = this._results.filter(r =>  r.issues.length).length;
    const COLS    = this._fields.slice(0, 5);

    document.getElementById('import-body').innerHTML = `
      <div class="import-summary-bar">
        <span class="ok-badge">✅ ${ok} ready to import</span>
        ${flagged ? `<span class="warn-badge">⚠️ ${flagged} flagged (will be skipped)</span>` : ''}
        <span style="color:var(--text-muted);font-size:12px;margin-left:auto">Showing up to 50 rows</span>
      </div>
      <div class="preview-table-wrap">
        <table class="preview-table">
          <thead><tr><th>#</th>${COLS.map(f => `<th>${f.label}</th>`).join('')}<th>Status</th></tr></thead>
          <tbody>
            ${this._results.slice(0, 50).map((r, i) => `
              <tr class="${r.issues.length ? 'row-warn' : ''}">
                <td style="color:var(--text-muted)">${i + 1}</td>
                ${COLS.map(f => `<td>${r.obj[f.key] ?? '—'}</td>`).join('')}
                <td>${r.issues.length
                  ? `<span class="issue-badge" title="${r.issues.join('; ')}">⚠️ ${r.issues[0]}</span>`
                  : `<span class="ok-tag">✓</span>`}</td>
              </tr>`).join('')}
            ${this._results.length > 50
              ? `<tr><td colspan="${COLS.length + 2}" style="color:var(--text-muted);text-align:center;padding:12px">… and ${this._results.length - 50} more rows</td></tr>`
              : ''}
          </tbody>
        </table>
      </div>`;

    this._setStep(3);
    this._renderFooter([
      { label: '← Back', action: 'back', cls: 'btn-ghost' },
      { label: `Import ${ok} row${ok !== 1 ? 's' : ''}`, action: 'import', cls: 'btn-primary' },
    ]);
    if (!ok) document.querySelector('[data-ia="import"]').disabled = true;
  },

  // Override back for step 3 → 2
  _goBack() {
    const step = document.querySelector('.progress-step.active');
    const n = step ? parseInt(step.dataset.step) : 2;
    if (n === 2) { this._setStep(1); this._renderStep1(); }
    else         { this._setStep(2); this._renderStep2(); }
  },

  // Override next for step 2 → 3
  _goNext() {
    const step = document.querySelector('.progress-step.active');
    const n = step ? parseInt(step.dataset.step) : 1;
    if (n === 1) {
      if (!this._parsed) return;
      this._mapping = this._autoDetect(this._parsed.headers);
      this._setStep(2);
      this._renderStep2();
    } else if (n === 2) {
      this._renderStep3();
    }
  },

  // ── Import ────────────────────────────────────────────────────────
  _doImport() {
    let added = 0, skipped = 0;
    this._results.forEach(r => {
      if (r.issues.length) { skipped++; return; }
      try {
        if (this._target === 'purchases') DB.addPurchase(r.obj);
        else if (this._target === 'sales')    DB.addSale(r.obj);
        else if (this._target === 'overhead') DB.addOverhead(r.obj);
        added++;
      } catch { skipped++; }
    });

    this._setStep(4);
    document.getElementById('import-body').innerHTML = `
      <div class="import-result">
        <div class="result-icon">✅</div>
        <h3>Import Complete</h3>
        <p>Added <strong>${added} row${added !== 1 ? 's' : ''}</strong>${skipped ? `, skipped <strong>${skipped}</strong> flagged row${skipped !== 1 ? 's' : ''}` : ''}.</p>
      </div>`;

    this._renderFooter([{ label: 'Done', action: 'close', cls: 'btn-primary' }]);
    if (this._onDone) this._onDone();
  },

  // ── Normalizers ───────────────────────────────────────────────────
  _normalizeDate(val) {
    if (val === '' || val == null || val === '—') return '';
    // Excel serial date number (e.g. 46134 = April 22, 2026)
    const num = typeof val === 'number' ? val : Number(val);
    if (!isNaN(num) && num > 40000 && num < 55000) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    const s = String(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // M/D/YYYY or MM/DD/YYYY
    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
      const y = slash[3].length === 2 ? '20' + slash[3] : slash[3];
      return `${y}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}`;
    }
    // Try Date constructor
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
    return val;
  },

  _normalizeNumber(val) {
    if (val === '' || val == null) return '';
    return String(val).replace(/[$,\s%]/g, '');
  },
};
