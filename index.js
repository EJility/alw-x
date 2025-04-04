const axios = require("axios");

// ✅ Manual Google Sheet for tickers
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQa04Eq_TGL-rZQGJ1dwdXxVDiE1hudo21PNOSBLa2JjQSy0X6Qhugkcy8-Z6oO_jtXGp2HI5LnWXMS/pub?gid=0&single=true&output=csv";

// ✅ Discord webhook hardcoded
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK";

// ✅ Your Twelve Data API key via Render
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;

// Helper function to pause between batches
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchTickersFromSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    const lines = response.data.split("\n");
    return lines.map((line) => line.trim()).filter((t) => t).slice(0, 20);
  } catch (error) {
    console.error("❌ Error fetching ticker sheet:", error.message);
    return [];
  }
}

async function fetchCandleData(ticker, interval = "1min", count = 5) {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=${interval}&outputsize=${count}&apikey=${TWELVE_DATA_API_KEY}`;
    const response = await axios.get(url);
    if (response.data.status === "error") throw new Error(response.data.message);
    return response.data.values;
  } catch (err) {
    console.error(`❌ Error fetching ${interval} data for ${ticker}:`, err.message);
    return null;
  }
}

function calculateATR(candles) {
  return (
    candles.reduce((sum, c) => sum + (parseFloat(c.high) - parseFloat(c.low)), 0) /
    candles.length
  );
}

function roundToClean(value) {
  const num = parseFloat(value);
  if (num < 1) return num.toFixed(4);
  if (num < 10) return num.toFixed(3);
  return num.toFixed(2);
}

function calculateConfidence(oneMinCandles) {
  try {
    const [latest, prev, prev2] = oneMinCandles;
    const change =
      ((parseFloat(latest.close) - parseFloat(prev.close)) / parseFloat(prev.close)) * 100;

    const avgVolume = (parseFloat(prev.volume) + parseFloat(prev2.volume)) / 2;
    const spike = parseFloat(latest.volume) > avgVolume;

    let score = 50;
    if (change > 0.3) score += 10;
    if (spike) score += 15;
    return Math.min(score, 100);
  } catch (e) {
    return 0;
  }
}

async function sendAlertToDiscord({ ticker, entry, stopLoss, takeProfit, confidence }) {
  const message = {
    content: `📈 **ALW-X Alert: ${ticker}**
• Entry: $${entry}
• Stop Loss: $${stopLoss}
• Take Profit: $${takeProfit}
• Confidence: ${confidence}%`
  };

  try {
    await axios.post(DISCORD_WEBHOOK_URL, message);
  } catch (err) {
    console.error("❌ Failed to send Discord alert:", err.message);
  }
}

async function scanBatch(tickers) {
  for (const ticker of tickers) {
    const oneMin = await fetchCandleData(ticker, "1min", 5);
    const fiveMin = await fetchCandleData(ticker, "5min", 3);

    if (!oneMin || !fiveMin) continue;

    const confidence = calculateConfidence(oneMin);
    if (confidence < 65) continue;

    const last5 = fiveMin[0];
    const fiveMinGreen = parseFloat(last5.close) > parseFloat(last5.open);
    if (!fiveMinGreen) continue;

    const entry = parseFloat(oneMin[0].close);
    const atr = calculateATR(oneMin);
    const stopLoss = roundToClean(entry - atr * 1.3);
    const takeProfit = roundToClean(entry + atr * 2.0);

    await sendAlertToDiscord({
      ticker,
      entry: roundToClean(entry),
      stopLoss,
      takeProfit,
      confidence,
    });

    console.log(`✅ Alert sent for ${ticker} (Confidence: ${confidence}%)`);
  }
}

async function scanAll() {
  const allTickers = await fetch
