# Reseller Tracker — Database Migration Design

**Date:** 2026-05-22
**Status:** Approved

## Overview

Migrate the reseller tracker from localStorage to a Node.js + Express + PostgreSQL backend hosted on Railway. Add multi-user support with JWT authentication. The frontend and backend live in separate GitHub repos.

---

## Repos

| Repo | Purpose |
|------|---------|
| `reseller-tracker` | Existing vanilla JS/HTML frontend |
| `reseller-tracker-api` | New Node.js + Express + PostgreSQL backend |

The frontend is updated to call the API instead of localStorage. The backend is deployed independently to Railway.

---

## Backend — `reseller-tracker-api`

### Folder Structure

```
reseller-tracker-api/
├── src/
│   ├── index.js              # Express entry point, middleware setup
│   ├── db/
│   │   ├── index.js          # pg Pool, exported as `pool`
│   │   └── schema.sql        # All CREATE TABLE statements
│   ├── middleware/
│   │   └── auth.js           # JWT verification, attaches req.userId
│   ├── routes/
│   │   ├── auth.js           # POST /auth/register, /auth/login
│   │   ├── purchases.js      # CRUD /api/purchases
│   │   ├── sales.js          # CRUD /api/sales
│   │   ├── overhead.js       # CRUD /api/overhead
│   │   ├── stats.js          # GET /api/stats, /api/monthly, /api/inventory
│   │   └── settings.js       # GET/PUT /api/settings
│   └── utils/
│       └── fifo.js           # FIFO cost calculation (moved from frontend data.js)
├── .env.example
├── package.json
└── README.md
```

### Dependencies

- `express` — HTTP server
- `pg` — PostgreSQL client
- `bcrypt` — password hashing
- `jsonwebtoken` — JWT sign/verify
- `dotenv` — environment variables
- `cors` — allow frontend origin

### Environment Variables (`.env`)

```
DATABASE_URL=postgresql://...
JWT_SECRET=...
PORT=3000
FRONTEND_ORIGIN=https://your-frontend-url
```

---

## Database Schema

```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchases (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date_bought     DATE NOT NULL,
  product_name    TEXT NOT NULL,
  category        TEXT,
  qty_bought      INTEGER NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(10,2) NOT NULL DEFAULT 0,
  store           TEXT,
  purchase_method TEXT,
  sku             TEXT,
  condition       TEXT,
  notes           TEXT,
  tags            TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date_sold           DATE NOT NULL,
  product_name        TEXT NOT NULL,
  sku                 TEXT,
  qty_sold            INTEGER NOT NULL DEFAULT 1,
  sale_price_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  gross_revenue       NUMERIC(10,2),
  platform            TEXT,
  sale_method         TEXT,
  unit_cost           NUMERIC(10,2),
  platform_fee_pct    NUMERIC(5,2) DEFAULT 0,
  platform_fee_amt    NUMERIC(10,2),
  shipping_cost       NUMERIC(10,2) DEFAULT 0,
  net_profit          NUMERIC(10,2),
  margin              NUMERIC(5,2),
  notes               TEXT,
  tags                TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE overhead (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  expense_name    TEXT NOT NULL,
  category        TEXT,
  amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method  TEXT,
  recurring       BOOLEAN DEFAULT FALSE,
  renewal_cycle   TEXT,
  notes           TEXT,
  tags            TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_meta (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sku_key     TEXT NOT NULL,
  listed      BOOLEAN DEFAULT FALSE,
  broken_down BOOLEAN DEFAULT FALSE,
  notes       TEXT,
  manual_adj  INTEGER DEFAULT 0,
  UNIQUE(user_id, sku_key)
);

CREATE TABLE settings (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  custom_categories TEXT[] DEFAULT '{}',
  data              JSONB DEFAULT '{}'
);
```

Every data table has `user_id` as a foreign key. All queries filter by `req.userId` (set by JWT middleware) to ensure complete user isolation.

---

## API Routes

### Auth (no token required)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/auth/register` | `{ email, password }` | `{ token, user: { id, email } }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, user: { id, email } }` |

