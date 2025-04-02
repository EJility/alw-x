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

let lastScanTime = "Not yet scanned";

// === Scrape Finviz Top Gainers ===
async function fetchTopStocksFromFinviz() {
  try {
    const res = await axios.get("https://finviz.com/screener.ashx?v=111&s=ta_topgainers&f=sh_price_u30&o=-volume");
    const $ = cheerio.load(res.data);
    const tickers = [];
    $("a.screener-link-primary").each((_, el) => {
      const ticker = $(el).text().trim();
      if (ticker && !tickers.includes(ticker)) tickers.push(ticker);
    });
    if (tickers.length === 0) console.warn("WARNING: No tickers scraped from Finviz.");
    return tickers.slice(0, 30);
  } catch (err) {
    console.error("Error scraping Finviz:", err.message);
    return [];
  }
}

// === Fetch Candle Data ===
async function fetchCandles(symbol) {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1min&outputsize=20&apikey=${TWELVE_DATA_KEY}`;
    const res = await axios.get(url);
    const values = res.data.values;
    return values ? values.reverse() : [];
  } catch (err) {
    console.error(`Error fetching candles for ${symbol}:`, err.message);
    return [];
  }
}

// === Technical Logic ===
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
  return parseFloat(latest.close) > parseFloat(latest.open) &&
         parseFloat(latest.close) > parseFloat(prev.high);
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

// === Send Discord Alert ===
function sendAlert({ symbol, entry, tp, sl, confidence }) {
  const msg = {
    content: `**ALW-X Alert (v4.7)**\n**Ticker:** ${symbol}\n**Entry:** $${entry.toFixed(2)}\n**TP:** $${tp.toFixed(2)}\n**SL:** $${sl.toFixed(2)}\n**Confidence:** ${confidence}%\n**Allocation:** 100%`
  };
  axios.post(DISCORD_WEBHOOK, msg);
}

// === Main Scan Logic ===
async function scanMarket() {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  if (hour < 9 || (hour === 9 && min < 15) || (hour === 10 && min > 30) || hour > 10) return;

  lastScanTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const tickers = await fetchTopStocksFromFinviz();

  for (const symbol of tickers) {
    const candles = await fetchCandles(symbol);
    if (candles.length < 6) continue;

    const latest = candles[candles.length - 1];
    const price = parseFloat(latest.close);
    const volume = parseFloat(latest.volume);

    if (price < MIN_PRICE || price > MAX_PRICE || volume < MIN_VOLUME) continue;

    const confidence = getConfidence(candles);
    if (confidence < CONFIDENCE_THRESHOLD) continue;

    const atr = calculateATR(candles);
    const entry = price;
    const tp = +(entry + 1.8 * atr).toFixed(2);
    const sl = +(entry - 1.3 * atr).toFixed(2);

    sendAlert({ symbol, entry, tp, sl, confidence });
  }
}

// === Immediately trigger scan once on boot ===
setTimeout(() => {
  console.log("Triggering first scan after startup...");
  scanMarket();
}, 5000); // delay 5 seconds after boot

// === Background Scan Loop ===
setInterval(scanMarket, SCAN_INTERVAL);

// === Express Routes ===
app.get("/", (_, res) => res.send("ALW-X Bridge is online"));
app.get("/scan", async (_, res) => {
  await scanMarket();
  res.json({ status: "Manual scan complete" });
});
app.get("/mock-alert", (_, res) => {
  sendAlert({ symbol: "TEST", entry: 1.23, tp: 1.50, sl: 1.10, confidence: 77 });
  res.json({ status: "Mock alert sent" });
});
app.get("/status", (_, res) => {
  res.json({ lastScan: lastScanTime });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ALW-X Sentinel running on port ${PORT}`));
