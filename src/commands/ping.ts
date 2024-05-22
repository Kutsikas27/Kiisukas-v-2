import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import humanizeDuration from "humanize-duration";

@ApplyOptions<Command.Options>({
  name: "uptime",
  description: "Näitab kaua Kiisukas ärkvel on olnud",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const uptime = humanizeDuration(process.uptime() * 1000, {
      language: "et",
      round: true,
      conjunction: " ja ",
      largest: 2,
      serialComma: false,
    });
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });
    await interaction.editReply(
      `Kiisukas on ärkvel olnud **${uptime}**, ping: **${
        sent.createdTimestamp - interaction.createdTimestamp
      } ms** `,
    );
  }
}
