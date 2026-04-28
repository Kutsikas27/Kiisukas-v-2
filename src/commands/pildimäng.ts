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

    const abortController = new AbortController();
    this.gameLoopControllers.set(channelId, abortController);

    try {
      await interaction.deferReply();

      const allQuestions = await SheetsService.getTriviaQuestions();

      if (allQuestions.length === 0) {
        await interaction.editReply({
          content: "Küsimusi ei leitud.",
        });
        return;
      }

      await this.gameLoop({
        interaction,
        channel,
        guildId: guild.id,
        allQuestions,
        abortSignal: abortController.signal,
      });

      return;
    } catch (error) {
      this.logError("Picture game failed:", error);

      await this.sendFailureMessage(interaction);

      return;
    } finally {
      this.activeGameChannelIds.delete(channelId);
      this.gameLoopControllers.delete(channelId);
    }
  }

  private async gameLoop(options: {
    interaction: Command.ChatInputCommandInteraction;
    channel: TextBasedChannel;
    guildId: string;
    allQuestions: TriviaQuestion[];
    abortSignal: AbortSignal;
  }) {
    const { interaction, channel, guildId, allQuestions, abortSignal } =
      options;

    if (abortSignal.aborted || allQuestions.length === 0) {
      return;
    }

    const questionIndex = Math.floor(Math.random() * allQuestions.length);
    const triviaQuestion = allQuestions[questionIndex];

    const question = this.createQuestion({
      title: "Trivia - Vastusta küsimus",
      description: triviaQuestion.question,
      correctAnswer: triviaQuestion.correctAnswer,
      allAnswers: [
        triviaQuestion.correctAnswer,
        ...triviaQuestion.wrongAnswers,
      ],
    });

    const sessionId = this.createSessionId();
    const row = this.buildButtonRow(question, sessionId);

    const message = await this.sendMessageWithImage(interaction, {
      embeds: [this.buildQuestionEmbed(triviaQuestion, question)],
      components: [row],
      isInitial: true,
      imagePath: triviaQuestion.imageUrl,
    });

    const correctUserIds = await this.collectAnswers({
      message,
      guildId,
      sessionId,
      question,
      abortSignal,
    });

    await this.disableMessageButtons(message, row);

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Õige vastus!")
          .setDescription(
            `Õige vastus: **${triviaQuestion.correctAnswer}**\n\nÕigeid vastajad: **${correctUserIds.size}**`,
          )
          .setColor("Gold"),
      ],
    });
  }

  private createQuestion(options: {
    title: string;
    description: string;
    correctAnswer: string;
    allAnswers: string[];
  }): MultipleChoiceQuestion {
    const { title, description, correctAnswer, allAnswers } = options;

    return {
      title,
      description,
      correctAnswer,
      options: this.generateMultipleChoice(correctAnswer, allAnswers, 4),
      points: 0.5,
    };
  }

  private async sendMessageWithImage(
    interaction: Command.ChatInputCommandInteraction,
    options: {
      embeds: EmbedBuilder[];
      components: ActionRowBuilder<ButtonBuilder>[];
      isInitial: boolean;
      imagePath: string;
    },
  ) {
    const files = this.getImageFiles(options.imagePath);

    if (options.isInitial) {
      await interaction.editReply({
        embeds: options.embeds,
        components: options.components,
        files,
      });

      return (await interaction.fetchReply()) as Message;
    }

    return null as any;
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

        if (!parsedCustomId || parsedCustomId.sessionId !== sessionId) {
          await buttonInteraction.reply({
            content: "See nupp ei kuulu enam aktiivse mängu juurde.",
            ephemeral: true,
          });
          continue;
        }

        const currentUserId = buttonInteraction.user.id;

        if (answeredUserIds.has(currentUserId)) {
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

        answeredUserIds.add(currentUserId);

        if (selectedOption.isCorrect) {
          correctUserIds.add(currentUserId);

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

    return correctUserIds;
  }

  private buildQuestionEmbed(
    triviaQuestion: TriviaQuestion,
    question: MultipleChoiceQuestion,
  ) {
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

    const imageSource = this.getEmbedImageSource(triviaQuestion.imageUrl);
    if (imageSource) {
      embed.setImage(imageSource);
    }

    return embed;
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
    const buttons = question.options
      .slice(0, 4)
      .map((option, index) =>
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

    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
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

  private getEmbedImageSource(imagePath: string): string | null {
    if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
      return imagePath;
    }

    // Try to find local file
    const resolvedPath = path.resolve(imagePath);

    if (existsSync(resolvedPath)) {
      const fileName = basename(imagePath);
      return `attachment://${fileName}`;
    }

    // Try without resolve (in case it's relative to pictures/)
    const picturesPath = path.join(
      process.cwd(),
      "pictures",
      basename(imagePath),
    );
    if (existsSync(picturesPath)) {
      const fileName = basename(imagePath);
      return `attachment://${fileName}`;
    }

    // If file doesn't exist, return null to skip image
    return null;
  }

  private getImageFiles(imagePath: string) {
    // Only process local files (not URLs)
    if (imagePath.startsWith("http")) {
      return [];
    }

    // Try exact path first
    let resolvedPath = path.resolve(imagePath);
    if (existsSync(resolvedPath)) {
      return [resolvedPath];
    }

    // Try pictures/ folder
    resolvedPath = path.join(process.cwd(), "pictures", basename(imagePath));
    if (existsSync(resolvedPath)) {
      return [resolvedPath];
    }

    // If nothing found, log it for debugging
    this.logError(`Image file not found: ${imagePath}`, null);
    return [];
  }

  private async delay(ms: number, abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);

      abortSignal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
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
    console.error(message, error);
  }
}
