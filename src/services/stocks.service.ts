import axios from "axios";
type Quote = {
  symbol: string;
  shortName: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  group: string;
  volume: string;
  marketCap: string;
  exchange: string;
  articleTags: string[];
  updated: Date;
};
type QuoteResponse = {
  data: { quotes: Quote[] };
};
export const getEmbedDescription = (
  quotes: Quote[],
  market: string,
): string => {
  const description = quotes
    .filter((el) => el.group === market)
    .sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent)
    .map((item) => {
      const marketChangeRounded =
        Math.round(item.regularMarketChangePercent * 100) / 100;

      let emoji = "<:green:1101471005312024667>";

      if (marketChangeRounded === 0) emoji = "<:yellow:1101471020860313640>";
      if (marketChangeRounded < 0) emoji = "<:red:1101471038132465724>";

      return `${emoji}  ${item.shortName} • **${marketChangeRounded}** %`;
    })
    .join("\n");
  return description;
};

export const getStocks = async () => {
  const stockResponse = await axios.get<QuoteResponse>(
    "https://api.delfi.ee/finance-api/v1/query/quotes-with-chart",
  );
  return stockResponse.data.data.quotes;
};
