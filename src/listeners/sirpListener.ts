import { Listener } from "@sapphire/framework";
import { Client, EmbedBuilder, Events } from "discord.js";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

type SirpCategory = {
  key: string;
  label: string;
  pageUrl: string;
  feedUrl: string;
};

type SirpArticle = {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  categoryKey: string;
  categoryLabel: string;
};

type SirpCheckOptions = {
  forcePostLatest?: boolean;
};

type SirpCheckResult = {
  ok: boolean;
  message: string;
  fetched: number;
  posted: number;
};

type SendableChannel = {
  send: (payload: { embeds: EmbedBuilder[] }) => Promise<unknown>;
};

const SIRP_CATEGORIES: SirpCategory[] = [
  {
    key: "kunst",
    label: "Kunst",
    pageUrl: "https://www.sirp.ee/category/kunst/",
    feedUrl: "https://www.sirp.ee/category/kunst/feed/",
  },
  {
    key: "teater",
    label: "Teater",
    pageUrl: "https://www.sirp.ee/category/teater/",
    feedUrl: "https://www.sirp.ee/category/teater/feed/",
  },
  {
    key: "muusika",
    label: "Muusika",
    pageUrl: "https://www.sirp.ee/category/muusika/",
    feedUrl: "https://www.sirp.ee/category/muusika/feed/",
  },
  {
    key: "kirjandus",
    label: "Kirjandus",
    pageUrl: "https://www.sirp.ee/category/kirjandus/",
    feedUrl: "https://www.sirp.ee/category/kirjandus/feed/",
  },
  {
    key: "film",
    label: "Film",
    pageUrl: "https://www.sirp.ee/category/film/",
    feedUrl: "https://www.sirp.ee/category/film/feed/",
  },
];

const SEEN_FILE = path.join(process.cwd(), "data", "sirp-kunst-seen.json");

const ENABLE_AUTOMATIC_CHECK = true;
const CHECK_INTERVAL_MINUTES = 300;
const POST_EXISTING_ON_FIRST_RUN = false;
const MAX_POSTS_PER_CHECK = 5;

const USER_AGENT = "Kiisukas-v-2 Discord bot (+https://www.sirp.ee/)";

let timer: NodeJS.Timeout | null = null;
let isChecking = false;

const parser = new Parser({
  headers: {
    "User-Agent": USER_AGENT,
  },
});

export class SirpKunstListener extends Listener {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.ClientReady,
      once: true,
    });
  }

  public run(client: Client) {
    if (!ENABLE_AUTOMATIC_CHECK) return;

    startSirpNews(client);
  }
}

function startSirpNews(client: Client) {
  if (timer) return;

  const intervalMs = Math.max(CHECK_INTERVAL_MINUTES, 5) * 60_000;

  void runSirpKunstCheck(client);

  timer = setInterval(() => {
    void runSirpKunstCheck(client);
  }, intervalMs);

  console.log(
    `[Sirp] Uudiste automaatne kontroll käivitatud (${CHECK_INTERVAL_MINUTES} min).`,
  );
}

