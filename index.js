const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURATION
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1356083288099520643/WxzFUsLw0F2nHHD4_eGdF8HmPUO00l4MXwGlsSYTg5bBrdBVLYHvuSVsYYo-3Ze6H8BK';
const API_KEY = '81ccfc8574164c00b822939c3f885f4a';
const WATCHLIST = ['BBAI', 'IONQ', 'GCT', 'TSLA', 'NVDA'];
const SCAN_WINDOW = { start: '09:15', end: '10:30' };

// UTILITIES
function isInScanWindow() {
  const now = new Date();
  const currentHour = now.getHours().toString().padStart(2, '0');
  const currentMinute = now.getMinutes().toString().padStart(2, '0');
  const timeString = `${currentHour}:${currentMinute}`;
  return timeString >= SCAN_WINDOW.start && timeString <= SCAN_WINDOW.end;
}

async function fetchQuote(ticker) {
  const url = `https://api.twelvedata.com/price?symbol=${ticker}&apikey=${API_KEY}`;
  try {
    const response = await axios.get(url);
    return response.data;
  } catch {
    return null;
  }
}

async function scanStocks() {
  const results = [];

  for (const ticker of WATCHLIST) {
    const quote = await
