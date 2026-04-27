import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder, Message, type TextBasedChannel } from "discord.js";
import axios from "axios";
import { PointsService } from "../services/points.service";

interface WikidataBindingValue {
  type: string;
  value: string;
}

interface WikidataFamousPaintingBinding {
  item?: WikidataBindingValue;
  itemLabel?: WikidataBindingValue;
  image?: WikidataBindingValue;
  catalogCode?: WikidataBindingValue;
  creatorLabel?: WikidataBindingValue;
}

interface WikidataSparqlResponse {
  head: {
    vars: string[];
  };
  results: {
    bindings: WikidataFamousPaintingBinding[];
  };
}

interface PaintingGameArtwork {
  id: string;
  title: string;
  artist: string;
  imageUrl: string;
  sourceUrl: string;
}

interface GuessCheckResult {
  titleCorrect: boolean;
  artistCorrect: boolean;
}

interface GuessRoundResult {
  titleGuessed: boolean;
  artistGuessed: boolean;
}

@ApplyOptions<Command.Options>({
  name: "pildimäng",
  description: "Alusta pildimängu, kus tuleb ära arvata kuulus maal või autor",
})
export class PictureGameCommand extends Command {
  private readonly activeGameChannelIds = new Set<string>();

  private readonly recentArtworkIds = new Set<string>();
  private readonly recentArtworkQueue: string[] = [];
  private readonly maxRecentArtworks = 50;

  private famousArtworkCache: PaintingGameArtwork[] = [];
  private famousArtworkCacheFetchedAt = 0;
  private readonly famousArtworkCacheTtlMs = 1000 * 60 * 60 * 24;

  private readonly wikidataSparqlUrl = "https://query.wikidata.org/sparql";

