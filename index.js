const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const app = express();

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK";
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY;
const SCAN_INTERVAL = 60000;

const MIN_PRICE = 0.3;
const MAX_PRICE = 30;
const MIN_VOLUME = 100000;
const CONFIDENCE_THRESHOLD = 65;

let lastScan = "Not yet scanned";
let tickersScraped = 0;
let apiCallsUsed = 0;
let alertsFired = 0;

// === Scrape Top Stocks ===
async function fetchTopStocksFromFinviz() {
  try {
    const res = await axios.get("https://finviz.com/screener.ashx?v=111&s=ta_topgainers&f=sh_price_u30&o=-volume");
    const $ = cheerio.load(res.data);
    const tickers = [];
    $("a.screener-link-primary").each((_, el) => {
      const ticker = $(el).text().trim();
      if (ticker && !tickers.includes(ticker)) tickers.push(ticker);
    });
    tickersScraped = tickers.length;
    return tickers.slice(0, 30);
  } catch (err) {
    console.error("Finviz error:", err.message);
    return [];
  }
}

// === Candle Fetcher ===
async function fetchCandles(symbol, interval = "1min", limit = 20) {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${limit}&apikey=${TWELVE_DATA_KEY}`;
    const res = await axios.get(url);
    apiCallsUsed++;
    return res.data.values ? res.data.values.reverse() : [];
  } catch (err) {
    console.error(`Candle error [${symbol}]:`, err.message);
    return [];
  }
}

// === ATR ===
function calculateATR(candles, period = 5) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const prevClose = parseFloat(candles[i - 1].close);
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return 0.05;
  return +(trs.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(4);
}

// === Filters ===
function isConfirmationCandle(candles) {
  if (candles.length < 2) return false;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return parseFloat(latest.close) > parseFloat(latest.open) &&
         parseFloat(latest.close) > parseFloat(prev.high);
}

function isVolumeSpike(candles) {
  const vols = candles.slice(-6, -1).map(c => parseFloat(c.volume));
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  return parseFloat(candles[candles.length - 1].volume) > 1.3 * avgVol;
}

// === Confidence Scoring ===
function getConfidence(candles) {
  let score = 0;
  if (isConfirmationCandle(candles)) score += 30;
  if (isVolumeSpike(candles)) score += 25;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (parseFloat(latest.low) > parseFloat(prev.low)) score += 10;
  if (parseFloat(latest.close) > parseFloat(latest.open)) score += 10;
  return score;
}

// === Optional 5-Min Confirmation (Smart Filter) ===
function passes5MinFilter(candles) {
  if (candles.length < 2) return false;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return parseFloat(latest.close) > parseFloat(latest.open) &&
         parseFloat(latest.close) > parseFloat(prev.high);
}

// === Alert ===
function sendAlert({ symbol, entry, tp, sl, confidence, allocation }) {
  const msg = {
    content: `**ALW-X Alert (v4.8)**\n**Ticker:** ${symbol}\n**Entry:** $${entry.toFixed(2)}\n**TP:** $${tp.toFixed(2)}\n**SL:** $${sl.toFixed(2)}\n**Confidence:** ${confidence}%\n**Allocation:** ${allocation}%`
  };
  axios.post(DISCORD_WEBHOOK, msg);
  alertsFired++;
}

// === Main Scanner ===
async function scanMarket() {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  if (hour < 9 || (hour === 9 && min < 15) || (hour === 10 && min > 30) || hour > 10) return;

  lastScan = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  console.log(`\n[Scan @ ${lastScan}] Starting scan...`);

  const tickers = await fetchTopStocksFromFinviz();

  for (const symbol of tickers) {
    const candles1m = await fetchCandles(symbol, "1min", 20);
    if (candles1m.length < 6) {
      console.log(`[${symbol}] Not enough 1-min data`);
      continue;
    }

    const latest = candles1m[candles1m.length - 1];
    const price = parseFloat(latest.close);
    const volume = parseFloat(latest.volume);
    if (price < MIN_PRICE || price > MAX_PRICE || volume < MIN_VOLUME) {
      console.log(`[${symbol}] Skipped: price/volume out of range`);
      continue;
    }

    const confidence = getConfidence(candles1m);
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.log(`[${symbol}] Skipped: confidence ${confidence}%`);
      continue;
    }

    // Optional 5-minute filter
    const candles5m = await fetchCandles(symbol, "5min", 10);
    if (!passes5MinFilter(candles5m)) {
      console.log(`[${symbol}] Skipped: 5-min filter failed`);
      continue;
    }

    const atr = calculateATR(candles1m);
    const entry = price;
    const tp = +(entry + 1.8 * atr).toFixed(2);
    const sl = +(entry - 1.3 * atr).toFixed(2);
    const allocation = confidence >= 80 ? 100 : confidence >= 75 ? 85 : 70;

    console.log(`[${symbol}] Alert: confidence ${confidence}%, entry $${entry}, TP $${tp}, SL $${sl}`);
    sendAlert({ symbol, entry, tp, sl, confidence, allocation });
  }
}

// === Force First Scan After Boot ===
setTimeout(() => {
  console.log("[Boot] Triggering initial scan...");
  scanMarket();
}, 5000);

// === Background Scan Loop ===
setInterval(scanMarket, SCAN_INTERVAL);

// === Express Routes ===
app.get("/", (_, res) => res.send("ALW-X Sentinel v4.8 is live"));
app.get("/status", (_, res) => {
  res.json({
    version: "v4.8",
    lastScan,
    tickersScraped,
    apiCallsUsed,
    alertsFired
  });
});
app.get("/scan", async (_, res) => {
  await scanMarket();
  res.json({ status: "Manual scan complete" });
});
app.get("/mock-alert", (_, res) => {
  sendAlert({ symbol: "TEST", entry: 1.23, tp: 1.55, sl: 1.10, confidence: 77, allocation: 100 });
  res.json({ status: "Mock alert sent" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ALW-X v4.8 Sentinel running on port ${PORT}`));
