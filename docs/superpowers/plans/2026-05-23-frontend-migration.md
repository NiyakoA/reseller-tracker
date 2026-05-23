# Frontend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Reseller Tracker frontend off `localStorage` onto the new `reseller-tracker-api` REST backend, add JWT-based login/signup, and preserve every existing UI module by introducing a local in-memory cache that keeps reads synchronous.

**Architecture:** A new `api.js` wraps `fetch` and handles bearer-token auth. A new `auth.js` provides a login/signup screen and token storage. A new `app.js` boots the app: shows the auth screen if logged out, otherwise loads `DB.init()` (which fetches purchases / sales / overhead / settings / invMeta in parallel into `DB._cache`) and then calls the existing `applyRoute()` to render the active page. `data.js` keeps every existing method name and return shape — reads are sync over the cache; writes become async and delegate to the API.

**Tech Stack:** Vanilla JS, no build step, no framework. Existing CDN dependencies (Chart.js, PapaParse, SheetJS, jsPDF, Lucide) all stay. New CSS uses the existing CSS variables in `index.html` (`--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--red`, `--green`). JWT stored in `localStorage` under `rt_token`.

---

## Prerequisites

Before starting this plan, the backend (`reseller-tracker-api`) must be deployed and the deployed URL known. Specifically:

1. The Railway-deployed Express + PostgreSQL backend is live and reachable from your browser.
2. The backend's `FRONTEND_ORIGINS` env var includes the origin you load `index.html` from (e.g. `http://localhost:5500` or `http://127.0.0.1:5500` for local file servers).
3. You have the backend's base URL (e.g. `https://reseller-tracker-api-production.up.railway.app`) ready to paste into `js/api.js`.
4. The backend implements every endpoint listed in `docs/superpowers/specs/2026-05-22-frontend-migration-spec.md` §3 with the exact response shapes specified.

**If the backend is not yet deployed, stop and complete that work first.** Running this plan against a missing backend will surface CORS errors, 404s, or hangs that look like frontend bugs but aren't.

---

## Findings From The Current Codebase

These are facts discovered while building this plan — record them so the implementor doesn't have to re-discover them.

