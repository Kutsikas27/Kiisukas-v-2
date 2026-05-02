import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder, Guild } from "discord.js";
import { DateTime } from "luxon";
import { ActivityService } from "../services/activity.service";

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

    const selectedUser = interaction.options.getUser("kasutaja");

    if (selectedUser) {
      const selectedDisplayName = await getGuildDisplayName(
        guild,
        selectedUser.id,
      );

      const stats = await ActivityService.getUserStats(
        guild.id,
        selectedUser.id,
      );

      if (!stats) {
        await interaction.reply({
          content: `${selectedDisplayName} kohta statistikat veel ei ole.`,
          ephemeral: true,
        });
        return;
      }

      const avgWordsPerLine =
        stats.line_count > 0 ? stats.word_count / stats.line_count : 0;

      const embed = new EmbedBuilder()
        .setColor("#71368A")
        .setTitle(`Statistika: ${selectedDisplayName}`)
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

      await interaction.reply({ embeds: [embed] });
      return;
    }

    const totals = await ActivityService.getGuildTotals(guild.id);
    const topUsers = await ActivityService.getTopUsers(guild.id, 10);

    if (!topUsers.length) {
      await interaction.reply({
        content: "Statistikat veel ei ole.",
        ephemeral: true,
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
      .setTitle(`${guild.name} aktiivseimad kasutajad`)
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

    await interaction.reply({ embeds: [embed] });
  }
}
