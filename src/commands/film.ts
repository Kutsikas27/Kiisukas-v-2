import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import axios from "axios";

const trim = (str: string, max: number) =>
  str.length > max ? `${str.slice(0, max - 3)}...` : str;

function generateRandomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
const pageNr = generateRandomInteger(1, 10);

@ApplyOptions<Command.Options>({
  name: "film",
  description: "Soovitab filmi valitud kategooriast.",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("kategooria")
            .setDescription("filmi kategooria ")
            .setRequired(true)
            .addChoices(
              { name: "Märul", value: "28" },
              { name: "Seiklus", value: "12" },
              { name: "Animatsioon", value: "16" },
              { name: "Komöödia", value: "35" },
              { name: "Krimi", value: "80" },
              { name: "Dokumentaal", value: "99" },
              { name: "Fantaasia", value: "14" },
              { name: "Ajalugu", value: "36" },
              { name: "Õudus", value: "27" },
              { name: "Müsteerium", value: "9648" },
              { name: "Armastus", value: "10749" },
              { name: "Ulme", value: "878" },
              { name: "Sõda", value: "10752" },
              { name: "Põnevik", value: "53" },
              { name: "Vestern", value: "37" },
              { name: "Draama", value: "18" },
            ),
        ),
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const category = interaction.options.getString("kategooria");

    type Response = {
      results: {
        id: number;
        title: string;
        vote_average: number;
        overview: string;
        poster_path: string;
        release_date: string;
      }[];
    };
    const response = await axios.get<Response>(
      `https://api.themoviedb.org/3/discover/movie?with_genres=${category}&sort_by=vote_count.desc&page=${pageNr}&api_key=${process.env.MOVIEDB_API_KEY}`,
    );

    const randomIndex = Math.floor(
      Math.random() * response.data.results.length,
    );
    const movie = response.data.results[randomIndex];
    const movieId = movie.id;
    const movieTitle = movie.title;
    const movieRating = movie.vote_average;
    const movieOverview = movie.overview;
    const posterPath = movie.poster_path;
    const date = movie.release_date;
    const releaseYear = new Date(date).getFullYear();
    type Response2 = {
      results: {
        id: number;
        title: string;
        vote_average: number;
        overview: string;
        poster_path: string;
        release_date: string;
      }[];
    };

    const movieResult2 = await axios.get<Response2>(
      `https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.MOVIEDB_API_KEY}`,
    );

    const movieGenre = movieResult2.genres[0].name;
    const imdbId = movieResult2.imdb_id;
    const runTimeMinutes = movieResult2.runtime;
    const runTimeHours = Math.floor(runTimeMinutes / 60);
    const remainingMinutes = runTimeMinutes % 60;

    const embed = new EmbedBuilder()
      .setTitle(movieTitle)
      .setURL(`https://www.imdb.com/title/${imdbId}?ref_=ttls_li_tt`)

      .setDescription(
        `**${releaseYear}** • **${runTimeHours}h${remainingMinutes}m** • **${movieGenre}**  \n⭐ **${movieRating}**   \n${trim(
          movieOverview,
          150,
        )},`,
      )
      .setThumbnail(`https://image.tmdb.org/t/p/original${posterPath}`)

      .setColor("#FF0000");

    await interaction.reply({ embeds: [embed] });
  }
}
