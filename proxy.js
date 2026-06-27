// day-trader-intel — Cloudflare Worker
// Routes: /evaluate, /fetch-sec, /fetch-quote, /fetch-movers, /fetch-indicators, /save-deal, /get-deals

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname;
    try {
      if (path === '/evaluate')         return await handleEvaluate(request, env);
      if (path === '/fetch-sec')        return await handleSEC(request, env);
      if (path === '/fetch-quote')      return await handleQuote(request, env);
      if (path === '/fetch-movers')     return await handleMovers(request, env);
      if (path === '/fetch-indicators') return await handleIndicators(request, env);
      if (path === '/fetch-signal')     return await handleSignal(request, env);
      if (path === '/save-deal')        return await handleSaveDeal(request, env);
      if (path === '/get-deals')        return await handleGetDeals(request, env);
      return json({ error: 'Unknown route' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

// ── /fetch-quote — single ticker price + change ────────────────────────────
async function handleQuote(request, env) {
  const { ticker } = await request.json();
  if (!ticker) return json({ error: 'Ticker required' }, 400);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return json({ error: 'No data', ticker });

  const price  = meta.regularMarketPrice;
  const prev   = meta.chartPreviousClose || meta.previousClose;
  const change = prev ? ((price - prev) / prev * 100) : 0;

  return json({
    ticker: ticker.toUpperCase(),
    price:  Math.round(price * 100) / 100,
    change: Math.round(change * 100) / 100,
    volume: meta.regularMarketVolume,
    avgVol: meta.averageDailyVolume10Day || meta.averageDailyVolume3Month,
    high52: meta.fiftyTwoWeekHigh,
    low52:  meta.fiftyTwoWeekLow,
    marketCap: meta.marketCap,
    name:   meta.shortName || ticker,
  });
}

// ── /fetch-movers — top momentum movers list ───────────────────────────────
async function handleMovers(request, env) {
  const body = await request.json().catch(() => ({}));
  const filter = body.filter || 'day_gainers';

  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${filter}&count=20`;
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const quotes = data?.finance?.result?.[0]?.quotes || [];

  const movers = quotes.map(q => {
    const price    = q.regularMarketPrice || 0;
    const prev     = q.regularMarketPreviousClose || price;
    const change   = prev ? ((price - prev) / prev * 100) : 0;
    const vol      = q.regularMarketVolume || 0;
    const avgVol   = q.averageDailyVolume10Day || q.averageDailyVolume3Month || 1;
    const volRatio = Math.round((vol / avgVol) * 10) / 10;
    const high52   = q.fiftyTwoWeekHigh || price;
    const low52    = q.fiftyTwoWeekLow  || price;
    const range52  = high52 - low52;
    const pct52    = range52 > 0 ? Math.round(((price - low52) / range52) * 100) : 50;

    return {
      ticker:    q.symbol,
      name:      q.shortName || q.symbol,
      price:     Math.round(price * 100) / 100,
      change:    Math.round(change * 100) / 100,
      volume:    vol,
      avgVol:    avgVol,
      volRatio:  volRatio,
      pct52w:    pct52,
      marketCap: q.marketCap,
      sector:    q.sector || '—',
    };
  });

  return json({ movers, filter, count: movers.length, timestamp: Date.now() });
}

// ── /fetch-indicators — RSI + MACD via Alpha Vantage ──────────────────────
async function handleIndicators(request, env) {
  const { ticker } = await request.json();
  if (!ticker) return json({ error: 'Ticker required' }, 400);

  const AV_KEY = env.ALPHA_VANTAGE_KEY || 'demo';
  const base   = 'https://www.alphavantage.co/query';

  const [rsiRes, macdRes] = await Promise.all([
    fetch(`${base}?function=RSI&symbol=${ticker}&interval=daily&time_period=14&series_type=close&apikey=${AV_KEY}`),
    fetch(`${base}?function=MACD&symbol=${ticker}&interval=daily&series_type=close&apikey=${AV_KEY}`),
  ]);

  const [rsiData, macdData] = await Promise.all([rsiRes.json(), macdRes.json()]);

  const rsiVals  = rsiData?.['Technical Analysis: RSI']  || {};
  const macdVals = macdData?.['Technical Analysis: MACD'] || {};

  const latestRSI  = Object.values(rsiVals)[0];
  const latestMACD = Object.values(macdVals)[0];

  const rsi      = latestRSI  ? Math.round(parseFloat(latestRSI['RSI'])  * 10) / 10 : null;
  const macd     = latestMACD ? Math.round(parseFloat(latestMACD['MACD']) * 100) / 100 : null;
  const macdSig  = latestMACD ? Math.round(parseFloat(latestMACD['MACD_Signal']) * 100) / 100 : null;
  const macdHist = latestMACD ? Math.round(parseFloat(latestMACD['MACD_Hist']) * 100) / 100 : null;

  const rsiLabel = rsi === null ? '—' : rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral';
  const macdDir  = macdHist === null ? 'neutral' : macdHist > 0 ? 'bullish' : 'bearish';

  return json({ ticker: ticker.toUpperCase(), rsi, rsiLabel, macd, macdSignal: macdSig, macdHist, macdDir });
}

// ── /fetch-signal — Claude AI signal read for a ticker ────────────────────
async function handleSignal(request, env) {
  const { ticker, quote, indicators } = await request.json();

  const prompt = `You are a professional day trader and technical analyst. Analyze this stock and return a JSON trading signal.

Ticker: ${ticker}
Price: $${quote?.price} (${quote?.change > 0 ? '+' : ''}${quote?.change}%)
Volume: ${quote?.volRatio}x average volume
52-week position: ${quote?.pct52w}th percentile
RSI (14): ${indicators?.rsi} — ${indicators?.rsiLabel}
MACD: ${indicators?.macd} (Signal: ${indicators?.macdSignal}, Hist: ${indicators?.macdHist}) — ${indicators?.macdDir}

Return ONLY this JSON, no other text:
{
  "signal": "Strong Buy | Buy | Watch | Sell | Short",
  "momentum": number (0-100),
  "direction": "Bull | Bear | Mixed",
  "aiRead": "2-3 sentence plain English analysis of what these signals mean and what to watch for",
  "entryZone": "price range string or null",
  "target": "price target string or null",
  "stopLoss": "stop loss string or null",
  "keyRisk": "one sentence on biggest risk today"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const result = await res.json();
  const text   = result.content?.[0]?.text || '';
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return json(JSON.parse(clean));
  } catch {
    return json({ signal: 'Watch', momentum: 50, direction: 'Mixed', aiRead: text, entryZone: null, target: null, stopLoss: null, keyRisk: null });
  }
}

// ── /evaluate ──────────────────────────────────────────────────────────────
async function handleEvaluate(request, env) {
  const { type, data, context } = await request.json();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(type),
      messages: [{ role: 'user', content: buildUserPrompt(type, data, context) }],
    }),
  });
  const result = await res.json();
  const text   = result.content?.[0]?.text || '';
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return json(JSON.parse(clean));
  } catch {
    return json({ raw: text, parseError: true });
  }
}