export async function runSirpKunstCheck(
  client: Client,
  options: SirpCheckOptions = {},
): Promise<SirpCheckResult> {
  if (isChecking) {
    return {
      ok: false,
      message: "Sirbi kontroll juba käib. Proovi mõne sekundi pärast uuesti.",
      fetched: 0,
      posted: 0,
    };
  }

  isChecking = true;

  try {
    const channelId = process.env.SIRP_KUNST_CHANNEL_ID;

    if (!channelId) {
      return {
        ok: false,
        message: "SIRP_KUNST_CHANNEL_ID puudub .env failist.",
        fetched: 0,
        posted: 0,
      };
    }

    const channel = await client.channels.fetch(channelId);

    if (!isSendableChannel(channel)) {
      return {
        ok: false,
        message:
          "Sirbi kanalit ei leitud või kanal ei toeta sõnumite saatmist.",
        fetched: 0,
        posted: 0,
      };
    }

    const articles = await getSirpArticles();

    if (articles.length === 0) {
      return {
        ok: false,
        message: "Sirbi rubriikidest ei leitud ühtegi artiklit.",
        fetched: 0,
        posted: 0,
      };
    }

    const seen = await readSeen();

    if (options.forcePostLatest) {
      const latestArticle = articles[0];

      await postArticle(channel, latestArticle, true);

      for (const category of SIRP_CATEGORIES) {
        seen.add(categorySeenMarker(category.key));
      }

      for (const article of articles) {
        seen.add(seenArticleKey(article));
      }

      await writeSeen(seen);

      return {
        ok: true,
        message: `Testpostitus tehtud: ${latestArticle.categoryLabel} / ${latestArticle.title}`,
        fetched: articles.length,
        posted: 1,
      };
    }

    const newArticles: SirpArticle[] = [];
    let initializedCategories = 0;

    for (const category of SIRP_CATEGORIES) {
      const categoryArticles = articles.filter(
        (article) => article.categoryKey === category.key,
      );

      if (categoryArticles.length === 0) continue;

      const categoryInitialized = isCategoryInitialized(
        category,
        categoryArticles,
        seen,
      );

      if (!categoryInitialized && !POST_EXISTING_ON_FIRST_RUN) {
        for (const article of categoryArticles) {
          seen.add(seenArticleKey(article));
        }

        seen.add(categorySeenMarker(category.key));
        initializedCategories++;
        continue;
      }

      seen.add(categorySeenMarker(category.key));

      for (const article of categoryArticles) {
        if (!isArticleSeen(article, seen)) {
          newArticles.push(article);
        }
      }
    }

    if (initializedCategories > 0) {
      await writeSeen(seen);
    }

    if (newArticles.length === 0) {
      const initializedMessage =
        initializedCategories > 0
          ? ` Esmakordselt lisatud rubriike märgiti nähtuks: ${initializedCategories}.`
          : "";

      return {
        ok: true,
        message: `Fetch õnnestus. Uusi Sirbi artikleid ei ole. Kontrollitud artikleid: ${articles.length}.${initializedMessage}`,
        fetched: articles.length,
        posted: 0,
      };
    }

    newArticles.sort((a, b) => getArticleTime(b) - getArticleTime(a));

    const articlesToPost = newArticles.slice(0, MAX_POSTS_PER_CHECK).reverse();

    for (const article of articlesToPost) {
      await postArticle(channel, article, false);
      console.log(
        `[Sirp] Postitatud: ${article.categoryLabel} / ${article.title}`,
      );
    }

    for (const article of newArticles) {
      seen.add(seenArticleKey(article));
    }

    await writeSeen(seen);

    return {
      ok: true,
      message: `Postitasin ${articlesToPost.length} uut Sirbi artiklit.`,
      fetched: articles.length,
      posted: articlesToPost.length,
    };
  } catch (error) {
    console.error("[Sirp] Uudiste kontroll ebaõnnestus:", error);

    return {
      ok: false,
      message:
        "Sirbi kontroll ebaõnnestus. Vaata täpsemat errorit terminalist.",
      fetched: 0,
      posted: 0,
    };
  } finally {
    isChecking = false;
  }
}

async function postArticle(
  channel: SendableChannel,
  article: SirpArticle,
  isTestPost: boolean,
) {
  const embed = new EmbedBuilder()
    .setColor(0x71368a)
    .setTitle(article.title)
    .setURL(article.link)
    .setDescription(
      article.description || `Uus Sirbi ${article.categoryLabel} artikkel.`,
    )
    .addFields({
      name: "Allikas",
      value: `Sirp / ${article.categoryLabel}`,
      inline: true,
    })
    .setFooter({
      text: isTestPost ? "Testpostitus" : "Sirbi automaatpostitus",
    });

  const timestamp = article.pubDate ? new Date(article.pubDate) : new Date();

  embed.setTimestamp(
    Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
  );

  await channel.send({ embeds: [embed] });
}

async function getSirpArticles(): Promise<SirpArticle[]> {
  const allArticles: SirpArticle[] = [];

  for (const category of SIRP_CATEGORIES) {
    try {
      const articles = await getSirpCategoryArticles(category);
      allArticles.push(...articles);
    } catch (error) {
      console.warn(
        `[Sirp] Rubriigi "${category.label}" lugemine ebaõnnestus:`,
        error,
      );
    }
  }

  const deduplicatedArticles = new Map<string, SirpArticle>();

  for (const article of allArticles) {
    const key = articleKey(article.link);

    if (!deduplicatedArticles.has(key)) {
      deduplicatedArticles.set(key, article);
    }
  }

  return Array.from(deduplicatedArticles.values()).sort(
    (a, b) => getArticleTime(b) - getArticleTime(a),
  );
}

async function getSirpCategoryArticles(
  category: SirpCategory,
): Promise<SirpArticle[]> {
  try {
    return await getArticlesFromRss(category);
  } catch (error) {
    console.warn(
      `[Sirp] RSS lugemine ebaõnnestus rubriigis "${category.label}", proovin HTML lehte:`,
      error,
    );

    return await getArticlesFromHtml(category);
  }
}