- **`Toast` already exists** at `js/modal.js:41` (`const Toast = { ... }`). It's globally available. The spec's §9.3 Toast fallback is **not needed** — use the existing module as-is.
- **The landing-page hook is `applyRoute()`** in `index.html` (inline `<script>` block, around line 1101). It's a hash-based router that reads `location.hash` and calls the matching `PAGE_INITS[page]()` function. This is what moves into `App._renderInitialPage()`.
- **The existing bootstrap block** in `index.html` runs (in order): `applyTheme(...)`, `lucide.createIcons()`, `Modal.init()`, `Importer.init()`, `DB.seed()`, `window.addEventListener('hashchange', applyRoute)`, `applyRoute()`. After this plan: `DB.seed()` is removed (it's a no-op), `applyRoute()` moves into `App._renderInitialPage()`, and everything else stays in the same bootstrap block.
- **CSS variables actually defined** in `index.html` (`:root` block, lines 21–53): `--bg`, `--surface`, `--surface2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-dim`, `--green`, `--red`, `--yellow`. The spec's CSS uses these correctly.

---

## File Plan

### New files

| File | Responsibility |
|------|----------------|
| `js/api.js` | Thin `fetch` wrapper. Holds `baseUrl`. Adds bearer token. Dispatches `rt:unauthorized` on 401. Defines methods for every REST endpoint. |
| `js/auth.js` | Login/signup form rendering, token storage (`rt_token`), `logout()`, and the `rt:unauthorized` listener that swaps screens. |
| `js/app.js` | Bootstrap. `App.start()` checks auth, shows loading overlay, calls `DB.init()`, then calls `App._renderInitialPage()` (which delegates to `applyRoute()`). Also owns the loading overlay and retry screen. |

### Modified files

| File | What changes |
|------|--------------|
| `js/data.js` | Full rewrite. Static config stays. Backing store is `DB._cache` instead of `localStorage`. Reads are sync over the cache. Writes become async and delegate to `API.*`. New `DB.init()`, server-computed async aggregates, stubbed `getStorageInfo`, no-op `seed`. |
| `js/modal.js` | Submit handlers add `await` on `DB.add*` / `DB.update*` / `DB.delete*` calls with try/catch + `Toast.error`. |
| `js/inventory.js` | `DB.setInvMeta` calls become `await DB.setInvMeta(...)` in event handlers. |
| `js/settings.js` | `DB.saveSetting`, `DB.addCategory`, `DB.removeCustomCategory`, `DB.clearAll`, `DB.importBackup` become awaited. `importBackup` caller adds disable + label-swap + try/finally. |
| `js/importer.js` | Loops over rows with `await this.addPurchase(...)` etc. |
| `js/dashboard.js` | `render()` becomes async with `Promise.all` up front. Sub-renders that previously called `DB.getMonthlyBreakdown / getPlatformPL / getCategoryPL` take the pre-fetched data as a parameter. `exportPDF` becomes async. `this._monthly` cached for the chart-view-switcher. |
| `js/monthly.js` | `Monthly.init()` becomes async, fetches once into `this._monthly`, sub-renders read from the local cache. |
| `js/purchases.js`, `js/sales.js`, `js/overhead.js` | If they have write-path handlers, those become async with `await` (most write paths run through `modal.js`, so changes here may be minimal). |
| `index.html` | New `#auth-screen` + `#app` wrapper containers. New CSS blocks for `.auth-*` and `.app-loading` / `.spinner`. New script tags for `api.js`, `auth.js`, `app.js` in correct load order. `Logout` button in sidebar. Existing bootstrap block drops `DB.seed()` and moves `applyRoute()` into `App._renderInitialPage()`. |
| `README.md` | Replace localStorage mentions, drop "in progress" from Roadmap, add a setup note that `API.baseUrl` in `js/api.js` must be set to the deployed Railway URL. |

---

## Verification Strategy

This project has no test framework. Verification is **manual browser testing** against a real running backend. Each task ends with explicit acceptance criteria — open `index.html` (or your local server), perform the described steps, and check the expected outcome before committing.

For interactive verification, serve the project with any static server. From the project root:

```bash
# Either of these works on Windows:
python -m http.server 5500
# or:
npx serve -p 5500
```

Then open `http://localhost:5500` in your browser.

---

## Task 1: Index.html Scaffolding — Containers, CSS, Logout Button

**Goal:** Add the `#auth-screen` and `#app` containers, the new CSS for the auth screen and loading overlay, and a Logout button in the sidebar. No JS yet — this task is just markup and CSS.

**Files:**
- Modify: `index.html` (multiple regions — see steps)

- [ ] **Step 1: Add auth-screen and loading overlay CSS**

In `index.html`, find the closing `</style>` tag of the main `<style>` block. Just before it, paste the following CSS:

```css
/* ── Auth screen ─────────────────────────────────────────────── */
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
.auth-tagline { color: var(--text-muted); font-size: 13px; margin: 0 0 20px; }
.auth-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.auth-tab {
  flex: 1; padding: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.auth-tab.is-active {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}
.auth-form { display: flex; flex-direction: column; gap: 10px; }
.auth-form input {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
}
.auth-error {
  color: var(--red);
  font-size: 12px;
  min-height: 16px;
  text-align: center;
}

/* ── Loading overlay (shown during DB.init()) ─────────────────── */
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

- [ ] **Step 2: Add the #auth-screen container**

In `index.html`, find the `<body>` opening tag. Immediately after `<body>`, insert:

```html
<div id="auth-screen" class="auth-screen" style="display:none"></div>
```

This is where `auth.js` will render the form. It stays hidden until `App.start()` decides to show it.

- [ ] **Step 3: Wrap the existing app UI in #app**

In `index.html`, the existing sidebar (`<aside id="sidebar">`) and main content (whatever follows it — the page containers, top bar, etc.) need to be wrapped in `<div id="app">...</div>`. Find the `<aside id="sidebar">` opening tag and add the wrapper opening just before it:

```html
<div id="app" style="display:none">
  <aside id="sidebar">
    <!-- existing sidebar content unchanged -->
```

Then find the matching close — everything that's a sibling of the sidebar (top bar, main, page divs) up to just before `<script>` tags or the closing `</body>`. Close the wrapper:

```html
  <!-- existing main content -->
</div>
<!-- existing scripts -->
```

The wrapper starts hidden — `App.start()` will show it once `DB.init()` resolves.

- [ ] **Step 4: Add Logout button to the sidebar**

In `index.html`, find the bottom of the sidebar content (typically near the theme toggle button or just before the `</aside>` close). Add:

```html
<button id="logout-btn" class="nav-item" style="margin-top:auto" title="Log out">
  <i data-lucide="log-out"></i>
  <span class="nav-label">Logout</span>
</button>
```

(Use the same class as the other nav items so it inherits the sidebar styling. The `margin-top:auto` pushes it to the bottom. Wiring the click handler to `Auth.logout()` happens in Task 3.)

- [ ] **Step 5: Verify in browser**

Open the page in your browser (`http://localhost:5500` or however you serve it). Expected:
- The app loads as before (the sidebar and main content are still visible because `App.start()` hasn't been wired yet — at this point you may want to temporarily change `style="display:none"` to `style="display:block"` on `#app` to keep developing visually; remember to revert before commit).
- No console errors.
- The Logout button appears in the sidebar (click does nothing yet).
- Resizing the window doesn't break anything.

Revert any temporary `display:block` change before committing.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add auth/loading containers and CSS scaffolding"
```

---

## Task 2: Create `js/api.js`

**Goal:** Create the API client. Defines `baseUrl`, holds the bearer token reader, wraps `fetch` with typed errors and `rt:unauthorized` dispatch, and exposes one method per backend endpoint.

**Files:**
- Create: `js/api.js`

- [ ] **Step 1: Create `js/api.js` with the full implementation**

Create `js/api.js` with the following content. **Replace `REPLACE_WITH_RAILWAY_URL` with your actual deployed backend base URL.**

```js
// js/api.js — thin fetch wrapper for the reseller-tracker-api REST backend.

const API = {
  baseUrl: 'https://REPLACE_WITH_RAILWAY_URL',  // set to your deployed backend URL

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
    // 401: explicit early exit — dispatch event AND throw so callers can branch
    // on err.status === 401 without falling into the generic !res.ok block.
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

  // ── Auth ──────────────────────────────────────────────────────
  register(email, password) { return this._req('POST', '/auth/register', { email, password }); },
  login(email, password)    { return this._req('POST', '/auth/login',    { email, password }); },

  // ── Purchases ─────────────────────────────────────────────────
  getPurchases()           { return this._req('GET',    '/api/purchases'); },
  addPurchase(data)        { return this._req('POST',   '/api/purchases', data); },
  updatePurchase(id, data) { return this._req('PUT',   `/api/purchases/${id}`, data); },
  deletePurchase(id)       { return this._req('DELETE',`/api/purchases/${id}`); },

  // ── Sales ─────────────────────────────────────────────────────
  getSales()               { return this._req('GET',    '/api/sales'); },
  addSale(data)            { return this._req('POST',   '/api/sales', data); },
  updateSale(id, data)     { return this._req('PUT',   `/api/sales/${id}`, data); },
  deleteSale(id)           { return this._req('DELETE',`/api/sales/${id}`); },

  // ── Overhead ──────────────────────────────────────────────────
  getOverhead()            { return this._req('GET',    '/api/overhead'); },
  addOverhead(data)        { return this._req('POST',   '/api/overhead', data); },
  updateOverhead(id, data) { return this._req('PUT',   `/api/overhead/${id}`, data); },
  deleteOverhead(id)       { return this._req('DELETE',`/api/overhead/${id}`); },

  // ── Inventory meta ────────────────────────────────────────────
  getInvMeta()             { return this._req('GET',    '/api/inventory-meta'); },
  setInvMeta(key, patch)   { return this._req('PUT',   `/api/inventory-meta/${encodeURIComponent(key)}`, patch); },

  // ── Aggregates ────────────────────────────────────────────────
  _ymd(d) {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return d;  // already YYYY-MM-DD
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

  // ── Settings ──────────────────────────────────────────────────
  getSettings()     { return this._req('GET', '/api/settings'); },
  updateSettings(s) { return this._req('PUT', '/api/settings', s); },
};

window.API = API;
```

- [ ] **Step 2: Add the script tag to index.html**

In `index.html`, find the existing list of `<script src="js/...">` tags near the bottom of the body. Add this line **above** all of them (it must load before `data.js` and the page modules):

```html
<script src="js/api.js"></script>
```

- [ ] **Step 3: Verify the API client loads with no errors**

Reload the page. Open devtools console. Expected:
- No syntax errors.
- Typing `API` in the console shows the object with all methods.
- Typing `API.baseUrl` shows your Railway URL (not the placeholder).

- [ ] **Step 4: Smoke-test a public endpoint from the console**

Try registering a test user from devtools to confirm the backend is reachable:

```js
await API.register('test@example.com', 'testpass123')
```

Expected: a response like `{ token: '...', user: { id: 1, email: 'test@example.com' } }`.

If you get a CORS error: the backend's `FRONTEND_ORIGINS` doesn't include your current origin. Fix that on the backend before continuing.

If you get a connection error: the backend isn't reachable. Verify the URL and that Railway is up.

If the user already exists, that's fine — you can call `API.login(...)` instead.

After a successful response, **store the token manually for the next tasks**:

```js
localStorage.setItem('rt_token', '<the token from the response>')
```

This lets you test subsequent endpoints before `auth.js` is built.

- [ ] **Step 5: Smoke-test an authenticated endpoint**

In the console:

```js
await API.getPurchases()
```

Expected: `[]` (empty array — new user, no data yet). If you get a 401, the token didn't get stored correctly.

- [ ] **Step 6: Commit**

```bash
git add js/api.js index.html
git commit -m "Add API client wrapping the backend REST endpoints"
```

---

## Task 3: Create `js/auth.js` — Login / Sign up Form

**Goal:** Create the auth module: form HTML, mode toggle, login/register/logout, the 401 listener, and the Logout button click handler.

**Files:**
- Create: `js/auth.js`
- Modify: `index.html` (add the script tag)

- [ ] **Step 1: Create `js/auth.js`**

Create `js/auth.js`:

```js
// js/auth.js — login/signup screen, token storage, logout.

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

  // Render the form into #auth-screen. Wires tab toggle and submit handler.
  mount() {
    const screen = document.getElementById('auth-screen');
    screen.style.display = '';
    screen.innerHTML = `
      <div class="auth-card">
        <h1>Reseller Tracker</h1>
        <p class="auth-tagline">Sign in to your account</p>
        <div class="auth-tabs">
          <button type="button" data-mode="login"  class="auth-tab is-active">Sign in</button>
          <button type="button" data-mode="signup" class="auth-tab">Create account</button>
        </div>
        <form id="auth-form" class="auth-form" novalidate>
          <input type="email"    id="auth-email"            placeholder="Email"             required>
          <input type="password" id="auth-password"         placeholder="Password"          required minlength="6">
          <input type="password" id="auth-password-confirm" placeholder="Confirm password"  style="display:none" minlength="6">
          <button type="submit" class="btn btn-primary" id="auth-submit">Sign in</button>
          <div id="auth-error" class="auth-error"></div>
        </form>
      </div>`;

    let mode = 'login';
    const submit  = screen.querySelector('#auth-submit');
    const confirm = screen.querySelector('#auth-password-confirm');
    const errEl   = screen.querySelector('#auth-error');

    screen.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        mode = tab.dataset.mode;
        screen.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('is-active', t === tab));
        confirm.style.display = mode === 'signup' ? '' : 'none';
        confirm.required = mode === 'signup';
        submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
        errEl.textContent = '';
      });
    });

    screen.querySelector('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const email = screen.querySelector('#auth-email').value.trim();
      const password = screen.querySelector('#auth-password').value;
      if (mode === 'signup') {
        const confirmVal = confirm.value;
        if (password !== confirmVal) { errEl.textContent = 'Passwords do not match.'; return; }
      }
      submit.disabled = true;
      const originalText = submit.textContent;
      submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
      try {
        if (mode === 'signup') await Auth.register(email, password);
        else                   await Auth.login(email, password);
        screen.style.display = 'none';
        screen.innerHTML = '';
        await App.start();
      } catch (err) {
        errEl.textContent = err.body?.message || err.message || 'Something went wrong.';
      } finally {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    });
  },
};

