// table.js — lightweight sortable paginated table (replaces Tabulator)
class SimpleTable {
  constructor(containerId, columns, options = {}) {
    this.el      = document.getElementById(containerId);
    this.columns = columns;
    this.opts    = { pageSize: 20, placeholder: 'No data.', ...options };
    this._data   = [];
    this._sort   = { field: null, dir: 1 };
    this._page   = 1;

    this.el.addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const f = th.dataset.sort;
        this._sort.dir = this._sort.field === f ? -this._sort.dir : 1;
        this._sort.field = f;
        this._render(); return;
      }
      const pb = e.target.closest('[data-pg]');
      if (pb && !pb.disabled) { this._page = +pb.dataset.pg; this._render(); }
    });
  }

  setData(data) { this._data = data || []; this._page = 1; this._render(); }

  download(filename) {
    const cols = this.columns.filter(c => c.field && c.title);
    const csv  = [cols.map(c => c.title), ...this._data.map(row =>
      cols.map(c => `"${String(row[c.field] ?? '').replace(/"/g, '""')}"`)
    )].map(r => r.join(',')).join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: filename,
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  _sorted() {
    const { field, dir } = this._sort;
    if (!field) return this._data;
    return [...this._data].sort((a, b) => {
      const av = a[field], bv = b[field];
      const num = typeof av === 'number' && typeof bv === 'number';
      return dir * (num ? av - bv : String(av ?? '').localeCompare(String(bv ?? '')));
    });
  }

  _render() {
    const sorted = this._sorted();
    const ps     = this.opts.pageSize;
    const pages  = Math.max(1, Math.ceil(sorted.length / ps));
    this._page   = Math.min(Math.max(1, this._page), pages);
    const slice  = sorted.slice((this._page - 1) * ps, this._page * ps);

    this.el.innerHTML = `
      <div style="overflow-x:auto">
        <table class="rt-table">
          <thead><tr>${this.columns.map(c => `
            <th ${c.field && c.sortable !== false ? `data-sort="${c.field}" class="rt-sortable"` : ''}
                style="${c.width ? `width:${c.width};` : ''}${c.align ? `text-align:${c.align}` : ''}">
              ${c.title}${this._sort.field === c.field ? (this._sort.dir === 1 ? ' ↑' : ' ↓') : ''}
            </th>`).join('')}
          </tr></thead>
          <tbody>${slice.length
            ? slice.map(row => `<tr>${this.columns.map(c =>
                `<td style="${c.align ? `text-align:${c.align}` : ''}">${c.formatter ? c.formatter(row[c.field], row) : (row[c.field] ?? '')}</td>`
              ).join('')}</tr>`).join('')
            : `<tr><td colspan="${this.columns.length}" class="rt-empty">${this.opts.placeholder}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="rt-pagination">
        <button class="rt-page-btn" data-pg="${this._page - 1}" ${this._page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span>${sorted.length} row${sorted.length !== 1 ? 's' : ''} · Page ${this._page} of ${pages}</span>
        <button class="rt-page-btn" data-pg="${this._page + 1}" ${this._page >= pages ? 'disabled' : ''}>Next →</button>
      </div>`;
    this.opts.onRender?.();
  }
}
