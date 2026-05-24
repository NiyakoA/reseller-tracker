const API = {
  baseUrl: 'https://reseller-tracker-api-production.up.railway.app',

  _token() { return localStorage.getItem('rt_token'); },

  async _req(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this._token() ? { Authorization: 'Bearer ' + this._token() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      localStorage.removeItem('rt_token');
      window.dispatchEvent(new CustomEvent('rt:unauthorized'));
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      let detail = null;
      try { detail = await res.json(); } catch {}
      const err = new Error(detail?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = detail;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  },

  register(email, password) { return this._req('POST', '/auth/register', { email, password }); },
  login(email, password)    { return this._req('POST', '/auth/login',    { email, password }); },

  getPurchases()           { return this._req('GET',    '/api/purchases'); },
  addPurchase(data)        { return this._req('POST',   '/api/purchases', data); },
  updatePurchase(id, data) { return this._req('PUT',   `/api/purchases/${id}`, data); },
  deletePurchase(id)       { return this._req('DELETE',`/api/purchases/${id}`); },

  getSales()               { return this._req('GET',    '/api/sales'); },
  addSale(data)            { return this._req('POST',   '/api/sales', data); },
  updateSale(id, data)     { return this._req('PUT',   `/api/sales/${id}`, data); },
  deleteSale(id)           { return this._req('DELETE',`/api/sales/${id}`); },

  getOverhead()            { return this._req('GET',    '/api/overhead'); },
  addOverhead(data)        { return this._req('POST',   '/api/overhead', data); },
  updateOverhead(id, data) { return this._req('PUT',   `/api/overhead/${id}`, data); },
  deleteOverhead(id)       { return this._req('DELETE',`/api/overhead/${id}`); },

  getInvMeta()             { return this._req('GET',    '/api/inventory-meta'); },
  setInvMeta(key, patch)   { return this._req('PUT',   `/api/inventory-meta/${encodeURIComponent(key)}`, patch); },

  _ymd(d) {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return d;
  },
  _qs(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, v);
    const s = qs.toString();
    return s ? '?' + s : '';
  },
  getStats(start, end) {
    return this._req('GET', '/api/stats' + this._qs({ start: this._ymd(start), end: this._ymd(end) }));
  },
  getMonthly() { return this._req('GET', '/api/monthly'); },
  getCategoryPL(start, end) {
    return this._req('GET', '/api/category-pl' + this._qs({ start: this._ymd(start), end: this._ymd(end) }));
  },
  getPlatformPL(start, end) {
    return this._req('GET', '/api/platform-pl' + this._qs({ start: this._ymd(start), end: this._ymd(end) }));
  },
  getTopProducts(n = 5) {
    return this._req('GET', `/api/top-products?n=${n}`);
  },

  getSettings()     { return this._req('GET', '/api/settings'); },
  updateSettings(s) { return this._req('PUT', '/api/settings', s); },
};

window.API = API;
