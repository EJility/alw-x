const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURATION ===
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/...' // (your real webhook here)
const API_KEY = 'your_twelvedata_api_key';
const WATCHLIST = ['BBAI', 'IONQ', 'SOFI', 'MVIS', 'RIVN'];
const SCAN_WINDOW = { start: '09:15', end: '10:30' };

// === UTILITY FUNCTIONS ===
function isInScanWindow() {
  const now = new Date();
  const currentHour = now.getHours().toString().padStart(2, '0');
  const currentMinute = now.getMinutes().toString().padStart(2, '0');
  const timeString = `${currentHour}:${currentMinute}`;
  return timeString >= SCAN_WINDOW.start && timeString <= SCAN_WINDOW.end;
}

async function fetchQuote(ticker) {
  const url = `https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${API_KEY}`;
  try {
    const response = await axios.get(url);
    return response.data;
  } catch {
    return null;
  }
}

async function scanWatchlist() {
  if (!isInScanWindow()) {
    console.log("Not in scan window. Skipping...");
    return;
  }

  for (const ticker of WATCHLIST) {
    const data = await fetchQuote(ticker);
    if (data && parseFloat(data.percent_change) >= 5) {
      await axios.post(DISCORD_WEBHOOK_URL, {
        content: `**ALW-X Alert:** ${ticker} is up ${data.percent_change}%! Current price: $${data.close}`
      });
      console.log(`Alert sent for ${ticker}`);
    }
  }
}

// === ROUTES ===
app.get("/", (req, res) => {
  res.send("ALW-X Engine is online.");
});

app.get("/test", (req, res) => {
  res.send("ALW-X Engine is live!");
});

app.listen(PORT, () => {
  console.log(`ALW-X server running on port ${PORT}`);
});
