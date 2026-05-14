import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder, Guild } from "discord.js";
import { DateTime } from "luxon";
import {
  ActivityPeriod,
  ActivityService,
} from "../services/activity.service";

const TALLINN_TIMEZONE = "Europe/Tallinn";

function formatTallinnDate(value: string | number | Date): string {
  let dateTime: DateTime;

  if (value instanceof Date) {
    dateTime = DateTime.fromJSDate(value, { zone: "utc" });
  } else if (typeof value === "number") {
    dateTime =
      value < 1_000_000_000_000
        ? DateTime.fromSeconds(value, { zone: "utc" })
        : DateTime.fromMillis(value, { zone: "utc" });
  } else {
    const normalizedValue = value.includes("T")
      ? value
      : value.replace(" ", "T");

    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalizedValue);

    dateTime = DateTime.fromISO(
      hasTimezone ? normalizedValue : `${normalizedValue}Z`,
      { zone: "utc" },
    );

    if (!dateTime.isValid) {
      dateTime = DateTime.fromJSDate(new Date(value));
    }
  }

  return dateTime
    .setZone(TALLINN_TIMEZONE)
    .setLocale("et")
    .toFormat("d.M.yyyy, HH:mm:ss");
}

async function getGuildDisplayName(
  guild: Guild,
  userId: string,
): Promise<string> {
  try {
    const member = await guild.members.fetch(userId);
    return member.displayName;
  } catch {
    try {
      const user = await guild.client.users.fetch(userId);
      return user.globalName ?? user.username;
    } catch {
      return userId;
    }
  }
}

async function getStatsOrReply<T>(
  interaction: Command.ChatInputCommandInteraction,
  getStats: () => Promise<T>,
): Promise<T | null> {
  try {
    return await getStats();
  } catch (error) {
    console.error("Statistika MongoDB päring ebaõnnestus:", error);

    await interaction.editReply({
      content:
        "Statistika andmebaasiga ühendamine ebaõnnestus. Proovi hiljem uuesti.",
    });

    return null;
  }
}

function getSelectedPeriod(
  interaction: Command.ChatInputCommandInteraction,
): ActivityPeriod {
  return (
    (interaction.options.getString("periood") as ActivityPeriod | null) ?? "all"
  );
}

function getPeriodLabel(period: ActivityPeriod): string {
  switch (period) {
    case "day":
      return "täna";
    case "week":
      return "sel nädalal";
    case "year":
      return "sel aastal";
    default:
      return "kokku";
  }
}

@ApplyOptions<Command.Options>({
  name: "stats",
  description: "Kuvab kasutaja või serveri aktiivsusstatistika",
})
export class StatsCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((option) =>
          option
            .setName("kasutaja")
            .setDescription("Kasutaja, kelle statistikat näidata")
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("periood")
            .setDescription("Mis ajavahemiku statistikat näidata")
            .setRequired(false)
            .addChoices(
              { name: "Kokku", value: "all" },
              { name: "Täna", value: "day" },
              { name: "Sel nädalal", value: "week" },
              { name: "Sel aastal", value: "year" },
            ),
        ),
    );
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: "Seda käsku saab kasutada ainult serveris.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const selectedUser = interaction.options.getUser("kasutaja");
    const selectedPeriod = getSelectedPeriod(interaction);
    const periodLabel = getPeriodLabel(selectedPeriod);

    if (selectedUser) {
      const selectedDisplayName = await getGuildDisplayName(
        guild,
        selectedUser.id,
      );

      const stats = await getStatsOrReply(interaction, () =>
        ActivityService.getUserStats(guild.id, selectedUser.id, selectedPeriod),
      );

      if (stats === null) return;

      if (!stats) {
        await interaction.editReply({
          content: `${selectedDisplayName} kohta statistikat perioodil "${periodLabel}" veel ei ole.`,
        });
        return;
      }

      const avgWordsPerLine =
        stats.line_count > 0 ? stats.word_count / stats.line_count : 0;

      const embed = new EmbedBuilder()
        .setColor("#71368A")
        .setTitle(`Statistika: ${selectedDisplayName} (${periodLabel})`)
        .addFields(
          {
            name: "Ridu",
            value: String(stats.line_count),
            inline: true,
          },
          {
            name: "Sõnu",
            value: String(stats.word_count),
            inline: true,
          },
          {
            name: "Keskmiselt sõnu reas",
            value: avgWordsPerLine.toFixed(2),
            inline: true,
          },
        )
        .setFooter({
          text: stats.last_message_at
            ? `Viimane sõnum: ${formatTallinnDate(stats.last_message_at)}`
            : "Viimase sõnumi aeg puudub",
        });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const statsData = await getStatsOrReply(interaction, async () => ({
      totals: await ActivityService.getGuildTotals(guild.id, selectedPeriod),
      topUsers: await ActivityService.getTopUsers(guild.id, 10, selectedPeriod),
    }));

    if (statsData === null) return;

    const { totals, topUsers } = statsData;

    if (!topUsers.length) {
      await interaction.editReply({
        content: `Statistikat perioodil "${periodLabel}" veel ei ole.`,
      });
      return;
    }

    const avgWordsPerLineOverall =
      totals.line_count > 0 ? totals.word_count / totals.line_count : 0;

    const lines = await Promise.all(
      topUsers.map(async (entry, index) => {
        const name = await getGuildDisplayName(guild, entry.user_id);

        const avgWordsPerLine =
          entry.line_count > 0
            ? (entry.word_count / entry.line_count).toFixed(2)
            : "0.00";

        return `${index + 1}. ${name} - ${
          entry.line_count
        } rida ~ ${avgWordsPerLine} sõna/reas`;
      }),
    );

    const embed = new EmbedBuilder()
      .setColor("#71368A")
      .setTitle(`${guild.name} aktiivseimad kasutajad (${periodLabel})`)
      .addFields(
        {
          name: "Kokku ridu",
          value: String(totals.line_count),
          inline: true,
        },
        {
          name: "Kokku sõnu",
          value: String(totals.word_count),
          inline: true,
        },
        {
          name: "Keskmiselt sõnu reas",
          value: avgWordsPerLineOverall.toFixed(2),
          inline: true,
        },
      )
      .setDescription(lines.join("\n"));

    await interaction.editReply({ embeds: [embed] });
  }
}
