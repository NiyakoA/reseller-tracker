# Reseller Tracker — Frontend Migration Spec

**Repo:** `reseller-tracker` (this repo)
**Date:** 2026-05-22
**Status:** Ready to build — wait until backend (`reseller-tracker-api`) is deployed and reachable before starting
**Audience:** Claude Code (or any engineer) migrating the frontend off `localStorage` onto the new API

This is a **frontend-only** spec. The backend lives in a separate repo (`reseller-tracker-api`) and is not touched by any work in this repo. The only thing this repo needs to know about the backend is its API contract (summarized in §3) and its deployed base URL.

---

## 1. Goal

Replace the frontend's `localStorage` data layer with calls to the `reseller-tracker-api` REST backend. Add a login/signup screen. **Keep all existing field names and method signatures so UI modules don't need to change beyond adding `await` to write-path calls.** The local-cache pattern preserves synchronous reads.

### Non-negotiable principles

- The **shape of every `DB.*` return value stays identical** to today's `data.js`. Field names like `qtyBought`, `qtyInStock`, `valueInStock`, `_key`, `avgMargin`, `roi`, `totalCOGS`, `netCashFlow`, `trueNet`, etc. must come back from the API exactly as the frontend already expects.
- **Every `DB.*` method name stays identical.** No renames. `DB.getInventory()` stays. `DB.saveSetting(key, val)` stays (it becomes a thin wrapper — see §4).
- Read methods stay synchronous (resolve against `DB._cache`). Write methods become async.
- No UI module gets renamed fields or changed call signatures. The only edits to UI files are adding `await` to the lines that call write methods.

---

## 2. New Files

### `js/api.js` — fetch wrapper

Thin async wrapper around `fetch`. Reads the bearer token from `localStorage` on every call. Dispatches `rt:unauthorized` on 401. Throws a typed error on other non-2xx responses so callers can branch on `err.status` / `err.body`.

```js
// js/api.js
const API = {
  baseUrl: 'https://REPLACE_WITH_RAILWAY_URL',  // set once after backend deploy

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
    // 401 path is explicit and exits early. Don't fall through to the generic
    // !res.ok block — that would double-handle (dispatch event AND throw a
    // generic "HTTP 401" that App.start's catch then routes wrong).
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

  // Auth
  register(email, password) { return this._req('POST', '/auth/register', { email, password }); },
  login(email, password)    { return this._req('POST', '/auth/login',    { email, password }); },

  // Purchases
  getPurchases()           { return this._req('GET',    '/api/purchases'); },
  addPurchase(data)        { return this._req('POST',   '/api/purchases', data); },
  updatePurchase(id, data) { return this._req('PUT',   `/api/purchases/${id}`, data); },
  deletePurchase(id)       { return this._req('DELETE',`/api/purchases/${id}`); },

  // Sales
  getSales()               { return this._req('GET',    '/api/sales'); },
  addSale(data)            { return this._req('POST',   '/api/sales', data); },
  updateSale(id, data)     { return this._req('PUT',   `/api/sales/${id}`, data); },
  deleteSale(id)           { return this._req('DELETE',`/api/sales/${id}`); },

  // Overhead
  getOverhead()            { return this._req('GET',    '/api/overhead'); },
  addOverhead(data)        { return this._req('POST',   '/api/overhead', data); },
  updateOverhead(id, data) { return this._req('PUT',   `/api/overhead/${id}`, data); },
  deleteOverhead(id)       { return this._req('DELETE',`/api/overhead/${id}`); },

  // Inventory meta (listed flag, notes, manualAdj, brokenDown)
  getInvMeta()             { return this._req('GET',    '/api/inventory-meta'); },
  setInvMeta(key, patch)   { return this._req('PUT',   `/api/inventory-meta/${encodeURIComponent(key)}`, patch); },

  // Aggregates (server-computed). All accept optional Date objects or YYYY-MM-DD strings.
  _ymd(d) {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return d;  // assume already YYYY-MM-DD
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

  // Settings
  getSettings()            { return this._req('GET',    '/api/settings'); },
  updateSettings(s)        { return this._req('PUT',    '/api/settings', s); },
};

window.API = API;
```

### `js/auth.js` — login/signup UI + token storage

Responsibilities:

- Render a login/signup form into `#auth-screen` when no valid token is present.
- On submit, call `API.login` or `API.register`. On success, store the token under `rt_token`, hide `#auth-screen`, show `#app`, then call `App.start()` (defined in §4).
- Provide `Auth.logout()` — clears token and reloads the page.
- Listen for `rt:unauthorized` (dispatched by `api.js` on any 401) and force the auth screen back up.

Sketch:

```js
const Auth = {
  isLoggedIn() { return !!localStorage.getItem('rt_token'); },

  async login(email, password) {
    const { token } = await API.login(email, password);
    localStorage.setItem('rt_token', token);
  },

  async register(email, password) {
    const { token } = await API.register(email, password);
    localStorage.setItem('rt_token', token);
  },

  logout() {
    localStorage.removeItem('rt_token');
    location.reload();
  },

  // Render login/signup form. Wire submit handler that calls login/register then App.start().
  mount() { /* DOM rendering in #auth-screen */ },
};

window.Auth = Auth;
window.addEventListener('rt:unauthorized', () => {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = '';
  Auth.mount();
});
```

### `js/app.js` — bootstrap and lifecycle (use a file, not inline)

A new dedicated bootstrap file. Don't inline into `index.html`. Defined here are `App.start()`, `App.showRetryScreen()`, and the focus-refresh listener.