async function getArticlesFromRss(
  category: SirpCategory,
): Promise<SirpArticle[]> {
  const feed = await parser.parseURL(category.feedUrl);

  return feed.items
    .filter((item) => item.title && item.link)
    .map((item) => ({
      title: cleanText(item.title ?? ""),
      link: item.link ?? "",
      description: cleanText(
        item.contentSnippet ||
          item.summary ||
          item.content ||
          `Uus Sirbi ${category.label} artikkel.`,
      ).slice(0, 500),
      pubDate: item.isoDate || item.pubDate,
      categoryKey: category.key,
      categoryLabel: category.label,
    }));
}

async function getArticlesFromHtml(
  category: SirpCategory,
): Promise<SirpArticle[]> {
  const html = await fetchText(category.pageUrl);
  const $ = cheerio.load(html);

  const articles: SirpArticle[] = [];
  const usedLinks = new Set<string>();

  $("h2 a, h3 a, article a").each((_, element) => {
    const title = cleanText($(element).text());
    const href = $(element).attr("href");

    if (!title || !href) return;

    const link = new URL(href, category.pageUrl).toString();
    const key = articleKey(link);

    if (!link.includes("sirp.ee")) return;
    if (usedLinks.has(key)) return;
    if (title.length < 4) return;

    usedLinks.add(key);

    articles.push({
      title,
      link,
      description: `Uus Sirbi ${category.label} artikkel.`,
      categoryKey: category.key,
      categoryLabel: category.label,
    });
  });

  return articles.slice(0, 20);
}

async function readSeen(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(SEEN_FILE, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) return new Set();

    return new Set(data.filter((value) => typeof value === "string"));
  } catch {
    return new Set();
  }
}

async function writeSeen(seen: Set<string>) {
  await fs.mkdir(path.dirname(SEEN_FILE), { recursive: true });

  const values = Array.from(seen);
  const markers = values.filter(isCategorySeenMarker);
  const articleKeys = values.filter((value) => !isCategorySeenMarker(value));
  const latest = Array.from(new Set([...markers, ...articleKeys.slice(-500)]));

  await fs.writeFile(SEEN_FILE, JSON.stringify(latest, null, 2), "utf8");
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return (
    typeof channel === "object" &&
    channel !== null &&
    "send" in channel &&
    typeof (channel as SendableChannel).send === "function"
  );
}

function isCategoryInitialized(
  category: SirpCategory,
  articles: SirpArticle[],
  seen: Set<string>,
) {
  if (seen.has(categorySeenMarker(category.key))) return true;

  if (articles.some((article) => seen.has(seenArticleKey(article)))) {
    return true;
  }

  // Tagasiühilduvus vana failiga, kus Kunsti lingid olid salvestatud ilma rubriigi prefiksita.
  if (
    category.key === "kunst" &&
    (seen.size > 0 ||
      articles.some((article) => seen.has(articleKey(article.link))))
  ) {
    return true;
  }

  return false;
}

function isArticleSeen(article: SirpArticle, seen: Set<string>) {
  return (
    seen.has(seenArticleKey(article)) ||
    // Tagasiühilduvus vana formaadiga.
    seen.has(articleKey(article.link))
  );
}

function seenArticleKey(article: SirpArticle) {
  return `${article.categoryKey}:${articleKey(article.link)}`;
}

function categorySeenMarker(categoryKey: string) {
  return `__category_initialized:${categoryKey}`;
}

function isCategorySeenMarker(value: string) {
  return value.startsWith("__category_initialized:");
}

function articleKey(link: string) {
  return link.split("#")[0].replace(/\/$/, "").toLowerCase();
}

function cleanText(value: string) {
  return cheerio.load(value).text().replace(/\s+/g, " ").trim();
}

function getArticleTime(article: SirpArticle) {
  if (!article.pubDate) return 0;

  const time = new Date(article.pubDate).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function fetchText(url: string, redirectsLeft = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;

    const request = client.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          response.headers.location &&
          redirectsLeft > 0
        ) {
          response.resume();

          const nextUrl = new URL(response.headers.location, url).toString();
          resolve(fetchText(nextUrl, redirectsLeft - 1));
          return;
        }

        if (statusCode >= 400) {
          response.resume();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }

        response.setEncoding("utf8");

        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          resolve(body);
        });
      },
    );

    request.setTimeout(15_000, () => {
      request.destroy(new Error("Request timeout"));
    });

    request.on("error", reject);
  });
}
