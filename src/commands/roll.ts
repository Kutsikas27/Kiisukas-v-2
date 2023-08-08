import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import Chance from "chance";
import { noop } from "../lib/utils/utils.js";
import { isGuildMember } from "@sapphire/discord.js-utilities";

const diceEmojis = new Map([
  [1, "<:dicesixfacesone1:1136634862435057675>"],
  [2, "<:dicesixfacestwo:1136635283543162890>"],
  [3, "<:dicesixfacesthree:1136635295605989376>"],
  [4, "<:dicesixfacesfour:1136635306448265276>"],
  [5, "<:dicesixfacesfive:1136635314761371709>"],
  [6, "<:dicesixfacessix:1136635330041233489>"],
]);

@ApplyOptions<Command.Options>({
  name: "roll",
  description: "Viska täringuid",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addIntegerOption((option) =>
          option
            .setName("number")
            .setDescription("sinu pakkumine")
            .setMinValue(2)
            .setMaxValue(12),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!isGuildMember(interaction.member)) return;
    const input = interaction.options.getInteger("number");
    const chance = new Chance();
    const d1 = chance.d6();
    const d2 = chance.d6();
    const content = `**${
      interaction.member.displayName
    }** viskab ${diceEmojis.get(d1)} ${diceEmojis.get(d2)}`;
    const reply = await interaction.reply({ content, fetchReply: true });

    const won = input ? d1 + d2 === input : d1 + d2 === 12;
    const lost = !input && d1 === 1 && d2 === 1;

    if (won) reply.react("🎉").catch(noop);
    if (lost) reply.react("💀").catch(noop);
  }
}
