# day-trader-intel

AI-powered company intelligence + live day trader signal platform. Evaluates public stocks, startups, IPO candidates, and pitch decks — plus a live Day Trader tab ranking the most active movers by momentum score with Claude AI signal reads.

Inherits Phase 1 from `market-intel` and adds the Day Trader tab in Phase 2.

---

## What's built

### Phase 1 (inherited)
- 4-type entry screen — public company, startup, IPO candidate, pitch deck
- SEC EDGAR auto-pull by ticker
- Claude evaluation engine — AI score, moat, signal, red flags, deal memo
- Results page with full scored output
- Airtable persistence

### Phase 2 (new)
- **Day Trader tab** — live momentum rankings
- RSI-14, MACD, volume spike indicators per ticker
- AI signal read + trade plan per row (expandable panel)
- Entry zone, target, stop loss from Claude
- Auto-refresh every 60 seconds
- Filter chips: Top gainers, Top losers, Most active, Buy signals, Watch, Short
- Yahoo Finance data feed + Alpha Vantage indicators

---

## Setup

### 1. Deploy Cloudflare Worker

1. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers → Create
2. Paste `worker/proxy.js`
3. Settings → Variables and Secrets → add:

```
ANTHROPIC_API_KEY    = sk-ant-...
AIRTABLE_TOKEN       = pat...
AIRTABLE_BASE_ID     = app...
ALPHA_VANTAGE_KEY    = (optional — get free key at alphavantage.co)
```

4. Deploy → copy worker URL

### 2. Update Worker URL

In `index.html`, `results.html`, and `daytrader.html` find:
```js
const WORKER_URL = 'https://YOUR-WORKER.workers.dev';
```
Replace with your actual worker URL.

### 3. Alpha Vantage API key (free)

Get a free key at [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key)
Add as `ALPHA_VANTAGE_KEY` in Cloudflare Worker variables.
Without it, RSI/MACD fall back to `demo` key (limited to 5 requests/min).

### 4. Push to GitHub

```bash
git init
git add .
git commit -m "Phase 2: day-trader-intel launch"
git remote add origin https://github.com/aitmai/day-trader-intel.git
git push -u origin main
```

Enable Pages: repo Settings → Pages → main branch → / (root)

**Live at:** `https://aitmai.github.io/day-trader-intel`

---

## Project structure

```
day-trader-intel/
├── index.html        ← Evaluate entry screen (all 4 types)
├── daytrader.html    ← Day Trader live signals tab
├── results.html      ← Evaluation output
├── rankings.html     ← Rankings table (Phase 3)
├── style.css         ← Full stylesheet
└── worker/
    └── proxy.js      ← Cloudflare Worker (deploy separately)
```

---

## Worker routes

| Route | Purpose |
|---|---|
| `POST /evaluate` | Claude company evaluation |
| `POST /fetch-sec` | SEC EDGAR financials by ticker |
| `POST /fetch-quote` | Single ticker price + change |
| `POST /fetch-movers` | Top gainers / losers / most active |
| `POST /fetch-indicators` | RSI + MACD via Alpha Vantage |
| `POST /fetch-signal` | Claude AI signal read |
| `POST /save-deal` | Save evaluation to Airtable |
| `GET /get-deals` | Load evaluation history |

---

## Phase roadmap

| Phase | What | Status |
|---|---|---|
| 1 | Entry screen + Claude + SEC + Airtable | ✅ Done |
| 2 | Day Trader tab — live momentum signals | ✅ Done |
| 3 | News sentiment + comparables + deal memo PDF | Next |
| 4 | Options flow + dark pool + push alerts | Later |
| 5 | Next.js + Vercel + Google OAuth | Scale |
| 6 | Free/Pro tiers + Stripe payments | Monetize |
