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
    console.log("test");

    const linn = interaction.options.getString("linn")!;

    const data = await getForecast(linn);
    if (!data)
      return interaction.editReply(`Ei leidnud vastet asukohale **${linn}**.`);
    const { currently, daily } = data.forecast;

    const embed = new EmbedBuilder()

      .setColor(0xefff00)

      .setTitle(`${data.description} ${getWeatherEmoji(currently[0].icon)}`)
      .setDescription(
        `**${Math.round(currently[0].temperature)}°C** (tajutav **${Math.round(
          currently[0].apparentTemperature,
        )}°C**) \n  ${currently[0].summary}, tuulekiirus **${Math.round(
          currently[0].windSpeed,
        )} m/s**`,
      )
      .addFields(
        {
          name: `**${new Date(daily[0].dateTime).toLocaleString("et", {
            month: "long",
            day: "numeric",
          })}**`,
          value: `**${getWeatherEmoji(daily[0].icon)}${Math.round(
            daily[1].temperatureLow,
          )}...${Math.round(daily[0].temperatureHigh)}°C**`,
          inline: true,
        },
        {
          name: `**${new Date(daily[1].dateTime).toLocaleString("et", {
            month: "long",
            day: "numeric",
          })}**`,
          value: `**${getWeatherEmoji(daily[1].icon)}${Math.round(
            daily[2].temperatureLow,
          )}...${Math.round(daily[1].temperatureHigh)}°C**`,
          inline: true,
        },
        {
          name: `**${new Date(daily[2].dateTime).toLocaleString("et", {
            month: "long",
            day: "numeric",
          })}**`,
          value: `**${getWeatherEmoji(daily[2].icon)}${Math.round(
            daily[3].temperatureLow,
          )}...${Math.round(daily[2].temperatureHigh)}°C**`,
          inline: true,
        },
      );
    return interaction.followUp({ embeds: [embed] });
  }
}
//khmm
