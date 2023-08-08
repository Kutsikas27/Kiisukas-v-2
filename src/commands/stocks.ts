import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import { getEmbedDescription, getStocks } from "../services/stocks.service";

@ApplyOptions<Command.Options>({
  name: "börs",
  description: "Erinevate börside hetkeinfo",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("turg")
            .setDescription("vali turg")
            .addChoices(
              { name: "Tallinna Börs", value: "TALLINN" },
              { name: "Riia Börs", value: "RIGA" },
              { name: "Vilniuse Börs", value: "VILNIUS" },
              { name: "Krüpto", value: "CRYPTO" },
              { name: "USA Börs", value: "USA" },
            ),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();
    const quotes = await getStocks();
    const market = interaction.options.getString("turg") || "TALLINN";
    const description = getEmbedDescription(quotes, market);
    const embed = new EmbedBuilder()
      .setColor(0xef0f00)
      .setDescription(description);
    interaction.followUp({ embeds: [embed] });
  }
}
