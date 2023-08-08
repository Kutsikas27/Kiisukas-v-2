import { ApplyOptions } from "@sapphire/decorators";
import {
  beachService,
  type Beach,
  beachFlags,
} from "../services/beach.service";
import { EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";
import { Command } from "@sapphire/framework";
import { TALLINN_TIMEZONE } from "../lib/constants";

const choices = beachService.names.map((name) => ({ name, value: name }));

@ApplyOptions<Command.Options>({
  name: "rannailm",
  description: "Näitab veetemperatuure supelrandades",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((subcommand) =>
          subcommand
            .setName("rand")
            .setDescription("vali üks rand")
            .addStringOption((option) =>
              option
                .setName("rand")
                .setDescription("sisesta ranna nimi")
                .setRequired(true)
                .addChoices(...choices),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("rannad").setDescription("näita kõiki randu"),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();
    const beaches = await beachService.getBeaches();
    const subCommand = interaction.options.getSubcommand();
    const searchString = interaction.options.getString("rand")!;
    const description =
      subCommand === "rand"
        ? getOneBeachDescription(searchString, beaches)
        : getBeachListDescription(beaches);
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setDescription(description);

    interaction.followUp({ embeds: [embed] });
  }
}

const getOneBeachDescription = (searchString: string, beaches: Beach[]) => {
  const beach = beaches.find((beach) => beach.name === searchString)!;
  return getBeachRow(beach);
};

const getBeachListDescription = (beaches: Beach[]) =>
  beaches
    .filter((beach) => beach.name)
    .map(getBeachRow)
    .join("\n");

const getBeachRow = (beach: Beach) => {
  const beachinfo = beach.forecast.beach[0];
  const date = DateTime.fromISO(beachinfo.dateTime)
    .setZone(TALLINN_TIMEZONE)
    .toFormat("dd.MM HH:mm");
  const flag = beachFlags[beachinfo.flag];
  if (beachinfo.temperature === null)
    return `${flag} **${beach.name}**: andmed puuduvad`;
  else {
    return ` ${flag} **${date} ${beach.name}** õhk: **${beachinfo.temperature} **°C vesi: **${beachinfo.waterTemperature} **°C  inimesi: **${beachinfo.crowd}** `;
  }
};