window.Auth = Auth;

// When any 401 fires (token expired mid-session, server invalidated, etc.) the
// api.js _req method dispatches this event. We hide the app and re-mount the
// auth screen — DB._cache is implicitly discarded because the app reloads on
// next successful login.
window.addEventListener('rt:unauthorized', () => {
  document.getElementById('app').style.display = 'none';
  Auth.mount();
});

// Wire the Logout button (in the sidebar — added in Task 1).
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', () => Auth.logout());
});
```

- [ ] **Step 2: Add the script tag to index.html**

In `index.html`, add `<script src="js/auth.js"></script>` **immediately after** the `api.js` script tag (auth.js depends on API):

```html
<script src="js/api.js"></script>
<script src="js/auth.js"></script>
```

- [ ] **Step 3: Verify the auth form renders**

Reload the page. Open devtools console. Run:

```js
Auth.mount()
```

Expected:
- The auth screen appears as a centered card with `Reseller Tracker` title, two tabs (`Sign in` / `Create account`), email + password fields, and a `Sign in` button.
- Clicking `Create account` swaps the submit button label to `Create account` and reveals the confirm password field.
- Clicking `Sign in` hides the confirm field.

- [ ] **Step 4: Verify register and login work end-to-end**

In the auth form (still mounted from Step 3):
1. Click `Create account`.
2. Enter a new email and a 6+ character password (twice).
3. Click `Create account`.

Expected: the auth screen disappears, and you'll see a `App is not defined` error in the console (because `app.js` doesn't exist yet — that's Task 4). The token IS stored — confirm in devtools Application tab → Local Storage → `rt_token`.

If the form returned an error inline ("Email already taken" etc.), pick a different email and try again.

- [ ] **Step 5: Clean up before commit**

Clear the token so the next reload starts fresh:

```js
localStorage.removeItem('rt_token')
```

- [ ] **Step 6: Commit**

```bash
git add js/auth.js index.html
git commit -m "Add auth module with login/signup form and logout"
```

---

## Task 4: Create `js/app.js` — Bootstrap & Lifecycle

**Goal:** Create the boot sequence. `App.start()` decides between auth screen and main app, runs `DB.init()` with a loading overlay, and delegates rendering to `applyRoute()` (the existing hash router in `index.html`). Also wires the focus-refresh listener for cross-device sync.

**Files:**
- Create: `js/app.js`
- Modify: `index.html` (add the script tag and refactor the existing bootstrap block)

- [ ] **Step 1: Create `js/app.js`**

Create `js/app.js`:

```js
// js/app.js — application bootstrap, loading overlay, and lifecycle.

