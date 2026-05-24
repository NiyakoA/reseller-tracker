const DB = {
  CATEGORIES:       ['Pokemon', 'Coins', 'Sports Cards', 'Sneakers', 'Other'],
  CONDITIONS:       ['New', 'Used', 'Sealed', 'Damaged'],
  PURCHASE_METHODS: ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Check', 'ACO', 'Manual', 'Refract', 'Other'],
  PLATFORMS:        ['eBay', 'Facebook Marketplace', 'Mercari', 'OfferUp', 'Poshmark', 'Depop', 'Amazon', 'Etsy', 'Tradepost', 'Marketplace', 'In-Person', 'Other'],
  SALE_METHODS:     ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Direct Deposit'],
  OVERHEAD_CATS:    ['Bot', 'Proxy', 'SMS', 'Profile Builder', 'Whop/Discord Group', 'Server', 'eBay Fees', 'PayPal Fees', 'Shipping Supplies', 'Storage', 'Ads', 'Software', 'Other'],
  STORES:           ['Best Buy', 'Target', 'Walmart', 'Costco', 'Amazon', 'eBay', 'StockX', 'GOAT', 'Nike SNKRS', 'APMEX', 'DACW', 'Other'],

  _cache: {
    purchases: [],
    sales: [],
    overhead: [],
    settings: { customCategories: [], theme: 'light' },
    invMeta: {},
  },

  async init() {
    const [purchases, sales, overhead, settings, invMeta] = await Promise.all([
      API.getPurchases(),
      API.getSales(),
      API.getOverhead(),
      API.getSettings(),
      API.getInvMeta(),
    ]);
    this._cache.purchases = purchases;
    this._cache.sales     = sales;
    this._cache.overhead  = overhead;
    this._cache.settings  = settings;
    this._cache.invMeta   = invMeta;
  },

  getPurchases() { return this._cache.purchases; },
  getSales()     { return this._cache.sales; },
  getOverhead()  { return this._cache.overhead; },
  getSettings()  { return this._cache.settings; },
  getInvMeta()   { return this._cache.invMeta; },

  async addPurchase(data) {
    const row = await API.addPurchase(data);
    this._cache.purchases.push(row);
    return row;
  },
  async updatePurchase(id, data) {
    const row = await API.updatePurchase(id, data);
    const i = this._cache.purchases.findIndex(p => p.id === id);
    if (i >= 0) this._cache.purchases[i] = row;
    return row;
  },
  async deletePurchase(id) {
    await API.deletePurchase(id);
    this._cache.purchases = this._cache.purchases.filter(p => p.id !== id);
  },

  async addSale(data) {
    const row = await API.addSale(data);
    this._cache.sales.push(row);
    return row;
  },
  async updateSale(id, data) {
    const row = await API.updateSale(id, data);
    const i = this._cache.sales.findIndex(s => s.id === id);
    if (i >= 0) this._cache.sales[i] = row;
    return row;
  },
  async deleteSale(id) {
    await API.deleteSale(id);
    this._cache.sales = this._cache.sales.filter(s => s.id !== id);
  },

  async addOverhead(data) {
    const row = await API.addOverhead(data);
    this._cache.overhead.push(row);
    return row;
  },
  async updateOverhead(id, data) {
    const row = await API.updateOverhead(id, data);
    const i = this._cache.overhead.findIndex(o => o.id === id);
    if (i >= 0) this._cache.overhead[i] = row;
    return row;
  },
  async deleteOverhead(id) {
    await API.deleteOverhead(id);
    this._cache.overhead = this._cache.overhead.filter(o => o.id !== id);
  },

  async setInvMeta(key, patch) {
    const updated = await API.setInvMeta(key, patch);
    this._cache.invMeta[key] = updated;
    return updated;
  },

  async saveSetting(key, val) {
    const updated = await API.updateSettings({ [key]: val });
    this._cache.settings = updated;
    return updated;
  },

  // FIFO weighted-average cost for selling `qty` units of `sku`.
  // Walks purchase lots oldest-first, skips units already sold, returns avg cost/unit.
  // Preserved because sales.js calls DB.getFIFOCost() directly.
  getFIFOCost(sku, qty) {
    if (!sku || !qty || qty <= 0) return 0;

    const lots = this._cache.purchases
      .filter(p => p.sku === sku)
      .sort((a, b) => new Date(a.dateBought) - new Date(b.dateBought))
      .map(p => ({ avail: p.qtyBought, cost: Number(p.unitCost) || 0 }));

    if (!lots.length) return 0;

    // Burn through already-sold units first so we start at the right lot
    let consumed = this._cache.sales
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

  getInventory() {
    const map = {};
    const meta = this._cache.invMeta || {};

    this._cache.purchases.forEach(p => {
      const key = p.sku || `__id_${p.id}`;
      if (!map[key]) {
        map[key] = {
          _key: key,
          sku: p.sku, productName: p.productName, category: p.category,
          unitCost: p.unitCost, qtyBought: 0, qtySold: 0,
        };
      }
      map[key].qtyBought += p.qtyBought;
      map[key].unitCost = p.unitCost;
    });

    this._cache.sales.forEach(s => {
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
        listed:       m.listed     || false,
        brokenDown:   m.brokenDown || false,
        notes:        m.notes      || '',
        manualAdj:    m.manualAdj  || 0,
      };
    });
  },

  async getStats(startDate, endDate)         { return API.getStats(startDate, endDate); },
  async getMonthlyBreakdown()                { return API.getMonthly(); },
  async getCategoryPL(startDate, endDate)    { return API.getCategoryPL(startDate, endDate); },
  async getPlatformPL(startDate, endDate)    { return API.getPlatformPL(startDate, endDate); },
  async getTopProducts(n = 5)                { return API.getTopProducts(n); },

  getCategories() {
    const custom = this._cache.settings.customCategories || [];
    return [...this.CATEGORIES, ...custom.filter(c => !this.CATEGORIES.includes(c))];
  },
  async addCategory(name) {
    const s = this._cache.settings;
    const custom = s.customCategories || [];
    if (!custom.includes(name) && !this.CATEGORIES.includes(name)) {
      const updated = await API.updateSettings({ customCategories: [...custom, name] });
      this._cache.settings = updated;
    }
  },
  async removeCustomCategory(name) {
    const s = this._cache.settings;
    const updated = await API.updateSettings({
      customCategories: (s.customCategories || []).filter(c => c !== name),
    });
    this._cache.settings = updated;
  },

  getStorageInfo() {
    return { used: 0, cap: 1, pct: 0 };
  },

  exportBackup() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      purchases: this._cache.purchases,
      sales:     this._cache.sales,
      overhead:  this._cache.overhead,
      settings:  this._cache.settings,
      invMeta:   this._cache.invMeta,
    };
  },
  async importBackup(json) {
    if (!json) throw new Error('Invalid backup file.');
    const purchases = Array.isArray(json.purchases)
      ? [...json.purchases].sort((a,b) => (a.dateBought||'').localeCompare(b.dateBought||''))
      : [];
    const sales = Array.isArray(json.sales)
      ? [...json.sales].sort((a,b) => (a.dateSold||'').localeCompare(b.dateSold||''))
      : [];
    const overhead = Array.isArray(json.overhead) ? json.overhead : [];

    for (const p of purchases) await this.addPurchase(p);
    for (const s of sales)     await this.addSale(s);
    for (const o of overhead)  await this.addOverhead(o);
    if (json.settings) await API.updateSettings(json.settings);
    if (json.invMeta && typeof json.invMeta === 'object') {
      for (const [key, patch] of Object.entries(json.invMeta)) {
        try { await this.setInvMeta(key, patch); } catch {}
      }
    }
    await this.init();
  },

  async clearAll() {
    for (const s of [...this._cache.sales])     await this.deleteSale(s.id);
    for (const p of [...this._cache.purchases]) await this.deletePurchase(p.id);
    for (const o of [...this._cache.overhead])  await this.deleteOverhead(o.id);
  },

  async seed() { /* no-op */ },
};

window.DB = DB;
