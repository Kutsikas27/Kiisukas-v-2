import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { EmbedBuilder } from "discord.js";
import axios from "axios";

type Movie = {
  runtime: number;
  imdb_id: number;
  id: number;
  genres: [{ name: string }];
  results: {
    id: number;
    title: string;
    vote_average: number;
    overview: string;
    poster_path: string;
    release_date: string;
    vote_count: number;
  }[];
};

@ApplyOptions<Command.Options>({
  name: "film",
  description: "otsi filmi pealkirja järgi",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName("film")
            .setDescription("pealkiri")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    );
  }
  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction,
  ) {
    const focusedValue = interaction.options.getFocused();

    const { data } = await getMovie(focusedValue);
    const limit = 5;
    const autocompleteOptions = data.results.slice(0, limit).map((film) => ({
      name: film.title.substring(0, 100),
      value: film.title.substring(0, 100),
    }));

    interaction.respond(autocompleteOptions);
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const film = interaction.options.getString("film", true);
    const movieResponse = await getMovie(film);
    if (!movieResponse || movieResponse.data.results.length === 0) {
      return await interaction.followUp(`Vastet filmile ${film} ei leitud.`);
    }
    const {
      title,
      id,
      vote_average,
      overview,
      poster_path,
      release_date,
      vote_count,
    } = movieResponse.data.results[0];

    const releaseYear = new Date(release_date).getFullYear();

    const movieResult2 = await axios.get<Movie>(
      `https://api.themoviedb.org/3/movie/${id}?api_key=${process.env.MOVIEDB_API_KEY}`,
    );

    const { imdb_id, runtime, genres } = movieResult2.data;

    const movieGenre = genres
      .slice(0, 2)
      .map((g) => g.name)
      .join(", ");
    const runTimeHours = Math.floor(runtime / 60);
    const remainingMinutes = runtime % 60;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(`https://www.imdb.com/title/${imdb_id}?ref_=ttls_li_tt`)
      .setDescription(
        `**${releaseYear}** • **${runTimeHours}h${remainingMinutes}m**
          *${movieGenre}*  \n\n ⭐ **${new String(vote_average).substring(
            0,
            3,
          )}** • *${new Intl.NumberFormat("et-EE").format(
            vote_count,
          )} reitingut*
            \n  ${overview} `,
      )
      .setThumbnail(`https://image.tmdb.org/t/p/original${poster_path}`)
      .setColor("#FF0000");

    return await interaction.reply({ embeds: [embed] });
  }
}
const getMovie = async (filmTitle: string) => {
  return await axios.get<Movie>(
    `https://api.themoviedb.org/3/search/movie?query=${filmTitle}&language=en-US&page=1&api_key=${process.env.MOVIEDB_API_KEY}`,
  );
};
