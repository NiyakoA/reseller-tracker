# Reseller Tracker

A browser-based UI for tracking reselling income, expenses, and profit. Built for resellers who buy and sell across multiple platforms — Pokemon cards, sneakers, coins, sports cards, and more.

The frontend talks to the `reseller-tracker-api` backend (Node.js + Express + PostgreSQL on Railway) for storage and auth. Multiple users can log in to their own accounts and access their data from any device.

---

## Features

### Dashboard
The main overview screen. Shows KPI cards at the top (total revenue, gross profit, net profit, margin %, ROI, inventory value, cash flow) and a suite of Chart.js visualizations below. You can switch between six chart views:
- Revenue & Profit by month
- Purchases vs Revenue by month
- Units Bought vs Sold by month
- Profit Margin % trend
- Net Cash Flow by month
- Overhead as % of Revenue

A time-range selector lets you filter all KPIs and charts to a specific window (7 days, 30 days, 90 days, this year, or a custom date range). The dashboard also breaks down profit and margin by category (Pokemon, Coins, Sneakers, etc.) and by platform (eBay, Mercari, Tradepost, etc.).

### Purchases
Log every item you buy. Each purchase record tracks:
- Date, product name, SKU, category, and condition
- Quantity and unit cost (total cost calculated automatically)
- Store and payment method (Cash, Card, PayPal, Venmo, Zelle, ACO, Refract, etc.)
- Notes and tags

Purchases feed directly into inventory and FIFO cost calculations for sales.

### Sales
Record every sale. Each sale record tracks:
- Date, product name, SKU, platform, and payment method
- Quantity sold and sale price per unit
- Platform fee % (fee amount calculated automatically)
- Shipping cost
- Unit cost (auto-filled via FIFO from matching purchase lots)
- Gross revenue, net profit, and margin (all calculated automatically)
- Notes and tags

The app uses **FIFO (First In, First Out)** cost accounting — when you sell a SKU, the cost is pulled from your oldest unsold purchase lots first, giving you an accurate cost basis without manual entry.

### Inventory
A live view of everything you currently hold in stock. Inventory is derived automatically from the difference between units purchased and units sold for each SKU. Each inventory row shows:
- Product name, SKU, category
- Units bought, units sold, units in stock
- Unit cost and total stock value
- Listed status, broken-down flag, manual quantity adjustment, and notes

You can mark items as listed, flag them as broken down into components, and manually adjust quantities for edge cases.

### Overhead
Track all business expenses that aren't tied to a specific purchase. Categories include bots, proxies, SMS services, Discord groups, server costs, eBay/PayPal fees, shipping supplies, storage, ads, and software. Each overhead record tracks:
- Date, expense name, category
- Amount and payment method
- Recurring flag and renewal cycle (monthly, yearly, etc.)
- Notes and tags

Overhead is factored into net profit and cash flow calculations across the dashboard and monthly summary.

### Price Check
A quick-reference tool for checking current market prices without leaving the app.

### Monthly Summary
A month-by-month table showing revenue, COGS, gross profit, overhead, true net profit, units bought/sold, purchase cost, and net cash flow for every month with activity. Useful for spotting trends and preparing for taxes.

### Import / Export
- **Import** — Load purchases, sales, and overhead from a CSV or XLSX file. Useful for bulk entry or migrating from a spreadsheet.
- **Export** — Export any table to PDF with full formatting via jsPDF and autoTable.
- **Backup / Restore** — Export a full JSON backup of all your data, or restore from a previous backup.

### Settings
- Add and remove custom categories
- Toggle light/dark theme
- View storage usage (with a warning at 80% capacity)
- Clear all data

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | Vanilla HTML + CSS + JavaScript (no framework) |
| Charts | [Chart.js 4.4](https://www.chartjs.org/) |
| Icons | [Lucide](https://lucide.dev/) |
| CSV parsing | [PapaParse 5.4](https://www.papaparse.com/) |
| XLSX parsing | [SheetJS 0.18](https://sheetjs.com/) |
| PDF export | [jsPDF 2.5](https://github.com/parallax/jsPDF) + autoTable |
| Data storage | PostgreSQL via REST API (`reseller-tracker-api`) — JWT auth, multi-user |

All dependencies are loaded from CDN — no build step, no `npm install`.

---

## Usage

1. Deploy the backend (see `reseller-tracker-api`) and note its base URL.
2. In `js/api.js`, set `API.baseUrl` to that URL.
3. Make sure the backend's `FRONTEND_ORIGINS` env var includes the origin you load `index.html` from (e.g. `http://localhost:5500`).
4. Serve the project locally (`python -m http.server 5500` or any static server) and open `http://localhost:5500`.
5. Create an account or sign in. All data persists to the backend — no local storage required.

---

## Project Structure

```
reseller-tracker/
├── index.html          # Single HTML file — all UI markup and styles
└── js/
    ├── api.js          # REST API client (fetch wrapper, token, error handling)
    ├── auth.js         # login/signup form, token storage, logout
    ├── app.js          # bootstrap (loading overlay, auth gate, retry screen)
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

---

## Roadmap

The backend migration is complete. See the [implementation plan](docs/superpowers/plans/2026-05-23-frontend-migration.md) and [design spec](docs/superpowers/specs/2026-05-22-frontend-migration-spec.md) for the work that shipped.

**Future polish (not yet built):**
- Email verification on signup
- Password reset flow
- Hard sync (page re-render when the tab regains focus, not just cache refresh)
- Rate limiting on the backend
- Admin panel

---

## License

MIT
