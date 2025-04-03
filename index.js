const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

// Your Discord webhook URL
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK';

let startTime = Date.now();

app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  res.send({
    version: 'v4.8.1',
    message: 'Scan loop running every 60 seconds',
    uptime: `${uptime} seconds`
  });
});

// Real alert for diagnostics
app.get('/mock-alert', async (req, res) => {
  try {
    const payload = {
      content: '**[ALW-X TRADE ALERT]**',
      embeds: [{
        title: 'Trade Opportunity',
        fields: [
          { name: 'Ticker', value: 'TEST', inline: true },
          { name: 'Entry', value: '$1.23', inline: true },
          { name: 'Stop-Loss', value: '$1.10', inline: true },
          { name: 'Take-Profit', value: '$1.50', inline: true },
          { name: 'Confidence', value: '77%', inline: true },
          { name: 'Allocation', value: '100%', inline: true }
        ],
        footer: {
          text: 'ALW-X Sentinel v4.8.1 Diagnostic Test'
        },
        timestamp: new Date().toISOString()
      }]
    };

    await axios.post(DISCORD_WEBHOOK_URL, payload);
    res.send({ status: 'Diagnostic alert sent to Discord' });

  } catch (error) {
    console.error('Failed to send Discord alert:', error.message);
    res.status(500).send({ error: 'Failed to send alert', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ALW-X Sentinel v4.8.1 Diagnostic running on port ${PORT}`);
});