```js
// js/app.js
// NOTE: §9.2 expands on the loading overlay in detail. This is the single
// authoritative implementation — do not use an older version without the overlay.
const App = {
  async start() {
    if (!Auth.isLoggedIn()) {
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-screen').style.display = '';
      Auth.mount();
      return;
    }
    // Keep #app hidden while data loads to avoid a flash of empty tables.
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'none';
    App._showLoadingOverlay();
    try {
      await DB.init();
      App._hideLoadingOverlay();
      document.getElementById('app').style.display = '';
      App._renderInitialPage();
    } catch (e) {
      App._hideLoadingOverlay();
      // 401 is already handled by api.js (dispatches rt:unauthorized → auth.js
      // shows the login screen). This branch is a defensive safety net in
      // case the listener isn't wired yet during early bootstrap.
      if (e.status === 401) { Auth.mount(); return; }
      App.showRetryScreen(e);
    }
  },

  // REQUIRED: replace the TODO body with the existing landing-page hook from
  // index.html. Common shapes:
  //   - Direct call:   Dashboard.init();
  //   - Nav-driven:    Nav.activate('dashboard');
  //   - Hash-driven:   Router.go(location.hash || '#dashboard');
  // Inspect the current index.html DOMContentLoaded handler before wiring this.
  // Do NOT guess Dashboard.init() — the actual hook may be different.
  _renderInitialPage() {
    // TODO: replace with the existing landing-page hook from index.html
    throw new Error('App._renderInitialPage not wired — see comment in app.js');
  },

  showRetryScreen(err) {
    const app = document.getElementById('app');
    app.style.display = '';
    app.innerHTML = `
      <div class="retry-screen" style="padding:40px;text-align:center">
        <h2>Couldn't load your data</h2>
        <p style="color:var(--text-muted)">${err?.message || 'Network error'}</p>
        <button class="btn btn-primary" id="retry-btn">Retry</button>
        <button class="btn btn-secondary" id="logout-btn" style="margin-left:8px">Log out</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => location.reload());
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());
  },

  _showLoadingOverlay() {
    let overlay = document.getElementById('app-loading');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'app-loading';
      overlay.className = 'app-loading';
      overlay.innerHTML = '<div class="spinner"></div><p>Loading your data…</p>';
      document.body.appendChild(overlay);
    }
    overlay.style.display = '';
  },

  _hideLoadingOverlay() {
    const overlay = document.getElementById('app-loading');
    if (overlay) overlay.style.display = 'none';
  },
};

window.App = App;

// Bootstrap on DOM ready
window.addEventListener('DOMContentLoaded', () => App.start());