// ── /fetch-sec ─────────────────────────────────────────────────────────────
async function handleSEC(request, env) {
  const { ticker } = await request.json();
  if (!ticker) return json({ error: 'Ticker required' }, 400);
  const cikRes  = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?company=${ticker}&CIK=&type=10-K&dateb=&owner=include&count=5&search_text=&action=getcompany&output=atom`, { headers: { 'User-Agent': 'day-trader-intel contact@aitmai.com' } });
  const cikText = await cikRes.text();
  const cikMatch = cikText.match(/CIK=(\d+)/);
  const cik = cikMatch ? cikMatch[1].padStart(10, '0') : null;
  let facts = null;
  if (cik) {
    const factsRes = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': 'day-trader-intel contact@aitmai.com' } });
    if (factsRes.ok) {
      const factsData = await factsRes.json();
      const us_gaap = factsData?.facts?.['us-gaap'] || {};
      facts = {
        revenue: getLatestFact(us_gaap, 'Revenues'),
        netIncome: getLatestFact(us_gaap, 'NetIncomeLoss'),
        assets: getLatestFact(us_gaap, 'Assets'),
        liabilities: getLatestFact(us_gaap, 'Liabilities'),
        operatingCashFlow: getLatestFact(us_gaap, 'NetCashProvidedByUsedInOperatingActivities'),
        eps: getLatestFact(us_gaap, 'EarningsPerShareBasic'),
      };
    }
  }
  return json({ ticker: ticker.toUpperCase(), cik, facts });
}

function getLatestFact(gaap, key) {
  const units = gaap?.[key]?.units;
  if (!units) return null;
  const entries = (units?.USD || []).filter(e => e.form === '10-K').sort((a, b) => b.end?.localeCompare(a.end));
  return entries[0] ? { value: entries[0].val, period: entries[0].end } : null;
}

// ── /save-deal ─────────────────────────────────────────────────────────────
async function handleSaveDeal(request, env) {
  const body = await request.json();
  const res  = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Evaluations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` },
    body: JSON.stringify({
      fields: {
        Company:     body.company  || '',
        Ticker:      body.ticker   || '',
        Type:        body.type     || '',
        Stage:       body.stage    || '',
        AIScore:     body.aiScore  || 0,
        Moat:        body.moat     || '',
        Signal:      body.signal   || '',
        RedFlags:    JSON.stringify(body.redFlags || []),
        Summary:     body.summary  || '',
        EvaluatedAt: new Date().toISOString(),
      }
    }),
  });
  const text = await res.text();
  return json({ saved: res.ok, status: res.status, airtable: text });
}

