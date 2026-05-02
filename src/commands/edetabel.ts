import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import { PointsService } from "../services/points.service";

@ApplyOptions<Command.Options>({
  name: "edetabel",
  description:
    "Näita pildimängu punktide edetabelit või konkreetse kasutaja punkte",
})
export class LeaderboardCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((option) =>
          option
            .setName("kasutaja")
            .setDescription("Vali kasutaja, kelle punkte näha")
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

    await interaction.deferReply();

    const targetUser = interaction.options.getUser("kasutaja");

    try {
      if (targetUser) {
        const points = Math.max(
          0,
          await PointsService.getPoints(guild.id, targetUser.id),
        );
        const username =
          interaction.guild?.members.cache.get(targetUser.id)?.displayName ||
          targetUser.username;

        const embed = new EmbedBuilder()
          .setTitle("Kasutaja Punktid")
          .setDescription(`${username}il on ${points} punkti pildimängust.`)
          .setColor("Blue");

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const topUsers = await PointsService.getTopUsers(guild.id, 10);

      if (topUsers.length === 0) {
        await interaction.editReply("Edetabel on tühi.");
        return;
      }

      const description = topUsers
        .map((user, index) => {
          const username =
            interaction.guild?.members.cache.get(user.user_id)?.displayName ||
            user.user_id;
          const points = Math.max(0, user.points);
          return `${index + 1}. ${username} - ${points} punkti`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Pildimängu Edetabel")
        .setDescription(description)
        .setColor("Gold");

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Pildimängu edetabeli MongoDB päring ebaõnnestus:", error);

      await interaction.editReply(
        "Pildimängu edetabeli andmebaasiga ühendamine ebaõnnestus. Proovi hiljem uuesti.",
      );
    }
  }
}
