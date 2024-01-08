import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";

import { getBookInfo, getBooksApi } from "../services/book.service";

@ApplyOptions<Command.Options>({
  name: "raamat",
  description: "info raamatu kohta",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("pealkiri")
            .setRequired(true)
            .setDescription("info raamatu kohta")
            .setAutocomplete(true),
        ),
    );
  }
  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction,
  ) {
    const focusedValue = interaction.options.getFocused();

    const { data } = await getBooksApi(focusedValue);

    const autocompleteOptions = data.map((book) => ({
      name: [
        book.title.substring(0, 70),
        book.author.name.substring(0, 20),
      ].join(" - "),
      value: book.title.substring(0, 100),
    }));

    interaction.respond(autocompleteOptions);
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();
    const term = interaction.options.getString("pealkiri", true);
    const { data } = await getBooksApi(term);
    if (!data || data.length === 0) {
      return await interaction.followUp(`Vastet raamatule ${term} ei leitud.`);
    }

    const { title, bookUrl, avgRating, numPages, ratingsCount } = data[0];
    const { name } = data[0].author;
    const info = await getBookInfo(bookUrl);
    if (!info) {
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(`https://www.goodreads.com${bookUrl}`)
      .setDescription(
        `**${name}** • **${numPages} lk**
      *${info.genres}*  \n\n ⭐ **${avgRating}** • *${new Intl.NumberFormat(
        "et-EE",
      ).format(ratingsCount)} reitingut*
        \n  ${info.description} `,
      )
      .setThumbnail(`${info.image}`)
      .setColor("#c7b198");

    return await interaction.followUp({ embeds: [embed] });
  }
}
