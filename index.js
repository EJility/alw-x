const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const app = express();

let finvizStatus = {
  httpStatus: null,
  tickersScraped: 0,
  preview: "",
};

async function fetchTopStocksFromFinviz() {
  try {
    const res = await axios.get("https://finviz.com/screener.ashx?v=111&s=ta_topgainers&f=sh_price_o0.3,sh_price_u30,sh_avgvol_o100&o=-volume", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    finvizStatus.httpStatus = res.status;
    const $ = cheerio.load(res.data);
    const tickers = [];

    $("a.screener-link-primary").each((_, el) => {
      const ticker = $(el).text().trim();
      if (ticker && !tickers.includes(ticker)) tickers.push(ticker);
    });

    finvizStatus.tickersScraped = tickers.length;
    finvizStatus.preview = res.data.slice(0, 300); // preview HTML to detect blocks
    return tickers.slice(0, 30);
  } catch (err) {
    finvizStatus.httpStatus = err.response ? err.response.status : "No response";
    finvizStatus.preview = err.message;
    console.error("Error fetching Finviz data:", err.message);
    return [];
  }
}

// Diagnostic scan route
app.get("/manual", async (_, res) => {
  console.log("[DIAGNOSTIC] Manual Finviz scan triggered.");
  const tickers = await fetchTopStocksFromFinviz();
  res.json({
    status: "Diagnostic complete",
    tickers,
    finvizStatus,
  });
});

// Status route
app.get("/status", (_, res) => {
  res.json(finvizStatus);
});

app.get("/", (_, res) => {
  res.send("Finviz Diagnostic Scanner is running.");
});

app.listen(process.env.PORT || 10000, () => {
  console.log("Finviz Diagnostic Server running on port 10000");
});
