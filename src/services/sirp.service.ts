import * as cheerio from "cheerio";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export type SirpCategory = {
  key: string;
  label: string;
  pageUrl: string;
};

export type SirpArticle = {
  title: string;
  link: string;
  description?: string;
  thumbnailUrl?: string;
  author?: string;
  dateText?: string;
  pubDate?: string;
  categoryKey: string;
  categoryLabel: string;
};

export type SirpImage = {
  buffer: Buffer;
  contentType?: string;
};

export const SIRP_CATEGORIES: SirpCategory[] = [
  {
    key: "kunst",
    label: "Kunst",
    pageUrl: "https://www.sirp.ee/category/kunst/",
  },
  {
    key: "teater",
    label: "Teater",
    pageUrl: "https://www.sirp.ee/category/teater/",
  },
  {
    key: "muusika",
    label: "Muusika",
    pageUrl: "https://www.sirp.ee/category/muusika/",
  },
  {
    key: "kirjandus",
    label: "Kirjandus",
    pageUrl: "https://www.sirp.ee/category/kirjandus/",
  },
  {
    key: "film",
    label: "Film",
    pageUrl: "https://www.sirp.ee/category/film/",
  },
];

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2_500_000;
const USER_AGENT = "Kiisukas-v-2 Discord bot (+https://www.sirp.ee/)";

export async function getSirpArticles(): Promise<SirpArticle[]> {
  const results = await Promise.allSettled(
    SIRP_CATEGORIES.map((category) => getArticlesFromCategoryPage(category)),
  );

  const allArticles: SirpArticle[] = [];

  for (let index = 0; index < results.length; index++) {
    const category = SIRP_CATEGORIES[index];
    const result = results[index];

    if (result.status === "fulfilled") {
      allArticles.push(...result.value);
      console.log(
        `[Sirp] ${category.label}: ${result.value.length} artiklit rubriigilehelt.`,
      );
      continue;
    }

    console.warn(
      `[Sirp] ${category.label}: rubriigilehe lugemine ebaõnnestus:`,
      result.reason,
    );
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

export function articleKey(link: string) {
  return link.split("#")[0].replace(/\/$/, "").toLowerCase();
}

export function getArticleTime(article: SirpArticle) {
  if (!article.pubDate) return 0;

  const time = new Date(article.pubDate).getTime();

  return Number.isNaN(time) ? 0 : time;
}

export function getImageExtension(url: string, contentType?: string) {
  const contentTypeExtensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };

  if (contentType) {
    const extension = contentTypeExtensions[contentType.split(";")[0].trim()];

    if (extension) return extension;
  }

  const extension = new URL(url).pathname.match(/\.(jpe?g|png|gif|webp)$/i);

  return extension ? extension[0].toLowerCase() : ".jpg";
}

export function fetchSirpImage(url: string) {
  return fetchBinary(url, {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
  });
}

async function getArticlesFromCategoryPage(
  category: SirpCategory,
): Promise<SirpArticle[]> {
  const html = await fetchText(category.pageUrl);
  const $ = cheerio.load(html);
  const articles: SirpArticle[] = [];

  $("li.wp-block-post").each((_, element) => {
    const article = $(element);
    const titleLink = article.find("h2.wp-block-post-title a").first();
    const title = cleanText(titleLink.text());
    const link = titleLink.attr("href")?.trim();

    if (!title || !link) return;

    const categoryLabel =
      cleanText(article.find(".taxonomy-category a").first().text()) ||
      category.label;
    const description = cleanText(
      article
        .find(
          ".article-subtitle, .custom-excerpt, .wp-block-post-excerpt, .wp-block-post-excerpt__excerpt",
        )
        .first()
        .text(),
    );
    const author = cleanText(
      article.find(".wp-block-post-author-name .author-name a").first().text(),
    );
    const dateElement = article.find(".wp-block-post-date time").first();
    const dateText = cleanText(dateElement.text());
    const pubDate = dateElement.attr("datetime") || parseSirpDate(dateText);
    const thumbnailUrl = getArticleThumbnailUrl(article, category.pageUrl);

    articles.push({
      title,
      link: new URL(link, category.pageUrl).toString(),
      description: description.slice(0, 500),
      thumbnailUrl,
      author,
      dateText,
      pubDate,
      categoryKey: category.key,
      categoryLabel,
    });
  });

  return articles.slice(0, 20);
}

function getArticleThumbnailUrl(
  article: ReturnType<cheerio.CheerioAPI>,
  pageUrl: string,
) {
  const image = article.find(".wp-block-post-featured-image img").first();
  const src =
    image.attr("src") ||
    image.attr("data-src") ||
    image.attr("data-lazy-src") ||
    firstSrcSetUrl(image.attr("srcset"));

  if (!src) return undefined;

  return new URL(src, pageUrl).toString();
}

function firstSrcSetUrl(srcset?: string) {
  if (!srcset) return undefined;

  return srcset.split(",")[0]?.trim().split(/\s+/)[0];
}

function cleanText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSirpDate(dateText: string) {
  const match = cleanText(dateText).match(
    /^(\d{1,2})\.\s*([IVXLCDM]+)\s+(\d{4})$/i,
  );

  if (!match) return undefined;

  const day = Number(match[1]);
  const year = Number(match[3]);
  const month = romanMonthToNumber(match[2]);

  if (!day || !year || !month) return undefined;

  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString();
}

function romanMonthToNumber(month: string) {
  const months: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
    XI: 11,
    XII: 12,
  };

  return months[month.toUpperCase()];
}

