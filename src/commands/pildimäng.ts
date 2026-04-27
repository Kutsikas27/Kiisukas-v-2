import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
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

type QuestionStage = "title" | "artist";

interface MultipleChoiceOption {
  label: string;
  isCorrect: boolean;
}

interface MultipleChoiceQuestion {
  stage: QuestionStage;
  title: string;
  description: string;
  correctAnswer: string;
  options: MultipleChoiceOption[];
  points: number;
}

interface StageResult {
  answeredUserIds: Set<string>;
  correctUserIds: Set<string>;
  wrongUserIds: Set<string>;
}

interface ParsedCustomId {
  sessionId: string;
  stage: QuestionStage;
  optionIndex: number;
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

      const allArtworks = await this.getFamousArtworks();
      const painting = this.selectRandomArtwork(allArtworks);
      const imageUrl = await this.getDiscordSafeImageUrl(painting.imageUrl);

      await this.playRound({
        interaction,
        channel,
        guildId: guild.id,
        painting,
        allArtworks,
        imageUrl,
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
    painting: PaintingGameArtwork;
    allArtworks: PaintingGameArtwork[];
    imageUrl: string;
  }) {
    const { interaction, channel, guildId, painting, allArtworks, imageUrl } =
      options;

    const sessionId = this.createSessionId();

    const titleQuestion = this.createQuestion({
      stage: "title",
      title: "Pildimäng - Maali nimi",
      description:
        "Arva ära selle kuulsa maali nimi, valides ühe vastusevariandi alt!",
      correctAnswer: painting.title,
      allAnswers: allArtworks.map((artwork) => artwork.title),
    });

    const titleRow = this.buildButtonRow(titleQuestion, sessionId);

    const titleMessage = await interaction.editReply({
      embeds: [this.buildQuestionEmbed(painting, imageUrl, titleQuestion)],
      components: [titleRow],
    });

    const titleResult = await this.collectStageAnswers({
      message: titleMessage,
      guildId,
      sessionId,
      question: titleQuestion,
    });

    await this.disableMessageButtons(titleMessage, titleRow);

    const artistQuestion = this.createQuestion({
      stage: "artist",
      title: "Pildimäng - Autor",
      description: "Nüüd arva ära selle maali autor!",
      correctAnswer: painting.artist,
      allAnswers: allArtworks.map((artwork) => artwork.artist),
    });

    const artistRow = this.buildButtonRow(artistQuestion, sessionId);

    const artistMessage = await channel.send({
      embeds: [this.buildQuestionEmbed(painting, imageUrl, artistQuestion)],
      components: [artistRow],
    });

    const artistResult = await this.collectStageAnswers({
      message: artistMessage,
      guildId,
      sessionId,
      question: artistQuestion,
    });

    await this.disableMessageButtons(artistMessage, artistRow);

    await channel.send({
      embeds: [
        this.buildFinalAnswerEmbed({
          painting,
          imageUrl,
          titleResult,
          artistResult,
        }),
      ],
    });
  }

  private createQuestion(options: {
    stage: QuestionStage;
    title: string;
    description: string;
    correctAnswer: string;
    allAnswers: string[];
  }): MultipleChoiceQuestion {
    const { stage, title, description, correctAnswer, allAnswers } = options;

    return {
      stage,
      title,
      description,
      correctAnswer,
      options: this.generateMultipleChoice(correctAnswer, allAnswers, 4),
      points: 0.5,
    };
  }

