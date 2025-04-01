const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK';

app.get('/', (req, res) => {
  res.send('ALW-X Bridge is online');
});

app.get('/mock-alert', async (req, res) => {
  await sendDiscordAlert("**TEST ALERT:** This is a manual test alert from the ALW-X Bridge.");
  res.send('Test alert sent to Discord.');
});

async function sendDiscordAlert(message) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
  } catch (error) {
    console.error('Failed to send alert:', error.message);
  }
}

// === MAIN TEST SCANNER LOOP ===
async function runTestScan() {
  const rawList = fs.readFileSync('./stockList.json');
  const stockList = JSON.parse(rawList);

  for (const ticker of stockList) {
    const fakeSignal = `**Ping Test:** ${ticker} triggered a fake alert for testing pipeline.`;
    await sendDiscordAlert(fakeSignal);
    console.log(`Test signal sent for: ${ticker}`);
    break; // Only send 1 to prevent spam
  }
}

// Run test scan after 10-second delay
setTimeout(runTestScan, 10000);

app.listen(port, () => {
  console.log(`ALW-X running on port ${port}`);
});
