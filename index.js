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

let systemStatus = {
  version: "v4.8.1",
  lastScan: "Not yet scanned",
  tickersScraped: 0,
  apiCallsUsed: 0,
  alertsFired: 0
};

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function fetchTopStocksFromFinviz() {
  try {
    const res = await axios.get("https://finviz.com/screener.ashx?v=111&s=ta_topgainers&f=sh_price_o0.3,sh_price_u30,sh_avgvol_o100&o=-volume");
    const $ = cheerio.load(res.data);
    const tickers = [];
    $("a.screener-link-primary").each((_, el) => {
      const ticker = $(el).text().trim();
      if (ticker && !tickers.includes(ticker)) tickers.push(ticker);
    });
    return tickers.slice(0, 30);
  } catch (err) {
    console.error("Error scraping Finviz:", err.message);
    return [];
  }
}

async function fetchBulkCandles(symbols, interval = "1min") {
  try {
    const joined = symbols.join(",");
    const url = `https://api.twelvedata.com/time_series?symbol=${joined}&interval=${interval}&outputsize=20&apikey=${TWELVE_DATA_KEY}`;
    const res = await axios.get(url);
    systemStatus.apiCallsUsed += 1;
    return res.data;
  } catch (err) {
    console.error("Bulk candle fetch error:", err.message);
    return {};
  }
}

async function fetchCandlesSingle(symbol, interval = "5min") {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=10&apikey=${TWELVE_DATA_KEY}`;
    const res = await axios.get(url);
    systemStatus.apiCallsUsed += 1;
    return res.data.values ? res.data.values.reverse() : [];
  } catch (err) {
    console.error(`Error fetching ${interval} candles for ${symbol}:`, err.message);
    return [];
  }
}

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
  const sum = trs.slice(-period).reduce((a, b) => a + b, 0);
  return +(sum / period).toFixed(4);
}

function isConfirmationCandle(candles) {
  if (candles.length < 2) return false;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return (
    parseFloat(latest.close) > parseFloat(latest.open) &&
    parseFloat(latest.close) > parseFloat(prev.high)
  );
}

function isVolumeSpike(candles) {
  const vols = candles.slice(-6, -1).map(c => parseFloat(c.volume));
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  const currentVol = parseFloat(candles[candles.length - 1].volume);
  return currentVol > 1.3 * avgVol;
}

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

async function passes5MinFilter(symbol) {
  const candles = await fetchCandlesSingle(symbol, "5min");
  if (candles.length < 2) return false;
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return (
    parseFloat(latest.close) > parseFloat(latest.open) &&
    parseFloat(latest.close) > parseFloat(prev.high)
  );
}

function sendAlert({ symbol, entry, tp, sl, confidence }) {
  const msg = {
    content: `**ALW-X Alert (v4.8.1)**\n**Ticker:** ${symbol}\n**Entry:** $${entry.toFixed(2)}\n**TP:** $${tp.toFixed(2)}\n**SL:** $${sl.toFixed(2)}\n**Confidence:** ${confidence}%\n**Allocation:** 100%`
  };

  axios.post(DISCORD_WEBHOOK, msg)
    .then(() => {
      systemStatus.alertsFired += 1;
      console.log(`[ALERT SENT] ${symbol} | Entry: $${entry.toFixed(2)} | Confidence: ${confidence}%`);
    })
    .catch((err) => {
      console.error(`[ALERT ERROR] Failed to send alert for ${symbol}:`, err.message);
    });
}

async function scanMarket() {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  if (hour < 9 || (hour === 9 && min < 15) || (hour === 10 && min > 30) || hour > 10) return;

  const allTickers = await fetchTopStocksFromFinviz();
  systemStatus.tickersScraped = allTickers.length;

  const finalTickers = [];
  for (const symbol of allTickers) {
    const candles = await fetchCandlesSingle(symbol, "1min");
    if (!candles.length) continue;
    const last = candles[candles.length - 1];
    const price = parseFloat(last.close);
    const volume = parseFloat(last.volume);
    if (price >= MIN_PRICE && price <= MAX_PRICE && volume >= MIN_VOLUME) {
      finalTickers.push(symbol);
      if (finalTickers.length >= 20) break;
    }
  }

  const chunks = chunkArray(finalTickers, 8);
  for (const group of chunks) {
    const bulk = await fetchBulkCandles(group);
    for (const symbol of group) {
      const data = bulk[symbol];
      if (!data || !data.values) continue;
      const candles = data.values.reverse();
      if (candles.length < 6) continue;

      const confidence = getConfidence(candles);
      if (confidence < CONFIDENCE_THRESHOLD) continue;

      const atr = calculateATR(candles);
      const entry = parseFloat(candles[candles.length - 1].close);
      const tp = +(entry + 1.8 * atr).toFixed(2);
      const sl = +(entry - 1.3 * atr).toFixed(2);

      const passed5Min = await passes5MinFilter(symbol);
      if (!passed5Min) continue;

      sendAlert({ symbol, entry, tp, sl, confidence });
    }
  }

  systemStatus.lastScan = now.toLocaleTimeString();
}

setInterval(scanMarket, SCAN_INTERVAL);

app.get("/", (_, res) => res.send("ALW-X Sentinel v4.8.1 is running."));
app.get("/status", (_, res) => res.json(systemStatus));
app.get("/manual", async (_, res) => {
  await scanMarket();
  res.json({ status: "Manual scan complete" });
});
app.get("/mock-alert", (_, res) => {
  sendAlert({ symbol: "MOCK", entry: 1.23, tp: 1.50, sl: 1.10, confidence: 88 });
  res.json({ status: "Mock alert triggered" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`ALW-X Sentinel v4.8.1 Diagnostic running on port ${PORT}`);
});