  private async collectStageAnswers(options: {
    message: Message;
    guildId: string;
    sessionId: string;
    question: MultipleChoiceQuestion;
  }): Promise<StageResult> {
    const { message, guildId, sessionId, question } = options;

    const result: StageResult = {
      answeredUserIds: new Set<string>(),
      correctUserIds: new Set<string>(),
      wrongUserIds: new Set<string>(),
    };

    const timeLimitMs = 30_000;
    const startedAt = Date.now();

    while (true) {
      const elapsed = Date.now() - startedAt;
      const timeLeft = Math.max(timeLimitMs - elapsed, 0);

      if (timeLeft <= 0) {
        break;
      }

      try {
        const buttonInteraction = await message.awaitMessageComponent({
          componentType: ComponentType.Button,
          time: timeLeft,
        });

        const parsedCustomId = this.parseQuestionCustomId(
          buttonInteraction.customId,
        );

        if (
          !parsedCustomId ||
          parsedCustomId.sessionId !== sessionId ||
          parsedCustomId.stage !== question.stage
        ) {
          await buttonInteraction.reply({
            content: "See nupp ei kuulu enam aktiivse mängu juurde.",
            ephemeral: true,
          });
          continue;
        }

        const currentUserId = buttonInteraction.user.id;

        if (result.answeredUserIds.has(currentUserId)) {
          await buttonInteraction.reply({
            content: "Sa oled juba sellele küsimusele vastanud!",
            ephemeral: true,
          });
          continue;
        }

        const selectedOption = question.options[parsedCustomId.optionIndex];

        if (!selectedOption) {
          await buttonInteraction.reply({
            content: "Seda vastusevarianti ei leitud.",
            ephemeral: true,
          });
          continue;
        }

        result.answeredUserIds.add(currentUserId);

        if (selectedOption.isCorrect) {
          result.correctUserIds.add(currentUserId);

          const points = this.addAndGetPoints(
            guildId,
            currentUserId,
            question.points,
          );

          await buttonInteraction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("✓ Õige vastus!")
                .setDescription(
                  [
                    `Õige vastus: **${question.correctAnswer}**`,
                    `+${this.formatPoints(question.points)} punkti`,
                    `Sul on nüüd **${this.formatPoints(points)}** punkti.`,
                  ].join("\n"),
                )
                .setColor("Green"),
            ],
            ephemeral: true,
          });

          continue;
        }

        result.wrongUserIds.add(currentUserId);

        const points = this.addAndGetPoints(
          guildId,
          currentUserId,
          -question.points,
        );