function fetchText(url: string, redirectsLeft = 2): Promise<string> {
  return requestText(url, {
    accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    redirectsLeft,
  });
}

function fetchBinary(
  url: string,
  options: { accept: string; redirectsLeft?: number },
): Promise<SirpImage> {
  return requestBinary(url, {
    accept: options.accept,
    redirectsLeft: options.redirectsLeft ?? 2,
  });
}

function requestText(
  url: string,
  options: { accept: string; redirectsLeft: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    makeRequest(
      url,
      options,
      reject,
      (nextUrl) =>
        resolve(
          requestText(nextUrl, {
            accept: options.accept,
            redirectsLeft: options.redirectsLeft - 1,
          }),
        ),
      (response, finish, fail) => {
        response.setEncoding("utf8");

        let body = "";
        let receivedBytes = 0;

        response.on("data", (chunk: string) => {
          receivedBytes += Buffer.byteLength(chunk, "utf8");

          if (receivedBytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            fail(new Error(`Response too large: ${receivedBytes} bytes`));
            return;
          }

          body += chunk;
        });

        response.on("end", () => {
          finish(() => resolve(body));
        });
      },
    );
  });
}

function requestBinary(
  url: string,
  options: { accept: string; redirectsLeft: number },
): Promise<SirpImage> {
  return new Promise((resolve, reject) => {
    makeRequest(
      url,
      options,
      reject,
      (nextUrl) =>
        resolve(
          requestBinary(nextUrl, {
            accept: options.accept,
            redirectsLeft: options.redirectsLeft - 1,
          }),
        ),
      (response, finish, fail) => {
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        response.on("data", (chunk: Buffer) => {
          const bytes = new Uint8Array(
            chunk.buffer,
            chunk.byteOffset,
            chunk.byteLength,
          );

          receivedBytes += chunk.length;

          if (receivedBytes > MAX_RESPONSE_BYTES) {
            response.destroy();
            fail(new Error(`Response too large: ${receivedBytes} bytes`));
            return;
          }

          chunks.push(bytes);
        });

        response.on("end", () => {
          finish(() =>
            resolve({
              buffer: Buffer.concat(chunks as readonly Uint8Array[]),
              contentType: response.headers["content-type"],
            }),
          );
        });
      },
    );
  });
}

function makeRequest(
  url: string,
  options: { accept: string; redirectsLeft: number },
  reject: (reason?: unknown) => void,
  followRedirect: (nextUrl: string) => void,
  handleResponse: (
    response: http.IncomingMessage,
    finish: (callback: () => void) => void,
    fail: (error: Error) => void,
  ) => void,
) {
  const parsedUrl = new URL(url);
  const client = parsedUrl.protocol === "http:" ? http : https;

  let settled = false;
  let request: http.ClientRequest | null = null;

  const timeout = setTimeout(() => {
    fail(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
  }, REQUEST_TIMEOUT_MS);

  function finish(callback: () => void) {
    if (settled) return;

    settled = true;
    clearTimeout(timeout);
    callback();
  }

  function fail(error: Error) {
    if (request && !request.destroyed) {
      request.destroy();
    }

    finish(() => reject(error));
  }

  request = client.request(
    parsedUrl,
    {
      method: "GET",
      agent: false,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.accept,
        Connection: "close",
      },
    },
    (response) => {
      const statusCode = response.statusCode ?? 0;

      if (
        [301, 302, 303, 307, 308].includes(statusCode) &&
        response.headers.location &&
        options.redirectsLeft > 0
      ) {
        response.resume();

        const nextUrl = new URL(response.headers.location, url).toString();

        finish(() => {
          followRedirect(nextUrl);
        });

        return;
      }

      if (statusCode >= 400) {
        response.resume();
        fail(new Error(`HTTP ${statusCode}`));
        return;
      }

      response.on("error", (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      handleResponse(response, finish, fail);
    },
  );

  request.on("timeout", () => {
    fail(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
  });

  request.on("error", (error) => {
    if (settled) return;
    fail(error instanceof Error ? error : new Error(String(error)));
  });

  request.setTimeout(REQUEST_TIMEOUT_MS);
  request.end();
}
