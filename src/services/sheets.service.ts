import { google } from "googleapis";

export interface TriviaQuestion {
  imageUrl: string;
  question: string;
  correctAnswer: string;
  wrongAnswers: string[];
}

interface SheetRow {
  imagePath: string;
  question: string;
  correctAnswer: string;
  wrongAnswers: string[];
}

class SheetsService {
  private sheets = google.sheets("v4");
  private cache: TriviaQuestion[] | null = null;
  private cacheTime = 0;
  private readonly cacheTtl = 1000 * 60 * 60; // 1 hour

  private getAuth() {
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    );

    if (!clientEmail || !privateKey) {
      throw new Error(
        "Missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY in .env",
      );
    }

    return new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
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
      const response = await this.sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: sheetsId,
        range: "Sheet1!A:G", // Columns A-G (image, question, answer, wrong answers)
      });

      const rows = response.data.values || [];

      if (rows.length === 0) {
        throw new Error("Sheet has no data");
      }

      // Skip header row if present
      const dataRows = rows.slice(1);
      const questions: TriviaQuestion[] = [];

      for (const row of dataRows) {
        if (row.length < 3) {
          continue;
        }

        const [imagePath, question, correctAnswer, ...wrongAnswers] = row;

        if (!imagePath || !question || !correctAnswer) {
          continue;
        }

        // Filter out empty wrong answers
        const filteredWrongAnswers = wrongAnswers.filter(
          (a: string) => a && a.trim(),
        );

        questions.push({
          imageUrl: imagePath.trim(),
          question: question.trim(),
          correctAnswer: correctAnswer.trim(),
          wrongAnswers: filteredWrongAnswers.map((a: string) => a.trim()),
        });
      }

      this.cache = questions;
      this.cacheTime = now;

      console.log(`Loaded ${questions.length} trivia questions from Google Sheets`);

      return questions;
    } catch (error) {
      console.error("Failed to fetch trivia questions from Google Sheets:", error);
      throw error;
    }
  }

  clearCache() {
    this.cache = null;
    this.cacheTime = 0;
  }
}

export default new SheetsService();
