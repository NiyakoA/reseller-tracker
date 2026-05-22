// data.js — localStorage schema, CRUD helpers, seed data, aggregates
// All keys prefixed 'rt_' to avoid collisions

const DB = {

  KEYS: {
    purchases: 'rt_purchases',
    sales:     'rt_sales',
    overhead:  'rt_overhead',
    settings:  'rt_settings',
    counters:  'rt_counters',
  },

  SEED_KEY: 'rt_seeded_v4',

  // ── Dropdown options ────────────────────────────────────────────
  CATEGORIES:        ['Pokemon', 'Coins', 'Sports Cards', 'Sneakers', 'Other'],
  CONDITIONS:        ['New', 'Used', 'Sealed', 'Damaged'],
  PURCHASE_METHODS:  ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Check', 'ACO', 'Manual', 'Refract', 'Other'],
  PLATFORMS:         ['eBay', 'Facebook Marketplace', 'Mercari', 'OfferUp', 'Poshmark', 'Depop', 'Amazon', 'Etsy', 'Tradepost', 'Marketplace', 'In-Person', 'Other'],
  SALE_METHODS:      ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Direct Deposit'],
  OVERHEAD_CATS:     ['Bot', 'Proxy', 'SMS', 'Profile Builder', 'Whop/Discord Group', 'Server', 'eBay Fees', 'PayPal Fees', 'Shipping Supplies', 'Storage', 'Ads', 'Software', 'Other'],
  STORES:            ['Best Buy', 'Target', 'Walmart', 'Costco', 'Amazon', 'eBay', 'StockX', 'GOAT', 'Nike SNKRS', 'APMEX', 'DACW', 'Other'],

  // ── Low-level helpers ───────────────────────────────────────────
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; }
  },
  _set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    this._checkStorage();
  },

  // ── Storage usage ────────────────────────────────────────────────
  // Returns chars used/cap so callers don't need to know the storage backend.
  // Swap this method when migrating off localStorage.
  getStorageInfo() {
    const used = Object.keys(localStorage)
      .filter(k => k.startsWith('rt_'))
      .reduce((a, k) => a + (localStorage.getItem(k)?.length || 0), 0);
    const cap = 5 * 1024 * 1024; // ~5 MB in chars
    return { used, cap, pct: Math.min(100, (used / cap) * 100) };
  },

  _storageWarnShown: false,
  _checkStorage() {
    const { pct } = this.getStorageInfo();
    if (pct >= 80 && !this._storageWarnShown) {
      this._storageWarnShown = true;
      if (typeof Toast !== 'undefined') {
        Toast.error(`⚠ Storage ${pct.toFixed(0)}% full — export a backup soon.`);
      }
    }
  },

  _nextId(type) {
    const c = JSON.parse(localStorage.getItem(this.KEYS.counters) || '{}');
    c[type] = (c[type] || 0) + 1;
    localStorage.setItem(this.KEYS.counters, JSON.stringify(c));
    return c[type];
  },

  // ── Purchases ───────────────────────────────────────────────────
  getPurchases()      { return this._get(this.KEYS.purchases); },
  savePurchases(rows) { this._set(this.KEYS.purchases, rows); },

  addPurchase(d) {
    const qty  = Number(d.qtyBought)  || 1;
    const cost = Number(d.unitCost)   || 0;
    const row  = {
      id: this._nextId('purchases'),
      dateBought:     d.dateBought     || '',
      productName:    d.productName    || '',
      category:       d.category       || 'Other',
      qtyBought:      qty,
      unitCost:       cost,
      totalCost:      qty * cost,
      store:          d.store          || '',
      purchaseMethod: d.purchaseMethod || 'Card',
      sku:            d.sku            || '',
      condition:      d.condition      || 'New',
      notes:          d.notes          || '',
      tags:           d.tags           || [],
      createdAt:      new Date().toISOString(),
    };
    const rows = this.getPurchases();
    rows.push(row);
    this.savePurchases(rows);
    return row;
  },

  updatePurchase(id, d) {
    const rows = this.getPurchases();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    const u = { ...rows[i], ...d, id };
    u.qtyBought = Number(u.qtyBought) || 0;
    u.unitCost  = Number(u.unitCost)  || 0;
    u.totalCost = u.qtyBought * u.unitCost;
    rows[i] = u;
    this.savePurchases(rows);
    return u;
  },

  deletePurchase(id) { this.savePurchases(this.getPurchases().filter(r => r.id !== id)); },

  // ── Sales ───────────────────────────────────────────────────────
  getSales()      { return this._get(this.KEYS.sales); },
  saveSales(rows) { this._set(this.KEYS.sales, rows); },

  // FIFO weighted-average cost for selling `qty` units of `sku`.
  // Walks purchase lots oldest-first, skips units already sold, returns avg cost/unit.
  getFIFOCost(sku, qty) {
    if (!sku || !qty || qty <= 0) return 0;

    const lots = this.getPurchases()
      .filter(p => p.sku === sku)
      .sort((a, b) => new Date(a.dateBought) - new Date(b.dateBought))
      .map(p => ({ avail: p.qtyBought, cost: Number(p.unitCost) || 0 }));

    if (!lots.length) return 0;

    // Burn through already-sold units first so we start at the right lot
    let consumed = this.getSales()
      .filter(s => s.sku === sku)
      .reduce((a, s) => a + s.qtySold, 0);

    for (const lot of lots) {
      if (consumed <= 0) break;
      const take = Math.min(consumed, lot.avail);
      lot.avail -= take;
      consumed  -= take;
    }

    // Consume the new qty in FIFO order
    let totalCost = 0, needed = qty;
    for (const lot of lots) {
      if (needed <= 0) break;
      if (lot.avail <= 0) continue;
      const take = Math.min(needed, lot.avail);
      totalCost += take * lot.cost;
      needed    -= take;
    }

    // Oversold beyond known lots — fall back to last lot's cost
    if (needed > 0) totalCost += needed * (lots[lots.length - 1]?.cost || 0);

    return totalCost / qty;
  },

  // Pull unit cost from matching purchase SKU if not provided (legacy fallback)
  _costForSku(sku) {
    const p = this.getPurchases().find(p => p.sku && p.sku === sku);
    return p ? p.unitCost : 0;
  },

  addSale(d) {
    const qty      = Number(d.qtySold)          || 1;
    const price    = Number(d.salePricePerUnit) || 0;
    const cost     = Number(d.unitCost) || this.getFIFOCost(d.sku, qty) || this._costForSku(d.sku) || 0;
    const feePct   = Number(d.platformFeePct)   || 0;
    const shipping = Number(d.shippingCost)     || 0;
    const rev      = qty * price;
    const cogs     = qty * cost;
    const feeAmt   = rev * (feePct / 100);
    const profit   = rev - cogs - feeAmt - shipping;
    const row   = {
      id: this._nextId('sales'),
      dateSold:        d.dateSold        || '',
      productName:     d.productName     || '',
      sku:             d.sku             || '',
      qtySold:         qty,
      salePricePerUnit: price,
      grossRevenue:    rev,
      platform:        d.platform        || 'eBay',
      saleMethod:      d.saleMethod      || 'PayPal',
      unitCost:        cost,
      totalCost:       cogs,
      platformFeePct:  feePct,
      platformFeeAmt:  feeAmt,
      shippingCost:    shipping,
      netProfit:       profit,
      margin:          rev > 0 ? (profit / rev) * 100 : 0,
      notes:           d.notes           || '',
      tags:            d.tags            || [],
      createdAt:       new Date().toISOString(),
    };
    const rows = this.getSales();
    rows.push(row);
    this.saveSales(rows);
    return row;
  },

  updateSale(id, d) {
    const rows = this.getSales();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    const u = { ...rows[i], ...d, id };
    u.qtySold          = Number(u.qtySold)          || 0;
    u.salePricePerUnit = Number(u.salePricePerUnit) || 0;
    u.unitCost         = Number(u.unitCost)         || 0;
    u.platformFeePct   = Number(u.platformFeePct)   || 0;
    u.shippingCost     = Number(u.shippingCost)     || 0;
    u.grossRevenue     = u.qtySold * u.salePricePerUnit;
    u.totalCost        = u.qtySold * u.unitCost;
    u.platformFeeAmt   = u.grossRevenue * (u.platformFeePct / 100);
    u.netProfit        = u.grossRevenue - u.totalCost - u.platformFeeAmt - u.shippingCost;
    u.margin           = u.grossRevenue > 0 ? (u.netProfit / u.grossRevenue) * 100 : 0;
    rows[i] = u;
    this.saveSales(rows);
    return u;
  },

  deleteSale(id) { this.saveSales(this.getSales().filter(r => r.id !== id)); },

  // ── Overhead ────────────────────────────────────────────────────
  getOverhead()      { return this._get(this.KEYS.overhead).map(o => ({ ...o, amount: Number(o.amount) || 0 })); },
  saveOverhead(rows) { this._set(this.KEYS.overhead, rows); },

  addOverhead(d) {
    const row = {
      id: this._nextId('overhead'),
      date:          d.date          || '',
      expenseName:   d.expenseName   || '',
      category:      d.category      || 'Other',
      amount:        Number(d.amount) || 0,
      paymentMethod: d.paymentMethod || 'Card',
      recurring:     !!d.recurring,
      renewalCycle:  d.renewalCycle  || 'monthly',
      notes:         d.notes         || '',
      tags:          d.tags          || [],
      createdAt:     new Date().toISOString(),
    };
    const rows = this.getOverhead();
    rows.push(row);
    this.saveOverhead(rows);
    return row;
  },

  updateOverhead(id, d) {
    const rows = this.getOverhead();
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...d, id };
    rows[i].amount = Number(rows[i].amount) || 0;
    this.saveOverhead(rows);
    return rows[i];
  },

  deleteOverhead(id) { this.saveOverhead(this.getOverhead().filter(r => r.id !== id)); },

  // ── Inventory meta (listed, notes, brokenDown per SKU) ─────────
  getInvMeta() {
    try { return JSON.parse(localStorage.getItem('rt_inv_meta')) || {}; } catch { return {}; }
  },
  setInvMeta(key, data) {
    const meta = this.getInvMeta();
    meta[key] = { ...(meta[key] || {}), ...data };
    localStorage.setItem('rt_inv_meta', JSON.stringify(meta));
  },

  // ── Inventory (derived + persisted meta) ───────────────────────
  getInventory() {
    const map  = {};
    const meta = this.getInvMeta();

    this.getPurchases().forEach(p => {
      const key = p.sku || `__id_${p.id}`;
      if (!map[key]) {
        map[key] = {
          _key: key,
          sku: p.sku, productName: p.productName, category: p.category,
          unitCost: p.unitCost, qtyBought: 0, qtySold: 0,
        };
      }
      map[key].qtyBought += p.qtyBought;
      map[key].unitCost   = p.unitCost; // keep most recent purchase cost
    });

    this.getSales().forEach(s => {
      const key = s.sku || `__sale_${s.id}`;
      if (map[key]) map[key].qtySold += s.qtySold;
    });

    return Object.values(map).map(item => {
      const m = meta[item._key] || {};
      const qty = item.qtyBought - item.qtySold + (m.manualAdj || 0);
      return {
        ...item,
        qtyInStock:   qty,
        valueInStock: Math.max(0, qty) * item.unitCost,
        listed:       m.listed      || false,
        brokenDown:   m.brokenDown  || false,
        notes:        m.notes       || '',
        manualAdj:    m.manualAdj   || 0,
      };
    });
  },

  // ── Aggregates ──────────────────────────────────────────────────
  getStats(startDate = null, endDate = null) {
    const inRange = dateStr => {
      if (!startDate && !endDate) return true;
      const d = new Date(dateStr);
      if (isNaN(d)) return false;
      if (startDate && d < startDate) return false;
      if (endDate   && d > endDate)   return false;
      return true;
    };

    const purchases = this.getPurchases().filter(p => inRange(p.dateBought));
    const sales     = this.getSales().filter(s     => inRange(s.dateSold));
    const overhead  = this.getOverhead().filter(o  => inRange(o.date));

    const totalRevenue      = sales.reduce((a, r) => a + r.grossRevenue, 0);
    const totalCOGS         = sales.reduce((a, r) => a + r.totalCost, 0);
    const totalPurchaseCost = purchases.reduce((a, r) => a + r.totalCost, 0);
    const totalOverhead     = overhead.reduce((a, r) => a + r.amount, 0);
    const grossProfit       = totalRevenue - totalCOGS;
    const netProfit         = grossProfit - totalOverhead;
    const netCashFlow       = netProfit - totalPurchaseCost;
    const avgMargin         = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const roi               = totalCOGS   > 0 ? (grossProfit / totalCOGS)   * 100 : 0;
    const inventory         = this.getInventory();
    const inventoryValue    = inventory.reduce((a, r) => a + Math.max(0, r.valueInStock), 0);
    const totalItemsPurchased = purchases.reduce((a, r) => a + r.qtyBought, 0);
    const totalItemsSold      = sales.reduce((a, r) => a + r.qtySold, 0);

    return {
      totalRevenue, totalCOGS, totalPurchaseCost, totalOverhead,
      grossProfit, netProfit, netCashFlow,
      avgMargin, roi, inventoryValue,
      totalItemsPurchased, totalItemsSold,
      purchaseCount: purchases.length,
      saleCount: sales.length,
    };
  },

  // Monthly breakdown — returns array of { year, month, ...stats }
  getMonthlyBreakdown() {
    const bucket = {};

    const key = (y, m) => `${y}-${String(m).padStart(2,'0')}`;

    const ensure = (y, m) => {
      const k = key(y, m);
      if (!bucket[k]) bucket[k] = {
        year: y, month: m, key: k,
        revenue: 0, cogs: 0, profit: 0, unitsSold: 0,
        purchaseCost: 0, unitsPurchased: 0, overhead: 0,
      };
      return bucket[k];
    };

    this.getSales().forEach(s => {
      const d = new Date(s.dateSold);
      if (isNaN(d)) return;
      const b = ensure(d.getFullYear(), d.getMonth() + 1);
      b.revenue    += s.grossRevenue;
      b.cogs       += s.totalCost;
      b.profit     += s.netProfit;
      b.unitsSold  += s.qtySold;
    });

    this.getPurchases().forEach(p => {
      const d = new Date(p.dateBought);
      if (isNaN(d)) return;
      const b = ensure(d.getFullYear(), d.getMonth() + 1);
      b.purchaseCost    += p.totalCost;
      b.unitsPurchased  += p.qtyBought;
    });

    this.getOverhead().forEach(o => {
      const d = new Date(o.date);
      if (isNaN(d)) return;
      const b = ensure(d.getFullYear(), d.getMonth() + 1);
      b.overhead += o.amount;
    });

    return Object.values(bucket)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(b => ({
        ...b,
        margin:      b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0,
        trueNet:     b.profit - b.overhead,
        netCashFlow: b.profit - b.overhead - b.purchaseCost,
      }));
  },

  // Profit / margin / ROI grouped by category (derived from sales + purchase category lookup)
  getCategoryPL(startDate = null, endDate = null) {
    const inRange = dateStr => {
      if (!startDate && !endDate) return true;
      const d = new Date(dateStr);
      if (isNaN(d)) return false;
      if (startDate && d < startDate) return false;
      if (endDate   && d > endDate)   return false;
      return true;
    };

    const catMap = {};
    this.getPurchases().forEach(p => { if (p.sku) catMap[p.sku] = p.category || 'Other'; });

    const bucket = {};
    this.getSales().filter(s => inRange(s.dateSold)).forEach(s => {
      const cat = (s.sku && catMap[s.sku]) || 'Other';
      if (!bucket[cat]) bucket[cat] = { revenue: 0, cogs: 0, profit: 0, units: 0 };
      bucket[cat].revenue += s.grossRevenue;
      bucket[cat].cogs    += s.totalCost;
      bucket[cat].profit  += s.netProfit;
      bucket[cat].units   += s.qtySold;
    });

    return Object.entries(bucket)
      .map(([category, d]) => ({
        category,
        revenue: d.revenue,
        cogs:    d.cogs,
        profit:  d.profit,
        units:   d.units,
        margin:  d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
        roi:     d.cogs    > 0 ? (d.profit / d.cogs)    * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  },

  // Top N SKUs by net profit
  getTopProducts(n = 5) {
    const map = {};
    this.getSales().forEach(s => {
      const key = s.sku || s.productName;
      if (!map[key]) map[key] = { name: s.productName, sku: s.sku, profit: 0, revenue: 0, units: 0 };
      map[key].profit  += s.netProfit;
      map[key].revenue += s.grossRevenue;
      map[key].units   += s.qtySold;
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, n);
  },

  // Profit / margin grouped by platform
  getPlatformPL(startDate = null, endDate = null) {
    const inRange = dateStr => {
      if (!startDate && !endDate) return true;
      const d = new Date(dateStr);
      if (isNaN(d)) return false;
      if (startDate && d < startDate) return false;
      if (endDate   && d > endDate)   return false;
      return true;
    };

    const bucket = {};
    this.getSales().filter(s => inRange(s.dateSold)).forEach(s => {
      const plat = s.platform || 'Other';
      if (!bucket[plat]) bucket[plat] = { revenue: 0, profit: 0, units: 0 };
      bucket[plat].revenue += s.grossRevenue;
      bucket[plat].profit  += s.netProfit;
      bucket[plat].units   += s.qtySold;
    });

    return Object.entries(bucket)
      .map(([platform, d]) => ({
        platform,
        revenue: d.revenue,
        profit:  d.profit,
        units:   d.units,
        margin:  d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  },

  // Sales grouped by platform
  getSalesByPlatform() {
    const map = {};
    this.getSales().forEach(s => {
      map[s.platform] = (map[s.platform] || 0) + s.grossRevenue;
    });
    return Object.entries(map).map(([platform, revenue]) => ({ platform, revenue }));
  },

  // Purchases grouped by category
  getPurchasesByCategory() {
    const map = {};
    this.getPurchases().forEach(p => {
      map[p.category] = (map[p.category] || 0) + p.totalCost;
    });
    return Object.entries(map).map(([category, cost]) => ({ category, cost }));
  },

  // ── Settings ────────────────────────────────────────────────────
  getSettings() {
    try { return JSON.parse(localStorage.getItem(this.KEYS.settings)) ?? {}; } catch { return {}; }
  },
  saveSetting(key, val) {
    const s = this.getSettings();
    s[key] = val;
    this._set(this.KEYS.settings, s);
  },

  // ── Backup / Restore ────────────────────────────────────────────
  exportBackup() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      purchases: this.getPurchases(),
      sales:     this.getSales(),
      overhead:  this.getOverhead(),
      settings:  this.getSettings(),
    };
  },

  importBackup(json) {
    if (!json || json.version !== 1) throw new Error('Invalid backup file.');
    if (Array.isArray(json.purchases)) this.savePurchases(json.purchases);
    if (Array.isArray(json.sales))     this.saveSales(json.sales);
    if (Array.isArray(json.overhead))  this.saveOverhead(json.overhead);
    if (json.settings)                 this._set(this.KEYS.settings, json.settings);
  },

  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('rt_inv_meta');
    // Legacy seed keys — clean up old versions but NEVER remove SEED_KEY
    // (removing SEED_KEY causes seed() to re-run on next load and stack duplicates)
    ['rt_seeded', 'rt_seeded_v2', 'rt_seeded_v3'].forEach(k => localStorage.removeItem(k));
  },

  // ── Custom categories ────────────────────────────────────────────
  getCategories() {
    const custom = this.getSettings().customCategories || [];
    return [...this.CATEGORIES, ...custom.filter(c => !this.CATEGORIES.includes(c))];
  },
  addCategory(name) {
    const s = this.getSettings();
    s.customCategories = s.customCategories || [];
    if (!s.customCategories.includes(name) && !this.CATEGORIES.includes(name)) {
      s.customCategories.push(name);
      this._set(this.KEYS.settings, s);
    }
  },
  removeCustomCategory(name) {
    const s = this.getSettings();
    s.customCategories = (s.customCategories || []).filter(c => c !== name);
    this._set(this.KEYS.settings, s);
  },

  // ── Seed data ───────────────────────────────────────────────────
  // Real data from Reseller_Tracker.xlsx — matches dashboard totals exactly.
  // Purchases $1,304.66 | Sales gross $1,621.06 | Profit $870.90 | Overhead $503.02
  seed() {
    if (localStorage.getItem(this.SEED_KEY)) return;
    // Wipe everything — old placeholder seeds, manual entries, all of it
    this.clearAll();
    this._set(this.KEYS.counters, { purchases: 0, sales: 0, overhead: 0 });

    // 11 purchases — exact dates & amounts from spreadsheet
    [
      { dateBought:'2026-04-01', productName:'Ascended Heroes ETB',          category:'Pokemon', qtyBought:1,  unitCost:52.99,  store:'Vending',   purchaseMethod:'Manual', sku:'ETB-AH',    condition:'New', notes:'' },
      { dateBought:'2026-04-22', productName:'Prismatic Evolution ETB',      category:'Pokemon', qtyBought:3,  unitCost:52.99,  store:'Best Buy',   purchaseMethod:'Manual', sku:'ETB-PE',    condition:'New', notes:'' },
      { dateBought:'2026-04-24', productName:'Ascended Heroes BB',           category:'Pokemon', qtyBought:2,  unitCost:31.79,  store:'Target',     purchaseMethod:'ACO',    sku:'BB-AH',     condition:'New', notes:'' },
      { dateBought:'2026-04-25', productName:'Ascended Heroes Ex box',       category:'Pokemon', qtyBought:3,  unitCost:20.49,  store:'Costco',     purchaseMethod:'Manual', sku:'EX-AH',     condition:'New', notes:'' },
      { dateBought:'2026-04-29', productName:'Ascended Heroes Poster',       category:'Pokemon', qtyBought:5,  unitCost:63.57,  store:'Walmart',    purchaseMethod:'Refract',sku:'PO-AH',     condition:'New', notes:'Broke down into packs' },
      { dateBought:'2026-04-29', productName:'First Partner Illustration',   category:'Pokemon', qtyBought:5,  unitCost:19.05,  store:'Walmart',    purchaseMethod:'Refract',sku:'FPI',       condition:'New', notes:'' },
      { dateBought:'2026-05-01', productName:'First Partner Illustration',   category:'Pokemon', qtyBought:2,  unitCost:19.05,  store:'Target',     purchaseMethod:'Refract',sku:'FPI',       condition:'New', notes:'' },
      { dateBought:'2026-05-06', productName:'Congratulation Set (W)',       category:'Coins',   qtyBought:1,  unitCost:180.95, store:'U.S Mint',   purchaseMethod:'Manual', sku:'CSW',       condition:'New', notes:'' },
      { dateBought:'2026-05-13', productName:'Chaos Rising PKC ETB',         category:'Pokemon', qtyBought:2,  unitCost:59.99,  store:'PKC',        purchaseMethod:'ACO',    sku:'PKCETB-CR', condition:'New', notes:'' },
      { dateBought:'2026-05-13', productName:'Chaos Rising BB',              category:'Pokemon', qtyBought:2,  unitCost:26.94,  store:'PKC',        purchaseMethod:'ACO',    sku:'BB-CR',     condition:'New', notes:'' },
      { dateBought:'2026-05-13', productName:'Chaos Rising Booster Display', category:'Pokemon', qtyBought:1,  unitCost:161.64, store:'PKC',        purchaseMethod:'ACO',    sku:'BD-CR',     condition:'New', notes:'' },
    ].forEach(p => this.addPurchase(p));

    // 5 sales — exact amounts; AH-BP is broke-down stock from PO-AH
    [
      { dateSold:'2026-04-05', productName:'Ascended Heroes ETB',          sku:'EX-AH',  qtySold:1,  salePricePerUnit:110.00,  unitCost:52.99, platform:'Marketplace',  saleMethod:'Zelle',          notes:'' },
      { dateSold:'2026-04-25', productName:'Prismatic Evolution ETB',      sku:'ETB-PE', qtySold:3,  salePricePerUnit:153.33,  unitCost:52.99, platform:'Marketplace',  saleMethod:'Zelle',          notes:'' },
      { dateSold:'2026-05-03', productName:'First Partner Illustration',   sku:'FPI',    qtySold:5,  salePricePerUnit:42.80,   unitCost:19.05, platform:'Tradepost',    saleMethod:'Direct Deposit', notes:'' },
      { dateSold:'2026-05-08', productName:'AH Booster Packs',             sku:'AH-BP',  qtySold:59, salePricePerUnit:11.73,   unitCost:6.43,  platform:'Tradepost',    saleMethod:'Direct Deposit', notes:'Broke-down stock from PO-AH' },
      { dateSold:'2026-05-13', productName:'Ascended Heroes BB',           sku:'BB-AH',  qtySold:2,  salePricePerUnit:72.50,   unitCost:31.79, platform:'Marketplace',  saleMethod:'Zelle',          notes:'' },
    ].forEach(s => this.addSale(s));

    // 8 overhead expenses — exact amounts
    [
      { date:'2026-04-12', expenseName:'AYCD',               category:'Profile Builder',    amount:60.00,  paymentMethod:'Card',  recurring:true,  notes:'' },
      { date:'2026-04-14', expenseName:'Refract',             category:'Bot',               amount:50.00,  paymentMethod:'Zelle', recurring:true,  notes:'' },
      { date:'2026-04-28', expenseName:'Unknown Collectors',  category:'Whop/Discord Group', amount:10.50,  paymentMethod:'Card',  recurring:true,  notes:'' },
      { date:'2026-04-30', expenseName:'SMS',                 category:'SMS',               amount:97.12,  paymentMethod:'Card',  recurring:false, notes:'' },
      { date:'2026-04-30', expenseName:'Proxies',             category:'Proxy',             amount:172.45, paymentMethod:'Card',  recurring:false, notes:'Combined' },
      { date:'2026-04-30', expenseName:'Flips University',    category:'Whop/Discord Group', amount:2.95,   paymentMethod:'Card',  recurring:true,  notes:'' },
      { date:'2026-05-14', expenseName:'Refract',             category:'Bot',               amount:50.00,  paymentMethod:'Zelle', recurring:true,  notes:'' },
      { date:'2026-05-14', expenseName:'Server',              category:'Bot',               amount:60.00,  paymentMethod:'Zelle', recurring:true,  notes:'' },
    ].forEach(o => this.addOverhead(o));

    localStorage.setItem(this.SEED_KEY, 'true');
  },
};
