import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";
import { AttachmentBuilder, EmbedBuilder, Message } from "discord.js";
import axios from "axios";
import { PointsService } from "../services/points.service";

interface WikidataBindingValue {
  type: string;
  value: string;
}

interface WikidataFamousPaintingBinding {
  item: WikidataBindingValue;
  itemLabel: WikidataBindingValue;
  image: WikidataBindingValue;
  catalogCode?: WikidataBindingValue;
  creatorLabel?: WikidataBindingValue;
}

interface WikidataSparqlResponse {
  head: {
    vars: string[];
  };
  results: {
    bindings: WikidataFamousPaintingBinding[];
  };
}

interface PaintingGameArtwork {
  id: string;
  title: string;
  artist: string;
  imageUrl: string;
  sourceUrl: string;
}

interface GuessCheckResult {
  titleCorrect: boolean;
  artistCorrect: boolean;
}

@ApplyOptions<Command.Options>({
  name: "pildimäng",
  description: "Alusta pildimängu, kus tuleb ära arvata kuulus maal või autor",
})
export class PictureGameCommand extends Command {
  private activeGames = new Map<string, boolean>();

  private recentArtworkIds = new Set<string>();
  private recentArtworkQueue: string[] = [];
  private readonly maxRecentArtworks = 50;

  private famousArtworkCache: PaintingGameArtwork[] = [];
  private famousArtworkCacheFetchedAt = 0;
  private readonly famousArtworkCacheTtlMs = 1000 * 60 * 60 * 24;

  private readonly wikidataSparqlUrl = "https://query.wikidata.org/sparql";

