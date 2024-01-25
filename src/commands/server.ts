import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";
import humanizeDuration from "humanize-duration";
import axios from "axios";

@ApplyOptions<Command.Options>({
  name: "server",
  description: "Kuvab informatsiooni serveri kohta",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) return;
    const getMemberCount = guild.memberCount;
    const getGuildLogo = guild.iconURL();
    const serverCreationDate = DateTime.fromJSDate(guild.createdAt)
      .setZone("Europe/Tallinn")
      .setLocale("et")
      .toFormat("d.MMMM yyyy HH:mm");

    const timePassedSinceCreation = humanizeDuration(
      guild.createdTimestamp - Date.now(),
      {
        language: "et",
        round: true,
        conjunction: " ja ",
        largest: 2,
        serialComma: false,
      },
    );
    const { data } = await axios.get(
      `https://discord.com/api/guilds/1189280475542454362/widget.json`,
    );

    const onlineMembers = data.presence_count;

    const embed = new EmbedBuilder()
      .setColor("#71368A")
      .setTitle("KOODIJUTUD")
      .setURL("https://koodijutud.ee/")
      .setThumbnail(getGuildLogo)
      .addFields({
        name: `👥 **${getMemberCount} Kasutajat**`,
        value: `🟢 **${onlineMembers} Online**`,
      })
      .addFields({
        name: "🕙 ** Server Loodud** ",
        value: `${serverCreationDate} (${timePassedSinceCreation} tagasi)`,
        inline: true,
      });

    await interaction.reply({ embeds: [embed] });
  }
}
