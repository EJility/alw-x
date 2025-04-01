const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURATION ===
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK';
const API_KEY = '81cfc8574164c00b82c7f139cfb452c6';
const WATCHLIST = ['BBAI', 'IONQ', 'SOUN', 'TAP', 'LXRX', 'MLGO', 'SURG', 'XHLD'];
const SCAN_WINDOW = { start: '09:15', end: '10:30' };

// === UTILITIES ===
function isInScanWindow() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;
  return currentTime >= SCAN_WINDOW.start && currentTime <= SCAN_WINDOW.end;
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

function shouldAlert(quote) {
  if (!quote || !quote.name || !quote.percent_change) return false;
  const change = parseFloat(quote.percent_change);
  return change >= 4.5;
}

async function scanTickers() {
  if (!isInScanWindow()) return;
  for (const ticker of WATCHLIST) {
    const quote = await fetchQuote(ticker);
    if (shouldAlert(quote)) {
      await axios.post(DISCORD_WEBHOOK_URL, {
        content: `**${quote.name} (${quote.symbol})** is up ${quote.percent_change}% — Price: $${quote.close}`
      });
    }
  }
}

// === ROUTES ===
app.get('/', (req, res) => {
  res.send('ALW-X Engine is live!');
});

app.get('/mock-alert', async (req, res) => {
  await axios.post(DISCORD_WEBHOOK_URL, {
    content: 'Mock alert sent from /mock-alert endpoint!'
  });
  res.send('Mock alert sent!');
});

// === STARTUP ===
app.listen(PORT, () => {
  console.log(`ALW-X server running on port ${PORT}`);
  setInterval(scanTickers, 60 * 1000); // every 60 seconds
});