  private readonly userAgent =
    "pildimang-discord-bot/1.0 (Discord bot for educational art guessing game)";

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    );
  }

  private addRecentArtwork(id: string) {
    if (this.recentArtworkIds.has(id)) return;

    this.recentArtworkIds.add(id);
    this.recentArtworkQueue.push(id);

    if (this.recentArtworkQueue.length > this.maxRecentArtworks) {
      const oldest = this.recentArtworkQueue.shift();

      if (oldest !== undefined) {
        this.recentArtworkIds.delete(oldest);
      }
    }
  }

  private normalizeAnswer(value: string) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private formatPoints(points: number) {
    return Number.isInteger(points) ? points.toString() : points.toFixed(1);
  }

  private answerContainsAnswer(input: string, answer: string) {
    const normalizedInput = this.normalizeAnswer(input);
    const normalizedAnswer = this.normalizeAnswer(answer);

    if (!normalizedInput || !normalizedAnswer) {
      return false;
    }

    if (normalizedInput === normalizedAnswer) {
      return true;
    }

    if (normalizedInput.includes(normalizedAnswer)) {
      return true;
    }

    return false;
  }

  private answerContainsArtist(input: string, artist: string) {
    const normalizedInput = this.normalizeAnswer(input);
    const normalizedArtist = this.normalizeAnswer(artist);

    if (!normalizedInput || !normalizedArtist) {
      return false;
    }

    if (normalizedInput === normalizedArtist) {
      return true;
    }

    if (normalizedInput.includes(normalizedArtist)) {
      return true;
    }

    const artistParts = normalizedArtist.split(" ").filter(Boolean);
    const lastName = artistParts[artistParts.length - 1];

    // Lubab nt "van Gogh" puhul "gogh" või "Leonardo da Vinci" puhul "vinci".
    // Ei luba liiga lühikesi perekonnanimesid, et vältida juhuslikke valepositiivseid vasteid.
    if (lastName && lastName.length >= 4 && normalizedInput === lastName) {
      return true;
    }

    return false;
  }

  private checkGuess(
    response: string,
    painting: PaintingGameArtwork,
  ): GuessCheckResult {
    return {
      titleCorrect: this.answerContainsAnswer(response, painting.title),
      artistCorrect: this.answerContainsArtist(response, painting.artist),
    };
  }

  private getWikidataIdFromUrl(url: string) {
    const match = url.match(/\/entity\/(Q\d+)$/);
    return match?.[1] ?? url;
  }

  private getWikidataSourceUrl(itemUrl: string) {
    const id = this.getWikidataIdFromUrl(itemUrl);
    return `https://www.wikidata.org/wiki/${id}`;
  }

  private normalizeImageUrl(url: string) {
    return url.replace(/^http:/, "https:");
  }

  private getFamousPaintingsSparqlQuery() {
    return `
      SELECT ?item ?itemLabel ?creatorLabel ?image ?catalogCode WHERE {
        ?item p:P528 ?catalogStatement.
        ?catalogStatement ps:P528 ?catalogCode.
        ?catalogStatement pq:P972 wd:Q41634361.
        ?item wdt:P18 ?image.

        OPTIONAL {
          ?item wdt:P170 ?creator.
        }

        SERVICE wikibase:label {
          bd:serviceParam wikibase:language "en".
        }
      }
      LIMIT 100
    `;
  }

  private async fetchFamousArtworksFromWikidata(): Promise<
    PaintingGameArtwork[]
  > {
    const response = await axios.get<WikidataSparqlResponse>(
      this.wikidataSparqlUrl,
      {
        timeout: 30_000,
        params: {
          query: this.getFamousPaintingsSparqlQuery(),
          format: "json",
        },
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": this.userAgent,
        },
      },
    );

    const artworks = response.data.results.bindings
      .map((binding): PaintingGameArtwork | null => {
        const itemUrl = binding.item?.value;
        const title = binding.itemLabel?.value;
        const artist = binding.creatorLabel?.value;
        const imageUrl = binding.image?.value;

        if (!itemUrl || !title || !artist || !imageUrl) {
          return null;
        }

        return {
          id: this.getWikidataIdFromUrl(itemUrl),
          title,
          artist,
          imageUrl: this.normalizeImageUrl(imageUrl),
          sourceUrl: this.getWikidataSourceUrl(itemUrl),
        };
      })
      .filter((artwork): artwork is PaintingGameArtwork => artwork !== null);

    const uniqueArtworks = new Map<string, PaintingGameArtwork>();

    for (const artwork of artworks) {
      if (!uniqueArtworks.has(artwork.id)) {
        uniqueArtworks.set(artwork.id, artwork);
      }
    }

    return [...uniqueArtworks.values()];
  }

  private async getFamousArtworks(): Promise<PaintingGameArtwork[]> {
    const now = Date.now();
    const cacheIsFresh =
      this.famousArtworkCache.length > 0 &&
      now - this.famousArtworkCacheFetchedAt < this.famousArtworkCacheTtlMs;

    if (cacheIsFresh) {
      return this.famousArtworkCache;
    }

    const artworks = await this.fetchFamousArtworksFromWikidata();

    if (artworks.length === 0) {
      throw new Error("Wikidata returned 0 famous paintings");
    }

    this.famousArtworkCache = artworks;
    this.famousArtworkCacheFetchedAt = now;

    console.log(`Fetched ${artworks.length} famous paintings from Wikidata`);

    return artworks;
  }

  private async fetchRandomArtwork(): Promise<PaintingGameArtwork> {
    const artworks = await this.getFamousArtworks();

    const unseenArtworks = artworks.filter(
      (artwork) => !this.recentArtworkIds.has(artwork.id),
    );

    const candidates = unseenArtworks.length > 0 ? unseenArtworks : artworks;

    const randomArtwork =
      candidates[Math.floor(Math.random() * candidates.length)];

    this.addRecentArtwork(randomArtwork.id);

    console.log(
      `Selected famous artwork: "${randomArtwork.title}" by ${randomArtwork.artist}, ID: ${randomArtwork.id}`,
    );

    return randomArtwork;
  }

  private async fetchArtworkAttachment(
    imageUrl: string,
  ): Promise<AttachmentBuilder | null> {
    try {
      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": this.userAgent,
          Accept: "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
        },
        timeout: 30_000,
        maxRedirects: 5,
      });

      return new AttachmentBuilder(Buffer.from(response.data), {
        name: "artwork.jpg",
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Error downloading artwork image:", {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url,
          method: error.config?.method,
        });
      } else {
        console.error("Error downloading artwork image:", error);
      }

      return null;
    }
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: "Seda käsku saab kasutada ainult serveris.",
        ephemeral: true,
      });
    }

    const channel = interaction.channel;

    if (!channel) {
      return interaction.reply({
        content: "Kanalit ei leitud.",
        ephemeral: true,
      });
    }

    // Check if picture game is restricted to a specific channel
    const allowedChannelId = process.env.PICTURE_GAME_CHANNEL_ID;
    if (allowedChannelId && interaction.channelId !== allowedChannelId) {
      return interaction.reply({
        content: "Kasuta seda käsku pildimäng kanalis.",
        ephemeral: true,
      });
    }

    const channelId = interaction.channelId;

    if (this.activeGames.get(channelId)) {
      return interaction.reply({
        content: "Pildimäng juba käib.",
        ephemeral: true,
      });
    }

    this.activeGames.set(channelId, true);

    try {
      await interaction.deferReply();

      const painting = await this.fetchRandomArtwork();

      const embed = new EmbedBuilder()
        .setTitle("Pildimäng")
        .setDescription(
          [
            "Arva ära selle kuulsa maali nimi või autor!",
            "",
            "Maali nimi = **0.5 punkti**",
            "Autor = **0.5 punkti**",
            "Mõlemad samas sõnumis = **2 punkti**",
          ].join("\n"),
        )
        .setImage(painting.imageUrl)
        .setColor("Blue");

      const artworkAttachment = await this.fetchArtworkAttachment(
        painting.imageUrl,
      );

      if (artworkAttachment) {
        embed.setImage("attachment://artwork.jpg");

        await interaction.editReply({
          embeds: [embed],
          files: [artworkAttachment],
        });
      } else {
        await interaction.editReply({
          embeds: [embed],
        });
      }

      let titleGuessed = false;
      let artistGuessed = false;

      const timeLimit = 30_000;
      const startTime = Date.now();

      const filter = (message: Message) =>
        message.author.id === interaction.user.id && !message.author.bot;

      try {
        while (true) {
          const elapsed = Date.now() - startTime;
          const timeLeft = Math.max(timeLimit - elapsed, 0);

          if (timeLeft <= 0) {
            break;
          }

          const collected = await channel.awaitMessages({
            filter,
            max: 1,
            time: timeLeft,
            errors: ["time"],
          });

          const response = collected.first()?.content;

          if (!response) {
            continue;
          }

          const guess = this.checkGuess(response, painting);

          const guessedBothAtOnce =
            !titleGuessed &&
            !artistGuessed &&
            guess.titleCorrect &&
            guess.artistCorrect;

          if (guessedBothAtOnce) {
            PointsService.addPoints(guild.id, interaction.user.id, 2);

            const points = PointsService.getPoints(
              guild.id,
              interaction.user.id,
            );

            await channel.send(
              `Täiuslik vastus! See oli "${painting.title}" — ${
                painting.artist
              }. Sa said 2 punkti. Sul on nüüd ${this.formatPoints(
                points,
              )} punkti.`,
            );

            return;
          }

          let earnedPoints = 0;
          const newlyCorrectParts: string[] = [];

          if (!titleGuessed && guess.titleCorrect) {
            titleGuessed = true;
            earnedPoints += 0.5;
            newlyCorrectParts.push("maali nimi");
          }

          if (!artistGuessed && guess.artistCorrect) {
            artistGuessed = true;
            earnedPoints += 0.5;
            newlyCorrectParts.push("autor");
          }

          if (earnedPoints > 0) {
            PointsService.addPoints(
              guild.id,
              interaction.user.id,
              earnedPoints,
            );

            const points = PointsService.getPoints(
              guild.id,
              interaction.user.id,
            );

            if (titleGuessed && artistGuessed) {
              await channel.send(
                `Õige! Leidsid nüüd mõlemad: "${painting.title}" — ${
                  painting.artist
                }. Sa said seekord +${this.formatPoints(
                  earnedPoints,
                )} punkti. Sul on nüüd ${this.formatPoints(points)} punkti.`,
              );

              return;
            }

            const remainingHint = titleGuessed
              ? "Autor on veel puudu."
              : "Maali nimi on veel puudu.";

            await channel.send(
              `Õige: ${newlyCorrectParts.join(" ja ")}! +${this.formatPoints(
                earnedPoints,
              )} punkti. ${remainingHint} Sul on nüüd ${this.formatPoints(
                points,
              )} punkti.`,
            );
          }

          // Vale vastus või kordus: jätkame vaikides kuni aeg saab otsa.
        }
      } catch {
        // Timeout jõudis kätte.
      }

      const missingParts: string[] = [];

      if (!titleGuessed) {
        missingParts.push(`maali nimi oli "${painting.title}"`);
      }

      if (!artistGuessed) {
        missingParts.push(`autor oli ${painting.artist}`);
      }

      await channel.send(
        `Aeg sai otsa! Õige vastus: "${painting.title}" — ${
          painting.artist
        }. Puudu jäi: ${missingParts.join(", ")}.`,
      );

      return;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Picture game Axios error:", {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url,
          method: error.config?.method,
        });
      } else {
        console.error("Picture game failed:", error);
      }

      return;
    } finally {
      this.activeGames.delete(channelId);
    }
  }
}
