// dashboard.js — KPI cards, time-range selector, Chart.js visualizations

const Dashboard = {
  rangeKey: 'rt_range_dashboard',
  _charts: {},
  _initialized: false,
  _pdfBound: false,
  get _chartView() { return localStorage.getItem('rt_dash_chart_view') || 'revenue'; },
  set _chartView(v) { localStorage.setItem('rt_dash_chart_view', v); },

  CHART_VIEWS: [
    { key: 'revenue',  label: 'Revenue & Profit',     title: 'Revenue, Profit & Overhead by Month' },
    { key: 'buyvsell', label: 'Purchases vs Revenue',  title: 'Total Purchased vs Revenue by Month' },
    { key: 'units',    label: 'Units Bought vs Sold',  title: 'Units Bought vs Sold by Month' },
    { key: 'margin',   label: 'Margin Trend',          title: 'Profit Margin % by Month' },
    { key: 'cashflow', label: 'Net Cash Flow',         title: 'Net Cash Flow by Month' },
    { key: 'overhead', label: 'Overhead %',            title: 'Overhead as % of Revenue by Month' },
  ],

  CHART_COLORS: [
    '#6c63ff','#34d399','#fbbf24','#f472b6',
    '#60a5fa','#a78bfa','#fb923c','#4ade80','#38bdf8','#c084fc',
  ],
  CAT_COLORS: {
    'Pokemon':'#f59e0b','Coins':'#10b981',
    'Sports Cards':'#3b82f6','Sneakers':'#8b5cf6','Other':'#6b7280',
  },

  init() {
    if (!this._initialized) {
      this._initialized = true;
      document.addEventListener('themechange', () => {
        if (document.getElementById('page-dashboard').classList.contains('active')) {
          this._destroyAllCharts();
          this.render();
        }
      });
    }
    if (!this._pdfBound) {
      this._pdfBound = true;
      document.getElementById('dash-export-pdf')?.addEventListener('click', () => this.exportPDF());
    }
    this.renderTimeRange();
    this.render();
  },

  // ── Range helpers ────────────────────────────────────────────────
  getRange() { return localStorage.getItem(this.rangeKey) || 'lifetime'; },

  computeDates(rk, customStart, customEnd) {
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (rk === '1w')  { const s = new Date(today); s.setDate(s.getDate() - 7);   s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === '1m')  { const s = new Date(today); s.setDate(s.getDate() - 30);  s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === '3m')  { const s = new Date(today); s.setMonth(s.getMonth() - 3); s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === '6m')  { const s = new Date(today); s.setMonth(s.getMonth() - 6); s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === 'ytd') { return { start: new Date(today.getFullYear(), 0, 1), end: today }; }
    if (rk === '1y')  { const s = new Date(today); s.setFullYear(s.getFullYear() - 1); s.setHours(0,0,0,0); return { start: s, end: today }; }
    if (rk === 'custom') {
      return { start: customStart ? new Date(customStart + 'T00:00:00') : null,
               end:   customEnd   ? new Date(customEnd   + 'T23:59:59') : null };
    }
    return { start: null, end: null };
  },

  computePrevDates(rk, start, end) {
    if (rk === 'lifetime' || !start || !end) return null;
    if (rk === 'ytd') {
      const py = start.getFullYear() - 1;
      return { start: new Date(py, 0, 1), end: new Date(py, end.getMonth(), end.getDate(), 23, 59, 59) };
    }
    const dur  = end.getTime() - start.getTime();
    const pEnd = new Date(start.getTime() - 1);
    return { start: new Date(pEnd.getTime() - dur), end: pEnd };
  },

  inRange(dateStr, start, end) {
    if (!start && !end) return true;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    if (start && d < start) return false;
    if (end   && d > end)   return false;
    return true;
  },

  // ── Formatters ───────────────────────────────────────────────────
  $:   v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: v => v.toFixed(1) + '%',
  num: v => Math.round(v).toLocaleString('en-US'),

  pctChange(curr, prev) { return prev === 0 ? null : ((curr - prev) / Math.abs(prev)) * 100; },

  changeBadge(curr, prev) {
    if (prev === null) return '';
    const p = this.pctChange(curr, prev);
    if (p === null) return '<span class="kpi-change neutral">—</span>';
    const up = p >= 0;
    return `<span class="kpi-change ${up ? 'up' : 'down'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px">
        <polyline points="${up ? '23 6 13.5 15.5 8.5 10.5 1 18' : '23 18 13.5 8.5 8.5 13.5 1 6'}"/>
      </svg>
      ${Math.abs(p).toFixed(1)}%
    </span>`;
  },

  // ── Chart helpers ────────────────────────────────────────────────
  _css(v)  { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); },

  _destroyChart(id) {
    if (this._charts[id]) { this._charts[id].destroy(); delete this._charts[id]; }
  },
  _destroyAllCharts() { Object.keys(this._charts).forEach(k => this._destroyChart(k)); },

  _theme() {
    return {
      text:   this._css('--text'),
      muted:  this._css('--text-muted'),
      border: this._css('--border'),
    };
  },

  _empty(msg = 'No data in selected range.') {
    return `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px">${msg}</div>`;
  },

  // ── Time-range bar ───────────────────────────────────────────────
  renderTimeRange() {
    const bar = document.getElementById('dash-time-range');
    if (!bar) return;
    const active = this.getRange();
    const opts = [
      { key: '1w', label: '1W' }, { key: '1m', label: '1M' },
      { key: '3m', label: '3M' }, { key: '6m', label: '6M' }, { key: 'ytd', label: 'YTD' },
      { key: '1y', label: '1Y' }, { key: 'lifetime', label: 'Lifetime' }, { key: 'custom', label: 'Custom' },
    ];
    bar.innerHTML = `
      <div class="time-range-pills">
        ${opts.map(o => `<button class="range-pill ${active === o.key ? 'active' : ''}" data-range="${o.key}">${o.label}</button>`).join('')}
      </div>
      <div class="custom-range-inputs ${active === 'custom' ? '' : 'hidden'}" id="dash-custom-range">
        <input type="date" id="dash-cs" value="${localStorage.getItem('rt_custom_start') || ''}">
        <span style="color:var(--text-muted)">→</span>
        <input type="date" id="dash-ce" value="${localStorage.getItem('rt_custom_end') || ''}">
        <button class="btn-sm" id="dash-apply">Apply</button>
      </div>`;

    bar.querySelectorAll('.range-pill').forEach(btn => btn.addEventListener('click', () => {
      localStorage.setItem(this.rangeKey, btn.dataset.range);
      this.renderTimeRange();
      this._destroyAllCharts();
      this.render();
    }));
    bar.querySelector('#dash-apply')?.addEventListener('click', () => {
      localStorage.setItem('rt_custom_start', document.getElementById('dash-cs').value);
      localStorage.setItem('rt_custom_end',   document.getElementById('dash-ce').value);
      this._destroyAllCharts();
      this.render();
    });
  },

  // ── Main render ──────────────────────────────────────────────────
  render() {
    const rk = this.getRange();
    const { start, end } = this.computeDates(rk, localStorage.getItem('rt_custom_start'), localStorage.getItem('rt_custom_end'));
    const prev      = this.computePrevDates(rk, start, end);
    const stats     = DB.getStats(start, end);
    const prevStats = prev ? DB.getStats(prev.start, prev.end) : null;

    this.renderKPIs(stats, prevStats);
    this.renderInsights(stats, start, end);
    this.renderMonthlyChart(start, end);
    this.renderMonthlyPreview(start, end);
    this.renderTopProducts(start, end);
    this.renderPlatformSplit(start, end);
    this.renderCategoryChart(start, end);
    this.renderRenewalReminders();
    this.renderPerformers(start, end);
    this.renderCategoryPL(start, end);
  },

  // ── KPI cards ────────────────────────────────────────────────────
  renderKPIs(stats, prev) {
    const el = document.getElementById('dash-kpis');
    if (!el) return;

    const cards = [
      { key: 'totalRevenue',        label: 'Gross Revenue',    icon: 'trending-up',    fmt: '$',   dynamic: false,
        tip: 'Total money received from all sales before any costs are deducted.' },
      { key: 'totalPurchaseCost',   label: 'Total Purchased',  icon: 'shopping-cart',  fmt: '$',   dynamic: false,
        tip: 'Total amount spent buying inventory, including items not yet sold.' },
      { key: 'totalCOGS',           label: 'Total COGS',       icon: 'package',        fmt: '$',   dynamic: false,
        tip: 'Cost of Goods Sold — the purchase cost of only the items you have actually sold, not all inventory.' },
      { key: 'grossProfit',         label: 'Gross Profit',     icon: 'dollar-sign',    fmt: '$',   dynamic: true,
        tip: 'Revenue minus COGS. Profit from sales before overhead expenses like fees, bots, and subscriptions.' },
      { key: 'netProfit',           label: 'True Net Profit',  icon: 'award',          fmt: '$',   dynamic: true,
        tip: 'Gross Profit minus all overhead expenses. The actual money you keep after every cost.' },
      { key: 'netCashFlow',         label: 'Net Cash Flow',    icon: 'activity',       fmt: '$',   dynamic: true,
        tip: 'Net Profit minus new inventory purchases. Negative means you reinvested more than you earned — normal for a growing operation.' },
      { key: 'avgMargin',           label: 'Avg Margin %',     icon: 'percent',        fmt: 'pct', dynamic: true,
        tip: 'Average profit margin across all sales. Calculated as Gross Profit ÷ Revenue. Higher is better.' },
      { key: 'roi',                 label: 'ROI %',            icon: 'bar-chart-2',    fmt: 'pct', dynamic: true,
        tip: 'Return on Investment — Gross Profit ÷ COGS. Shows how much profit you made for every dollar spent on sold goods.' },
      { key: 'inventoryValue',      label: 'Inventory Value',  icon: 'clipboard-list', fmt: '$',   dynamic: false,
        tip: 'Total value of your unsold stock at cost price — money currently tied up in inventory.' },
      { key: 'totalItemsPurchased', label: 'Items Purchased',  icon: 'package-plus',   fmt: 'num', dynamic: false,
        tip: 'Total number of individual units bought across all purchase entries in the selected period.' },
      { key: 'totalItemsSold',      label: 'Items Sold',       icon: 'check-circle',   fmt: 'num', dynamic: false,
        tip: 'Total number of individual units sold across all sale entries in the selected period.' },
      { key: 'totalOverhead',       label: 'Total Overhead',   icon: 'credit-card',    fmt: '$',   dynamic: false,
        tip: 'Non-product business expenses such as bots, proxies, platform fees, subscriptions, and supplies.' },
    ];

    el.innerHTML = cards.map((c, i) => {
      const val     = stats[c.key] ?? 0;
      const prevVal = prev ? (prev[c.key] ?? 0) : null;
      const fmted   = c.fmt === '$' ? this.$(val) : c.fmt === 'pct' ? this.pct(val) : this.num(val);
      const color   = c.dynamic ? (val >= 0 ? 'var(--green)' : 'var(--red)') : '';
      const badge   = this.changeBadge(val, prevVal);
      // Avoid tooltip going off-screen on first and last columns
      const cols = 4;
      const tipCls = (i % cols === 0) ? 'tip-right' : (i % cols === cols - 1) ? 'tip-left' : '';
      return `
        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label ${tipCls}" data-tip="${c.tip}">${c.label}</span>
            <i data-lucide="${c.icon}" style="width:15px;height:15px;color:var(--text-muted)"></i>
          </div>
          <div class="kpi-value" ${color ? `style="color:${color}"` : ''}>${fmted}</div>
          <div class="kpi-footer">${badge}${prev ? '<span class="kpi-vs">vs prev period</span>' : ''}</div>
        </div>`;
    }).join('');

    lucide.createIcons();
  },

  // ── Monthly chart — multi-view ────────────────────────────────────
  renderMonthlyChart(start, end) {
    const el = document.getElementById('dash-monthly-chart');
    if (!el) return;
    this._destroyChart('monthly');

    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let months = DB.getMonthlyBreakdown();
    if (start || end) {
      months = months.filter(m => {
        const d = new Date(m.year, m.month - 1, 1);
        if (start && d < new Date(start.getFullYear(), start.getMonth(), 1)) return false;
        if (end   && d > new Date(end.getFullYear(),   end.getMonth(),   31)) return false;
        return true;
      });
    }

    const view    = this._chartView;
    const viewDef = this.CHART_VIEWS.find(v => v.key === view) || this.CHART_VIEWS[0];
    const labels  = months.map(m => `${MO[m.month - 1]} '${String(m.year).slice(2)}`);

    // Render widget with view-switcher pills
    el.innerHTML = `
      <div class="widget-card">
        <div class="chart-view-header">
          <span class="widget-title" id="dash-chart-title">${viewDef.title}</span>
          <div class="chart-view-pills">
            ${this.CHART_VIEWS.map(v =>
              `<button class="cv-pill ${view === v.key ? 'active' : ''}" data-cv="${v.key}">${v.label}</button>`
            ).join('')}
          </div>
        </div>
        <div class="chart-container chart-container-tall">
          ${months.length === 0 ? this._empty() : '<canvas id="chart-monthly"></canvas>'}
        </div>
      </div>`;

    // Bind view-switcher
    el.querySelectorAll('[data-cv]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._chartView = btn.dataset.cv;
        this.renderMonthlyChart(start, end);
      });
    });

    if (months.length === 0) return;

    const { muted, border, text } = this._theme();
    const sharedOpts = (yFmt, tooltipFmt) => ({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: text, boxWidth: 12, padding: 16, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${tooltipFmt(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: muted, font: { size: 11 } }, grid: { color: border } },
        y: { ticks: { color: muted, font: { size: 11 }, callback: yFmt }, grid: { color: border } },
      },
    });

    const fmtDollar = v => '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+'k' : Number(v).toFixed(0));
    const fmtPct    = v => v.toFixed(1) + '%';
    const fmtUnits  = v => v + ' units';

    let chartCfg;

    switch (view) {

      case 'buyvsell':
        chartCfg = {
          type: 'bar',
          data: { labels, datasets: [
            { label: 'Total Purchased', data: months.map(m => m.purchaseCost), backgroundColor: 'rgba(248,113,113,0.75)', borderRadius: 4 },
            { label: 'Revenue',         data: months.map(m => m.revenue),      backgroundColor: 'rgba(52,211,153,0.75)',  borderRadius: 4 },
          ]},
          options: sharedOpts(fmtDollar, v => '$' + Number(v).toFixed(2)),
        };
        break;

      case 'units':
        chartCfg = {
          type: 'bar',
          data: { labels, datasets: [
            { label: 'Units Purchased', data: months.map(m => m.unitsPurchased), backgroundColor: 'rgba(99,102,241,0.8)',  borderRadius: 4 },
            { label: 'Units Sold',      data: months.map(m => m.unitsSold),      backgroundColor: 'rgba(251,191,36,0.8)',  borderRadius: 4 },
          ]},
          options: sharedOpts(fmtUnits, v => v + ' units'),
        };
        break;

      case 'margin':
        chartCfg = {
          type: 'line',
          data: { labels, datasets: [
            { label: 'Margin %', data: months.map(m => +m.margin.toFixed(2)),
              borderColor: 'rgba(108,99,255,.9)', backgroundColor: 'rgba(108,99,255,.12)',
              tension: 0.35, fill: true, pointBackgroundColor: 'rgba(108,99,255,.9)', pointRadius: 5, borderWidth: 2 },
          ]},
          options: { ...sharedOpts(fmtPct, v => v.toFixed(1) + '%'),
            scales: {
              x: { ticks: { color: muted, font: { size: 11 } }, grid: { color: border } },
              y: { ticks: { color: muted, font: { size: 11 }, callback: fmtPct }, grid: { color: border }, min: 0 },
            }},
        };
        break;

      case 'cashflow':
        chartCfg = {
          type: 'bar',
          data: { labels, datasets: [
            { label: 'Net Cash Flow', data: months.map(m => +m.netCashFlow.toFixed(2)),
              backgroundColor: months.map(m => m.netCashFlow >= 0 ? 'rgba(52,211,153,0.8)' : 'rgba(248,113,113,0.8)'),
              borderRadius: 4 },
          ]},
          options: sharedOpts(fmtDollar, v => '$' + Number(v).toFixed(2)),
        };
        break;

      case 'overhead':
        chartCfg = {
          type: 'line',
          data: { labels, datasets: [
            { label: 'Overhead %', data: months.map(m => m.revenue > 0 ? +(m.overhead / m.revenue * 100).toFixed(2) : 0),
              borderColor: 'rgba(248,113,113,.9)', backgroundColor: 'rgba(248,113,113,.1)',
              pointBackgroundColor: 'rgba(248,113,113,.9)', tension: 0.35, fill: true, pointRadius: 5, borderWidth: 2 },
          ]},
          options: { ...sharedOpts(fmtPct, v => v.toFixed(1) + '%'),
            scales: {
              x: { ticks: { color: muted, font: { size: 11 } }, grid: { color: border } },
              y: { ticks: { color: muted, font: { size: 11 }, callback: fmtPct }, grid: { color: border }, min: 0 },
            }},
        };
        break;

      default: // 'revenue'
        chartCfg = {
          type: 'bar',
          data: { labels, datasets: [
            { label: 'Revenue', data: months.map(m => m.revenue), backgroundColor: 'rgba(108,99,255,0.8)', borderRadius: 4, order: 2 },
            { label: 'Profit',  data: months.map(m => m.profit),  backgroundColor: 'rgba(52,211,153,0.8)',  borderRadius: 4, order: 2 },
            { label: 'Overhead', type: 'line', data: months.map(m => m.overhead),
              borderColor: 'rgba(248,113,113,.9)', backgroundColor: 'transparent',
              pointBackgroundColor: 'rgba(248,113,113,.9)', tension: 0.35, borderWidth: 2, pointRadius: 4, order: 1 },
          ]},
          options: sharedOpts(fmtDollar, v => '$' + Number(v).toFixed(2)),
        };
    }

    this._charts.monthly = new Chart(document.getElementById('chart-monthly'), chartCfg);
  },

  // ── Monthly preview table ─────────────────────────────────────────
  renderMonthlyPreview(start, end) {
    const el = document.getElementById('dash-monthly-preview');
    if (!el) return;
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let months = DB.getMonthlyBreakdown();
    if (start || end) {
      months = months.filter(m => {
        const d = new Date(m.year, m.month - 1, 1);
        if (start && d < new Date(start.getFullYear(), start.getMonth(), 1)) return false;
        if (end   && d > new Date(end.getFullYear(),   end.getMonth(),   31)) return false;
        return true;
      });
    }
    const rows = months.slice(-6);
    el.innerHTML = `
      <div class="widget-card">
        <div class="widget-header">
          <span class="widget-title">Monthly Breakdown</span>
          <a class="widget-link" onclick="navigateTo('monthly');return false;" href="#">View Full →</a>
        </div>
        ${rows.length === 0
          ? `<p class="empty-msg">No data in selected range.</p>`
          : `<div class="table-scroll"><table class="mini-table">
              <thead><tr><th>Month</th><th>Revenue</th><th>Profit</th><th>Margin</th><th>Overhead</th><th>True Net</th></tr></thead>
              <tbody>${rows.map(m => `
                <tr>
                  <td class="fw">${MO[m.month-1]} ${m.year}</td>
                  <td>${this.$(m.revenue)}</td>
                  <td class="${m.profit >= 0 ? 'c-green':'c-red'}">${this.$(m.profit)}</td>
                  <td>${this.pct(m.margin)}</td>
                  <td>${this.$(m.overhead)}</td>
                  <td class="${m.trueNet >= 0 ? 'c-green':'c-red'}">${this.$(m.trueNet)}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>`}
      </div>`;
  },

  // ── Top products horizontal bar ───────────────────────────────────
  renderTopProducts(start, end) {
    const el = document.getElementById('dash-top-products');
    if (!el) return;
    this._destroyChart('topProducts');

    const sales = DB.getSales().filter(s => this.inRange(s.dateSold, start, end));
    const map = {};
    sales.forEach(s => {
      const k = s.sku || s.productName;
      if (!map[k]) map[k] = { name: s.productName, profit: 0, units: 0 };
      map[k].profit += s.netProfit;
      map[k].units  += s.qtySold;
    });
    const top = Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, 5);
    const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '…' : str;

    el.innerHTML = `
      <div class="widget-card">
        <div class="widget-title">Top 5 Products by Profit</div>
        <div class="chart-container">
          ${top.length === 0 ? this._empty('No sales in range.') : '<canvas id="chart-top-products"></canvas>'}
        </div>
      </div>`;

    if (top.length === 0) return;
    const { text, muted, border } = this._theme();
    this._charts.topProducts = new Chart(document.getElementById('chart-top-products'), {
      type: 'bar',
      data: {
        labels: top.map(p => trunc(p.name, 22)),
        datasets: [{
          data: top.map(p => p.profit),
          backgroundColor: top.map(p => p.profit >= 0 ? 'rgba(52,211,153,0.8)' : 'rgba(248,113,113,0.8)'),
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` $${Number(ctx.raw).toFixed(2)}` } },
        },
        scales: {
          x: { ticks: { color: muted, font: { size: 11 }, callback: v => '$' + v }, grid: { color: border } },
          y: { ticks: { color: text, font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  },

  // ── Platform doughnut + P&L ───────────────────────────────────────
  renderPlatformSplit(start, end) {
    const el = document.getElementById('dash-platform-split');
    if (!el) return;
    this._destroyChart('platform');

    const items = DB.getPlatformPL(start, end);
    const total = items.reduce((a, d) => a + d.revenue, 0);

    const plRows = items.map((d, i) => {
      const color = this.CHART_COLORS[i % this.CHART_COLORS.length];
      return `
        <div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span style="flex:1;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.platform}</span>
          <span style="font-size:12px;font-weight:700;color:${d.profit >= 0 ? 'var(--green)' : 'var(--red)'}">$${d.profit.toFixed(2)}</span>
          <span style="font-size:11px;color:var(--text-muted);min-width:34px;text-align:right">${d.margin.toFixed(1)}%</span>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="widget-card">
        <div class="widget-title">Sales by Platform</div>
        <div class="chart-container">
          ${items.length === 0 ? this._empty('No sales in range.') : '<canvas id="chart-platform"></canvas>'}
        </div>
        ${items.length > 0 ? `
          <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
            <div style="display:flex;justify-content:flex-end;gap:16px;padding-bottom:4px">
              <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Profit</span>
              <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:34px;text-align:right">Margin</span>
            </div>
            ${plRows}
          </div>` : ''}
      </div>`;

    if (items.length === 0) return;
    const { text } = this._theme();
    this._charts.platform = new Chart(document.getElementById('chart-platform'), {
      type: 'doughnut',
      data: {
        labels: items.map(d => d.platform),
        datasets: [{ data: items.map(d => d.revenue), backgroundColor: this.CHART_COLORS, borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: text, boxWidth: 10, padding: 8, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ` $${Number(ctx.raw).toFixed(2)} (${total > 0 ? (ctx.raw / total * 100).toFixed(1) : 0}%)` } },
        },
      },
    });
  },

  // ── Category doughnut ─────────────────────────────────────────────
  renderCategoryChart(start, end) {
    const el = document.getElementById('dash-category-chart');
    if (!el) return;
    this._destroyChart('category');

    const purchases = DB.getPurchases().filter(p => this.inRange(p.dateBought, start, end));
    const map = {}, total = purchases.reduce((a, p) => a + p.totalCost, 0);
    purchases.forEach(p => { map[p.category] = (map[p.category] || 0) + p.totalCost; });
    const items = Object.entries(map).sort((a, b) => b[1] - a[1]);

    el.innerHTML = `
      <div class="widget-card">
        <div class="widget-title">Purchases by Category</div>
        <div class="chart-container">
          ${items.length === 0 ? this._empty('No purchases in range.') : '<canvas id="chart-category"></canvas>'}
        </div>
      </div>`;

    if (items.length === 0) return;
    const { text } = this._theme();
    this._charts.category = new Chart(document.getElementById('chart-category'), {
      type: 'doughnut',
      data: {
        labels: items.map(([c]) => c),
        datasets: [{ data: items.map(([, v]) => v), backgroundColor: items.map(([c]) => this.CAT_COLORS[c] || '#6b7280'), borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: text, boxWidth: 10, padding: 8, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ` $${Number(ctx.raw).toFixed(2)} (${total > 0 ? (ctx.raw/total*100).toFixed(1) : 0}%)` } },
        },
      },
    });
  },

  // ── Insights strip ────────────────────────────────────────────────
  renderInsights(stats, start, end) {
    const el = document.getElementById('dash-insights');
    if (!el) return;

    const settings = DB.getSettings();
    const taxRate  = settings.taxRate || 25;
    const monthlyGoal = settings.monthlyGoal || 0;

    const taxReserve = Math.max(0, stats.netProfit) * (taxRate / 100);
    const afterTax   = stats.netProfit - taxReserve;

    // Current month profit
    const now = new Date();
    const allMonths = DB.getMonthlyBreakdown();
    const curMonth  = allMonths.find(m => m.year === now.getFullYear() && m.month === now.getMonth() + 1);
    const curProfit = curMonth ? curMonth.trueNet : 0;
    const goalPct   = monthlyGoal > 0 ? Math.min(100, (curProfit / monthlyGoal) * 100) : 0;

    el.innerHTML = `
      <div class="insight-strip">
        <div class="insight-card">
          <h4>Tax Reserve (${taxRate}%)</h4>
          <div class="insight-val" style="color:var(--red)">($${taxReserve.toFixed(2)})</div>
          <div class="goal-label">Set Aside for Taxes</div>
        </div>
        <div class="insight-card">
          <h4>After-Tax Net</h4>
          <div class="insight-val" style="color:${afterTax >= 0 ? 'var(--green)' : 'var(--red)'}">
            ${afterTax < 0 ? '-$' : '$'}${Math.abs(afterTax).toFixed(2)}
          </div>
          <div class="goal-label">After-Tax Net</div>
        </div>
        <div class="insight-card">
          <h4>Monthly Goal</h4>
          <div class="insight-val" style="color:var(--text)">${goalPct.toFixed(0)}%</div>
          <div class="progress-track"><div class="progress-fill" style="width:${goalPct}%"></div></div>
          <div class="goal-label">$${curProfit.toFixed(2)} / $${(monthlyGoal).toFixed(2)}</div>
        </div>
      </div>`;
  },

  // ── Renewal Reminders ─────────────────────────────────────────────
  renderRenewalReminders() {
    const el = document.getElementById('dash-renewals');
    if (!el) return;

    const recurring = DB.getOverhead().filter(o => o.recurring);
    // Keep most recent entry per expenseName
    const latestMap = {};
    recurring.forEach(o => {
      if (!latestMap[o.expenseName] || o.date > latestMap[o.expenseName].date) {
        latestMap[o.expenseName] = o;
      }
    });

    const CYCLE_DAYS = { monthly: 30, quarterly: 90, annually: 365 };
    const now = new Date();
    const upcoming = Object.values(latestMap).map(o => {
      const last = new Date(o.date + 'T12:00:00');
      const days = CYCLE_DAYS[o.renewalCycle || 'monthly'] || 30;
      const next = new Date(last.getTime() + days * 24 * 60 * 60 * 1000);
      const daysUntil = Math.round((next - now) / (1000 * 60 * 60 * 24));
      return { ...o, nextDate: next, daysUntil };
    }).filter(o => o.daysUntil <= 60).sort((a, b) => a.nextDate - b.nextDate);

    const dateStr = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dueColor = days => days <= 7 ? 'var(--red)' : days <= 14 ? 'var(--yellow)' : 'var(--text-muted)';

    el.innerHTML = `
      <div class="widget-card">
        <div class="widget-title">⏰ Upcoming Renewals</div>
        ${upcoming.length === 0
          ? `<p class="empty-msg">No recurring expenses due soon.</p>`
          : upcoming.map(o => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
              <div style="flex:1;min-width:0">
                <span style="font-weight:600">${o.expenseName}</span>
                <span style="color:var(--text-muted);font-size:11px;margin-left:6px">${o.category}</span>
              </div>
              <div style="text-align:right;white-space:nowrap">
                <span style="color:${dueColor(o.daysUntil)};font-weight:600">Due: ${dateStr(o.nextDate)}</span>
                <span style="color:var(--text-muted);font-size:12px;margin-left:8px">($${o.amount.toFixed(2)})</span>
              </div>
            </div>`).join('')}
      </div>`;
  },

  // ── Top & Bottom Performers ───────────────────────────────────────
  renderPerformers(start, end) {
    const el = document.getElementById('dash-performers');
    if (!el) return;

    const sales = DB.getSales().filter(s => this.inRange(s.dateSold, start, end));
    const map = {};
    sales.forEach(s => {
      const k = s.sku || s.productName;
      if (!map[k]) map[k] = { name: s.productName, profit: 0 };
      map[k].profit += s.netProfit;
    });
    const sorted = Object.values(map).sort((a, b) => b.profit - a.profit);

    if (sorted.length < 2) {
      el.innerHTML = `
        <div class="widget-card">
          <div class="widget-title">Top &amp; Bottom Performers</div>
          <p class="empty-msg">Not enough products to compare. Log at least 2 different products.</p>
        </div>`;
      return;
    }

    const top = sorted.slice(0, 3);
    const bot = sorted.slice(-3).reverse();
    const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

    const makeRows = (items, cls, sign) => items.map(p => `
      <div class="performer-row">
        <span>${trunc(p.name, 22)}</span>
        <span class="perf-badge ${cls}">${sign}$${Math.abs(p.profit).toFixed(2)}</span>
      </div>`).join('');

    el.innerHTML = `
      <div class="widget-card" style="margin-bottom:16px">
        <div class="widget-title">Top &amp; Bottom Performers</div>
        <div class="performers-grid">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Top Performers</div>
            ${makeRows(top, 'top', '+')}
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Bottom Performers</div>
            ${makeRows(bot, 'bot', '')}
          </div>
        </div>
      </div>`;
  },

  // ── Category P&L table ────────────────────────────────────────────
  renderCategoryPL(start, end) {
    const el = document.getElementById('dash-category-pl');
    if (!el) return;

    const data = DB.getCategoryPL(start, end);

    if (data.length === 0) {
      el.innerHTML = `
        <div class="widget-card">
          <div class="widget-title">Category P&amp;L</div>
          <p class="empty-msg">No sales in selected range.</p>
        </div>`;
      return;
    }

    const colSign = v => v >= 0 ? 'c-green' : 'c-red';

    el.innerHTML = `
      <div class="widget-card">
        <div class="widget-title">Category P&amp;L</div>
        <div class="table-scroll">
          <table class="mini-table">
            <thead>
              <tr>
                <th>Category</th>
                <th style="text-align:right">Units</th>
                <th style="text-align:right">Revenue</th>
                <th style="text-align:right">Profit</th>
                <th style="text-align:right">Margin</th>
                <th style="text-align:right">ROI</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(d => `
                <tr>
                  <td>
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <span style="width:8px;height:8px;border-radius:50%;background:${this.CAT_COLORS[d.category]||'#6b7280'};flex-shrink:0"></span>
                      <span class="fw">${d.category}</span>
                    </span>
                  </td>
                  <td style="text-align:right">${d.units}</td>
                  <td style="text-align:right">$${d.revenue.toFixed(2)}</td>
                  <td style="text-align:right"><strong class="${colSign(d.profit)}">$${d.profit.toFixed(2)}</strong></td>
                  <td style="text-align:right"><span class="${colSign(d.margin)}">${d.margin.toFixed(1)}%</span></td>
                  <td style="text-align:right"><span class="${colSign(d.roi)}">${d.roi.toFixed(1)}%</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  },

  // ── PDF Export ────────────────────────────────────────────────────
  exportPDF() {
    if (!window.jspdf) { Toast.error('PDF library not loaded.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const stats  = DB.getStats();
    const months = DB.getMonthlyBreakdown();
    const today  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    // Title
    doc.setFontSize(20); doc.setFont('helvetica','bold');
    doc.text('Reseller Business Report', 14, 20);
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text(`Generated: ${today}`, 14, 28);

    // KPI summary
    doc.setFontSize(13); doc.setFont('helvetica','bold');
    doc.text('Business Summary', 14, 42);
    doc.autoTable({
      startY: 46,
      head: [['Metric', 'Value']],
      body: [
        ['Gross Revenue',    '$' + stats.totalRevenue.toFixed(2)],
        ['Total COGS',       '$' + stats.totalCOGS.toFixed(2)],
        ['Gross Profit',     '$' + stats.grossProfit.toFixed(2)],
        ['Total Overhead',   '$' + stats.totalOverhead.toFixed(2)],
        ['True Net Profit',  '$' + stats.netProfit.toFixed(2)],
        ['Avg Margin %',     stats.avgMargin.toFixed(1) + '%'],
        ['ROI %',            stats.roi.toFixed(1) + '%'],
        ['Inventory Value',  '$' + stats.inventoryValue.toFixed(2)],
        ['Items Purchased',  stats.totalItemsPurchased.toString()],
        ['Items Sold',       stats.totalItemsSold.toString()],
      ],
      styles: { fontSize: 10 },
      headStyles: { fillColor: [108, 99, 255] },
      alternateRowStyles: { fillColor: [245, 245, 255] },
    });

    // Monthly breakdown
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (months.length) {
      doc.addPage();
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      doc.text('Monthly Breakdown', 14, 20);
      doc.autoTable({
        startY: 24,
        head: [['Month','Revenue','Profit','Margin','Overhead','True Net']],
        body: months.map(m => [
          MO[m.month - 1] + ' ' + m.year,
          '$' + m.revenue.toFixed(2),
          '$' + m.profit.toFixed(2),
          m.margin.toFixed(1) + '%',
          '$' + m.overhead.toFixed(2),
          '$' + m.trueNet.toFixed(2),
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [108, 99, 255] },
      });
    }

    // Top products
    const top = DB.getTopProducts(10);
    if (top.length) {
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      const y = doc.lastAutoTable.finalY + 14;
      doc.text('Top Products by Profit', 14, y);
      doc.autoTable({
        startY: y + 4,
        head: [['Product','SKU','Units Sold','Profit','Revenue']],
        body: top.map(p => [p.name, p.sku || '—', p.units, '$' + p.profit.toFixed(2), '$' + p.revenue.toFixed(2)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [52, 211, 153], textColor: 0 },
      });
    }

    doc.save(`reseller-report-${new Date().toISOString().split('T')[0]}.pdf`);
    Toast.show('PDF exported ✓');
  },
};
