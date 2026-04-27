import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  type TextBasedChannel,
} from "discord.js";
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
      const allArtworks = await this.getFamousArtworks();

      await this.playRound({
        interaction,
        channel,
        guildId: guild.id,
        userId: interaction.user.id,
        painting,
        allArtworks,
      });

      return;
    } catch (error) {
      this.logError("Picture game failed:", error);

      await this.sendFailureMessage(interaction);

      return;
    } finally {
      this.activeGameChannelIds.delete(channelId);
    }
  }

  private async playRound(options: {
    interaction: Command.ChatInputCommandInteraction;
    channel: TextBasedChannel;
    guildId: string;
    userId: string;
    painting: PaintingGameArtwork;
    allArtworks: PaintingGameArtwork[];
  }) {
    const {
      interaction,
      channel,
      guildId,
      userId: initiatorId,
      painting,
      allArtworks,
    } = options;

    // Generate multiple choice options
    const titleOptions = this.generateMultipleChoice(
      painting.title,
      allArtworks.map((a) => a.title),
      4,
    );

    const artistOptions = this.generateMultipleChoice(
      painting.artist,
      allArtworks.map((a) => a.artist),
      4,
    );

    const embed = this.buildGameEmbed(painting);
    const titleButtons = this.buildButtonRow(titleOptions, "title");

    const message = await interaction.editReply({
      embeds: [embed],
      components: [titleButtons],
    });

    const timeLimit = 30_000;
    const startTime = Date.now();
    const usersWhoAnsweredTitle = new Set<string>();
    const usersWhoAnsweredArtist = new Set<string>();

    // TITLE STAGE - allow multiple users to answer once each
    const titleStageStartTime = Date.now();
    while (Date.now() - titleStageStartTime < timeLimit) {
      const timeLeft = Math.max(
        timeLimit - (Date.now() - titleStageStartTime),
        0,
      );

      if (timeLeft <= 0) {
        break;
      }

      try {
        const buttonInteraction = await message.awaitMessageComponent({
          time: timeLeft,
        });

        const currentUserId = buttonInteraction.user.id;

        // Check if this user already answered
        if (usersWhoAnsweredTitle.has(currentUserId)) {
          await buttonInteraction.reply({
            content: "Sa oled juba vastanud sellele küsimusele!",
            ephemeral: true,
          });
          continue;
        }

        usersWhoAnsweredTitle.add(currentUserId);

        const selectedOption = buttonInteraction.customId.split("_")[1];

        // Check title answer
        if (selectedOption === this.normalizeAnswer(painting.title)) {
          const points = this.addAndGetPoints(guildId, currentUserId, 0.5);

          const responseEmbed = new EmbedBuilder()
            .setTitle("✓ Õige vastus!")
            .setDescription(
              `Maali nimi: **${
                painting.title
              }**\n+0.5 punkti\nSul on nüüd **${this.formatPoints(
                points,
              )}** punkti`,
            )
            .setColor("Green");

          await buttonInteraction.reply({
            embeds: [responseEmbed],
            ephemeral: true,
          });
        } else {
          // Wrong answer - deduct 0.5 points
          const points = this.addAndGetPoints(guildId, currentUserId, -0.5);

          await buttonInteraction.reply({
            content: `Vale vastus! -0.5 punkti\nSul on nüüd **${this.formatPoints(
              points,
            )}** punkti`,
            ephemeral: true,
          });
        }
      } catch {
        // Timeout on title stage
        await channel.send({ embeds: [this.buildTimeoutEmbed()] });
        break;
      }
    }

    // ARTIST STAGE
    const artistButtonsRow = this.buildButtonRow(artistOptions, "artist");
    const artistMessage = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Pildimäng - Järgmine: Autor")
          .setDescription("Nüüd arva ära selle maali autor!")
          .setImage(painting.imageUrl)
          .setColor("Blue"),
      ],
      components: [artistButtonsRow],
    });

    const timeRemainingForArtist = timeLimit;
    const artistStageStartTime = Date.now();

    while (Date.now() - artistStageStartTime < timeRemainingForArtist) {
      const timeLeft = Math.max(
        timeRemainingForArtist - (Date.now() - artistStageStartTime),
        0,
      );

      if (timeLeft <= 0) {
        break;
      }

      try {
        const buttonInteraction = await artistMessage.awaitMessageComponent({
          time: timeLeft,
        });

        const currentUserId = buttonInteraction.user.id;

        // Check if this user already answered
        if (usersWhoAnsweredArtist.has(currentUserId)) {
          await buttonInteraction.reply({
            content: "Sa oled juba vastanud sellele küsimusele!",
            ephemeral: true,
          });
          continue;
        }

        usersWhoAnsweredArtist.add(currentUserId);

        const selectedArtist = buttonInteraction.customId.split("_")[1];

        // Check artist answer
        if (selectedArtist === this.normalizeAnswer(painting.artist)) {
          const totalPoints = this.addAndGetPoints(guildId, currentUserId, 0.5);

          const winEmbed = new EmbedBuilder()
            .setTitle("✓ Õige vastus!")
            .setDescription(
              `Autor: **${
                painting.artist
              }**\n+0.5 punkti\nSul on nüüd **${this.formatPoints(
                totalPoints,
              )}** punkti`,
            )
            .setColor("Gold");

          await buttonInteraction.reply({
            embeds: [winEmbed],
            ephemeral: true,
          });
        } else {
          // Wrong answer - deduct 0.5 points
          const points = this.addAndGetPoints(guildId, currentUserId, -0.5);

          await buttonInteraction.reply({
            content: `Vale vastus! -0.5 punkti\nSul on nüüd **${this.formatPoints(
              points,
            )}** punkti`,
            ephemeral: true,
          });
        }
      } catch {
        // Timeout on artist stage
        await channel.send({ embeds: [this.buildTimeoutEmbed()] });
        break;
      }
    }

    await this.disableMessageComponents(
      titleButtons,
      artistButtonsRow,
      message,
      artistMessage,
    );
  }

  private buildTimeoutEmbed() {
    return new EmbedBuilder()
      .setTitle("Aeg läbi")
      .setDescription("Mängu uuesti käivitamiseks kasuta käsku /pildimäng")
      .setColor("Red");
  }

  private async disableMessageComponents(
    titleRow: ActionRowBuilder<ButtonBuilder>,
    artistRow: ActionRowBuilder<ButtonBuilder>,
    titleMessage: Message,
    artistMessage: Message,
  ) {
    const disableRow = (row: ActionRowBuilder<ButtonBuilder>) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        row.components.map((component) =>
          ButtonBuilder.from(component as any).setDisabled(true),
        ),
      );

    try {
      await titleMessage.edit({ components: [disableRow(titleRow)] });
    } catch {
      // ignore if editing failed
    }

    try {
      await artistMessage.edit({ components: [disableRow(artistRow)] });
    } catch {
      // ignore if editing failed
    }
  }

  private buildGameEmbed(painting: PaintingGameArtwork) {
    return new EmbedBuilder()
      .setTitle("Pildimäng - Maali nimi")
      .setDescription(
        "Arva ära selle kuulsa maali nimi valides ühe vastusevariandi alt!",
      )
      .setImage(painting.imageUrl)
      .setColor("Blue");
  }

  private generateMultipleChoice(
    correctAnswer: string,
    allOptions: string[],
    count: number,
  ): string[] {
    // Filter out the correct answer and get unique options
    const uniqueOptions = [
      ...new Set(
        allOptions
          .filter((opt) => opt !== correctAnswer && opt.length > 0)
          .map((opt) => opt.substring(0, 80)), // Truncate to fit buttons
      ),
    ];

    if (uniqueOptions.length < count - 1) {
      // If not enough wrong answers, use what we have
      return [correctAnswer, ...uniqueOptions].slice(0, count);
    }

    // Randomly select wrong answers
    const wrongAnswers: string[] = [];
    const tempOptions = [...uniqueOptions];

    for (let i = 0; i < count - 1; i++) {
      if (tempOptions.length === 0) break;
      const idx = Math.floor(Math.random() * tempOptions.length);
      wrongAnswers.push(tempOptions[idx]);
      tempOptions.splice(idx, 1);
    }

    // Combine and shuffle
    const choices = [correctAnswer, ...wrongAnswers];
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }

    return choices;
  }

  private buildButtonRow(
    options: string[],
    type: "title" | "artist",
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons = options.map((option) => {
      const normalizedOption = this.normalizeAnswer(option);
      return new ButtonBuilder()
        .setCustomId(`${type}_${normalizedOption}`)
        .setLabel(option.substring(0, 80))
        .setStyle(ButtonStyle.Primary);
    });

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      buttons.slice(0, 4),
    );
  }

  private async runGuessRound(options: {
    channel: TextBasedChannel;
    guildId: string;
    userId: string;
    painting: PaintingGameArtwork;
  }): Promise<GuessRoundResult> {
    // This method is replaced by playRound
    return {
      titleGuessed: false,
      artistGuessed: false,
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