// Re-sync cache when tab regains focus (covers "I edited on my phone" case).
// Silently ignore failures — stale data for a few seconds is acceptable.
//
// KNOWN LIMITATION (intentional in v1): this is a SOFT SYNC. It updates
// DB._cache but does NOT re-render the current page. A user who edits data
// on another device will see the fresh data on the next interaction that
// triggers a render (e.g. switching tabs, opening a modal, applying a
// filter) — not the moment the window regains focus. This is acceptable
// for the small-group friends-only scale. Hard sync (page re-render on
// focus) is a v2 polish: it'd require each page module to expose a
// re-render entry point that App can call, which we deferred.
window.addEventListener('focus', () => {
  if (Auth.isLoggedIn()) DB.init().catch(() => {});
});
```

> **Note on `App._renderInitialPage()`:** before running build step 5, open the current `index.html` and find where the initial page render happens today (search for `.init()` calls in the script tags, a `DOMContentLoaded` listener, or a router setup). That call needs to be moved into `App._renderInitialPage()` so the cache is guaranteed to be populated first. The spec deliberately doesn't pick `Dashboard.init()` for you — guessing wrong silently breaks the landing experience.

---

## 3. Backend API Contract (what this frontend depends on)

Base URL: set in `API.baseUrl`. Must match a value in the backend's `FRONTEND_ORIGINS` CORS list. All `/api/*` calls require `Authorization: Bearer <token>`.

### Response shapes — must match these field names exactly

The backend's job is to return data shaped exactly like the current `data.js` produces. **No renames, no snake_case.** The backend spec (`backend-build-spec.md`) §6 mirrors this contract.

**`GET /api/purchases`** → array of:
```json
{
  "id": 1, "dateBought": "2026-04-01", "productName": "...", "category": "Pokemon",
  "qtyBought": 1, "unitCost": 52.99, "totalCost": 52.99,
  "store": "...", "purchaseMethod": "Manual", "sku": "ETB-AH", "condition": "New",
  "notes": "", "tags": [], "createdAt": "2026-04-01T00:00:00Z"
}
```

**`GET /api/sales`** → array of:
```json
{
  "id": 1, "dateSold": "2026-04-05", "productName": "...", "sku": "EX-AH",
  "qtySold": 1, "salePricePerUnit": 110.00,
  "grossRevenue": 110.00, "platform": "Marketplace", "saleMethod": "Zelle",
  "unitCost": 52.99, "totalCost": 52.99,
  "platformFeePct": 0, "platformFeeAmt": 0, "shippingCost": 0,
  "netProfit": 57.01, "margin": 51.83,
  "notes": "", "tags": [], "createdAt": "2026-04-05T00:00:00Z"
}
```

> The backend computes `unitCost`, `totalCost`, `grossRevenue`, `platformFeeAmt`, `netProfit`, and `margin` server-side via the `sale_lots` FIFO mechanism, then returns the row with those fields filled in.

**`GET /api/overhead`** → array of:
```json
{
  "id": 1, "date": "2026-04-12", "expenseName": "AYCD", "category": "Profile Builder",
  "amount": 60.00, "paymentMethod": "Card",
  "recurring": true, "renewalCycle": "monthly",
  "notes": "", "tags": [], "createdAt": "2026-04-12T00:00:00Z"
}
```

**`GET /api/inventory`** → array of:
```json
{
  "_key": "ETB-AH",
  "sku": "ETB-AH", "productName": "Ascended Heroes ETB", "category": "Pokemon",
  "unitCost": 52.99, "qtyBought": 1, "qtySold": 1,
  "qtyInStock": 0, "valueInStock": 0,
  "listed": false, "brokenDown": false, "notes": "", "manualAdj": 0
}
```

> `_key` is `sku` when present, otherwise `__id_<purchase_id>` matching the current `data.js` fallback. The backend joins `inventory_meta` to fill `listed`, `brokenDown`, `notes`, `manualAdj`.

**`GET /api/stats?start=YYYY-MM-DD&end=YYYY-MM-DD`** → single object:
```json
{
  "totalRevenue": 0, "totalCOGS": 0, "totalPurchaseCost": 0, "totalOverhead": 0,
  "grossProfit": 0, "netProfit": 0, "netCashFlow": 0,
  "avgMargin": 0, "roi": 0, "inventoryValue": 0,
  "totalItemsPurchased": 0, "totalItemsSold": 0,
  "purchaseCount": 0, "saleCount": 0
}
```

**`GET /api/monthly`** → array (one entry per month with activity):
```json
{
  "year": 2026, "month": 4, "key": "2026-04",
  "revenue": 0, "cogs": 0, "profit": 0, "unitsSold": 0,
  "purchaseCost": 0, "unitsPurchased": 0, "overhead": 0,
  "margin": 0, "trueNet": 0, "netCashFlow": 0
}
```

**`GET /api/category-pl?start=&end=`** → array:
```json
{ "category": "Pokemon", "revenue": 0, "cogs": 0, "profit": 0, "units": 0, "margin": 0, "roi": 0 }
```

**`GET /api/platform-pl?start=&end=`** → array:
```json
{ "platform": "eBay", "revenue": 0, "profit": 0, "units": 0, "margin": 0 }
```

**`GET /api/top-products?n=5`** → array:
```json
{ "name": "...", "sku": "ETB-PE", "profit": 0, "revenue": 0, "units": 0 }
```

**`GET /api/inventory-meta`** → object keyed by `_key`:
```json
{
  "ETB-AH": { "listed": false, "brokenDown": false, "notes": "...", "manualAdj": 0 }
}
```

**`PUT /api/inventory-meta/:key`** body: `{ listed?, brokenDown?, notes?, manualAdj? }` → returns the updated meta object for that key.

**`GET /api/settings`** → object:
```json
{
  "customCategories": ["..."],
  "taxRate": 0,
  "monthlyGoal": 0,
  "theme": "light"
}
```

**`PUT /api/settings`** body: any subset of the above fields → returns full updated settings.

### Auth

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/auth/register` | `{ email, password }` | `{ token, user: { id, email } }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, user: { id, email } }` |

### Error response shape

```json
{ "error": "short_code", "message": "...", "details": {} }
```

### Special errors the frontend handles

- **`400 insufficient_inventory`** on `POST /api/sales` — show inline in the sale modal: "You're trying to sell N but only M are in stock for this item." Keep modal open.
- **`409 purchase_consumed_by_sales`** on `DELETE /api/purchases/:id` — show: "This purchase is locked because sale(s) #X, #Y have already used its inventory. Delete those sales first." Do not delete client-side.
- **`401` from any endpoint** — `api.js` dispatches `rt:unauthorized`; `auth.js` shows the login screen.

### Defaults for new users

A brand-new user's `DB.init()` must not 404. The backend returns empty arrays for `/api/purchases`, `/api/sales`, `/api/overhead`, `/api/inventory`, `/api/inventory-meta`, `/api/monthly`, `/api/category-pl`, `/api/platform-pl`, `/api/top-products`, and an auto-created default settings object for `/api/settings`. `/api/stats` returns all zeros. **None of these endpoints return 404 for "no data."**

### CORS

`API.baseUrl` must point to the deployed Railway URL. The backend's `FRONTEND_ORIGINS` env var must list every origin this frontend is loaded from (e.g. `http://localhost:5500,http://127.0.0.1:5500,https://your-frontend.example.com`). Mismatches cause silent CORS failures in the browser console — verify the list matches.

---

## 4. `js/data.js` rewrite (the meaty change)

Goals:

1. **Keep all static config exports** (`DB.CATEGORIES`, `DB.CONDITIONS`, `DB.PURCHASE_METHODS`, `DB.PLATFORMS`, `DB.SALE_METHODS`, `DB.OVERHEAD_CATS`, `DB.STORES`) — UI files import these directly.
2. Replace `localStorage` backing with `DB._cache` (purchases, sales, overhead, settings, invMeta, derived).
3. **Synchronous read methods preserve exact existing signatures** — they read from `DB._cache`. No caller changes.
4. **Async write methods** call the API, update `DB._cache`, return the new/updated row.
5. New `DB.init()` populates the cache in parallel and is called once per session start.
6. **`DB.saveSetting(key, val)` is preserved** as a thin wrapper around `API.updateSettings({ [key]: val })`. Settings.js code keeps working.
7. **`DB.getInventory()` keeps its name and shape** — `_key`, `qtyInStock`, `valueInStock`, etc.
8. **Derived getters become async** (`getStats`, `getMonthlyBreakdown`, `getCategoryPL`, `getPlatformPL`, `getTopProducts`). The pages that call them already have `init()` methods — add `await`.

### Full skeleton

```js
// js/data.js
const DB = {
  // ── Static config (UNCHANGED from current data.js) ──────────────
  CATEGORIES:       ['Pokemon', 'Coins', 'Sports Cards', 'Sneakers', 'Other'],
  CONDITIONS:       ['New', 'Used', 'Sealed', 'Damaged'],
  PURCHASE_METHODS: ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Check', 'ACO', 'Manual', 'Refract', 'Other'],
  PLATFORMS:        ['eBay', 'Facebook Marketplace', 'Mercari', 'OfferUp', 'Poshmark', 'Depop', 'Amazon', 'Etsy', 'Tradepost', 'Marketplace', 'In-Person', 'Other'],
  SALE_METHODS:     ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Direct Deposit'],
  OVERHEAD_CATS:    ['Bot', 'Proxy', 'SMS', 'Profile Builder', 'Whop/Discord Group', 'Server', 'eBay Fees', 'PayPal Fees', 'Shipping Supplies', 'Storage', 'Ads', 'Software', 'Other'],
  STORES:           ['Best Buy', 'Target', 'Walmart', 'Costco', 'Amazon', 'eBay', 'StockX', 'GOAT', 'Nike SNKRS', 'APMEX', 'DACW', 'Other'],

  // ── Cache ──────────────────────────────────────────────────────
  _cache: {
    purchases: [],
    sales: [],
    overhead: [],
    settings: { customCategories: [], theme: 'light' },
    invMeta: {},
  },

  // ── INIT ──────────────────────────────────────────────────────
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

  // ── SYNCHRONOUS READS (signatures unchanged) ──────────────────
  getPurchases() { return this._cache.purchases; },
  getSales()     { return this._cache.sales; },
  getOverhead()  { return this._cache.overhead; },
  getSettings()  { return this._cache.settings; },
  getInvMeta()   { return this._cache.invMeta; },

  // ── ASYNC WRITES ──────────────────────────────────────────────
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

  // ── Inventory meta (existing signatures preserved) ────────────
  async setInvMeta(key, patch) {
    const updated = await API.setInvMeta(key, patch);
    this._cache.invMeta[key] = updated;
    return updated;
  },

  // ── Settings: preserve the legacy key/value setter signature ──
  // settings.js calls DB.saveSetting('taxRate', 0.08) etc. Don't break it.
  async saveSetting(key, val) {
    const updated = await API.updateSettings({ [key]: val });
    this._cache.settings = updated;
    return updated;
  },

  // ── Inventory (derived, but pull from cache for sync access) ──
  // The backend also computes /api/inventory, but UI calls DB.getInventory()
  // synchronously in many places (e.g. inventory.js _getFilteredData, dashboard).
  // We re-derive client-side from the cache to keep the read sync, matching
  // the current data.js behavior exactly.
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
      map[key].unitCost = p.unitCost;  // latest cost wins (matches current behavior)
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

  // ── Async aggregates (server-computed) ────────────────────────
  // Pages that call these need `await` and `async` on their render functions.
  async getStats(startDate, endDate)         { return API.getStats(startDate, endDate); },
  async getMonthlyBreakdown()                { return API.getMonthly(); },
  async getCategoryPL(startDate, endDate)    { return API.getCategoryPL(startDate, endDate); },
  async getPlatformPL(startDate, endDate)    { return API.getPlatformPL(startDate, endDate); },
  async getTopProducts(n = 5)                { return API.getTopProducts(n); },

  // ── Custom categories (signatures unchanged) ──────────────────
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

  // ── Storage info (replaced — there's no localStorage cap anymore) ──
  // The current implementation measures rt_* keys against a 5MB cap.
  // With a backend, storage is effectively unbounded for this user base.
  // Return a fixed shape that satisfies settings.js without ever warning.
  getStorageInfo() {
    return { used: 0, cap: 1, pct: 0 };
  },

  // ── Backup / Restore (work from the cache + sequential POSTs) ──
  // See §7 for the full flow.
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
    // Accept v1 (old localStorage backup) or v2 (new backend backup)
    const purchases = Array.isArray(json.purchases) ? [...json.purchases].sort((a,b) => (a.dateBought||'').localeCompare(b.dateBought||'')) : [];
    const sales     = Array.isArray(json.sales)     ? [...json.sales].sort((a,b) => (a.dateSold||'').localeCompare(b.dateSold||''))     : [];
    const overhead  = Array.isArray(json.overhead)  ? json.overhead  : [];

    // UX NOTE: this loop can take several seconds for large datasets (100+
    // rows × ~100ms per request = 10–30s). The caller in settings.js MUST
    // disable the import button and show a loading state before calling this,
    // and re-enable / hide it in a finally block. Even a simple "Importing…"
    // label swap is enough — without it the user will think the app is frozen.
    // A progress counter ("Importing 45 / 200…") is optional but recommended
    // for datasets over 50 rows. Pass an optional onProgress(done, total)
    // callback if you want to wire that up.
    for (const p of purchases) await this.addPurchase(p);
    for (const s of sales)     await this.addSale(s);     // FIFO will reallocate server-side
    for (const o of overhead)  await this.addOverhead(o);
    if (json.settings) await API.updateSettings(json.settings);
    // invMeta restore (best-effort)
    if (json.invMeta && typeof json.invMeta === 'object') {
      for (const [key, patch] of Object.entries(json.invMeta)) {
        try { await this.setInvMeta(key, patch); } catch {}
      }
    }
    await this.init();  // refresh cache after bulk import
  },

  // ── Clear-all: nuke this user's data via the backend ──────────
  // No bulk DELETE endpoint in v1; loop through. This is a power-user feature
  // in Settings; small datasets so the loop is fine.
  async clearAll() {
    for (const s of [...this._cache.sales])     await this.deleteSale(s.id);
    for (const p of [...this._cache.purchases]) await this.deletePurchase(p.id);
    for (const o of [...this._cache.overhead])  await this.deleteOverhead(o.id);
  },

  // ── Seed: NOT migrated. Remove from settings.js or no-op it. ──
  // The seed function loaded sample data into localStorage. With multi-user
  // backend that no longer makes sense — new accounts start empty.
  async seed() { /* no-op */ },
};

