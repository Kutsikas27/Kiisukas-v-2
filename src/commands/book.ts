import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import axios from "axios";

type Book = {
  imageUrl: string;
  title: string;
  bookUrl: string;
  numPages: number;
  avgRating: string;
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
            .setDescription("info raamatu kohta"),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const term = interaction.options.getString("pealkiri")!;
    const { data } = await axios.get<Book[]>(
      `https://www.goodreads.com/book/auto_complete?format=json&q=${term}}`,
    );
    if (!data || data.length === 0) {
      return await interaction.reply(`Vastet raamatule ${term} ei leitud.`);
    }

    const { title, bookUrl, imageUrl, avgRating, numPages } = data[0];
    const { name } = data[0].author;
    const { html } = data[0].description;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(`https://www.goodreads.com${bookUrl}`)
      .setDescription(
        `**${name}** • **${numPages} lk**  \n**${avgRating}**⭐
        \n  ${html} `,
      )
      .setThumbnail(imageUrl)
      .setColor("#FF0000");

    return await interaction.reply({ embeds: [embed] });
  }
}
