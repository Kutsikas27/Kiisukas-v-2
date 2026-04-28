import { google } from "googleapis";
import axios from "axios";

export interface TriviaQuestion {
  imageUrl: string;
  question: string;
  correctAnswer: string;
  wrongAnswers: string[];
}

interface WikidataBindingValue {
  type: string;
  value: string;
}

interface WikidataFamousPaintingBinding {
  item?: WikidataBindingValue;
  itemLabel?: WikidataBindingValue;
  image?: WikidataBindingValue;
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

interface GoogleSheetsCredentials {
  clientEmail: string;
  privateKey: string;
}

class SheetsService {
  private sheets = google.sheets("v4");
  private cache: TriviaQuestion[] | null = null;
  private cacheTime = 0;
  private readonly cacheTtl = 1000 * 60 * 60; // 1 hour

  private getAuth() {
    const credentials = this.getGoogleSheetsCredentials();

    return new google.auth.JWT({
      email: credentials.clientEmail,
      key: credentials.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }

  private getGoogleSheetsCredentials(): GoogleSheetsCredentials {
    const serviceAccountJson = this.getServiceAccountJsonFromEnv();

    const clientEmail =
      serviceAccountJson?.client_email ||
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL ||
      process.env.GOOGLE_CLIENT_EMAIL;

    const privateKey =
      serviceAccountJson?.private_key || this.getPrivateKeyFromEnv();

    if (!clientEmail) {
      throw new Error(
        "Missing GOOGLE_SHEETS_CLIENT_EMAIL in .env / Fly secrets",
      );
    }

    if (!privateKey) {
      throw new Error(
        "Missing GOOGLE_SHEETS_PRIVATE_KEY in .env / Fly secrets",
      );
    }

    const normalizedPrivateKey = this.normalizePrivateKey(privateKey);

    if (
      !normalizedPrivateKey.includes("-----BEGIN PRIVATE KEY-----") &&
      !normalizedPrivateKey.includes("-----BEGIN RSA PRIVATE KEY-----")
    ) {
      throw new Error(
        "GOOGLE_SHEETS_PRIVATE_KEY is not a valid PEM private key. Use GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 or fix escaped newlines.",
      );
    }

    return {
      clientEmail,
      privateKey: normalizedPrivateKey,
    };
  }

  private getServiceAccountJsonFromEnv(): {
    client_email?: string;
    private_key?: string;
  } | null {
    const base64Json =
      process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

    if (base64Json) {
      try {
        const decodedJson = Buffer.from(base64Json, "base64").toString("utf8");
        return JSON.parse(decodedJson);
      } catch (error) {
        throw new Error(
          `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const rawJson =
      process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (rawJson) {
      try {
        return JSON.parse(rawJson);
      } catch (error) {
        throw new Error(
          `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return null;
  }

  private getPrivateKeyFromEnv() {
    const base64PrivateKey =
      process.env.GOOGLE_SHEETS_PRIVATE_KEY_BASE64 ||
      process.env.GOOGLE_PRIVATE_KEY_BASE64;

    if (base64PrivateKey) {
      return Buffer.from(base64PrivateKey, "base64").toString("utf8");
    }

    return (
      process.env.GOOGLE_SHEETS_PRIVATE_KEY ||
      process.env.GOOGLE_PRIVATE_KEY ||
      null
    );
  }

  private normalizePrivateKey(privateKey: string) {
    return privateKey
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
  }

  async getTriviaQuestions(): Promise<TriviaQuestion[]> {
    const now = Date.now();

    if (this.cache && now - this.cacheTime < this.cacheTtl) {
      return this.cache;
    }

    const sheetsId = process.env.TRIVIA_SHEETS_ID;

    if (!sheetsId) {
      throw new Error("Missing TRIVIA_SHEETS_ID in .env");
    }

    const auth = this.getAuth();

    try {
      const spreadsheetResponse = await this.sheets.spreadsheets.get({
        auth,
        spreadsheetId: sheetsId,
      });

      const sheets = spreadsheetResponse.data.sheets || [];
      const firstSheet = sheets[0];

      if (!firstSheet || !firstSheet.properties?.title) {
        throw new Error("Could not find any sheets in the spreadsheet");
      }

      const sheetName = firstSheet.properties.title;
      console.log(`Found sheet: ${sheetName}`);

      const response = await this.sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: sheetsId,
        range: `${sheetName}!A1:G`,
      });

      const rows = response.data.values || [];

      if (rows.length === 0) {
        throw new Error("Sheet has no data");
      }

      const dataRows = rows.slice(1);
      const questions: TriviaQuestion[] = [];

      for (const row of dataRows) {
        if (row.length < 3) {
          continue;
        }

        const [
          imagePathRaw,
          questionRaw,
          correctAnswerRaw,
          ...wrongAnswersRaw
        ] = row;

        const imagePath = String(imagePathRaw ?? "").trim();
        const question = String(questionRaw ?? "").trim();
        const correctAnswer = String(correctAnswerRaw ?? "").trim();

        if (!question || !correctAnswer) {
          continue;
        }

        const wrongAnswers = wrongAnswersRaw
          .map((answer) => String(answer ?? "").trim())
          .filter((answer) => answer.length > 0);

        questions.push({
          imageUrl: imagePath,
          question,
          correctAnswer,
          wrongAnswers,
        });
      }

      this.cache = questions;
      this.cacheTime = now;

      console.log(
        `Loaded ${questions.length} trivia questions from Google Sheets`,
      );

      return questions;
    } catch (error) {
      console.error(
        "Failed to fetch trivia questions from Google Sheets:",
        error,
      );
      throw error;
    }
  }

  clearCache() {
    this.cache = null;
    this.cacheTime = 0;
  }

  async populateSheetWithWikidata(): Promise<void> {
    console.log("Fetching artworks from Wikidata...");

    const artworks = await this.fetchFamousArtworksFromWikidata();

    if (artworks.length === 0) {
      throw new Error("No artworks found from Wikidata");
    }

    console.log(
      `Found ${artworks.length} artworks. Converting to trivia questions...`,
    );

    const triviaQuestions = this.convertArtworksToTriviaQuestions(artworks);

    console.log(
      `Converted to ${triviaQuestions.length} trivia questions. Writing to sheet...`,
    );

    await this.writeTriviaQuestionsToSheet(triviaQuestions);

    console.log("Successfully populated sheet with Wikidata data!");
  }

  private async fetchFamousArtworksFromWikidata(): Promise<
    PaintingGameArtwork[]
  > {
    const response = await axios.get<WikidataSparqlResponse>(
      "https://query.wikidata.org/sparql",
      {
        timeout: 30_000,
        params: {
          query: this.getFamousPaintingsSparqlQuery(),
          format: "json",
        },
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent":
            "pildimang-discord-bot/1.0 (educational Discord art guessing game)",
        },
      },
    );

    const artworks = response.data.results.bindings
      .map((binding) => this.parseWikidataArtwork(binding))
      .filter((artwork): artwork is PaintingGameArtwork => artwork !== null);

    return this.deduplicateArtworks(artworks);
  }

  private parseWikidataArtwork(
    binding: WikidataFamousPaintingBinding,
  ): PaintingGameArtwork | null {
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
  }

  private deduplicateArtworks(artworks: PaintingGameArtwork[]) {
    const uniqueArtworks = new Map<string, PaintingGameArtwork>();

    for (const artwork of artworks) {
      if (!uniqueArtworks.has(artwork.id)) {
        uniqueArtworks.set(artwork.id, artwork);
      }
    }

    return [...uniqueArtworks.values()];
  }

  private getFamousPaintingsSparqlQuery() {
    return `
      SELECT DISTINCT ?item ?itemLabel ?creatorLabel ?image ?catalogCode WHERE {
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

  private convertArtworksToTriviaQuestions(
    artworks: PaintingGameArtwork[],
  ): TriviaQuestion[] {
    const questions: TriviaQuestion[] = [];

    for (const artwork of artworks) {
      const artistQuestion: TriviaQuestion = {
        imageUrl: artwork.imageUrl,
        question: `Kes on selle maali "${artwork.title}" autor?`,
        correctAnswer: artwork.artist,
        wrongAnswers: this.generateWrongArtists(artwork.artist, artworks),
      };

      const titleQuestion: TriviaQuestion = {
        imageUrl: artwork.imageUrl,
        question: `Mis on selle maali nimi, mille autor on ${artwork.artist}?`,
        correctAnswer: artwork.title,
        wrongAnswers: this.generateWrongTitles(artwork.title, artworks),
      };

      questions.push(artistQuestion, titleQuestion);
    }

    return questions;
  }

  private generateWrongArtists(
    correctArtist: string,
    allArtworks: PaintingGameArtwork[],
  ): string[] {
    const otherArtists = allArtworks
      .filter((artwork) => artwork.artist !== correctArtist)
      .map((artwork) => artwork.artist);

    const uniqueArtists = [...new Set(otherArtists)];
    this.shuffleArray(uniqueArtists);

    return uniqueArtists.slice(0, 3);
  }

  private generateWrongTitles(
    correctTitle: string,
    allArtworks: PaintingGameArtwork[],
  ): string[] {
    const otherTitles = allArtworks
      .filter((artwork) => artwork.title !== correctTitle)
      .map((artwork) => artwork.title);

    const uniqueTitles = [...new Set(otherTitles)];
    this.shuffleArray(uniqueTitles);

    return uniqueTitles.slice(0, 3);
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private async writeTriviaQuestionsToSheet(
    questions: TriviaQuestion[],
  ): Promise<void> {
    const sheetsId = process.env.TRIVIA_SHEETS_ID;

    if (!sheetsId) {
      throw new Error("Missing TRIVIA_SHEETS_ID in .env");
    }

    const auth = this.getAuth();

    const spreadsheetResponse = await this.sheets.spreadsheets.get({
      auth,
      spreadsheetId: sheetsId,
    });

    const sheets = spreadsheetResponse.data.sheets || [];
    const firstSheet = sheets[0];

    if (!firstSheet || !firstSheet.properties?.title) {
      throw new Error("Could not find any sheets in the spreadsheet");
    }

    const sheetName = firstSheet.properties.title;

    const headerRow = [
      "Pilt",
      "Küsimus",
      "Õige vastus",
      "Vale vastus 1",
      "Vale vastus 2",
      "Vale vastus 3",
    ];

    const dataRows = questions.map((question) => [
      question.imageUrl,
      question.question,
      question.correctAnswer,
      ...question.wrongAnswers.slice(0, 3),
    ]);

    const values = [headerRow, ...dataRows];

    await this.sheets.spreadsheets.values.clear({
      auth,
      spreadsheetId: sheetsId,
      range: `${sheetName}!A:Z`,
    });

    await this.sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: sheetsId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values,
      },
    });
  }
}

export default new SheetsService();