### Data (all require `Authorization: Bearer <token>`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/purchases` | Returns all for current user |
| POST | `/api/purchases` | Create, returns new row |
| PUT | `/api/purchases/:id` | Update, returns updated row |
| DELETE | `/api/purchases/:id` | Delete |
| GET | `/api/sales` | |
| POST | `/api/sales` | Runs FIFO cost calculation server-side |
| PUT | `/api/sales/:id` | |
| DELETE | `/api/sales/:id` | |
| GET | `/api/overhead` | |
| POST | `/api/overhead` | |
| PUT | `/api/overhead/:id` | |
| DELETE | `/api/overhead/:id` | |
| GET | `/api/stats?start=&end=` | Same shape as current `getStats()` |
| GET | `/api/monthly` | Same shape as current `getMonthlyBreakdown()` |
| GET | `/api/inventory` | Same shape as current `getInventory()` |
| GET | `/api/settings` | |
| PUT | `/api/settings` | Upsert full settings object |

### Error Responses

- `400` — validation error, missing fields
- `401` — missing or invalid token
- `403` — record exists but belongs to another user
- `404` — record not found
- `500` — server error

---

## Auth Flow

1. User registers or logs in via the frontend auth form
2. Server hashes password with `bcrypt` (rounds: 12), returns a signed JWT
3. Frontend stores JWT in `localStorage` under `rt_token`
4. Every API request includes `Authorization: Bearer <token>`
5. JWT middleware verifies the token and attaches `req.userId` to the request
6. A `401` response from any endpoint clears the token and shows the login screen

JWT expiry: 30 days.

---

## Frontend Changes — `reseller-tracker`

### New Files

**`js/api.js`** — thin wrapper around `fetch`. All methods are async and include the Bearer token automatically. Throws on non-2xx responses.

```js
// shape of api.js
const API = {
  baseUrl: 'https://your-api.railway.app',
  async getPurchases() { ... },
  async addPurchase(data) { ... },
  async updatePurchase(id, data) { ... },
  async deletePurchase(id) { ... },
  // same pattern for sales, overhead, settings
  async getStats(start, end) { ... },
  async getMonthly() { ... },
  async getInventory() { ... },
};
```

**`js/auth.js`** — handles login/signup form rendering, token storage (`rt_token` in localStorage), and logout. Shows the auth screen when no valid token is present; hides it once logged in.

### Local Cache Pattern

The current `DB.*` read methods are synchronous (`DB.getPurchases()` returns an array immediately). API calls are async, so a naive swap would require adding `await` to every caller across all files.

To avoid this, `data.js` uses a **local cache**:

- `DB._cache` holds `{ purchases, sales, overhead, settings }` in memory
- Synchronous read methods (`getPurchases()`, `getSales()`, etc.) read from `DB._cache` — no change for callers
- `DB.init()` is a new async method that fetches all data from the API and populates the cache; called once after login
- Write methods (`addPurchase()`, `updateSale()`, etc.) are async: they call the API, then update `DB._cache` and return the new/updated row
- After a successful write, callers call their existing `render()` method as they do today — reads are still synchronous against the cache

This means:
- `dashboard.js`, `sales.js`, etc. — read calls are unchanged
- Modal submit handlers (in `modal.js` and individual page files) add `await` to write calls only — a small, isolated change
- App startup adds `await DB.init()` once after the user logs in

### Modified Files

**`js/data.js`** — keeps all static config, replaces localStorage with a `_cache` object. Synchronous reads serve from cache. Write methods become async and delegate to `API.*`. `DB.init()` populates the cache from the API on startup.

**`js/modal.js`** and write-path files — add `await` to `DB.add*` / `DB.update*` / `DB.delete*` calls in submit handlers.

**`index.html`** — add `<script src="js/auth.js">` and `<script src="js/api.js">` before `data.js`. Add a logout button to the sidebar.

### Unchanged Files

`dashboard.js`, `inventory.js`, `monthly.js`, `pricecheck.js`, `settings.js`, `table.js` — read-only consumers of `DB.*`; no changes needed.

---

## Deployment

1. Create `reseller-tracker-api` repo on GitHub
2. Connect repo to Railway — Railway auto-detects Node.js
3. Add Railway PostgreSQL plugin — `DATABASE_URL` is injected automatically
4. Set `JWT_SECRET` and `FRONTEND_ORIGIN` in Railway environment variables
5. Run `schema.sql` against the Railway PostgreSQL instance via `psql $DATABASE_URL -f src/db/schema.sql`
6. Update `API.baseUrl` in the frontend to point to the Railway URL
7. Push frontend changes to `reseller-tracker`

---

## Out of Scope

- Email verification
- Password reset flow
- Rate limiting
- Admin panel
