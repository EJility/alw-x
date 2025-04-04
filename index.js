const express = require("express");
const axios = require("axios");
const app = express();

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK";
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY;
const SHEET_CSV_URL = process.env.SHEET_CSV_URL;

const SCAN_INTERVAL = 60000;
const MIN_PRICE = 0.3;
const MAX_PRICE = 30;
const MIN_VOLUME = 100000;
const CONFIDENCE_THRESHOLD = 65;

let systemStatus = {
  version: "v4.8.2",
  lastScan: "Not yet scanned",
  tickersChecked: 0,
  apiCallsUsed: 0,
  alertsFired: 0
};

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function fetchCSVTickers() {
  try {
    const res = await axios.get(SHEET_CSV_URL);
    const rows = res.data.split("\n").map(line => line.trim().split(",")[0]);
    const cleaned = rows.filter(t => /^[A-Z]+$/.test(t)).slice(0, 20);
    return cleaned;
  } catch (err) {
    console.error("CSV Fetch Error:", err.message);
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

async function fetch5MinCandles(symbol) {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=5min&outputsize=10&apikey=${TWELVE_DATA_KEY}`;
    const res = await axios.get(url);
    systemStatus.apiCallsUsed += 1;
    return res.data.values ? res.data.values.reverse() : [];
  } catch (err) {
    console.error(`5min candle error for ${symbol}:`, err.message);
    return [];
  }
}

function isConfirmationCandle(candles) {
  const [prev, latest] = candles.slice(-2);
  return latest && prev &&
    parseFloat(latest.close) > parseFloat(latest.open) &&
    parseFloat(latest.close) > parseFloat(prev.high);
}

function isVolumeSpike(candles) {
  const vols = candles.slice(-6, -1).map(c => parseFloat(c.volume));
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  return parseFloat(candles.at(-1).volume) > 1.3 * avgVol;
}

function getConfidence(candles) {
  let score = 0;
  if (isConfirmationCandle(candles)) score += 30;
  if (isVolumeSpike(candles)) score += 25;
  const latest = candles.at(-1);
  const prev = candles.at(-2);
  if (parseFloat(latest.low) > parseFloat(prev.low)) score += 10;
  if (parseFloat(latest.close) > parseFloat(latest.open)) score += 10;
  return score;
}

function calculateATR(candles, period = 5) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const prevClose = parseFloat(candles[i - 1].close);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return +(trs.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(4) || 0.05;
}

async function passes5MinFilter(symbol) {
  const candles = await fetch5MinCandles(symbol);
  return candles.length >= 2 && isConfirmationCandle(candles);
}

function sendAlert({ symbol, entry, tp, sl, confidence }) {
  const msg = {
    content: `**ALW-X Alert (v4.8.2)**\n**Ticker:** ${symbol}\n**Entry:** $${entry.toFixed(2)}\n**TP:** $${tp.toFixed(2)}\n**SL:** $${sl.toFixed(2)}\n**Confidence:** ${confidence}%\n**Allocation:** 100%`
  };
  axios.post(DISCORD_WEBHOOK, msg)
    .then(() => {
      systemStatus.alertsFired += 1;
      console.log(`[ALERT] ${symbol} | Confidence: ${confidence}%`);
    })
    .catch(err => console.error(`[ALERT ERROR] ${symbol}:`, err.message));
}

async function scanMarket() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const h = now.getHours(), m = now.getMinutes();
  if (h < 9 || (h === 9 && m < 15) || (h === 10 && m > 30) || h > 10) return;

  const tickers = await fetchCSVTickers();
  systemStatus.tickersChecked = tickers.length;

  const chunks = chunkArray(tickers, 8);
  for (const group of chunks) {
    const bulk = await fetchBulkCandles(group);
    for (const symbol of group) {
      const data = bulk[symbol];
      if (!data || !data.values) continue;
      const candles = data.values.reverse();
      if (candles.length < 6) continue;

      const confidence = getConfidence(candles);
      if (confidence < CONFIDENCE_THRESHOLD) continue;

      const entry = parseFloat(candles.at(-1).close);
      const atr = calculateATR(candles);
      const tp = +(entry + 1.8 * atr).toFixed(2);
      const sl = +(entry - 1.3 * atr).toFixed(2);

      const passed5Min = await passes5MinFilter(symbol);
      if (!passed5Min) continue;

      sendAlert({ symbol, entry, tp, sl, confidence });
    }
  }

  systemStatus.lastScan = now.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles" });
}

app.get("/", (_, res) => res.send("ALW-X Sentinel v4.8.2 is live."));
app.get("/status", (_, res) => res.json(systemStatus));
app.get("/manual", async (_, res) => {
  await scanMarket();
  res.json({ message: "Manual scan complete" });
});
app.get("/mock-alert", (_, res) => {
  sendAlert({ symbol: "MOCK", entry: 1.11, tp: 1.33, sl: 0.99, confidence: 91 });
  res.json({ message: "Mock alert sent" });
});

setTimeout(() => {
  console.log("[INIT] Starting scan loop after warmup.");
  scanMarket();
  setInterval(scanMarket, SCAN_INTERVAL);
}, 5000);

app.listen(process.env.PORT || 10000, () => {
  console.log("ALW-X Sentinel v4.8.2 server running.");
});