// ── /get-deals ─────────────────────────────────────────────────────────────
async function handleGetDeals(request, env) {
  const res  = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Evaluations?sort[0][field]=EvaluatedAt&sort[0][direction]=desc&maxRecords=50`, {
    headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  const data = await res.json();
  return json({ records: data.records || [] });
}

// ── Prompt builders ────────────────────────────────────────────────────────
function buildSystemPrompt(type) {
  const base = 'You are a senior investment analyst. Always respond with valid JSON only — no markdown, no preamble.';
  const map  = {
    public:  base + ' You specialize in public equity analysis using SEC filings and market signals.',
    startup: base + ' You specialize in early-stage venture evaluation.',
    ipo:     base + ' You specialize in IPO readiness analysis.',
    deck:    base + ' You specialize in pitch deck evaluation.',
  };
  return map[type] || base;
}

function buildUserPrompt(type, data, context) {
  const schema = `Return JSON: { "company": string, "ticker": string|null, "type": "${type}", "stage": string, "aiScore": number 0-100, "moat": "Strong|Moderate|Weak|Unproven", "signal": "Strong Buy|Buy|Watch|Sell|Short", "redFlags": [{"label":string,"description":string,"impact":"High|Medium|Low"}], "strengths": [string], "summary": string, "dealMemo": {"thesis":string,"market":string,"team":string,"risks":string,"recommendation":string}, "metrics": {"revenueGrowth":string|null,"grossMargin":string|null,"burnMultiple":string|null,"runway":string|null,"estimatedReturn":string|null} }`;
  const prompts = {
    public:  `Evaluate this public company from a VC/growth investor lens.\n\nData: ${JSON.stringify(data)}\nContext: ${context||'None'}\n\n${schema}`,
    startup: `Evaluate this ${data.stage||'early'} stage startup. Weight: 30% founder, 25% market, 25% traction, 20% economics.\n\nData: ${JSON.stringify(data)}\nContext: ${context||'None'}\n\n${schema}`,
    ipo:     `Evaluate this IPO candidate for investment readiness.\n\nData: ${JSON.stringify(data)}\nContext: ${context||'None'}\n\n${schema}`,
    deck:    `Evaluate this pitch deck. Flag missing data explicitly.\n\nData: ${JSON.stringify(data)}\nContext: ${context||'None'}\n\n${schema}`,
  };
  return prompts[type] || prompts.public;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
