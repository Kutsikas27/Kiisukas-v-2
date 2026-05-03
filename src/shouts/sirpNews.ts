import { container } from "@sapphire/framework";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import {
  SIRP_CATEGORIES,
  type SirpArticle,
  type SirpCategory,
  articleKey,
  fetchSirpImage,
  getArticleTime,
  getImageExtension,
  getSirpArticles,
} from "../services/sirp.service";

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
  send: (payload: {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
  }) => Promise<unknown>;
};

const CHECK_INTERVAL_MINUTES = 300;
const INITIAL_CHECK_DELAY_SECONDS = 600;
const POST_EXISTING_ON_FIRST_RUN = false;
const MAX_POSTS_PER_CHECK = 5;

let intervalTimer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let isChecking = false;
const initializedCategories = new Set<string>();
const seenArticleKeys = new Set<string>();

export const initSirpNewsShoutsService = () => {
  if (initialTimer || intervalTimer) return;

  const channelId = process.env.SIRP_KUNST_CHANNEL_ID;

  if (!channelId) {
    console.log("Sirbi kanal seadistamata");
    return;
  }

  const intervalMs = Math.max(CHECK_INTERVAL_MINUTES, 5) * 60_000;
  const initialDelayMs = Math.max(INITIAL_CHECK_DELAY_SECONDS, 60) * 1_000;

  initialTimer = setTimeout(() => {
    initialTimer = null;

    void runSirpNewsCheck();

    intervalTimer = setInterval(() => {
      void runSirpNewsCheck();
    }, intervalMs);
  }, initialDelayMs);

  console.log(
    `[Sirp] Uudiste automaatne kontroll käivitatud (${CHECK_INTERVAL_MINUTES} min). Esimene kontroll ${Math.round(
      initialDelayMs / 1_000,
    )}s pärast.`,
  );
};

export async function runSirpNewsCheck(
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

    const channel = await container.client.channels.fetch(channelId);

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
        ok: true,
        message:
          "Sirbi rubriigilehtedelt ei saadud praegu artikleid kätte. Bot jätkab tööd.",
        fetched: 0,
        posted: 0,
      };
    }

    if (options.forcePostLatest) {
      const latestArticle = articles[0];

      await postArticle(channel, latestArticle, true);

      for (const category of SIRP_CATEGORIES) {
        initializedCategories.add(category.key);
      }

      for (const article of articles) {
        seenArticleKeys.add(seenArticleKey(article));
      }

      return {
        ok: true,
        message: `Testpostitus tehtud: ${latestArticle.categoryLabel} / ${latestArticle.title}`,
        fetched: articles.length,
        posted: 1,
      };
    }

    const newArticles: SirpArticle[] = [];
    let newlyInitializedCategories = 0;

    for (const category of SIRP_CATEGORIES) {
      const categoryArticles = articles.filter(
        (article) => article.categoryKey === category.key,
      );

      if (categoryArticles.length === 0) continue;

      const categoryInitialized = isCategoryInitialized(category);

      if (!categoryInitialized && !POST_EXISTING_ON_FIRST_RUN) {
        for (const article of categoryArticles) {
          seenArticleKeys.add(seenArticleKey(article));
        }

        initializedCategories.add(category.key);
        newlyInitializedCategories++;
        continue;
      }

      initializedCategories.add(category.key);

      for (const article of categoryArticles) {
        if (!isArticleSeen(article)) {
          newArticles.push(article);
        }
      }
    }

    if (newArticles.length === 0) {
      const initializedMessage =
        newlyInitializedCategories > 0
          ? ` Esmakordselt lisatud rubriike märgiti nähtuks: ${newlyInitializedCategories}.`
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
      seenArticleKeys.add(seenArticleKey(article));
    }

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
        "Sirbi kontroll ebaõnnestus. Bot jätkab tööd, vaata täpsemat errorit terminalist.",
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
  const descriptionParts = [
    article.categoryLabel,
    article.description || `Uus Sirbi ${article.categoryLabel} artikkel.`,
    `[Loe edasi](${article.link})`,
  ];
  const footerParts = [article.author, article.dateText].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(0x71368a)
    .setTitle(article.title)
    .setURL(article.link)
    .setDescription(descriptionParts.join("\n\n"));

  if (footerParts.length > 0) {
    embed.setFooter({
      text: footerParts.join(" • "),
    });
  }

  const files: AttachmentBuilder[] = [];

  if (article.thumbnailUrl) {
    try {
      const image = await fetchSirpImage(article.thumbnailUrl);
      const filename = `sirp-thumbnail${getImageExtension(
        article.thumbnailUrl,
        image.contentType,
      )}`;

      files.push(new AttachmentBuilder(image.buffer, { name: filename }));
      embed.setImage(`attachment://${filename}`);
    } catch (error) {
      console.warn("[Sirp] Thumbnaili allalaadimine ebaõnnestus:", error);
      embed.setImage(article.thumbnailUrl);
    }
  }

  await channel.send({
    embeds: [embed],
    files: files.length > 0 ? files : undefined,
  });
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return (
    typeof channel === "object" &&
    channel !== null &&
    "send" in channel &&
    typeof (channel as SendableChannel).send === "function"
  );
}

function isCategoryInitialized(category: SirpCategory) {
  return initializedCategories.has(category.key);
}

function isArticleSeen(article: SirpArticle) {
  return seenArticleKeys.has(seenArticleKey(article));
}

function seenArticleKey(article: SirpArticle) {
  return `${article.categoryKey}:${articleKey(article.link)}`;
}
