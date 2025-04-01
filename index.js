const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURATION
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK';
const API_KEY = '81ccfc8574164c00b82c80bc64cf580e';
const WATCHLIST = ['BBAI', 'IONQ', 'SOFI', 'TQQQ', 'PLTR', 'MARA', 'RIOT', 'FUBO', 'TSLA', 'NVDA'];
const SCAN_WINDOW = { start: '09:15', end: '10:30' }; // PT

// UTILITY FUNCTIONS
function isInScanWindow() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const timeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
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

function meetsAlertCriteria(quote) {
  if (!quote || !quote.price || !quote.previous_close) return false;
  const price = parseFloat(quote.price);
  const prevClose = parseFloat(quote.previous_close);
  const changePercent = ((price - prevClose) / prevClose) * 100;

  return (
    changePercent > 4 &&
    parseFloat(quote.volume) > 2000000 &&
    price < 20
  );
}

async function sendDiscordAlert(ticker, quote) {
  const message = {
    username: 'ALW-X Sentinel',
    content: `**ALERT: ${ticker}**  
Price: $${quote.price}  
Change: ${quote.percent_change}%  
Volume: ${quote.volume}`,
  };
  try {
    await axios.post(DISCORD_WEBHOOK_URL, message);
  } catch (err) {
    console.error('Failed to send Discord alert:', err.message);
  }
}

// ROUTES
app.get('/', (req, res) => {
  res.send('ALW-X Bridge is online');
});

app.get('/test', async (req, res) => {
  await sendDiscordAlert('TEST', {
    price: '1.23',
    percent_change: '5.67',
    volume: '999999',
  });
  res.send('Test alert sent to Discord.');
});

app.get('/scan', async (req, res) => {
  if (!isInScanWindow()) return res.send('Outside scan window.');

  for (const ticker of WATCHLIST) {
    const quote = await fetchQuote(ticker);
    if (meetsAlertCriteria(quote)) {
      await sendDiscordAlert(ticker, quote);
    }
  }

  res.send('Scan completed.');
});

// START SERVER
app.listen(PORT, () => {
  console.log(`ALW-X server running on port ${PORT}`);
});