const App = {
  async start() {
    if (!Auth.isLoggedIn()) {
      document.getElementById('app').style.display = 'none';
      Auth.mount();
      return;
    }
    // Keep #app hidden until DB.init() resolves — avoids a flash of empty tables.
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
      // 401 is already handled by api.js (it dispatches rt:unauthorized → auth
      // screen mounts). This branch is a defensive safety net in case the event
      // listener wasn't wired yet during very early bootstrap.
      if (e.status === 401) { Auth.mount(); return; }
      App.showRetryScreen(e);
    }
  },

  // Delegates to the existing applyRoute() defined inline in index.html.
  // applyRoute reads location.hash, picks the matching page, and calls its
  // init(). It must be globally exposed from index.html (done in Step 3).
  _renderInitialPage() {
    if (typeof applyRoute === 'function') applyRoute();
    else throw new Error('applyRoute() is not defined — confirm index.html exposes it globally.');
  },

  showRetryScreen(err) {
    const app = document.getElementById('app');
    app.style.display = '';
    app.innerHTML = `
      <div class="retry-screen" style="padding:40px;text-align:center">
        <h2>Couldn't load your data</h2>
        <p style="color:var(--text-muted)">${err?.message || 'Network error'}</p>
        <button class="btn btn-primary" id="retry-btn">Retry</button>
        <button class="btn btn-secondary" id="logout-btn-retry" style="margin-left:8px">Log out</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => location.reload());
    document.getElementById('logout-btn-retry').addEventListener('click', () => Auth.logout());
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

// Boot once the DOM is ready.
window.addEventListener('DOMContentLoaded', () => App.start());

// Soft sync: when the tab regains focus, re-fetch all data into the cache.
// Intentional v1 limitation: this does NOT re-render the current page. The
// user will see fresh data on the next interaction that triggers a render
// (switching pages, opening a modal, applying a filter). Hard sync is a v2
// polish — would require each page module to expose a re-render entry point.
window.addEventListener('focus', () => {
  if (Auth.isLoggedIn()) DB.init().catch(() => {});
});
```

- [ ] **Step 2: Expose `applyRoute` globally in index.html**

The `applyRoute` function is currently defined inside an IIFE in `index.html`'s inline `<script>` block, so it's not callable from `app.js`. Make it global.

Find the line in `index.html` that defines it (around line 1043):

```js
  function applyRoute() {
```

Change it to:

```js
  window.applyRoute = function applyRoute() {
```

Also find every internal call to `applyRoute()` within the same script block (e.g. on the `hashchange` listener) — they keep working since they look up `applyRoute` on the window automatically. Verify by searching the inline script for `applyRoute` and confirming all references still resolve.

- [ ] **Step 3: Refactor the existing bootstrap block in index.html**

Find the existing bootstrap block at the bottom of the inline `<script>` (around lines 1094–1101):

```js
  /* ── Boot: theme → icons → systems → seed → route ────────────── */
  applyTheme(localStorage.getItem('theme') || 'dark');
  lucide.createIcons();
  Modal.init();
  Importer.init();
  DB.seed();
  window.addEventListener('hashchange', applyRoute);
  applyRoute(); // initial render — runs after everything is ready
```

Replace with:

```js
  /* ── Boot: theme + icons + systems. Routing now driven by App.start(). ── */
  applyTheme(localStorage.getItem('theme') || 'dark');
  lucide.createIcons();
  Modal.init();
  Importer.init();
  // DB.seed() removed — new users start empty (seed is a no-op after migration).
  // applyRoute() is no longer called here — App._renderInitialPage() handles it
  // after DB.init() resolves to guarantee the cache is populated first.
  window.addEventListener('hashchange', applyRoute);
```

- [ ] **Step 4: Add the app.js script tag**

In `index.html`, add `<script src="js/app.js"></script>` **last** in the list of script tags — after every UI module:

```html
<!-- ...all existing js/* modules... -->
<script src="js/settings.js"></script>
<script src="js/app.js"></script>  <!-- bootstrap last -->
```

- [ ] **Step 5: Verify the auth screen still loads when logged out**

Clear the token to force the auth screen:

```js
localStorage.removeItem('rt_token')
```

Reload. Expected:
- Auth screen appears (centered card).
- No console errors.
- `#app` is hidden.

- [ ] **Step 6: Verify login → loading overlay → empty app**

In the auth form, log in with your test account from Task 3. Expected:
- Auth screen disappears.
- A loading overlay shows briefly (spinner + "Loading your data…").
- After `DB.init()` resolves, the overlay hides and the app appears — **but most pages will look broken** because `data.js` still uses `localStorage`. That's expected. The next task rewrites `data.js`.

The console will show errors like `API.getPurchases is not a function` if the script load order is wrong, or `Cannot read properties of undefined (reading 'purchases')` if `data.js` hasn't been rewritten yet. The latter is expected at this point.

If the loading overlay never hides: there's an error in `DB.init()`. Open the Network tab and look for failed requests.

- [ ] **Step 7: Verify the retry screen on network failure**

In the Network tab, set throttling to "Offline" and reload. Expected:
- The loading overlay shows.
- After a moment, the overlay hides and the retry screen appears with the error message and a Retry / Log out button.
- Clicking Retry reloads the page. Clicking Log out clears the token and reloads.

Restore the Network throttling to "No throttling" before continuing.

- [ ] **Step 8: Commit**

```bash
git add js/app.js index.html
git commit -m "Add app.js bootstrap with loading overlay and retry screen"
```

---

## Task 5: Rewrite `js/data.js` — Cache + API Delegation

**Goal:** Replace the localStorage data layer with the cache + API pattern. Keep every public method name and return shape unchanged so UI modules don't break.

**Files:**
- Modify: `js/data.js` (full rewrite)

- [ ] **Step 1: Replace the entire contents of `js/data.js`**

Replace the entire file with the following. The static config arrays (`CATEGORIES`, `CONDITIONS`, etc.) must match what was in the original file exactly — copy them from the spec at `docs/superpowers/specs/2026-05-22-frontend-migration-spec.md` §4 if in doubt.

```js
// js/data.js — local cache mirroring the backend, plus DB.* API used by every UI module.
// Reads are synchronous over the cache. Writes are async and delegate to API.*.

const DB = {
  // ── Static config (UNCHANGED from the original localStorage version) ──
  CATEGORIES:       ['Pokemon', 'Coins', 'Sports Cards', 'Sneakers', 'Other'],
  CONDITIONS:       ['New', 'Used', 'Sealed', 'Damaged'],
  PURCHASE_METHODS: ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Check', 'ACO', 'Manual', 'Refract', 'Other'],
  PLATFORMS:        ['eBay', 'Facebook Marketplace', 'Mercari', 'OfferUp', 'Poshmark', 'Depop', 'Amazon', 'Etsy', 'Tradepost', 'Marketplace', 'In-Person', 'Other'],
  SALE_METHODS:     ['Cash', 'Card', 'PayPal', 'Venmo', 'Zelle', 'Direct Deposit'],
  OVERHEAD_CATS:    ['Bot', 'Proxy', 'SMS', 'Profile Builder', 'Whop/Discord Group', 'Server', 'eBay Fees', 'PayPal Fees', 'Shipping Supplies', 'Storage', 'Ads', 'Software', 'Other'],
  STORES:           ['Best Buy', 'Target', 'Walmart', 'Costco', 'Amazon', 'eBay', 'StockX', 'GOAT', 'Nike SNKRS', 'APMEX', 'DACW', 'Other'],

  // ── Cache (populated by DB.init() after login) ──────────────
  _cache: {
    purchases: [],
    sales: [],
    overhead: [],
    settings: { customCategories: [], theme: 'light' },
    invMeta: {},
  },

  // ── INIT ────────────────────────────────────────────────────
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

  // ── Synchronous reads (signatures unchanged) ────────────────
  getPurchases() { return this._cache.purchases; },
  getSales()     { return this._cache.sales; },
  getOverhead()  { return this._cache.overhead; },
  getSettings()  { return this._cache.settings; },
  getInvMeta()   { return this._cache.invMeta; },

  // ── Async writes — purchases ────────────────────────────────
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

  // ── Async writes — sales ────────────────────────────────────
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

  // ── Async writes — overhead ─────────────────────────────────
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

  // ── Inventory meta (signature unchanged) ────────────────────
  async setInvMeta(key, patch) {
    const updated = await API.setInvMeta(key, patch);
    this._cache.invMeta[key] = updated;
    return updated;
  },

  // ── Settings: preserve the legacy (key, val) setter ─────────
  async saveSetting(key, val) {
    const updated = await API.updateSettings({ [key]: val });
    this._cache.settings = updated;
    return updated;
  },

  // ── Inventory: derived from cache, kept sync to match callers ─
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
      map[key].unitCost = p.unitCost;  // latest cost wins — matches original behavior
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

  // ── Async aggregates (server-computed) ──────────────────────
  async getStats(startDate, endDate)         { return API.getStats(startDate, endDate); },
  async getMonthlyBreakdown()                { return API.getMonthly(); },
  async getCategoryPL(startDate, endDate)    { return API.getCategoryPL(startDate, endDate); },
  async getPlatformPL(startDate, endDate)    { return API.getPlatformPL(startDate, endDate); },
  async getTopProducts(n = 5)                { return API.getTopProducts(n); },

  // ── Custom categories ───────────────────────────────────────
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

  // ── Storage info: stub (no localStorage cap on the backend) ─
  getStorageInfo() {
    return { used: 0, cap: 1, pct: 0 };
  },

  // ── Backup / Restore ────────────────────────────────────────
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
    // Sort purchases / sales by date ASC so server-side FIFO allocates correctly.
    // UX NOTE: this loop can take seconds for large datasets. The caller in
    // settings.js MUST disable the import button and show a loading state
    // before calling this (see Task 8).
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
    await this.init();  // refresh cache after bulk import
  },

  // ── Clear-all: nuke this user's data via the backend ────────
  // Sales must be deleted before purchases (server-side 409 otherwise).
  async clearAll() {
    for (const s of [...this._cache.sales])     await this.deleteSale(s.id);
    for (const p of [...this._cache.purchases]) await this.deletePurchase(p.id);
    for (const o of [...this._cache.overhead])  await this.deleteOverhead(o.id);
  },

  // ── Seed: no-op (new accounts start empty) ──────────────────
  async seed() { /* no-op */ },
};

window.DB = DB;
```

- [ ] **Step 2: Verify the rewritten data.js loads cleanly**

Reload the page (still logged in from Task 4). Expected:
- No syntax errors in the console.
- Loading overlay shows, `DB.init()` runs.
- Once init resolves, the dashboard / inventory page renders. Empty data is expected (you may have no purchases/sales yet).
- In the console, run `DB._cache` — should show an object with empty arrays for `purchases`, `sales`, `overhead`, and a settings object.

If `DB.init()` throws because the backend returns 404 for an endpoint: the backend doesn't implement that endpoint yet. Confirm against §3 of the spec and fix the backend before continuing.

- [ ] **Step 3: Verify a read returns from the cache**

In the console:

```js
DB.getPurchases()
```

Expected: `[]` (empty array, same reference as `DB._cache.purchases`).

- [ ] **Step 4: Verify a write round-trips and updates the cache**

In the console:

```js
const p = await DB.addPurchase({
  dateBought: '2026-05-23',
  productName: 'Test Product',
  category: 'Pokemon',
  qtyBought: 1,
  unitCost: 50,
  store: 'Best Buy',
  purchaseMethod: 'Card',
  sku: 'TEST-1',
  condition: 'New',
})
console.log(p)            // server-returned row with id
console.log(DB.getPurchases())  // should include the new row
```

Expected: the server returns a row with an `id` field, and `DB.getPurchases()` now contains that row.

- [ ] **Step 5: Clean up the test purchase**

```js
await DB.deletePurchase(p.id)
DB.getPurchases()  // back to []
```

- [ ] **Step 6: Commit**

```bash
git add js/data.js
git commit -m "Rewrite data.js to use API + in-memory cache (replaces localStorage)"
```

---

## Task 6: Update `js/modal.js` Write Paths

**Goal:** Modal submit handlers that currently call `DB.add*` / `DB.update*` / `DB.delete*` synchronously need `await` plus try/catch with `Toast.error` on failure.

**Files:**
- Modify: `js/modal.js`

- [ ] **Step 1: Audit every DB write call in modal.js**

In `js/modal.js`, search for every occurrence of `DB.add`, `DB.update`, `DB.delete`. Each one is a candidate for the change below. List them in a scratch note before editing — you want to know how many sites need the same treatment.

- [ ] **Step 2: Apply the await + try/catch pattern at each site**

For each site that looks like:

```js
DB.addPurchase(data);
this._refresh();
closeModal();
```

…change it to:

```js
try {
  await DB.addPurchase(data);
  this._refresh();
  closeModal();
} catch (e) {
  Toast.error(e.body?.message || e.message);
}
```

Make sure the **enclosing function is `async`** — if the submit handler is `onSubmit() {`, change it to `async onSubmit() {`. Without `async`, `await` is a syntax error.

Apply the same pattern to `addSale`, `addOverhead`, `updatePurchase`, `updateSale`, `updateOverhead`, `deletePurchase`, `deleteSale`, `deleteOverhead` — anything in modal.js that writes to the DB.

- [ ] **Step 3: Verify by adding a purchase via the UI**

Reload the page (logged in). Navigate to the Purchases page. Click `+ Add Purchase` (or however the existing UI exposes it).

Fill the form with test data. Click Save. Expected:
- The modal closes.
- The table updates with the new row.
- No console errors.

- [ ] **Step 4: Verify a write failure shows a Toast**

Force a failure to test the error path. In devtools, temporarily break `API.baseUrl` by typing in the console:

```js
const real = API.baseUrl; API.baseUrl = 'https://invalid.example.com';
```

Now try adding another purchase via the UI. Expected:
- The modal stays open (or closes — depends on modal lifecycle; the important thing is the next bit).
- A Toast appears at the bottom-right with an error message (network error or similar).

Restore the URL:

```js
API.baseUrl = real;
```

- [ ] **Step 5: Verify a delete via the UI**

In the purchases table, delete a row. Expected: row disappears, no errors.

- [ ] **Step 6: Commit**

```bash
git add js/modal.js
git commit -m "Await DB writes in modal submit handlers with Toast error feedback"
```

---

## Task 7: Update `js/inventory.js` for Async `setInvMeta`

**Goal:** `DB.setInvMeta` is now async. Event handlers that call it need `await` and `async`.

**Files:**
- Modify: `js/inventory.js`

- [ ] **Step 1: Find every `DB.setInvMeta` call**

In `js/inventory.js`, search for `DB.setInvMeta`. Each site needs `await` added, and the enclosing function must be `async`.

- [ ] **Step 2: Apply the await pattern**

For each site:

```js
if (btn.dataset.action === 'toggle-listed') {
  DB.setInvMeta(key, { listed: btn.dataset.val === 'false' || btn.dataset.val === '' });
  this._refresh();
}
```

becomes:

```js
if (btn.dataset.action === 'toggle-listed') {
  await DB.setInvMeta(key, { listed: btn.dataset.val === 'false' || btn.dataset.val === '' });
  this._refresh();
}
```

…with the enclosing event handler marked `async`. Same pattern for the notes modal save handler and any manual adjustment handler.

- [ ] **Step 3: Verify in the UI**

Navigate to the Inventory page. Expected: page renders normally (data comes from `DB.getInventory()` which is sync over the cache).

For each row, exercise:
- Toggle the "listed" badge. Expected: the badge toggles, no errors, the change persists if you navigate away and come back.
- Edit the notes (if there's a notes editor). Expected: notes save without errors.
- Adjust the manual quantity (if there's an input). Expected: the quantity updates.

- [ ] **Step 4: Commit**

```bash
git add js/inventory.js
git commit -m "Await DB.setInvMeta in inventory event handlers"
```

---

## Task 8: Update `js/settings.js` — Async Writes + Import Loading State

**Goal:** Settings calls to `DB.saveSetting`, `DB.addCategory`, `DB.removeCustomCategory`, `DB.clearAll`, and `DB.importBackup` all become awaited. The import handler additionally needs a disable + label-swap + try/finally because `importBackup` can take 10–30 seconds.

**Files:**
- Modify: `js/settings.js`

- [ ] **Step 1: Find every DB write call in settings.js**

In `js/settings.js`, search for `DB.saveSetting`, `DB.addCategory`, `DB.removeCustomCategory`, `DB.clearAll`, `DB.importBackup`. Note each location.

- [ ] **Step 2: Add `await` to each write call**

For each non-import write:

```js
if (!isNaN(v)) DB.saveSetting('taxRate', v);
```

becomes:

```js
if (!isNaN(v)) await DB.saveSetting('taxRate', v);
```

Make sure the enclosing event handler is `async`. Same pattern for `addCategory`, `removeCustomCategory`, `clearAll`.

- [ ] **Step 3: Wrap `importBackup` with a loading state**

Find the existing import handler. It probably looks something like:

```js
function handleImport(json) {
  DB.importBackup(json);
  this._refresh();
}
```

Replace it with the following pattern. Adjust the button selector (`#import-btn` etc.) to whatever the actual DOM element is in your settings page:

```js
async _handleImport(json) {
  const btn = document.getElementById('import-btn');  // <-- adjust selector to match the actual button
  const originalLabel = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  try {
    await DB.importBackup(json);
    Toast.show('Import complete');
    this._render();  // re-render the settings page to refresh counts
  } catch (e) {
    Toast.error(e.body?.message || e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}
```

If `Toast.show` doesn't exist (only `Toast.error`), use `Toast.error('Import complete')` — the visual signal is more important than the colour. Verify by checking `Toast` in `js/modal.js`.

- [ ] **Step 4: Remove any reference to `DB.seed()`**

Search `settings.js` for `DB.seed`. If found (e.g. a "Reseed sample data" button), either:
- Remove the button + handler entirely, OR
- Leave the call — `DB.seed()` is now a no-op so it won't break anything, but it also won't do what the button label suggests. Best to remove.

- [ ] **Step 5: Verify saveSetting via the UI**

Navigate to Settings. Change the theme via the segmented control (which calls `DB.saveSetting('theme', '...')`). Expected: theme changes, no errors.

Refresh the page. Expected: theme persists (it's stored server-side now and `DB.init()` re-fetches it).

- [ ] **Step 6: Verify addCategory / removeCustomCategory**

In the Categories card, add a new custom category. Expected: it appears in the list. Remove it. Expected: it disappears. No errors.

- [ ] **Step 7: Verify importBackup with loading state**

You'll need a backup JSON file. The simplest way to generate one: in the console, run `DB.exportBackup()` and save the result. Then add some test data via the UI (a couple purchases / sales).

Trigger the import via the Settings page UI. Expected:
- The import button becomes disabled and shows "Importing…".
- After a few seconds, the button re-enables and the label restores.
- A Toast confirms success.
- Reload — the imported data is present.

- [ ] **Step 8: Commit**

```bash
git add js/settings.js
git commit -m "Await DB writes in settings.js and add import loading state"
```

---

## Task 9: Update `js/importer.js` for Sequential Awaits

**Goal:** The CSV/XLSX importer loops over rows calling `DB.add*`. Each needs `await`.

**Files:**
- Modify: `js/importer.js`

- [ ] **Step 1: Find the import loops**

In `js/importer.js`, search for `DB.addPurchase`, `DB.addSale`, `DB.addOverhead`. Each one is likely inside a `.forEach`, `for`, or `for...of` loop.

- [ ] **Step 2: Convert `.forEach` to `for...of` and add `await`**

`.forEach` does NOT respect `await` — replace it with `for...of`. Example:

```js
// Before
rows.forEach(row => DB.addPurchase(row));
```

```js
// After
for (const row of rows) await DB.addPurchase(row);
```

Make sure the enclosing function is `async`. Apply to every loop.

- [ ] **Step 3: Verify CSV import via the UI**

Prepare a small CSV with 3-5 purchase rows. Use the existing CSV import button to import it. Expected:
- Rows appear in the Purchases table after the import completes.
- No console errors.
- A Toast (if the importer surfaces one) confirms success.

- [ ] **Step 4: Commit**

```bash
git add js/importer.js
git commit -m "Await sequential DB writes in CSV/XLSX importer loops"
```

---

## Task 10: Update `js/purchases.js`, `js/sales.js`, `js/overhead.js`

**Goal:** These page files mostly read data, but may have their own write-path handlers (delete from a row's action menu, inline edits, etc.). Apply the same await + try/catch pattern from Task 6.

**Files:**
- Modify: `js/purchases.js`
- Modify: `js/sales.js`
- Modify: `js/overhead.js`

- [ ] **Step 1: Audit each file for DB writes**

In each of `purchases.js`, `sales.js`, `overhead.js`, search for `DB.add`, `DB.update`, `DB.delete`. Many of these files delegate to Modal for editing; the writes might already be covered by Task 6. List remaining direct calls.

- [ ] **Step 2: Apply the await + try/catch pattern**

For each remaining direct call:

```js
// Before
DB.deletePurchase(id);
this._refresh();
```

```js
// After
try {
  await DB.deletePurchase(id);
  this._refresh();
} catch (e) {
  Toast.error(e.body?.message || e.message);
}
```

Mark the enclosing handler `async`. Pay special attention to the **delete confirmation handler** — that almost always calls `DB.deletePurchase / deleteSale / deleteOverhead` directly.

- [ ] **Step 3: Test the special-error UX for purchase deletion**

The backend returns `409 purchase_consumed_by_sales` when a purchase is deleted that has linked sales. Verify the Toast surfaces this message:

1. Make sure you have a purchase with at least one matching sale (same SKU).
2. Try to delete the purchase from the Purchases page.

Expected: a Toast appears with a message like "This purchase is locked because sale(s) #X have already used its inventory. Delete those sales first." (The exact wording comes from the backend.)

- [ ] **Step 4: Test the special-error UX for over-selling**

The backend returns `400 insufficient_inventory` when a sale exceeds available stock. Verify:

1. Pick a SKU where you have N units. Try to record a sale of N+1 units.

Expected: a Toast appears with a message like "You're trying to sell 5 but only 3 are in stock." (Modal stays open since the create handler in Modal already wraps the call from Task 6.)

- [ ] **Step 5: Commit**

```bash
git add js/purchases.js js/sales.js js/overhead.js
git commit -m "Await DB writes in page-level handlers for purchases/sales/overhead"
```

---

## Task 11: Update `js/dashboard.js` — Async Aggregates

**Goal:** `render()` becomes async. All async data is fetched up front via `Promise.all` and passed down to sub-renders so they stay synchronous. `exportPDF()` becomes async. `init()` and the range-pill click handlers become async. `this._monthly` is cached so the chart-view-switcher doesn't refetch.

**Files:**
- Modify: `js/dashboard.js`

- [ ] **Step 1: Make `render()` async with parallel fetch**

Find the `render()` method. Add `async` to the declaration. Replace the body so the aggregate data is fetched in parallel up front:

```js
async render() {
  const rk = this.getRange();
  const { start, end } = this.computeDates(rk /* …existing args… */);
  const prev = this.computePrevDates(rk, start, end);

  // Fetch all async data in parallel before kicking off sub-renders.
  const [stats, prevStats, monthly, platformPL, categoryPL] = await Promise.all([
    DB.getStats(start, end),
    prev ? DB.getStats(prev.start, prev.end) : Promise.resolve(null),
    DB.getMonthlyBreakdown(),
    DB.getPlatformPL(start, end),
    DB.getCategoryPL(start, end),
  ]);

  // Cache monthly for the chart-view-switcher (avoids re-fetch on view toggle).
  this._monthly = monthly;

  // Sub-renders take pre-fetched data — they stay synchronous.
  this.renderKPIs(stats, prevStats);
  this.renderInsights(stats, start, end, monthly);
  this.renderMonthlyChart(start, end, monthly);
  this.renderMonthlyPreview(start, end, monthly);
  this.renderTopProducts(start, end);
  this.renderPlatformSplit(start, end, platformPL);
  this.renderCategoryChart(start, end);
  this.renderRenewalReminders();
  this.renderPerformers(start, end);
  this.renderCategoryPL(start, end, categoryPL);
}
```

Adapt to your actual `computeDates` signature — leave the existing args as they were.

- [ ] **Step 2: Update sub-renders to take pre-fetched data**

Modify each of these to accept the new parameter and remove their internal `DB.getMonthlyBreakdown / getPlatformPL / getCategoryPL` calls:

```js
renderInsights(stats, start, end, monthly) {
  // …existing logic, but replace any `DB.getMonthlyBreakdown()` with `monthly`.
}

renderMonthlyChart(start, end, monthly) {
  // …existing logic, but replace `DB.getMonthlyBreakdown()` with `monthly`.
}

renderMonthlyPreview(start, end, monthly) {
  // …existing logic, but replace `DB.getMonthlyBreakdown()` with `monthly`.
}

renderPlatformSplit(start, end, platformPL) {
  // …existing logic, but replace `DB.getPlatformPL(start, end)` with `platformPL`.
}

renderCategoryPL(start, end, categoryPL) {
  // …existing logic, but replace `DB.getCategoryPL(start, end)` with `categoryPL`.
}
```

`renderKPIs`, `renderTopProducts`, `renderCategoryChart`, `renderPerformers`, `renderRenewalReminders` — leave their signatures alone. They either already take `stats` as a parameter (KPIs) or they read directly from `DB.getSales() / DB.getPurchases() / DB.getOverhead()` which are still synchronous.

- [ ] **Step 3: Update the chart-view-switcher handler in `renderMonthlyChart`**

Inside `renderMonthlyChart`, the view-switcher click handler currently calls `renderMonthlyChart(start, end)` recursively to re-render. Now it needs to pass `this._monthly`:

```js
btn.addEventListener('click', () => {
  this._chartView = btn.dataset.cv;
  this.renderMonthlyChart(start, end, this._monthly);  // reuse cached data
});
```

- [ ] **Step 4: Make `init()` and other `render()` callers async**

Find `Dashboard.init()` — it calls `render()`. Make it async and `await`:

```js
async init() {
  if (!this._initialized) {
    // …existing one-time setup…
    this._initialized = true;
  }
  await this.render();
}
```

Find the range-pill click handler (the segmented control that switches time range). It calls `render()` after updating state. Mark the handler async and `await`:

```js
btn.addEventListener('click', async () => {
  // …existing range update logic…
  await this.render();
});
```

Same for the custom-range "Apply" button handler.

- [ ] **Step 5: Make `exportPDF()` async**

Find `exportPDF()`. Make it async and fetch its data up front:

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

  // …existing PDF generation, using stats / months / top from above…
}
```

If `exportPDF` is wired to a button click, the handler doesn't need changes — calling an async function from a sync handler works (the resulting Promise is discarded but the body still runs).

- [ ] **Step 6: Verify dashboard renders correctly**

Reload the page (logged in). Navigate to Dashboard. Expected:
- KPI cards populate (totals revenue / profit / margin / etc.).
- Charts render with real data (not empty).
- Range pills (`7d`, `30d`, `90d`, etc.) work — clicking switches the active range and re-renders.
- The chart-view switcher (above the monthly chart) toggles between Revenue & Profit / Purchases vs Revenue / etc.
- No console errors.

If the loading takes noticeably longer than before, that's expected — 5 parallel API calls vs. instant localStorage reads.

- [ ] **Step 7: Verify exportPDF**

Click the PDF export button (if present in the Dashboard). Expected: a PDF downloads with stats / monthly / top products tables filled in.

- [ ] **Step 8: Commit**

```bash
git add js/dashboard.js
git commit -m "Async dashboard render with parallel aggregate fetch and pre-fetch propagation"
```

---

## Task 12: Update `js/monthly.js` — Async Init

**Goal:** `Monthly.init()` becomes async, fetches the monthly breakdown once, and caches it. Sub-renders read from the local cache.

**Files:**
- Modify: `js/monthly.js`

- [ ] **Step 1: Make `init()` async with local cache**

Find `Monthly.init()`. Modify it:

```js
async init() {
  this._monthly = await DB.getMonthlyBreakdown();
  this._initialized = true;
  this._render();
}
```

- [ ] **Step 2: Update sub-renders to read from `this._monthly`**

Find `_getYears()` — it currently calls `DB.getMonthlyBreakdown()`. Change it to read from the local cache:

```js
_getYears() {
  return [...new Set((this._monthly || []).map(m => m.year))].sort((a, b) => b - a);
}
```

Find `_renderData()` or whatever method filters rows by year. Replace `DB.getMonthlyBreakdown()` calls with `(this._monthly || [])`:

```js
_renderData() {
  const all = (this._monthly || []).filter(m => m.year === this._year);
  const compAll = this._compareYear
    ? (this._monthly || []).filter(m => m.year === this._compareYear)
    : [];
  // …rest unchanged…
}
```

Apply the same substitution everywhere `DB.getMonthlyBreakdown()` is called inside `monthly.js`.

- [ ] **Step 3: Verify the monthly page**

Navigate to the Monthly page. Expected:
- Year selector populates with the years that have data.
- The table renders with revenue / cogs / profit / overhead / margin / etc. per month.
- Switching years updates the table.
- Compare-year selector (if present) works.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/monthly.js
git commit -m "Async Monthly.init with locally cached breakdown"
```

---

## Task 13: End-to-End Integration Test

**Goal:** Manually exercise the full flow across both a brand-new account and the existing test account. Catch anything the per-task verification missed.

**Files:** None modified — this is a verification task only.

- [ ] **Step 1: Test brand-new account flow**

In devtools, clear all local storage:

```js
localStorage.clear()
```

Reload. Expected:
- Auth screen appears.
- Click "Create account", enter a new email / password (twice). Submit.
- Loading overlay shows briefly.
- Dashboard renders with all-zero KPIs and empty charts. No errors.

- [ ] **Step 2: Add a full set of data**

From the UI:
- Add 2-3 purchases (varying categories, SKUs, costs).
- Add 1-2 sales (matching some of the SKUs you just bought).
- Add 1 overhead expense.

Expected: each action returns quickly, the relevant table updates, no errors.

- [ ] **Step 3: Verify dashboard reflects the data**

Navigate to Dashboard. Expected:
- KPI cards show non-zero revenue, COGS, profit, etc.
- Monthly chart shows bars for the relevant months.
- Top products / category PL / platform PL tables populate.

- [ ] **Step 4: Verify inventory**

Navigate to Inventory. Expected:
- One row per unique SKU.
- `units in stock` = `qtyBought` - `qtySold` (manual adjustments accounted for).
- Toggle the listed flag on one row — it persists across navigation.

- [ ] **Step 5: Verify monthly**

Navigate to Monthly. Expected: a row for each month with activity, correct totals.

- [ ] **Step 6: Backup → register second account → restore**

1. Click "Export Backup" in Settings. A JSON file downloads.
2. Log out (Logout button in sidebar).
3. Register a brand-new account with a different email.
4. Navigate to Settings and import the backed-up JSON file.
5. Watch the loading state on the import button.
6. After import completes, navigate to Dashboard / Purchases / Sales / Overhead.

Expected: the second account now has the same data as the first. Inventory should match (since FIFO re-allocates server-side based on `dateSold ASC`).

- [ ] **Step 7: Verify the focus-refresh soft sync**

Open the app in two browser tabs (logged in as the same account in both).

In tab 1, add a purchase via the UI.

Switch to tab 2. Expected: nothing changes visually (this is the soft-sync limitation — `DB._cache` is updated but no re-render is triggered). Now click anything that triggers a render (switch to a different page and back, or click a range pill on the dashboard). Expected: the new purchase is now visible in tab 2.

This is the expected v1 behavior — not a bug.

- [ ] **Step 8: Verify token expiry / 401 handling**

In devtools, manually corrupt the token:

```js
localStorage.setItem('rt_token', 'invalid')
```

Reload. Expected: the loading overlay shows briefly, then the auth screen reappears (because `DB.init()` fails with 401, which is dispatched as `rt:unauthorized`, which mounts the auth form).

- [ ] **Step 9: No commit required**

This is a verification task. If you found bugs, go back to the relevant task and fix them — don't pile fixes into a single commit here.

---

## Task 14: Update `README.md`

**Goal:** Reflect the new backend dependency and drop the "in progress" status from the Roadmap.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the introduction**

Find the opening paragraphs in `README.md`. The current second paragraph says the app "currently runs entirely in the browser" with the migration "in progress". Replace with:

```markdown
A browser-based UI for tracking reselling income, expenses, and profit. Built for resellers who buy and sell across multiple platforms — Pokemon cards, sneakers, coins, sports cards, and more.

The frontend talks to the `reseller-tracker-api` backend (Node.js + Express + PostgreSQL on Railway) for storage and auth. Multiple users can log in to their own accounts and access their data from any device.
```

- [ ] **Step 2: Update the Usage section**

Replace the current Usage paragraph with:

```markdown
## Usage

1. Deploy the backend (see `reseller-tracker-api`) and note its base URL.
2. In `js/api.js`, set `API.baseUrl` to that URL.
3. Make sure the backend's `FRONTEND_ORIGINS` env var includes the origin you load `index.html` from (e.g. `http://localhost:5500`).
4. Serve the project locally (`python -m http.server 5500` or any static server) and open `http://localhost:5500`.
5. Create an account or sign in. All data persists to the backend — no local storage required.
```

- [ ] **Step 3: Update the Tech Stack table**

Find the row that mentions `localStorage` and update it:

```markdown
| Data storage | PostgreSQL via REST API (`reseller-tracker-api`) — JWT auth, multi-user |
```

- [ ] **Step 4: Update the Roadmap**

Find the Roadmap section. Replace with:

```markdown
## Roadmap

The backend migration is complete. See the [implementation plan](docs/superpowers/plans/2026-05-23-frontend-migration.md) and [design spec](docs/superpowers/specs/2026-05-22-frontend-migration-spec.md) for the work that shipped.

**Future polish (not yet built):**
- Email verification on signup
- Password reset flow
- Hard sync (page re-render when the tab regains focus, not just cache refresh)
- Rate limiting on the backend
- Admin panel
```

- [ ] **Step 5: Update Project Structure**

Update the `js/` tree to include the three new files:

```markdown
└── js/
    ├── api.js          # NEW: REST API client (fetch wrapper, token, error handling)
    ├── auth.js         # NEW: login/signup form, token storage, logout
    ├── app.js          # NEW: bootstrap (loading overlay, auth gate, retry screen)
    ├── data.js         # Data layer: in-memory cache + API delegation
    ├── dashboard.js    # KPI cards, time-range selector, Chart.js charts
    ├── purchases.js    # Purchases table and form logic
    ├── sales.js        # Sales table and form logic
    ├── inventory.js    # Inventory derived view
    ├── overhead.js     # Overhead table and form logic
    ├── pricecheck.js   # Price check tool
    ├── monthly.js      # Monthly summary table
    ├── importer.js     # CSV/XLSX import logic
    ├── modal.js        # Shared modal/form component + Toast
    ├── table.js        # Shared table rendering component
    └── settings.js     # Settings panel
```

- [ ] **Step 6: Verify the README renders correctly**

Open `README.md` on GitHub (push first if needed) or in a Markdown previewer. Expected: all sections render, no broken links, the new headings/lists look right.

- [ ] **Step 7: Commit and push**

```bash
git add README.md
git commit -m "Update README for backend-backed multi-user architecture"
git push
```

---

## What's NOT in this plan

- No backend changes — that's a separate repo with its own plan.
- No service worker / offline mode.
- No optimistic updates.
- No multi-tab hard-sync (focus refresh only updates the cache, doesn't re-render).
- No test framework — verification is manual browser testing.
- No CI configuration.

These are all valid v2+ work but not part of this migration.