window.DB = DB;
```

### Method-by-method change summary

| Method | Sync/Async | Change |
|--------|-----------|--------|
| `DB.CATEGORIES` etc. | — | Unchanged (static) |
| `DB.getPurchases()` | sync | Reads `_cache.purchases` — callers unchanged |
| `DB.getSales()` | sync | Reads `_cache.sales` — callers unchanged |
| `DB.getOverhead()` | sync | Reads `_cache.overhead` — callers unchanged |
| `DB.getSettings()` | sync | Reads `_cache.settings` — callers unchanged |
| `DB.getInvMeta()` | sync | Reads `_cache.invMeta` — callers unchanged |
| `DB.getInventory()` | sync | Derived from cache, same shape — callers unchanged |
| `DB.getCategories()` | sync | Unchanged |
| `DB.getStorageInfo()` | sync | Returns stub — callers unchanged |
| `DB.exportBackup()` | sync | Snapshots cache, version bumped to 2 |
| `DB.addPurchase(d)` | **async** | Callers need `await` |
| `DB.updatePurchase(id, d)` | **async** | Callers need `await` |
| `DB.deletePurchase(id)` | **async** | Callers need `await` |
| `DB.addSale(d)` | **async** | Callers need `await` |
| `DB.updateSale(id, d)` | **async** | Callers need `await` |
| `DB.deleteSale(id)` | **async** | Callers need `await` |
| `DB.addOverhead(d)` | **async** | Callers need `await` |
| `DB.updateOverhead(id, d)` | **async** | Callers need `await` |
| `DB.deleteOverhead(id)` | **async** | Callers need `await` |
| `DB.setInvMeta(key, p)` | **async** | Callers need `await` |
| `DB.saveSetting(key, val)` | **async** | Callers need `await` (signature unchanged) |
| `DB.addCategory(name)` | **async** | Callers need `await` |
| `DB.removeCustomCategory(name)` | **async** | Callers need `await` |
| `DB.clearAll()` | **async** | Callers need `await` |
| `DB.importBackup(json)` | **async** | Already async — signature unchanged |
| `DB.getStats(start, end)` | **async** | Callers need `await` (was sync — see §5) |
| `DB.getMonthlyBreakdown()` | **async** | Callers need `await` (was sync — see §5) |
| `DB.getCategoryPL(s, e)` | **async** | Callers need `await` (was sync) |
| `DB.getPlatformPL(s, e)` | **async** | Callers need `await` (was sync) |
| `DB.getTopProducts(n)` | **async** | Callers need `await` (was sync) |
| `DB.getFIFOCost(sku, qty)` | — | **Removed.** FIFO is now server-side. Sale modal no longer pre-fills `unitCost`; the server returns it after `POST /api/sales`. |
| `DB._costForSku(sku)` | — | **Removed.** Server-side only. |
| `DB.getSalesByPlatform()` | — | **Removed.** Not called by any UI file. Dashboard builds platform charts via `DB.getPlatformPL()` and inline `DB.getSales()` filtering. |
| `DB.getPurchasesByCategory()` | — | **Removed.** Not called by any UI file. Dashboard builds category charts via inline `DB.getPurchases()` filtering. |
| `DB.seed()` | — | **No-op.** New users start empty. |

---

## 5. Changes to existing UI files

The goal is **minimal edits**. Most files just need `await` added in a handful of places.

### `js/modal.js` and form submit handlers

Wherever a submit handler does:

```js
DB.addPurchase(data);
this._refresh();
```

change to:

```js
try {
  await DB.addPurchase(data);
  this._refresh();
  return true;
} catch (e) {
  Toast.error(e.body?.message || e.message);
  return false;  // keeps modal open if Modal supports it; otherwise show inline
}
```

Same pattern for `addSale`, `addOverhead`, `updatePurchase`, `updateSale`, `updateOverhead`, `deletePurchase`, `deleteSale`, `deleteOverhead`, `setInvMeta`, `addCategory`, `removeCustomCategory`, `saveSetting`, `clearAll`, `importBackup`.

### `js/dashboard.js` — async stats (the most invasive UI-file change)

Dashboard.js calls **five** methods that become async (`DB.getStats`, `DB.getMonthlyBreakdown`, `DB.getCategoryPL`, `DB.getPlatformPL`, `DB.getTopProducts`). These are called from `render()` and cascade into eight sub-render methods. Additionally, `exportPDF()` calls three of them.

**The cleanest approach:** make `render()` async, fetch all async data up front, and pass results down to the sub-render methods that need them — so they stay synchronous internally.

```js
// Before
render() {
  const rk = this.getRange();
  const { start, end } = this.computeDates(rk, ...);
  const prev = this.computePrevDates(rk, start, end);
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

// After
async render() {
  const rk = this.getRange();
  const { start, end } = this.computeDates(rk, ...);
  const prev = this.computePrevDates(rk, start, end);

  // Fetch all async data in parallel up front
  const [stats, prevStats, monthly, platformPL, categoryPL] = await Promise.all([
    DB.getStats(start, end),
    prev ? DB.getStats(prev.start, prev.end) : Promise.resolve(null),
    DB.getMonthlyBreakdown(),
    DB.getPlatformPL(start, end),
    DB.getCategoryPL(start, end),
  ]);

  // All sub-renders receive pre-fetched data — no further awaits needed
  this.renderKPIs(stats, prevStats);
  this.renderInsights(stats, start, end, monthly);  // pass monthly in
  this.renderMonthlyChart(start, end, monthly);      // pass monthly in
  this.renderMonthlyPreview(start, end, monthly);    // pass monthly in
  this.renderTopProducts(start, end);                // uses DB.getSales() sync
  this.renderPlatformSplit(start, end, platformPL);  // pass data in
  this.renderCategoryChart(start, end);              // uses DB.getPurchases() sync
  this.renderRenewalReminders();                     // uses DB.getOverhead() sync
  this.renderPerformers(start, end);                 // uses DB.getSales() sync
  this.renderCategoryPL(start, end, categoryPL);     // pass data in
},
```

**Sub-render method changes:**

- `renderInsights(stats, start, end)` → add a `monthly` parameter. Replace the inline `DB.getMonthlyBreakdown()` call (line 582) with the passed-in array.
- `renderMonthlyChart(start, end)` → add a `monthly` parameter. Replace `DB.getMonthlyBreakdown()` (line 242) with it.
- `renderMonthlyPreview(start, end)` → add a `monthly` parameter. Replace `DB.getMonthlyBreakdown()` (line 392) with it.
- `renderPlatformSplit(start, end)` → add a `platformPL` parameter. Replace `DB.getPlatformPL(start, end)` (line 483) with it.
- `renderCategoryPL(start, end)` → add a `categoryPL` parameter. Replace `DB.getCategoryPL(start, end)` (line 710) with it.
- `renderTopProducts`, `renderCategoryChart`, `renderPerformers`, `renderRenewalReminders` → **unchanged**. They use sync reads (`DB.getSales()`, `DB.getPurchases()`, `DB.getOverhead()`).
- `renderKPIs` → **unchanged** (already receives stats as a parameter).

**Callers of `render()` that need `await`:**

- `Dashboard.init()` → make `init()` async, `await this.render()`
- Range pill click handler (line 150) → make the callback async, `await this.render()`
- Custom range "Apply" button handler (line 155) → same
- Chart view-switcher in `renderMonthlyChart` (line 276) → this one only re-renders the chart, which now receives `monthly` as a parameter. Either pass monthly through (store it as `this._monthly` after the initial fetch) or re-fetch. Storing is cleaner:

```js
// In render(), after the Promise.all:
this._monthly = monthly;  // cache for chart-view-switcher re-renders

// In renderMonthlyChart's view-switcher handler:
btn.addEventListener('click', () => {
  this._chartView = btn.dataset.cv;
  this.renderMonthlyChart(start, end, this._monthly);  // reuse cached data
});
```

**`exportPDF()` migration:**

`exportPDF()` calls `DB.getStats()`, `DB.getMonthlyBreakdown()`, and `DB.getTopProducts(10)` — all now async. Make `exportPDF` async and await them:

```js
async exportPDF() {
  if (!window.jspdf) { Toast.error('PDF library not loaded.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const [stats, months, top] = await Promise.all([
    DB.getStats(),
    DB.getMonthlyBreakdown(),
    DB.getTopProducts(10),
  ]);
  // ...rest unchanged, just use stats/months/top from above
}
```

**Summary:** dashboard.js is the file with the most changes, but it's mechanical — fetch data up front, pass it down. The sub-render methods themselves don't change their logic, just their parameter lists.

### `js/monthly.js` — async monthly breakdown

`Monthly._getYears()` currently does `DB.getMonthlyBreakdown().map(...)` synchronously. Fix by fetching once in `Monthly.init()` and caching locally on the module:

```js
async init() {
  this._monthly = await DB.getMonthlyBreakdown();
  this._initialized = true;
  this._render();
},
_getYears() {
  return [...new Set((this._monthly || []).map(m => m.year))].sort((a,b)=>b-a);
},
_renderData() {
  const all     = (this._monthly || []).filter(m => m.year === this._year);
  const compAll = this._compareYear
    ? (this._monthly || []).filter(m => m.year === this._compareYear)
    : [];
  // ...rest unchanged
}
```

The year selector and compare-year selector both work against `this._monthly` rather than calling `DB.getMonthlyBreakdown()` again. If you want fresh data after a write that affects monthly numbers (rare — usually only happens when sales/purchases/overhead change), set `this._monthly = null` in those write handlers and re-fetch on next init.

### `js/inventory.js` — unchanged

`DB.getInventory()` stays sync (derived from cache) and returns the same shape. The only change is that `DB.setInvMeta(key, patch)` is now async — wherever it's called (e.g. the `toggle-listed` click handler and the notes modal save), add `await`:

```js
if (btn.dataset.action === 'toggle-listed') {
  await DB.setInvMeta(key, { listed: btn.dataset.val === 'false' || btn.dataset.val === '' });
  this._refresh();
}
```

Make the enclosing event handler `async`.

### `js/settings.js` — preserved signature, just add `await`

`DB.saveSetting(key, val)` keeps its (key, val) signature thanks to the wrapper in §4. The settings.js code becomes:

```js
// Before
if (!isNaN(v)) DB.saveSetting('taxRate', v);

// After (inside an async handler)
if (!isNaN(v)) await DB.saveSetting('taxRate', v);
```

Same for `DB.addCategory(name)`, `DB.removeCustomCategory(name)`, `DB.clearAll()` — all become awaited.

`DB.exportBackup()` stays sync (snapshots cache).

`DB.getStorageInfo()` stays sync (returns stub). The 80% warning UI will simply never trigger.

**`DB.importBackup(json)` — loading state required.** The import can take 10–30 seconds for datasets of 100+ rows (one sequential API call per row). Before calling `importBackup`, the settings.js handler must:

1. Disable the import button and swap its label to `"Importing…"` (or similar).
2. Wrap the call in a `try/finally` to re-enable the button regardless of outcome.
3. On success, show `Toast.show('Import complete ✓')` and call the relevant render.
4. On failure, show `Toast.error(err.body?.message || err.message)`.

```js
// settings.js import handler — approximate shape
async function handleImport(json) {
  const btn = document.getElementById('import-btn'); // whatever the actual ID is
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    await DB.importBackup(json);
    Toast.show('Import complete ✓');
  } catch (e) {
    Toast.error(e.body?.message || e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Restore Backup';  // restore original label
  }
}
```

### `js/importer.js` — sequential awaits

CSV/XLSX imports loop over rows; wrap the `add*` calls in `await`. Sequential is fine for small batches.

### `js/purchases.js`, `js/sales.js`, `js/overhead.js`

Same pattern as `modal.js` — `await` on write-path calls in their own submit handlers if any.

### `js/pricecheck.js`, `js/table.js`

**Unchanged.** No `DB.*` writes.

### `index.html`

- Add `<div id="auth-screen" style="display:none"></div>` and wrap the existing app UI in `<div id="app" style="display:none">...</div>`.
- Script load order (in this exact order):
  1. `api.js`
  2. `auth.js`
  3. `data.js`
  4. All existing UI modules (`modal.js`, `table.js`, `dashboard.js`, `purchases.js`, `sales.js`, `inventory.js`, `overhead.js`, `pricecheck.js`, `monthly.js`, `importer.js`, `settings.js`)
  5. `app.js` (last — kicks off bootstrap)
- Add a "Logout" button to the sidebar wired to `Auth.logout()`.
- Remove any reference to `DB.seed()` from the existing bootstrap (the seed function is now a no-op anyway; just clean up the call).

---

## 6. Edge cases & UX polish

- **Init failure that isn't 401** (network down, 500): `App.showRetryScreen(err)` (§4) renders a Retry + Log out screen. Don't render the app on stale/empty cache.
- **Write failure**: keep the modal open, show the error message inline (`Toast.error` or modal-internal error slot). Do NOT update `DB._cache` if the API throws.
- **Focus refresh failures**: silently ignored (§4).
- **Focus refresh is soft sync, not hard sync**: §4's `window.focus` listener re-runs `DB.init()` so the cache is fresh, but it does NOT trigger a page re-render. A user editing on another device will see the new data on the next interaction that causes a render (switching tabs, opening a modal, applying a filter) — not the moment the window regains focus. This is an intentional v1 limitation, not a bug. Hard sync is a v2 polish.
- **Logout**: `Auth.logout()` clears `rt_token` and reloads. Cache is implicitly discarded.
- **Token expiry mid-session**: any 401 dispatches `rt:unauthorized`; auth screen shows; reload via login.

---

## 7. Backup / Restore

The existing JSON backup feature keeps working — implementation is in §4.

- **Backup** (`DB.exportBackup`): snapshots `DB._cache` (purchases, sales, overhead, settings, invMeta) to a downloadable JSON file. Version bumped to `2`.
- **Restore** (`DB.importBackup`): parses uploaded JSON. Sorts purchases by `dateBought ASC` and sales by `dateSold ASC` so server-side FIFO allocates in the right order. POSTs each row sequentially, then PUTs settings, then writes invMeta entries. Calls `DB.init()` at the end to refresh the cache. Accepts both v1 (old localStorage backups) and v2 (new backend backups) — both use the same field names so no mapping needed.

> **Sale FIFO note for restores:** the server re-runs FIFO allocation on every `POST /api/sales`. As long as purchases are restored first and sales are sorted by `dateSold ASC`, the `unitCost` and `netProfit` the server computes will match (or improve on) the backed-up values. The `unitCost` field in the backup JSON is sent in the request body but the server may override it during allocation — that's fine; this is the new source of truth.

---

## 8. Build Order

Work through these in order. Backend must already be deployed and the URL known before step 2.

1. **Add `auth.js` skeleton and the auth-screen container in `index.html`.** Stub `Auth.login` to fake a token for now. Verify the auth screen renders when no token is present and `#app` is hidden.

2. **Set `API.baseUrl`** to the real Railway URL. Add `api.js`. Wire up real `register` / `login` in `auth.js`. Verify register → token stored → main app shows.

3. **Test API methods from devtools** — `await API.getPurchases()` etc. — to confirm the contract matches §3 before touching `data.js`.

4. **Rewrite `data.js`** per §4. Keep static config intact. Add `DB.init()`. Wrap `saveSetting` and other key/value helpers so signatures don't change.

5. **Identify the existing landing-page hook.** Before writing `app.js`, open the current `index.html` and find the call that fires the initial page render today (commonly `Dashboard.init()`, but could be `Nav.activate(...)`, a hash-based router, or something else). Note the exact call. Remove it from its current location — it will move into `App._renderInitialPage()` in the next step.

6. **Add `app.js`** (§4). Paste the call you identified in step 5 into `App._renderInitialPage()`, replacing the TODO. Wire focus listener and `rt:unauthorized` listener. Verify the app loads with empty cache and the correct landing page renders (likely empty tables — expected).

7. **Update write-path callers** (§5): `modal.js`, individual page files, `importer.js`, `settings.js`, `inventory.js`. Verify add/update/delete on each resource roundtrips and updates the UI.

8. **Update async aggregate callers**: `dashboard.js`, `monthly.js`. Verify charts and the monthly table render correctly using server data.

9. **Settings + logout + retry screen.** Polish.

10. **Backup / restore.** Verify a full round-trip: export JSON from one account, register a second account, import into it.

11. **Update `README.md`** — replace localStorage mentions with the new flow; remove the Roadmap "in progress" status; add a setup note that the app requires `API.baseUrl` to be set in `api.js`.

---

## 9. Implementation decisions (resolved during spec review)

These were open questions during spec review. Resolving them here so Claude Code doesn't have to guess.

### 9.1 Auth UI

**Single-page form with a toggle between Login / Sign up modes.** Not two separate screens — too much chrome for a friends-only app, and the bounce between screens loses entered fields.

Layout:

- One centered card in `#auth-screen`. Title above (`Reseller Tracker`), small tagline below (`Sign in to your account`).
- Two tabs at the top of the card: `Sign in` (default) and `Create account`. Clicking switches the mode without leaving the page.
- Two inputs: `Email`, `Password`. Show a "Confirm password" field only in Create account mode.
- Submit button: `Sign in` or `Create account` depending on mode.
- Below the button, a single-line slot for inline error display.

**Theme:** use the existing CSS variables from `index.html` — `--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-dim`, `--green`, `--red`, `--yellow`. The auth card picks up dark/light theme automatically. **Do not** hardcode colours or invent new variable names.

**Error display:** inline below the form, not Toast. Toast is great for write-path feedback inside the app, but auth errors (`Invalid email or password`, `Email already taken`) need to be tied to the form fields. A red `.auth-error` div below the submit button is enough — same pattern any login screen uses.

Minimal sketch (style with existing CSS classes — don't invent new ones):

```html
<div id="auth-screen" class="auth-screen">
  <div class="auth-card">
    <h1>Reseller Tracker</h1>
    <p class="auth-tagline">Sign in to your account</p>
    <div class="auth-tabs">
      <button data-mode="login" class="auth-tab is-active">Sign in</button>
      <button data-mode="signup" class="auth-tab">Create account</button>
    </div>
    <form id="auth-form" class="auth-form">
      <input type="email" id="auth-email" placeholder="Email" required>
      <input type="password" id="auth-password" placeholder="Password" required>
      <input type="password" id="auth-password-confirm" placeholder="Confirm password" style="display:none" required>
      <button type="submit" class="btn btn-primary" id="auth-submit">Sign in</button>
      <div id="auth-error" class="auth-error"></div>
    </form>
  </div>
</div>
```

`Auth.mount()` wires the tab click to swap modes (show/hide the confirm field, update submit text), and wires the form submit to call `Auth.login(email, password)` or `Auth.register(email, password)` based on the active mode. On success, hide `#auth-screen`, show `#app`, and call `App.start()`. On failure, set `#auth-error`'s text to `err.body?.message || err.message`.

**New CSS required:** the class names `auth-screen`, `auth-card`, `auth-tabs`, `auth-tab`, `auth-form`, and `auth-error` do not exist in the current stylesheet. Add them to `index.html`'s `<style>` block. Use existing CSS variables throughout — don't hardcode colours. A minimal starting point:

```css
/* Auth screen */
.auth-screen {
  position: fixed; inset: 0;
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  z-index: 8000;
}
.auth-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 32px; width: 100%; max-width: 400px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
}
.auth-card h1 { font-size: 22px; margin: 0 0 4px; }
.auth-tagline  { color: var(--text-muted); font-size: 13px; margin: 0 0 20px; }
.auth-tabs     { display: flex; gap: 4px; margin-bottom: 20px; }
.auth-tab      { flex: 1; padding: 8px; border: 1px solid var(--border); background: transparent;
                 color: var(--text-muted); border-radius: 6px; cursor: pointer; font-size: 13px; }
.auth-tab.is-active { background: var(--accent); color: #fff; border-color: transparent; }
.auth-form     { display: flex; flex-direction: column; gap: 10px; }
.auth-form input { padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
                   background: var(--bg); color: var(--text); font-size: 14px; }
.auth-error    { color: var(--red); font-size: 12px; min-height: 16px; text-align: center; }
```

### 9.2 Loading state during `DB.init()`

**Show `#app` only after `DB.init()` resolves** — don't let the user see a flash of empty tables. The `App.start()` implementation in §2 is the authoritative version — it already includes `_showLoadingOverlay()`, `_hideLoadingOverlay()`, and the correct `#app` visibility sequencing. Don't use an older version without the overlay.

**New CSS required:** add the following to `index.html`'s `<style>` block. The class names `app-loading` and `spinner` do not exist in the current stylesheet:

```css
/* Loading overlay — shown during DB.init() */
.app-loading {
  position: fixed; inset: 0;
  background: var(--bg);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; z-index: 9000;
  color: var(--text-muted); font-size: 14px;
}
.spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

### 9.3 `Toast` — does it already exist?

`Toast.error(...)` and `Toast.show(...)` are referenced in the current `inventory.js`. They're called as if `Toast` is a global, so it's defined somewhere in the existing codebase — most likely inline in `index.html` or in `modal.js` / `table.js`.

**Before implementing §5's write-path error handling, grep for `const Toast =` or `window.Toast` in the current repo to confirm it exists.** If it exists, use it as-is — no changes needed.

If it doesn't exist (unlikely given the inventory.js usage, but possible), add a minimal implementation to `index.html` or a new `js/toast.js`:

```js
const Toast = {
  _stack: null,
  _ensure() {
    if (!this._stack) {
      this._stack = document.createElement('div');
      this._stack.id = 'toast-stack';
      this._stack.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(this._stack);
    }
  },
  _push(text, kind) {
    this._ensure();
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = text;
    el.style.cssText = `background:var(--surface);color:var(--text);border:1px solid var(--border);border-left:3px solid ${kind === 'error' ? 'var(--red)' : 'var(--green)'};padding:10px 14px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:13px;max-width:320px;`;
    this._stack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 200ms'; }, 3000);
    setTimeout(() => el.remove(), 3300);
  },
  show(text)  { this._push(text, 'info'); },
  error(text) { this._push(text, 'error'); },
};
window.Toast = Toast;
```

---

## 10. What's NOT in this migration

- No UI framework change.
- No new pages or features beyond auth.
- No offline mode / service worker / IndexedDB fallback.
- No optimistic updates (writes wait for server response).
- No multi-tab cache sync beyond the focus listener.
- No analytics, telemetry, or error reporting service.
- No seed data for new users — they start empty.
- `DB.getStorageInfo()` returns a stub; the 80% warning UI is effectively retired.

These can come later. The local-cache pattern leaves room for any of them.
