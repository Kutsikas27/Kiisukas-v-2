import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder, bold, italic } from "discord.js";

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
      value: book.bookUrl,
    }));

    interaction.respond(autocompleteOptions);
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();

    const term = interaction.options.getString("pealkiri", true);

    let bookUrl;
    if (!term.startsWith("/")) {
      const { data } = await getBooksApi(term);
      if (!data || data.length === 0) {
        return await interaction.followUp(
          `Vastet raamatule *${term}* ei leitud.`,
        );
      }
      bookUrl = data[0].bookUrl;
    } else {
      bookUrl = term;
    }

    const info = await getBookInfo(bookUrl);
    if (!info) {
      return console.log("book info not found");
    }

    const descriptionItems = [];
    if (info.author) descriptionItems.push(bold(info.author));
    if (info.genres) descriptionItems.push(italic(info.genres));

    const ratingsRow = [];
    if (info.rating) ratingsRow.push(bold("⭐ " + info.rating));
    if (info.reviewsCount) ratingsRow.push(italic(info.reviewsCount));
    if (ratingsRow.length) descriptionItems.push(ratingsRow.join(" • "));

    if (info.description) descriptionItems.push("\n" + info.description);
    const description = descriptionItems.join("\n");

    const embed = new EmbedBuilder()

      .setTitle(info.title)
      .setURL(`https://www.goodreads.com${bookUrl}`)
      .setDescription(description)
      .setThumbnail(`${info.image}`)
      .setColor("#c7b198");
    if (info.pagesAndYearPublished) {
      embed.setFooter({ text: info.pagesAndYearPublished });
    }
    return await interaction.followUp({ embeds: [embed] });
  }
}
