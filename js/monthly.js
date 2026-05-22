// monthly.js — Monthly Breakdown page

const Monthly = {
  _year: new Date().getFullYear(),
  _compareYear: null,
  _chart: null,
  _initialized: false,

  init() {
    this._initialized = true;
    this._render();
  },

  _getYears() {
    return [...new Set(DB.getMonthlyBreakdown().map(m => m.year))].sort((a,b)=>b-a);
  },

  _render() {
    const el = document.getElementById('page-monthly');
    if (!el) return;
    const years = this._getYears();
    if (!years.length) {
      el.innerHTML = `<div class="empty-page"><h2>No data yet</h2><p>Add purchases and sales to see your monthly breakdown.</p></div>`;
      return;
    }
    if (!years.includes(this._year)) this._year = years[0];

    el.innerHTML = `
      <div class="page-toolbar" style="margin-bottom:20px">
        <div class="toolbar-left">
          <span style="font-weight:600;color:var(--text-muted)">Year:</span>
          <select id="mon-year" class="filter-select">
            ${years.map(y => `<option value="${y}" ${y===this._year?'selected':''}>${y}</option>`).join('')}
          </select>
          <span style="color:var(--text-muted);font-size:13px">Compare with:</span>
          <select id="mon-compare" class="filter-select">
            <option value="">None</option>
            ${years.filter(y => y !== this._year).map(y => `<option value="${y}" ${this._compareYear == y ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="mon-summary" style="margin-bottom:16px"></div>
      <div class="widget-card" style="margin-bottom:16px">
        <div class="widget-title">Revenue, Profit &amp; Overhead — ${this._year}${this._compareYear ? ' vs ' + this._compareYear : ''}</div>
        <div class="chart-container chart-container-tall"><canvas id="mon-chart"></canvas></div>
      </div>
      <div class="widget-card">
        <div class="widget-title">Monthly Breakdown — ${this._year}${this._compareYear ? ' vs ' + this._compareYear : ''}</div>
        <div class="table-scroll" id="mon-table"></div>
      </div>`;

    document.getElementById('mon-year').addEventListener('change', e => {
      this._year = +e.target.value;
      // Reset compare year if it equals the new primary year
      if (this._compareYear === this._year) this._compareYear = null;
      this._render();
    });

    document.getElementById('mon-compare').addEventListener('change', e => {
      this._compareYear = +e.target.value || null;
      this._renderData();
    });

    this._renderData();
  },

  _renderData() {
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const all     = DB.getMonthlyBreakdown().filter(m => m.year === this._year);
    const compAll = this._compareYear
      ? DB.getMonthlyBreakdown().filter(m => m.year === this._compareYear)
      : [];

    // Build compare map for O(1) lookup by month number
    const compMap = {};
    compAll.forEach(m => { compMap[m.month] = m; });

    // Summary
    const totRev  = all.reduce((a,m)=>a+m.revenue, 0);
    const totProf = all.reduce((a,m)=>a+m.profit,  0);
    const totOH   = all.reduce((a,m)=>a+m.overhead,0);
    const totNet  = totProf - totOH;
    const avgMarg = totRev > 0 ? (totProf/totRev*100) : 0;

    const s = document.getElementById('mon-summary');
    if (s) s.innerHTML = `
      <div class="summary-bar">
        <div class="summary-stat"><span class="summary-label">Total Revenue</span><span class="summary-value">$${totRev.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Gross Profit</span><span class="summary-value ${totProf>=0?'c-green':'c-red'}">$${totProf.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Overhead</span><span class="summary-value c-red">$${totOH.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">True Net</span><span class="summary-value ${totNet>=0?'c-green':'c-red'}">$${totNet.toFixed(2)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-stat"><span class="summary-label">Avg Margin</span><span class="summary-value">${avgMarg.toFixed(1)}%</span></div>
      </div>`;

    // Chart
    if (this._chart) { this._chart.destroy(); this._chart = null; }
    if (all.length && typeof Chart !== 'undefined') {
      const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
      const labels = all.map(m => MO[m.month-1]);

      const datasets = [
        { label: `${this._year} Revenue`, data: all.map(m=>m.revenue), backgroundColor:'rgba(108,99,255,0.8)', borderRadius:4, order:2 },
        { label: `${this._year} Profit`,  data: all.map(m=>m.profit),  backgroundColor:'rgba(52,211,153,0.8)',  borderRadius:4, order:2 },
        { label: `${this._year} Overhead`, type:'line', data: all.map(m=>m.overhead),
          borderColor:'rgba(248,113,113,.9)', backgroundColor:'transparent',
          pointBackgroundColor:'rgba(248,113,113,.9)', tension:0.35, borderWidth:2, pointRadius:4, order:1 },
      ];

      if (this._compareYear && compAll.length) {
        // Map compare data to same month slots as primary year (fill 0 if missing)
        const compRevenue  = all.map(m => (compMap[m.month]?.revenue  || 0));
        const compProfit   = all.map(m => (compMap[m.month]?.profit   || 0));
        const compOverhead = all.map(m => (compMap[m.month]?.overhead || 0));
        datasets.push(
          { label: `${this._compareYear} Revenue`, data: compRevenue, backgroundColor:'rgba(108,99,255,0.3)', borderRadius:4, order:2, borderDash:[4,4] },
          { label: `${this._compareYear} Profit`,  data: compProfit,  backgroundColor:'rgba(52,211,153,0.3)',  borderRadius:4, order:2 },
          { label: `${this._compareYear} Overhead`, type:'line', data: compOverhead,
            borderColor:'rgba(248,113,113,.45)', backgroundColor:'transparent',
            borderDash:[5,5], pointBackgroundColor:'rgba(248,113,113,.45)',
            tension:0.35, borderWidth:2, pointRadius:4, order:1 },
        );
      }

      this._chart = new Chart(document.getElementById('mon-chart'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive:true, maintainAspectRatio:false,
          interaction:{ mode:'index', intersect:false },
          plugins: {
            legend:{ labels:{ color:css('--text'), boxWidth:12, padding:16, font:{size:12} } },
            tooltip:{ callbacks:{ label: ctx => ` ${ctx.dataset.label}: $${Number(ctx.raw).toFixed(2)}` } },
          },
          scales: {
            x:{ ticks:{color:css('--text-muted'), font:{size:11}}, grid:{color:css('--border')} },
            y:{ ticks:{color:css('--text-muted'), font:{size:11}, callback: v=>'$'+(Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':v)}, grid:{color:css('--border')} },
          },
        },
      });
    }

    // Table
    const tbody = document.getElementById('mon-table');
    if (!tbody) return;
    if (!all.length) {
      tbody.innerHTML = '<p class="empty-msg" style="padding:16px">No data for this year.</p>'; return;
    }

    const cmp = this._compareYear;
    const colClass = (curr, comp) => curr > comp ? 'c-green' : curr < comp ? 'c-red' : '';

    if (cmp && compAll.length) {
      // YoY comparison table
      tbody.innerHTML = `<table class="mini-table" style="width:100%">
        <thead>
          <tr>
            <th rowspan="2">Month</th>
            <th colspan="2">Revenue</th>
            <th colspan="2">Gross Profit</th>
            <th colspan="2">Margin</th>
            <th colspan="2">True Net</th>
          </tr>
          <tr>
            <th>${this._year}</th><th>${cmp}</th>
            <th>${this._year}</th><th>${cmp}</th>
            <th>${this._year}</th><th>${cmp}</th>
            <th>${this._year}</th><th>${cmp}</th>
          </tr>
        </thead>
        <tbody>
          ${all.map(m => {
            const c = compMap[m.month] || { revenue:0, profit:0, margin:0, trueNet:0 };
            return `<tr>
              <td class="fw">${MO[m.month-1]}</td>
              <td>$${m.revenue.toFixed(2)}</td>
              <td style="color:var(--text-muted)">$${c.revenue.toFixed(2)}</td>
              <td class="${m.profit>=0?'c-green':'c-red'}">$${m.profit.toFixed(2)}</td>
              <td style="color:var(--text-muted);font-size:12px">$${c.profit.toFixed(2)}</td>
              <td class="${colClass(m.margin, c.margin)}">${m.margin.toFixed(1)}%</td>
              <td style="color:var(--text-muted);font-size:12px">${c.margin.toFixed(1)}%</td>
              <td class="${m.trueNet>=0?'c-green':'c-red'}">$${m.trueNet.toFixed(2)}</td>
              <td style="color:var(--text-muted);font-size:12px">$${c.trueNet.toFixed(2)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    } else {
      // Standard table
      tbody.innerHTML = `<table class="mini-table" style="width:100%">
        <thead><tr>
          <th>Month</th><th>Revenue</th><th>COGS</th><th>Gross Profit</th><th>Margin</th>
          <th>Units Sold</th><th>Purchases</th><th>Overhead</th><th>True Net</th><th>Cash Flow</th>
        </tr></thead>
        <tbody>
          ${all.map(m=>`<tr>
            <td class="fw">${MO[m.month-1]}</td>
            <td>$${m.revenue.toFixed(2)}</td>
            <td>$${m.cogs.toFixed(2)}</td>
            <td class="${m.profit>=0?'c-green':'c-red'}">$${m.profit.toFixed(2)}</td>
            <td>${m.margin.toFixed(1)}%</td>
            <td>${m.unitsSold}</td>
            <td>$${m.purchaseCost.toFixed(2)}</td>
            <td class="c-red">$${m.overhead.toFixed(2)}</td>
            <td class="${m.trueNet>=0?'c-green':'c-red'}">$${m.trueNet.toFixed(2)}</td>
            <td class="${m.netCashFlow>=0?'c-green':'c-red'}">$${m.netCashFlow.toFixed(2)}</td>
          </tr>`).join('')}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>Total</td>
            <td>$${totRev.toFixed(2)}</td>
            <td>$${all.reduce((a,m)=>a+m.cogs,0).toFixed(2)}</td>
            <td class="${totProf>=0?'c-green':'c-red'}">$${totProf.toFixed(2)}</td>
            <td>${avgMarg.toFixed(1)}%</td>
            <td>${all.reduce((a,m)=>a+m.unitsSold,0)}</td>
            <td>$${all.reduce((a,m)=>a+m.purchaseCost,0).toFixed(2)}</td>
            <td class="c-red">$${totOH.toFixed(2)}</td>
            <td class="${totNet>=0?'c-green':'c-red'}">$${totNet.toFixed(2)}</td>
            <td class="${all.reduce((a,m)=>a+m.netCashFlow,0)>=0?'c-green':'c-red'}">$${all.reduce((a,m)=>a+m.netCashFlow,0).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>`;
    }
  },
};