        await buttonInteraction.reply({
          content: [
            "Vale vastus!",
            `-${this.formatPoints(question.points)} punkti`,
            `Sul on nüüd **${this.formatPoints(points)}** punkti.`,
          ].join("\n"),
          ephemeral: true,
        });
      } catch {
        break;
      }
    }

    return result;
  }

  private buildQuestionEmbed(
    painting: PaintingGameArtwork,
    imageUrl: string,
    question: MultipleChoiceQuestion,
  ) {
    return new EmbedBuilder()
      .setTitle(question.title)
      .setDescription(
        [
          question.description,
          "",
          "Õige vastus = **+0.5 punkti**",
          "Vale vastus = **-0.5 punkti**",
          "Iga kasutaja saab vastata ühe korra.",
        ].join("\n"),
      )
      .setImage(imageUrl)
      .setColor("Blue");
  }

  private buildFinalAnswerEmbed(options: {
    painting: PaintingGameArtwork;
    imageUrl: string;
    titleResult: StageResult;
    artistResult: StageResult;
  }) {
    const { painting, imageUrl, titleResult, artistResult } = options;

    return new EmbedBuilder()
      .setTitle("Pildimäng läbi")
      .setURL(painting.sourceUrl)
      .setDescription(
        [
          `Õige vastus: **${painting.title}** — **${painting.artist}**`,
          "",
          `Maali nime arvas õigesti: **${titleResult.correctUserIds.size}**`,
          `Autori arvas õigesti: **${artistResult.correctUserIds.size}**`,
          "",
          `[Allikas](${painting.sourceUrl})`,
        ].join("\n"),
      )
      .setImage(imageUrl)
      .setColor("Gold");
  }

  private generateMultipleChoice(
    correctAnswer: string,
    allOptions: string[],
    count: number,
  ): MultipleChoiceOption[] {
    const normalizedCorrectAnswer = this.normalizeAnswer(correctAnswer);

    const wrongOptions = this.uniqueByNormalizedAnswer(allOptions)
      .filter((option) => {
        const normalizedOption = this.normalizeAnswer(option);

        return (
          normalizedOption.length > 0 &&
          normalizedOption !== normalizedCorrectAnswer
        );
      })
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(count - 1, 0));

    const choices: MultipleChoiceOption[] = [
      {
        label: correctAnswer,
        isCorrect: true,
      },
      ...wrongOptions.map((option) => ({
        label: option,
        isCorrect: false,
      })),
    ];

    return choices.sort(() => Math.random() - 0.5).slice(0, count);
  }

  private uniqueByNormalizedAnswer(values: string[]) {
    const uniqueValues = new Map<string, string>();

    for (const value of values) {
      const trimmedValue = value.trim();

      if (!trimmedValue) {
        continue;
      }

      const normalizedValue = this.normalizeAnswer(trimmedValue);

      if (!normalizedValue || uniqueValues.has(normalizedValue)) {
        continue;
      }

      uniqueValues.set(normalizedValue, trimmedValue);
    }

    return [...uniqueValues.values()];
  }

  private buildButtonRow(
    question: MultipleChoiceQuestion,
    sessionId: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons = question.options.slice(0, 4).map((option, index) =>
      new ButtonBuilder()
        .setCustomId(
          this.buildQuestionCustomId(sessionId, question.stage, index),
        )
        .setLabel(this.formatButtonLabel(option.label))
        .setStyle(ButtonStyle.Primary),
    );

    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }

  private buildQuestionCustomId(
    sessionId: string,
    stage: QuestionStage,
    optionIndex: number,
  ) {
    return `pg:${sessionId}:${stage}:${optionIndex}`;
  }

  private parseQuestionCustomId(customId: string): ParsedCustomId | null {
    const parts = customId.split(":");

    if (parts.length !== 4) {
      return null;
    }

    const [prefix, sessionId, stage, optionIndexRaw] = parts;

    if (prefix !== "pg") {
      return null;
    }

    if (stage !== "title" && stage !== "artist") {
      return null;
    }

    const optionIndex = Number(optionIndexRaw);

    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
      return null;
    }

    return {
      sessionId,
      stage,
      optionIndex,
    };
  }

  private async disableMessageButtons(
    message: Message,
    row: ActionRowBuilder<ButtonBuilder>,
  ) {
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      row.components.map((component) =>
        ButtonBuilder.from(component.toJSON()).setDisabled(true),
      ),
    );

    try {
      await message.edit({
        components: [disabledRow],
      });
    } catch (error) {
      this.logError("Failed to disable picture game buttons:", error);
    }
  }

  private formatButtonLabel(label: string) {
    const normalizedLabel = label.replace(/\s+/g, " ").trim();

    if (!normalizedLabel) {
      return "Tundmatu";
    }

    if (normalizedLabel.length <= 80) {
      return normalizedLabel;
    }

    return `${normalizedLabel.slice(0, 77)}...`;
  }

  private createSessionId() {
    return `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private addAndGetPoints(guildId: string, userId: string, points: number) {
    PointsService.addPoints(guildId, userId, points);
    return PointsService.getPoints(guildId, userId);
  }

  private formatPoints(points: number) {
    return Number.isInteger(points) ? points.toString() : points.toFixed(1);
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

  private selectRandomArtwork(
    artworks: PaintingGameArtwork[],
  ): PaintingGameArtwork {
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
    return url.replace(/^http:/, "https:");
  }

  private async getDiscordSafeImageUrl(imageUrl: string) {
    const normalizedUrl = this.normalizeImageUrl(imageUrl);

    if (!this.isCommonsSpecialFilePathUrl(normalizedUrl)) {
      return normalizedUrl;
    }

    const previewUrl = this.addCommonsPreviewWidth(normalizedUrl, 900);

    try {
      const response = await axios.head(previewUrl, {
        timeout: 10_000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          "User-Agent": this.userAgent,
          Accept: "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
        },
      });

      const location = response.headers.location;

      if (!location) {
        console.log("Wikimedia image URL did not redirect:", {
          original: imageUrl,
          preview: previewUrl,
          status: response.status,
        });

        return previewUrl;
      }

      const directUrl = this.normalizeRedirectLocation(previewUrl, location);

      console.log("Resolved artwork image URL:", {
        original: imageUrl,
        preview: previewUrl,
        direct: directUrl,
      });

      return directUrl;
    } catch (error) {
      this.logError("Failed to resolve Wikimedia image URL:", error);
      return previewUrl;
    }
  }

  private isCommonsSpecialFilePathUrl(url: string) {
    try {
      const parsedUrl = new URL(url);

      return (
        parsedUrl.hostname === "commons.wikimedia.org" &&
        parsedUrl.pathname.includes("/wiki/Special:FilePath/")
      );
    } catch {
      return false;
    }
  }

  private addCommonsPreviewWidth(url: string, width: number) {
    try {
      const parsedUrl = new URL(url);

      if (!parsedUrl.searchParams.has("width")) {
        parsedUrl.searchParams.set("width", width.toString());
      }

      return parsedUrl.toString();
    } catch {
      return url;
    }
  }

  private normalizeRedirectLocation(baseUrl: string, location: string) {
    if (location.startsWith("//")) {
      return `https:${location}`;
    }

    if (location.startsWith("/")) {
      const base = new URL(baseUrl);
      return `${base.origin}${location}`;
    }

    return location.replace(/^http:/, "https:");
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
          components: [],
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
