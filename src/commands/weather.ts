import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import { getForecast, getWeatherEmoji } from "../services/weather.service";

@ApplyOptions<Command.Options>({
  name: "ilm",
  description: "Hetke ilm eesti/maailma eri paigus",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("linn")
            .setDescription("Sisesta linna nimi")
            .setRequired(true),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();

    const linn = interaction.options.getString("linn")!;

    const data = await getForecast(linn);
    if (!data)
      return interaction.editReply(`Ei leidnud vastet asukohale **${linn}**.`);
    const { summary, temperature, apparentTemperature, windSpeed, icon } =
      data.forecast;
    const embed = new EmbedBuilder()
      .setColor(0xefff00)
      .setTitle(`${data.description} ${getWeatherEmoji(icon)}`)
      .setDescription(
        `${summary}, **${Math.round(temperature)}°C** (tajutav **${Math.round(
          apparentTemperature,
        )}°C**), tuulekiirus **${Math.round(windSpeed)} m/s**`,
      );

    return interaction.followUp({ embeds: [embed] });
  }
}
