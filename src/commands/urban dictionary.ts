import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import axios from "axios";
import { trim } from "../lib/utils/utils";

@ApplyOptions<Command.Options>({
  name: "ud",
  description: "urban dictionary",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("termin")
            .setRequired(true)
            .setDescription("urban dictionary"),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();

    const term = interaction.options.getString("termin")!;
    const { data } = await axios.get(
      `https://api.urbandictionary.com/v0/define?term=${term}}`,
    );
    const { list } = data;
    if (!list.length) {
      return interaction.editReply(`Ei leidnud vastet sõnale **${term}**.`);
    }
    const [answer] = list;

    const fixAnswer = answer.definition.replace(/\[|\]/g, "");

    const embed = new EmbedBuilder()
      .setColor(0xefff00)
      .setTitle(answer.word)
      .setURL(answer.permalink)
      .setDescription(trim(fixAnswer, 200));
    return interaction.editReply({ embeds: [embed] });
  }
}