  private readonly userAgent =
    process.env.WIKIDATA_USER_AGENT ??
    "pildimang-discord-bot/1.0 (educational Discord art guessing game)";

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: "Seda käsku saab kasutada ainult serveris.",
        ephemeral: true,
      });
    }

    const channel = interaction.channel;

    if (!channel?.isTextBased()) {
      return interaction.reply({
        content: "Selles kanalis ei saa pildimängu käivitada.",
        ephemeral: true,
      });
    }

    const allowedChannelId = process.env.PICTURE_GAME_CHANNEL_ID;

    if (allowedChannelId && interaction.channelId !== allowedChannelId) {
      return interaction.reply({
        content: "Kasuta seda käsku kanalis #pildimäng.",
        ephemeral: true,
      });
    }

    const channelId = interaction.channelId;

    if (this.activeGameChannelIds.has(channelId)) {
      return interaction.reply({
        content: "Pildimäng juba käib.",
        ephemeral: true,
      });
    }

    this.activeGameChannelIds.add(channelId);

    try {
      await interaction.deferReply();

      const painting = await this.fetchRandomArtwork();
      const embed = this.buildGameEmbed(painting);

      await interaction.editReply({
        embeds: [embed],
      });

      const result = await this.runGuessRound({
        channel,
        guildId: guild.id,
        userId: interaction.user.id,
        painting,
      });

      if (!result.titleGuessed || !result.artistGuessed) {
        await channel.send(this.buildTimeoutMessage(painting, result));
      }

      return;
    } catch (error) {
      this.logError("Picture game failed:", error);

      await this.sendFailureMessage(interaction);

      return;
    } finally {
      this.activeGameChannelIds.delete(channelId);
    }
  }

  private buildGameEmbed(painting: PaintingGameArtwork) {
    return new EmbedBuilder()
      .setTitle("Pildimäng")
      .setDescription(
        [
          "Arva ära selle kuulsa maali nimi või autor!",
          "",
          "Maali nimi = **0.5 punkti**",
          "Autor = **0.5 punkti**",
          "Mõlemad samas sõnumis = **2 punkti**",
          "",
          `[Allikas](${painting.sourceUrl})`,
        ].join("\n"),
      )
      .setImage(painting.imageUrl)
      .setColor("Blue");
  }

  private async runGuessRound(options: {
    channel: TextBasedChannel;
    guildId: string;
    userId: string;
    painting: PaintingGameArtwork;
  }): Promise<GuessRoundResult> {
    const { channel, guildId, userId, painting } = options;

    let titleGuessed = false;
    let artistGuessed = false;

    const timeLimitMs = 30_000;
    const startTime = Date.now();

    const filter = (message: Message) =>
      message.author.id === userId && !message.author.bot;

    while (true) {
      const elapsed = Date.now() - startTime;
      const timeLeft = Math.max(timeLimitMs - elapsed, 0);

      if (timeLeft <= 0) {
        break;
      }

      const response = await this.awaitNextGuess(channel, filter, timeLeft);

      if (!response) {
        break;
      }

      const guess = this.checkGuess(response, painting);

      const guessedBothAtOnce =
        !titleGuessed &&
        !artistGuessed &&
        guess.titleCorrect &&
        guess.artistCorrect;

      if (guessedBothAtOnce) {
        const points = this.addAndGetPoints(guildId, userId, 2);

        await channel.send(
          `Täiuslik vastus! See oli "${painting.title}" — ${
            painting.artist
          }. Sa said 2 punkti. Sul on nüüd ${this.formatPoints(
            points,
          )} punkti.`,
        );

        return {
          titleGuessed: true,
          artistGuessed: true,
        };
      }

      let earnedPoints = 0;
      const newlyCorrectParts: string[] = [];

      if (!titleGuessed && guess.titleCorrect) {
        titleGuessed = true;
        earnedPoints += 0.5;
        newlyCorrectParts.push("maali nimi");
      }

      if (!artistGuessed && guess.artistCorrect) {
        artistGuessed = true;
        earnedPoints += 0.5;
        newlyCorrectParts.push("autor");
      }

      if (earnedPoints <= 0) {
        continue;
      }

      const points = this.addAndGetPoints(guildId, userId, earnedPoints);

      if (titleGuessed && artistGuessed) {
        await channel.send(
          `Õige! Leidsid nüüd mõlemad: "${painting.title}" — ${
            painting.artist
          }. Sa said seekord +${this.formatPoints(
            earnedPoints,
          )} punkti. Sul on nüüd ${this.formatPoints(points)} punkti.`,
        );

        return {
          titleGuessed,
          artistGuessed,
        };
      }

      const remainingHint = titleGuessed
        ? "Autor on veel puudu."
        : "Maali nimi on veel puudu.";

      await channel.send(
        `Õige: ${newlyCorrectParts.join(" ja ")}! +${this.formatPoints(
          earnedPoints,
        )} punkti. ${remainingHint} Sul on nüüd ${this.formatPoints(
          points,
        )} punkti.`,
      );
    }

    return {
      titleGuessed,
      artistGuessed,
    };
  }

  private async awaitNextGuess(
    channel: TextBasedChannel,
    filter: (message: Message) => boolean,
    timeLeftMs: number,
  ) {
    try {
      const collected = await channel.awaitMessages({
        filter,
        max: 1,
        time: timeLeftMs,
        errors: ["time"],
      });

      return collected.first()?.content ?? null;
    } catch {
      return null;
    }
  }

  private buildTimeoutMessage(
    painting: PaintingGameArtwork,
    result: GuessRoundResult,
  ) {
    const missingParts: string[] = [];

    if (!result.titleGuessed) {
      missingParts.push(`maali nimi oli "${painting.title}"`);
    }

    if (!result.artistGuessed) {
      missingParts.push(`autor oli ${painting.artist}`);
    }

    return `Aeg sai otsa! Õige vastus: "${painting.title}" — ${
      painting.artist
    }. Puudu jäi: ${missingParts.join(", ")}.`;
  }

  private addAndGetPoints(guildId: string, userId: string, points: number) {
    PointsService.addPoints(guildId, userId, points);
    return PointsService.getPoints(guildId, userId);
  }

  private checkGuess(
    response: string,
    painting: PaintingGameArtwork,
  ): GuessCheckResult {
    return {
      titleCorrect: this.answerContainsTitle(response, painting.title),
      artistCorrect: this.answerContainsArtist(response, painting.artist),
    };
  }

  private answerContainsTitle(input: string, title: string) {
    const normalizedInput = this.normalizeAnswer(input);
    const titleVariants = this.getTitleVariants(title);

    if (!normalizedInput || titleVariants.length === 0) {
      return false;
    }

    return titleVariants.some((variant) =>
      this.normalizedTextContainsPhrase(normalizedInput, variant),
    );
  }

  private answerContainsArtist(input: string, artist: string) {
    const normalizedInput = this.normalizeAnswer(input);
    const artistVariants = this.getArtistVariants(artist);

    if (!normalizedInput || artistVariants.length === 0) {
      return false;
    }

    return artistVariants.some((variant) =>
      this.normalizedTextContainsPhrase(normalizedInput, variant),
    );
  }

  private getTitleVariants(title: string) {
    const normalizedTitle = this.normalizeAnswer(title);

    if (!normalizedTitle) {
      return [];
    }

    const withoutLeadingArticle = normalizedTitle.replace(
      /^(the|a|an|la|le|les|el|il|lo|die|der|das)\s+/,
      "",
    );

    return this.uniqueNonEmpty([normalizedTitle, withoutLeadingArticle]);
  }

  private getArtistVariants(artist: string) {
    const normalizedArtist = this.normalizeAnswer(artist);

    if (!normalizedArtist) {
      return [];
    }

    const parts = normalizedArtist.split(" ").filter(Boolean);

    const lastName = parts.at(-1);
    const lastTwoNames = parts.length >= 2 ? parts.slice(-2).join(" ") : "";
    const lastThreeNames = parts.length >= 3 ? parts.slice(-3).join(" ") : "";

    return this.uniqueNonEmpty([
      normalizedArtist,
      lastName && lastName.length >= 4 ? lastName : "",
      lastTwoNames.length >= 4 ? lastTwoNames : "",
      lastThreeNames.length >= 4 ? lastThreeNames : "",
    ]);
  }

  private normalizedTextContainsPhrase(text: string, phrase: string) {
    if (!text || !phrase) {
      return false;
    }

    return ` ${text} `.includes(` ${phrase} `);
  }

  private normalizeAnswer(value: string) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private uniqueNonEmpty(values: Array<string | undefined>) {
    return [
      ...new Set(values.filter((value): value is string => Boolean(value))),
    ];
  }

  private formatPoints(points: number) {
    return Number.isInteger(points) ? points.toString() : points.toFixed(1);
  }

  private addRecentArtwork(id: string) {
    if (this.recentArtworkIds.has(id)) {
      return;
    }

    this.recentArtworkIds.add(id);
    this.recentArtworkQueue.push(id);

    if (this.recentArtworkQueue.length <= this.maxRecentArtworks) {
      return;
    }

    const oldest = this.recentArtworkQueue.shift();

    if (oldest) {
      this.recentArtworkIds.delete(oldest);
    }
  }

  private async fetchRandomArtwork(): Promise<PaintingGameArtwork> {
    const artworks = await this.getFamousArtworks();

    const unseenArtworks = artworks.filter(
      (artwork) => !this.recentArtworkIds.has(artwork.id),
    );

    const candidates = unseenArtworks.length > 0 ? unseenArtworks : artworks;
    const randomArtwork = this.getRandomItem(candidates);

    this.addRecentArtwork(randomArtwork.id);

    console.log(
      `Selected famous artwork: "${randomArtwork.title}" by ${randomArtwork.artist}, ID: ${randomArtwork.id}`,
    );

    return randomArtwork;
  }

  private async getFamousArtworks(): Promise<PaintingGameArtwork[]> {
    const now = Date.now();
    const cacheIsFresh =
      this.famousArtworkCache.length > 0 &&
      now - this.famousArtworkCacheFetchedAt < this.famousArtworkCacheTtlMs;

    if (cacheIsFresh) {
      return this.famousArtworkCache;
    }

    const artworks = await this.fetchFamousArtworksFromWikidata();

    if (artworks.length === 0) {
      throw new Error("Wikidata returned 0 famous paintings");
    }

    this.famousArtworkCache = artworks;
    this.famousArtworkCacheFetchedAt = now;

    console.log(`Fetched ${artworks.length} famous paintings from Wikidata`);

    return artworks;
  }

  private async fetchFamousArtworksFromWikidata(): Promise<
    PaintingGameArtwork[]
  > {
    const response = await axios.get<WikidataSparqlResponse>(
      this.wikidataSparqlUrl,
      {
        timeout: 30_000,
        params: {
          query: this.getFamousPaintingsSparqlQuery(),
          format: "json",
        },
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": this.userAgent,
        },
      },
    );

    const artworks = response.data.results.bindings
      .map((binding) => this.parseWikidataArtwork(binding))
      .filter((artwork): artwork is PaintingGameArtwork => artwork !== null);

    return this.deduplicateArtworks(artworks);
  }

  private parseWikidataArtwork(
    binding: WikidataFamousPaintingBinding,
  ): PaintingGameArtwork | null {
    const itemUrl = binding.item?.value;
    const title = binding.itemLabel?.value;
    const artist = binding.creatorLabel?.value;
    const imageUrl = binding.image?.value;

    if (!itemUrl || !title || !artist || !imageUrl) {
      return null;
    }

    return {
      id: this.getWikidataIdFromUrl(itemUrl),
      title,
      artist,
      imageUrl: this.normalizeImageUrl(imageUrl),
      sourceUrl: this.getWikidataSourceUrl(itemUrl),
    };
  }

  private deduplicateArtworks(artworks: PaintingGameArtwork[]) {
    const uniqueArtworks = new Map<string, PaintingGameArtwork>();

    for (const artwork of artworks) {
      if (!uniqueArtworks.has(artwork.id)) {
        uniqueArtworks.set(artwork.id, artwork);
      }
    }

    return [...uniqueArtworks.values()];
  }

  private getFamousPaintingsSparqlQuery() {
    return `
      SELECT DISTINCT ?item ?itemLabel ?creatorLabel ?image ?catalogCode WHERE {
        ?item p:P528 ?catalogStatement.
        ?catalogStatement ps:P528 ?catalogCode.
        ?catalogStatement pq:P972 wd:Q41634361.
        ?item wdt:P18 ?image.

        OPTIONAL {
          ?item wdt:P170 ?creator.
        }

        SERVICE wikibase:label {
          bd:serviceParam wikibase:language "en".
        }
      }
      LIMIT 250
    `;
  }

  private getWikidataIdFromUrl(url: string) {
    const match = url.match(/\/entity\/(Q\d+)$/);
    return match?.[1] ?? url;
  }

  private getWikidataSourceUrl(itemUrl: string) {
    const id = this.getWikidataIdFromUrl(itemUrl);
    return `https://www.wikidata.org/wiki/${id}`;
  }

  private normalizeImageUrl(url: string) {
    const secureUrl = url.replace(/^http:/, "https:");

    try {
      const parsedUrl = new URL(secureUrl);

      const isCommonsFilePath =
        parsedUrl.hostname === "commons.wikimedia.org" &&
        parsedUrl.pathname.includes("/wiki/Special:FilePath/");

      if (isCommonsFilePath && !parsedUrl.searchParams.has("width")) {
        parsedUrl.searchParams.set("width", "900");
      }

      return parsedUrl.toString();
    } catch {
      return secureUrl;
    }
  }

  private getRandomItem<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot select random item from empty array");
    }

    return items[Math.floor(Math.random() * items.length)];
  }

  private async sendFailureMessage(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const message =
      "Pildimängu ei õnnestunud käivitada. Proovi natuke hiljem uuesti.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: message,
          embeds: [],
        });

        return;
      }

      await interaction.reply({
        content: message,
        ephemeral: true,
      });
    } catch (error) {
      this.logError("Failed to send picture game failure message:", error);
    }
  }

  private logError(message: string, error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error(message, {
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url,
        method: error.config?.method,
      });

      return;
    }

    console.error(message, error);
  }
}
