const express = require("express");
const axios = require("axios");
const app = express();

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK";
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY;

const SCAN_INTERVAL = 60000;
const MIN_PRICE = 0.3;
const MAX_PRICE = 30;
const MIN_VOLUME = 100000;
const CONFIDENCE_THRESHOLD = 65;

let systemStatus = {
  version: "v4.8.2",
  lastScan: "Not yet scanned",
  tickersScanned: 0,
  alphaCallsUsed: 0,
  twelveCallsUsed: 0,
  alertsFired: 0
};

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function fetchAlphaTickers() {
  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${ALPHA_VANTAGE_KEY}`
    );
    const symbols = res.data.top_gainers.map(item => item.ticker)
      .filter(t => t && /^[A-Z]+$/.test(t));
    systemStatus.alphaCallsUsed += 1;
    return symbols.slice(0, 100);
  } catch (err) {
    console.error("Alpha fetch error:", err.message);
    return [];
  }
}

async function fetchBulkCandles(symbols, interval = "1min") {
  try {
    const joined = symbols.join(",");
    const res = await axios.get(
      `https://api.twelvedata.com/time_series?symbol=${joined}&interval=${interval}&outputsize=20&apikey=${TWELVE_DATA_KEY}`
    );
    systemStatus.twelveCallsUsed += 1;
    return res.data;
  } catch (err) {
    console.error("Twelve Data batch error:", err.message);
    return {};
  }
}

async function fetch5MinCandles(symbol) {
  try {
    const res = await axios.get(
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=5min&outputsize=10&apikey=${TWELVE_DATA_KEY}`
    );
    systemStatus.twelveCallsUsed += 1;
    return res.data.values ? res.data.values.reverse() : [];
  } catch (err) {
    console.error(`5-min fetch error (${symbol}):`, err.message);
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
  const sum = trs.slice(-period).reduce((a, b) => a + b, 0);
  return +(sum / period).toFixed(4) || 0.05;
}

function isConfirmationCandle(candles) {
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

async function passes5Min(symbol) {
  const candles = await fetch5MinCandles(symbol);
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
    content: `**ALW-X Alert (v4.8.2)**\n**Ticker:** ${symbol}\n**Entry:** $${entry.toFixed(
      2
    )}\n**TP:** $${tp.toFixed(2)}\n**SL:** $${sl.toFixed(
      2
    )}\n**Confidence:** ${confidence}%\n**Allocation:** 100%`
  };

  axios.post(DISCORD_WEBHOOK, msg)
    .then(() => {
      console.log(`[ALERT] ${symbol} | TP: $${tp} | SL: $${sl}`);
      systemStatus.alertsFired += 1;
    })
    .catch((err) => {
      console.error("[ALERT ERROR]", err.message);
    });
}

async function scanMarket() {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  if (hour < 9 || (hour === 9 && min < 15) || (hour === 10 && min > 30) || hour > 10) return;

  const alphaTickers = await fetchAlphaTickers();
  systemStatus.tickersScanned = alphaTickers.length;

  const filtered = [];
  for (const symbol of alphaTickers) {
    const candles = await fetch5MinCandles(symbol);
    if (!candles.length) continue;
    const last = candles[candles.length - 1];
    const price = parseFloat(last.close);
    const volume = parseFloat(last.volume);
    if (price >= MIN_PRICE && price <= MAX_PRICE && volume >= MIN_VOLUME) {
      filtered.push(symbol);
    }
    if (filtered.length >= 20) break;
  }

  const chunks = chunkArray(filtered, 8);
  for (const group of chunks) {
    const data = await fetchBulkCandles(group);
    for (const symbol of group) {
      const candles = data[symbol]?.values?.reverse() || [];
      if (candles.length < 6) continue;

      const confidence = getConfidence(candles);
      if (confidence < CONFIDENCE_THRESHOLD) continue;

      const atr = calculateATR(candles);
      const entry = parseFloat(candles[candles.length - 1].close);
      const tp = +(entry + 1.8 * atr).toFixed(2);
      const sl = +(entry - 1.3 * atr).toFixed(2);

      const valid = await passes5Min(symbol);
      if (!valid) continue;

      sendAlert({ symbol, entry, tp, sl, confidence });
    }
  }

  systemStatus.lastScan = new Date().toLocaleTimeString();
}

// === Express Routes ===
app.get("/", (_, res) => res.send("ALW-X Sentinel v4.8.2 is running."));
app.get("/status", (_, res) => res.json(systemStatus));
app.get("/manual", async (_, res) => {
  await scanMarket();
  res.json({ status: "Manual scan complete" });
});
app.get("/mock-alert", (_, res) => {
  sendAlert({ symbol: "MOCK", entry: 1.23, tp: 1.5, sl: 1.1, confidence: 88 });
  res.json({ status: "Mock alert triggered" });
});

// === Startup ===
setTimeout(() => {
  console.log("[STARTUP] Initial scan triggered.");
  scanMarket();
  setInterval(scanMarket, SCAN_INTERVAL);
}, 5000);

app.listen(process.env.PORT || 3000, () => {
  console.log("ALW-X Sentinel v4.8.2 running on port 3000");
});
