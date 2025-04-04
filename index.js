const axios = require("axios");

// ✅ Configuration
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQa04Eq_TGL-rZQGJ1dwdXxVDiE1hudo21PNOSBLa2JjQSy0X6Qhugkcy8-Z6oO_jtXGp2HI5LnWXMS/pub?gid=0&single=true&output=csv";
const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK";
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function isWithinTradingWindow() {
  const now = new Date();
  const ptTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const hours = ptTime.getHours();
  const minutes = ptTime.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 555 && totalMinutes <= 630; // 9:15 AM to 10:30 AM PT
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

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
• Confidence: ${confidence}%`,
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
  if (!isWithinTradingWindow()) {
    console.log("⏸️ Outside of trading window. Skipping scan.");
    return;
  }

  const allTickers = await fetchTickersFromSheet();
  console.log(`📊 Starting batch scan of ${allTickers.length} tickers`);

  const batches = [];
  for (let i = 0; i < allTickers.length; i += 4) {
    batches.push(allTickers.slice(i, i + 4));
  }

  for (let i = 0; i < batches.length; i++) {
    console.log(`⏳ Running batch ${i + 1}/${batches.length}...`);
    await scanBatch(batches[i]);
    if (i < batches.length - 1) {
      console.log("⏱️ Waiting 60s before next batch to avoid API limit...");
      await delay(60000); // wait 60s
    }
  }

  console.log("✅ All batches completed.");
}

// 🔁 Loop every 5 minutes
setInterval(scanAll, SCAN_INTERVAL_MS);
scanAll(); // Run immediately on start
