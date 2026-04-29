import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  Message,
  type ButtonInteraction,
  type TextBasedChannel,
} from "discord.js";
import path, { basename } from "path";
import { existsSync } from "fs";
import { PointsService } from "../services/points.service";
import SheetsService, { TriviaQuestion } from "../services/sheets.service";

interface MultipleChoiceOption {
  label: string;
  isCorrect: boolean;
}

interface MultipleChoiceQuestion {
  title: string;
  description: string;
  correctAnswer: string;
  options: MultipleChoiceOption[];
  points: number;
}

interface ParsedCustomId {
  sessionId: string;
  optionIndex: number;
}

interface LocalImageAttachment {
  filePath: string;
  fileName: string;
  embedUrl: string;
}

interface QuestionMessageOptions {
  interaction: Command.ChatInputCommandInteraction;
  channel: TextBasedChannel;
  triviaQuestion: TriviaQuestion;
  question: MultipleChoiceQuestion;
  components: ActionRowBuilder<ButtonBuilder>[];
  isInitial: boolean;
}

@ApplyOptions<Command.Options>({
  name: "pildimäng",
  description: "Alusta trivia mängu piltidega",
})
export class PictureGameCommand extends Command {
  private readonly activeGameChannelIds = new Set<string>();
  private readonly gameLoopControllers = new Map<string, AbortController>();

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    );
  }

  public async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    const validationError = this.validateInteraction(interaction);

    if (validationError) {
      await interaction.reply({
        content: validationError,
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const channel = interaction.channel;
    const channelId = interaction.channelId;

    if (!guild || !channel?.isTextBased()) {
      await interaction.reply({
        content: "Selles kanalis ei saa pildimängu käivitada.",
        ephemeral: true,
      });
      return;
    }

    if (this.activeGameChannelIds.has(channelId)) {
      await interaction.reply({
        content: "Pildimäng juba käib.",
        ephemeral: true,
      });
      return;
    }

    this.activeGameChannelIds.add(channelId);

    const abortController = new AbortController();
    this.gameLoopControllers.set(channelId, abortController);

    let deferred = false;

    try {
      await interaction.deferReply();
      deferred = true;

      const allQuestions = await SheetsService.getTriviaQuestions();

      if (allQuestions.length === 0) {
        await this.sendEphemeralAfterPublicDefer(
          interaction,
          "Küsimusi ei leitud.",
        );
        return;
      }

      await this.gameLoop({
        interaction,
        channel,
        guildId: guild.id,
        allQuestions,
        abortSignal: abortController.signal,
      });
    } catch (error) {
      this.logError("Picture game failed:", error);

      if (deferred) {
        await this.sendEphemeralAfterPublicDefer(
          interaction,
          "Pildimängu ei õnnestunud käivitada. Proovi natuke hiljem uuesti.",
        );
      }
    } finally {
      this.activeGameChannelIds.delete(channelId);
      this.gameLoopControllers.delete(channelId);
    }
  }

  private validateInteraction(
    interaction: Command.ChatInputCommandInteraction,
  ): string | null {
    if (!interaction.guild) {
      return "Seda käsku saab kasutada ainult serveris.";
    }

    if (!interaction.channel?.isTextBased()) {
      return "Selles kanalis ei saa pildimängu käivitada.";
    }

    const allowedChannelId = process.env.PICTURE_GAME_CHANNEL_ID;

    if (allowedChannelId && interaction.channelId !== allowedChannelId) {
      return "Kasuta seda käsku kanalis #pildimäng.";
    }

    return null;
  }

  private async gameLoop(options: {
    interaction: Command.ChatInputCommandInteraction;
    channel: TextBasedChannel;
    guildId: string;
    allQuestions: TriviaQuestion[];
    abortSignal: AbortSignal;
  }): Promise<void> {
    const { interaction, channel, guildId, allQuestions, abortSignal } =
      options;

    let questionIndex = 0;
    let isInitialMessage = true;

    while (!abortSignal.aborted) {
      const triviaQuestion = allQuestions[questionIndex];
      const question = this.createQuestion(triviaQuestion);
      const sessionId = this.createSessionId();
      const row = this.buildButtonRow(question, sessionId);

      const message = await this.sendQuestionMessage({
        interaction,
        channel,
        triviaQuestion,
        question,
        components: [row],
        isInitial: isInitialMessage,
      });

      isInitialMessage = false;

      const correctUserIds = await this.collectAnswers({
        message,
        guildId,
        sessionId,
        question,
        abortSignal,
      });

      await this.disableMessageButtons(message, row);
      await this.sendRoundFinishedMessage(channel, correctUserIds.size);
      await this.delay(3000, abortSignal);

      questionIndex = (questionIndex + 1) % allQuestions.length;
    }
  }

  private createQuestion(
    triviaQuestion: TriviaQuestion,
  ): MultipleChoiceQuestion {
    return {
      title: "Trivia - vasta küsimusele",
      description: triviaQuestion.question,
      correctAnswer: triviaQuestion.correctAnswer,
      options: this.generateMultipleChoice({
        correctAnswer: triviaQuestion.correctAnswer,
        wrongAnswers: triviaQuestion.wrongAnswers,
        count: 4,
      }),
      points: 0.5,
    };
  }

  private generateMultipleChoice(options: {
    correctAnswer: string;
    wrongAnswers: string[];
    count: number;
  }): MultipleChoiceOption[] {
    const { correctAnswer, wrongAnswers, count } = options;
    const wrongAnswerCount = Math.max(count - 1, 0);
    const normalizedCorrectAnswer = this.normalizeAnswer(correctAnswer);

    const selectedWrongAnswers = this.shuffleArray(
      this.uniqueByNormalizedAnswer(wrongAnswers).filter(
        (answer) => this.normalizeAnswer(answer) !== normalizedCorrectAnswer,
      ),
    ).slice(0, wrongAnswerCount);

    return this.shuffleArray([
      {
        label: correctAnswer,
        isCorrect: true,
      },
      ...selectedWrongAnswers.map((answer) => ({
        label: answer,
        isCorrect: false,
      })),
    ]);
  }

  private async sendQuestionMessage(
    options: QuestionMessageOptions,
  ): Promise<Message> {
    const imageAttachment = this.resolveLocalImageAttachment(
      options.triviaQuestion.imageUrl,
    );

    const embed = this.buildQuestionEmbed(
      options.question,
      imageAttachment?.embedUrl ?? null,
    );

    const files = imageAttachment
      ? [
          new AttachmentBuilder(imageAttachment.filePath, {
            name: imageAttachment.fileName,
          }),
        ]
      : [];

    const payload = {
      embeds: [embed],
      components: options.components,
      files,
    };

    if (options.isInitial) {
      await options.interaction.editReply(payload);
      return (await options.interaction.fetchReply()) as Message;
    }

    return await options.channel.send(payload);
  }

  private async collectAnswers(options: {
    message: Message;
    guildId: string;
    sessionId: string;
    question: MultipleChoiceQuestion;
    abortSignal: AbortSignal;
  }): Promise<Set<string>> {
    const { message, guildId, sessionId, question, abortSignal } = options;

    const correctUserIds = new Set<string>();
    const answeredUserIds = new Set<string>();

    const timeLimitMs = 30_000;
    const startedAt = Date.now();

    while (!abortSignal.aborted) {
      const timeLeft = Math.max(timeLimitMs - (Date.now() - startedAt), 0);

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

        if (!parsedCustomId || parsedCustomId.sessionId !== sessionId) {
          await buttonInteraction.reply({
            content: "See nupp ei kuulu enam aktiivse mängu juurde.",
            ephemeral: true,
          });
          continue;
        }

        const userId = buttonInteraction.user.id;

        if (answeredUserIds.has(userId)) {
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

        answeredUserIds.add(userId);

        if (selectedOption.isCorrect) {
          correctUserIds.add(userId);
        }

        await this.replyToAnswer({
          buttonInteraction,
          guildId,
          userId,
          question,
          isCorrect: selectedOption.isCorrect,
        });
      } catch {
        break;
      }
    }

    return correctUserIds;
  }

  private async replyToAnswer(options: {
    buttonInteraction: ButtonInteraction;
    guildId: string;
    userId: string;
    question: MultipleChoiceQuestion;
    isCorrect: boolean;
  }): Promise<void> {
    const pointChange = options.isCorrect
      ? options.question.points
      : -options.question.points;

    const totalPoints = this.addAndGetPoints(
      options.guildId,
      options.userId,
      pointChange,
    );

    if (options.isCorrect) {
      await options.buttonInteraction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✓ Õige vastus!")
            .setDescription(
              [
                `+${this.formatPoints(options.question.points)} punkti`,
                `Sul on nüüd **${this.formatPoints(totalPoints)}** punkti.`,
              ].join("\n"),
            )
            .setColor("Green"),
        ],
        ephemeral: true,
      });
      return;
    }

    await options.buttonInteraction.reply({
      content: [
        "Vale vastus!",
        `-${this.formatPoints(options.question.points)} punkti`,
        `Sul on nüüd **${this.formatPoints(totalPoints)}** punkti.`,
      ].join("\n"),
      ephemeral: true,
    });
  }

  private async sendRoundFinishedMessage(
    channel: TextBasedChannel,
    correctAnswerCount: number,
  ): Promise<void> {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Mäng läbi!")
          .setDescription(`Õigeid vastuseid: **${correctAnswerCount}**`)
          .setColor("Gold"),
      ],
    });
  }

  private buildQuestionEmbed(
    question: MultipleChoiceQuestion,
    imageSource: string | null,
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
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
      .setColor("Blue");

    if (imageSource) {
      embed.setImage(imageSource);
    }

    return embed;
  }

  private buildButtonRow(
    question: MultipleChoiceQuestion,
    sessionId: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons = question.options.map((option, index) =>
      new ButtonBuilder()
        .setCustomId(this.buildQuestionCustomId(sessionId, index))
        .setLabel(this.formatButtonLabel(option.label))
        .setStyle(ButtonStyle.Primary),
    );

    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }

  private buildQuestionCustomId(sessionId: string, optionIndex: number) {
    return `pg:${sessionId}:${optionIndex}`;
  }

  private parseQuestionCustomId(customId: string): ParsedCustomId | null {
    const parts = customId.split(":");

    if (parts.length !== 3) {
      return null;
    }

    const [prefix, sessionId, optionIndexRaw] = parts;

    if (prefix !== "pg" && prefix !== "trivia") {
      return null;
    }

    const optionIndex = Number(optionIndexRaw);

    if (!sessionId || !Number.isInteger(optionIndex) || optionIndex < 0) {
      return null;
    }

    return {
      sessionId,
      optionIndex,
    };
  }

  private async disableMessageButtons(
    message: Message,
    row: ActionRowBuilder<ButtonBuilder>,
  ): Promise<void> {
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

  private resolveLocalImageAttachment(
    rawImagePath: string | null | undefined,
  ): LocalImageAttachment | null {
    const imagePath = String(rawImagePath ?? "").trim();

    if (!imagePath || this.isRemoteUrl(imagePath)) {
      return null;
    }

    const imageFilePath = this.findLocalImageFile(imagePath);

    if (!imageFilePath) {
      this.logError(`Image file not found: ${imagePath}`, null);
      return null;
    }

    const fileName = "pilt.png";

    return {
      filePath: imageFilePath,
      fileName,
      embedUrl: `attachment://${fileName}`,
    };
  }

  private findLocalImageFile(imagePath: string): string | null {
    for (const candidatePath of this.getLocalImagePathCandidates(imagePath)) {
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    return null;
  }

  private getLocalImagePathCandidates(imagePath: string): string[] {
    const fileName = basename(imagePath);
    const fileNameWithoutExtension = fileName.replace(/\.[^.]+$/, "");

    const possibleFileNames = [
      fileName,
      `${fileNameWithoutExtension}.png`,
      `${fileNameWithoutExtension}.jpg`,
      `${fileNameWithoutExtension}.jpeg`,
      `${fileNameWithoutExtension}.webp`,
    ];

    return Array.from(
      new Set([
        path.resolve(imagePath),
        path.join(process.cwd(), imagePath),
        ...possibleFileNames.flatMap((possibleFileName) => [
          path.join(process.cwd(), "pictures", possibleFileName),
          path.join(process.cwd(), "dist", "pictures", possibleFileName),
          path.join(process.cwd(), "..", "pictures", possibleFileName),
        ]),
      ]),
    );
  }

  private uniqueByNormalizedAnswer(values: string[]): string[] {
    const uniqueValues = new Map<string, string>();

    for (const value of values) {
      const trimmedValue = String(value ?? "").trim();
      const normalizedValue = this.normalizeAnswer(trimmedValue);

      if (!normalizedValue || uniqueValues.has(normalizedValue)) {
        continue;
      }

      uniqueValues.set(normalizedValue, trimmedValue);
    }

    return [...uniqueValues.values()];
  }

  private shuffleArray<T>(values: T[]): T[] {
    const shuffledValues = [...values];

    for (let index = shuffledValues.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffledValues[index], shuffledValues[randomIndex]] = [
        shuffledValues[randomIndex],
        shuffledValues[index],
      ];
    }

    return shuffledValues;
  }

  private formatButtonLabel(label: string): string {
    const normalizedLabel = label.replace(/\s+/g, " ").trim();

    if (!normalizedLabel) {
      return "Tundmatu";
    }

    if (normalizedLabel.length <= 80) {
      return normalizedLabel;
    }

    return `${normalizedLabel.slice(0, 77)}...`;
  }

  private createSessionId(): string {
    return `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private addAndGetPoints(guildId: string, userId: string, points: number) {
    PointsService.addPoints(guildId, userId, points);
    return PointsService.getPoints(guildId, userId);
  }

  private formatPoints(points: number): string {
    return Number.isInteger(points) ? points.toString() : points.toFixed(1);
  }

  private normalizeAnswer(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isRemoteUrl(value: string): boolean {
    return value.startsWith("http://") || value.startsWith("https://");
  }

  private async delay(ms: number, abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);

      abortSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });
  }

  private async sendEphemeralAfterPublicDefer(
    interaction: Command.ChatInputCommandInteraction,
    message: string,
  ): Promise<void> {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.deleteReply().catch(() => null);

        await interaction.followUp({
          content: message,
          ephemeral: true,
        });

        return;
      }

      await interaction.reply({
        content: message,
        ephemeral: true,
      });
    } catch (error) {
      this.logError("Failed to send ephemeral error message:", error);
    }
  }

  private logError(message: string, error: unknown): void {
    console.error(message, error);
  }
}
