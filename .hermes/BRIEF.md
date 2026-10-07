# BRIEF — Dikichi Dashboard (clone of Gacoan dashboard)

Status: build phase. Owner: Hermes. Date: 2026-10-07.

## Goal
Static dashboard on Vercel at https://dikichi-dashboard.vercel.app/ that is a **pixel-identical clone** of the
Mie Gacoan dashboard front-end, but whose data comes from sheet `Master Responses Gabungan`
filtered to `Outlet == "Dikichi"` only.

## Hard constraints
- **NO regression** to the existing end-to-end ETL chain. Never write to, or redeploy, these existing
  Apps Script projects or the source spreadsheet:
  - Gacoan dashboard GAS: scriptId `1brNLCun66v-oq6Sf6tMoc1pfw9BiXa6hkv2179iYhslBnpZHq2rV2r8K`
    (deployments `AKfycbyDtJAW...` v27 rollback, `AKfycbwCP6RN...` v33 live)
  - Dikichi ETL GAS: scriptId `1xKOIZtxqjn6uZxl9yZY3moxrZs7eIjrLRQ1uLg-aUyh_P1mbire-A2mQ`
  - Spreadsheet `1i-nGUWKqmVgNOdDjN2f8c5gk5lsgS-PaLbABLjqteaA` — READ ONLY.
- Sheet reads are read-only. Never call `sheets.spreadsheets.values.update/append/batchUpdate`.
- Never commit tokens. All Google creds come from files on disk (below).

## Credentials (already on disk, do not print secrets)
Helper: `D:/05 PROJECT/11 PROJECT PPA/09 Master Gacoan ETL/scripts/dk_auth.py`
```python
import sys; sys.path.insert(0, r"D:/05 PROJECT/11 PROJECT PPA/09 Master Gacoan ETL/scripts")
from dk_auth import req, PCA, YUD, SCRIPT, SHEETS, sv, su, sb, meta
```
- `PCA` = productauditcoffee@gmail.com token (`%USERPROFILE%/AppData/Local/hermes/google_token.json`)
  → has `spreadsheets` + `script.projects` + `script.deployments` + `drive`.
- `YUD` = yudantaa@gmail.com token (`C:/Users/JINN/.clasprc.json`).
- `SCRIPT = "https://script.googleapis.com/v1/projects"`, `SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"`.

## Data source facts (verified 2026-10-07)
- Spreadsheet `1i-nGUWKqmVgNOdDjN2f8c5gk5lsgS-PaLbABLjqteaA`, title "PE Form Responses".
- Sheet `Master Responses Gabungan`: 17 columns, header row 1:
  `start_time, end_time, Tanggal Audit, audit_id, Nama Auditor, Outlet, Branch / Cabang, Product, _id,`
  `Item, Parameter, Score / Hasil Evaluasi, Catatan Khusus, Finding / Alasan Evaluasi, Evidence Photo,`
  `Evidence Photo_URL, evidence_id`
- Last non-empty row ≈ 22438. Outlet values: `Mie Gacoan` (majority) and **`Dikichi` (552 rows)**.
- Dikichi rows exist for real. Sample audit ids: `DK-007`, auditor `Andrias`, branch `KEDIRI PEMUDA`,
  Product `Ayam Crispy`, Item `Ayam Hot`, Date `10/09/2026`.

## Reference project (READ ONLY — clone from it, never edit it)
`D:/05 PROJECT/11 PROJECT PPA/08 Gacoan Dashboard/`
- `source/` — GAS backend: `Code.gs`, `DashboardConfig.gs`, `DashboardData.gs`, `DashboardAnalytics.gs`,
  `DashboardUtils.gs`, `Index.html`, `JS.html`, `CSS.html`, `appsscript.json`, `_logo_datauri.txt`.
- `web/` — static front-end deployed to Vercel: `index.html`, `app.js`, `styles.css`, `vercel.json`.
- `harness/deploy_faseB_update.js` — deploy recipe (POST /versions then PUT /deployments/<id>).

