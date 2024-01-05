import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder, escapeMarkdown } from "discord.js";
import axios from "axios";
import { JSDOM } from "jsdom";

type Book = {
  imageUrl: string;
  title: string;
  bookUrl: string;
  numPages: number;
  avgRating: string;
  ratingsCount: number;
  author: Author;
  description: Description;
};
type Author = {
  name: string;
};
type Description = {
  html: string;
};

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
      name: book.title,
      value: book.title,
    }));

    interaction.respond(autocompleteOptions);
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();
    const term = interaction.options.getString("pealkiri")!;
    const { data } = await getBooksApi(term);

    if (!data || data.length === 0) {
      return await interaction.reply(`Vastet raamatule ${term} ei leitud.`);
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

const getBookInfo = async (bookUrl: string) => {
  const response = await axios.get(`https://www.goodreads.com/${bookUrl}`, {
    responseType: "stream",
  });
  let html = "";
  for await (const chunk of response.data) {
    const currentChunk = chunk.toString();
    html += currentChunk;
    const { document } = new JSDOM(html).window;
    const featuredPerson = document.querySelector(".FeaturedPerson__meta");
    if (featuredPerson) {
      response.data.destroy();
      break;
    }
  }

  const { document } = new JSDOM(html.replaceAll("<br />", "\n")).window;
  const image = document.querySelector<HTMLImageElement>(
    ".BookPage__bookCover img",
  )?.src;
  const genresList = [
    ...document.querySelectorAll(
      ".BookPageMetadataSection__genres .BookPageMetadataSection__genreButton",
    ),
  ].map((e) => e.textContent);
  const textContent = document.querySelector(
    ".TruncatedContent__text.TruncatedContent__text--large",
  )?.textContent;
  if (!textContent) {
    return;
  }
  const description = escapeMarkdown(textContent, {
    bulletedList: true,
    numberedList: true,
  }).replaceAll("\n\n\n", "\n\n");
  const genres = genresList.slice(0, 3).join(", ");
  return {
    image,
    description,
    genres,
  };
};
const getBooksApi = async (title: string) => {
  return await axios.get<Book[]>(
    `https://www.goodreads.com/book/auto_complete?format=json&q=${title}`,
  );
};
