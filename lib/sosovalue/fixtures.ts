import type {
  CurrencyListResponse,
  NewsFeaturedResponse,
  EtfSummaryHistoryResponse,
  EtfListResponse,
} from "./types";

// Realistic seed data for development. Shapes mirror the live API exactly,
// including the `{code, message, data}` envelope and the camelCase fields on
// news items. Flip SONAR_DATA_SOURCE=live (with SOSOVALUE_API_KEY set) to swap.

const ASOF = "2026-04-23T20:30:00Z";

function daysAgo(n: number): string {
  const d = new Date(ASOF);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export const currencyListFixture: CurrencyListResponse = {
  code: 0,
  message: "success",
  data: [
    { currency_id: "1673723677362319866", symbol: "btc", name: "Bitcoin" },
    { currency_id: "1673723677362319867", symbol: "eth", name: "Ethereum" },
    { currency_id: "1673723677362319868", symbol: "sol", name: "Solana" },
    { currency_id: "1673723677362319869", symbol: "xrp", name: "XRP" },
    { currency_id: "1673723677362319870", symbol: "doge", name: "Dogecoin" },
    { currency_id: "1673723677362319871", symbol: "link", name: "Chainlink" },
    { currency_id: "1673723677362319872", symbol: "avax", name: "Avalanche" },
  ],
};

export const newsFeaturedFixture: NewsFeaturedResponse = {
  code: 0,
  msg: null,
  data: {
    pageNum: 1,
    pageSize: 5,
    totalPage: 1,
    total: 5,
    list: [
      {
        id: "n1",
        sourceLink: "https://sosovalue.com/news/btc-etf-streak",
        releaseTime: new Date(daysAgo(0) + "T14:12:00Z").getTime(),
        category: 1,
        matchedCurrencies: [
          { id: "1673723677362319866", name: "BTC", fullName: "BITCOIN" },
        ],
        tags: ["ETF", "BTC"],
        multilanguageContent: [
          {
            language: "en",
            title: "BTC spot ETFs log fifth straight day of positive net inflows",
            content: "<p>Net inflows extended into a fifth session...</p>",
          },
        ],
      },
      {
        id: "n2",
        sourceLink: "https://sosovalue.com/news/eth-etf-creations",
        releaseTime: new Date(daysAgo(1) + "T18:42:00Z").getTime(),
        category: 1,
        matchedCurrencies: [
          { id: "1673723677362319867", name: "ETH", fullName: "ETHEREUM" },
        ],
        tags: ["ETF", "ETH"],
        multilanguageContent: [
          {
            language: "en",
            title: "ETH ETF authorized participants signal fresh creation demand",
          },
        ],
      },
      {
        id: "n3",
        sourceLink: "https://sosovalue.com/news/sol-etf-s1",
        releaseTime: new Date(daysAgo(2) + "T12:05:00Z").getTime(),
        category: 1,
        matchedCurrencies: [
          { id: "1673723677362319868", name: "SOL", fullName: "SOLANA" },
        ],
        tags: ["ETF", "SOL"],
        multilanguageContent: [
          {
            language: "en",
            title: "SOL ETF S-1 filings clear SEC informal review hurdle",
          },
        ],
      },
      {
        id: "n4",
        sourceLink: "https://sosovalue.com/news/meme-rebalance",
        releaseTime: new Date(daysAgo(1) + "T09:15:00Z").getTime(),
        category: 2,
        matchedCurrencies: [
          { id: "1673723677362319870", name: "DOGE", fullName: "DOGECOIN" },
        ],
        tags: ["MEME", "DOGE"],
        multilanguageContent: [
          {
            language: "en",
            title: "Meme index rebalance pushes DOGE weight past SHIB",
          },
        ],
      },
      {
        id: "n5",
        sourceLink: "https://sosovalue.com/news/defi-tvl-ath",
        releaseTime: new Date(daysAgo(3) + "T21:55:00Z").getTime(),
        category: 2,
        matchedCurrencies: [
          { id: "1673723677362319867", name: "ETH", fullName: "ETHEREUM" },
        ],
        tags: ["DEFI", "TVL"],
        multilanguageContent: [
          {
            language: "en",
            title: "DeFi TVL crosses prior cycle high as stablecoin float expands",
          },
        ],
      },
    ],
  },
};

function flowSeries(
  base: number,
  drift: number,
  days = 30,
): EtfSummaryHistoryResponse["data"] {
  const out: EtfSummaryHistoryResponse["data"] = [];
  let cumulative = 0;
  for (let i = days - 1; i >= 0; i--) {
    const noise = Math.sin(i * 0.7) * base * 0.6;
    const net = Math.round(base + drift * (days - i) + noise);
    cumulative += net;
    out.push({
      date: daysAgo(i),
      total_net_inflow: net * 1_000_000,
      total_value_traded: net * 1_000_000 * 12,
      total_net_assets: cumulative * 1_000_000 + 50_000_000_000,
      cum_net_inflow: cumulative * 1_000_000,
    });
  }
  // Live API returns reverse-chronological. Match that.
  return out.reverse();
}

export function etfSummaryHistoryFixture(
  symbol: string,
): EtfSummaryHistoryResponse {
  const params =
    symbol === "BTC"
      ? { base: 180, drift: 5 }
      : symbol === "ETH"
      ? { base: 60, drift: 2 }
      : symbol === "SOL"
      ? { base: 25, drift: 1 }
      : { base: 10, drift: 0 };
  return {
    code: 0,
    message: "success",
    data: flowSeries(params.base, params.drift),
  };
}

export function etfListFixture(symbol: string): EtfListResponse {
  if (symbol === "BTC") {
    return {
      code: 0,
      message: "success",
      data: [
        { ticker: "IBIT", name: "iShares Bitcoin Trust", exchange: "NASDAQ" },
        { ticker: "FBTC", name: "Fidelity Wise Origin Bitcoin Fund", exchange: "CBOE" },
        { ticker: "GBTC", name: "Grayscale Bitcoin Trust", exchange: "NYSE" },
      ],
    };
  }
  if (symbol === "ETH") {
    return {
      code: 0,
      message: "success",
      data: [
        { ticker: "ETHA", name: "iShares Ethereum Trust", exchange: "NASDAQ" },
        { ticker: "FETH", name: "Fidelity Ethereum Fund", exchange: "CBOE" },
      ],
    };
  }
  return { code: 0, message: "success", data: [] };
}