## Live Gacoan API contract (must be replicated for Dikichi)
Base: `https://script.google.com/macros/s/AKfycbwCP6RN-eDecyD6WH8sCNFtH_sg-ZuEKW-CyYk57kUmxvVTSQlqrfU0xYKxTIQuF-kg/exec`
- `?page=fast&filters={...}` → KPI payload (`getDashboardDataFast`)
- `?page=audits&filters={...}` → audit list (`getDashboardAudits`)
- `?page=download` → `{url}` xlsx export (`getMasterGacoanDownloadUrl`)
- `?page=refresh` → clears cache
- `?page=status` → cache diagnostics
- `?page=perf` → timings
- no `page` → HtmlService dashboard (leave as is)

The static front-end `web/app.js` maps GAS function names → these pages, so the Dikichi backend MUST keep
the same function names (`getDashboardDataFast`, `getDashboardAudits`, `getMasterGacoanDownloadUrl`,
`runETLAndRefresh`, `refreshDashboardData`, `clearDashboardCache`, `warmDashboardCache`,
`ensureWarmupTrigger`, `jsonOutput`, `parseFiltersParam`, `include`, `getDashboardData`).

## Dikichi backend delta (ONLY these changes vs Gacoan source)
`DashboardConfig.gs` object `DASHBOARD_CONFIG`:
- `OUTLET_FILTER`: `"Mie Gacoan"` → `"Dikichi"`
- `CACHE_KEY`: `"MIE_GACOAN_DASHBOARD_DATA"` → `"DIKICHI_DASHBOARD_DATA"`
- `BRAND.NAME`: `"MIE GACOAN"` → `"DIKICHI"`
- `BRAND.SCRIPT_TITLE`: `"Mie Gacoan - Product Excellence Dashboard"` → `"Dikichi - Product Excellence Dashboard"`
- keep `SPREADSHEET_ID` (same master sheet), `MASTER_SHEET` (`Master Responses Gabungan`),
  `HEADERS`, `GRADE`, `GRADE_WEIGHT`, `SCORE_THRESHOLDS`, `MONTH_COMPARISON_MIN_AUDITS`, `CACHE_SECONDS` identical.
Everything else in the 5 `.gs` files: byte-identical to Gacoan.

## Frontend brand delta (ONLY these, keep layout/CSS/JS identical)
`index.html`: `<title>`, logo `alt`, `.brand-name` text, hero paragraph (line ~185),
`Master Gacoan` status label (line ~200), cabinet panel description (line ~1050), logo fallback letters `MG` → `DK`.
`app.js`: `var API_BASE = ...` literal on line ~188 → Dikichi exec URL. Comments/log strings only otherwise.
Do NOT rename CSS classes, element ids, or JS function names (`downloadMasterGacoan`, `getMasterGacoanDownloadUrl`,
`.gacoan-*` class names stay — they are internal and must stay identical to keep the clone faithful).

## Target repo (Vercel auto-deploys from this repo's `master` branch, root dir)
`D:/05 PROJECT/11 PROJECT PPA/dikichi-dashboard/` → GitHub `yudantaadhipramana/dikichi-dashboard`
Root files served statically: `index.html`, `app.js`, `styles.css`, `vercel.json`.
Verified: `git push origin master` triggers a Vercel production deploy (deployed `/app.js` matched the committed file).

## Requirements from the user
- Anyone can open the dashboard **without a Google login** → manifest `webapp.access = ANYONE_ANONYMOUS`,
  `executeAs = USER_DEPLOYING` (same as Gacoan).
- Must still work when the visitor is signed into multiple Google accounts in the browser
  → no `google.script.run` dependency (static front-end + fetch to anonymous /exec), same as Gacoan.
- Must not be slow to load → keep the 20-minute `warmDashboardCache` trigger + `CacheService` cache of the
  Gacoan design (`CACHE_SECONDS: 1800`).
- Everything must be demonstrably verified with real output, not claims.
