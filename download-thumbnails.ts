import "dotenv/config";
import axios from "axios";
import { google } from "googleapis";
import sharp from "sharp";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const THUMB_DIR = path.join(process.cwd(), "pictures");
const DELAY_BETWEEN_REQUESTS = 5000; // 5 seconds between requests

function sanitizeFilename(text: string) {
  // First decode URL encoding if present
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // If decoding fails, use original text
  }

  return decoded
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with dash
    .replace(/^-|-$/g, "") // Remove leading/trailing dashes
    .slice(0, 60);
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImageWithRetry(
  imageUrl: string,
  maxRetries: number = 2,
): Promise<Buffer | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const imageResponse = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (compatible; Wikimedia-DiscordBot/1.0; +https://kiisukas.ee)",
          Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });

      return Buffer.from(imageResponse.data);
    } catch (error: any) {
      const status = error.response?.status;
      const retryAfter = error.response?.headers?.["retry-after"];

      if (status === 429) {
        const waitTime = retryAfter
          ? parseInt(retryAfter) * 1000
          : 10000 * Math.pow(2, attempt);
        console.log(
          `⏳ Rate limited. Waiting ${Math.ceil(
            waitTime / 1000,
          )}s before retry...`,
        );
        await delay(waitTime);
        continue;
      }

      if (attempt < maxRetries - 1) {
        console.log(
          `⚠️  Attempt ${attempt + 1} failed, retrying in 3s... (${
            status || error.message
          })`,
        );
        await delay(3000);
        continue;
      }

      console.error(`❌ Failed after ${maxRetries} attempts: ${error.message}`);
      return null;
    }
  }

  return null;
}

async function main() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );
  const sheetsId = process.env.TRIVIA_SHEETS_ID;

  if (!clientEmail || !privateKey || !sheetsId) {
    console.error(
      "Missing GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, or TRIVIA_SHEETS_ID in .env",
    );
    process.exit(1);
  }

  await fs.mkdir(THUMB_DIR, { recursive: true });
  console.log(`📁 Thumbnails folder: ${THUMB_DIR}`);

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets("v4");

  const spreadsheetResponse = await sheets.spreadsheets.get({
    auth,
    spreadsheetId: sheetsId,
  });

  const firstSheet = spreadsheetResponse.data.sheets?.[0];
  if (!firstSheet?.properties?.title) {
    throw new Error("Could not find a sheet tab in the spreadsheet");
  }

  const sheetName = firstSheet.properties.title;
  const response = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId: sheetsId,
    range: `${sheetName}!A2:C`, // Get image URL, question, and correct answer
  });

  const rows = response.data.values || [];

  if (rows.length === 0) {
    console.log("❌ No rows found in the sheet");
    return;
  }

  console.log(`📥 Found ${rows.length} images to download`);

  const updatedPaths: string[] = [];
  let downloadCount = 0;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const imageUrl = String(row[0] || "").trim();
    const question = String(row[1] || "").trim();
    const correctAnswer = String(row[2] || "").trim();

    // Skip if no URL, or if it's already a local file (contains .webp, .jpg, etc.)
    if (!imageUrl) {
      console.log(`⏭️  Row ${index + 2}: Empty URL, skipping`);
      updatedPaths.push(imageUrl);
      continue;
    }

    const isLocalFile =
      !imageUrl.startsWith("http://") && !imageUrl.startsWith("https://");
    const hasImageExtension = /\.(webp|jpg|jpeg|png|gif)$/i.test(imageUrl);

    if (isLocalFile && hasImageExtension) {
      console.log(`✅ Row ${index + 2}: Already local (${imageUrl})`);
      updatedPaths.push(imageUrl);
      continue;
    }

    if (isLocalFile) {
      console.log(`⏭️  Row ${index + 2}: Skipping non-URL: ${imageUrl}`);
      updatedPaths.push(imageUrl);
      continue;
    }

    // Extract artist and painting name from question/answer
    let fileName: string;

    // Try to extract artist and painting title
    const artist = correctAnswer ? sanitizeFilename(correctAnswer) : "unknown";
    const paintingMatch = question.match(/"([^"]+)"/);
    const painting = paintingMatch
      ? sanitizeFilename(paintingMatch[1])
      : "untitled";

    fileName = `${artist}-${painting}.webp`;

    const outputPath = path.join(THUMB_DIR, fileName);

    try {
      if (existsSync(outputPath)) {
        console.log(`✅ Row ${index + 2}: ${fileName} (already exists)`);
      } else {
        console.log(`⬇️  Row ${index + 2}: Downloading for ${fileName}`);

        const imageBuffer = await downloadImageWithRetry(imageUrl);

        if (!imageBuffer) {
          console.error(
            `❌ Row ${index + 2}: Skipping, could not download image`,
          );
          updatedPaths.push(imageUrl);
          continue;
        }

        await sharp(imageBuffer)
          .resize({
            width: 640,
            height: 960,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 80 })
          .toFile(outputPath);

        console.log(`✨ Row ${index + 2}: Saved as ${fileName}`);
        downloadCount++;
      }

      updatedPaths.push(fileName);

      // Add delay between requests to avoid rate limiting
      if (index < rows.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS);
      }
    } catch (error) {
      console.error(`❌ Row ${index + 2}: Failed to process`, error);
      updatedPaths.push(imageUrl);
    }
  }

  // Update the sheet with local file paths
  console.log("\n📝 Updating Google Sheet with local paths...");
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: sheetsId,
    range: `${sheetName}!A2:A${updatedPaths.length + 1}`,
    valueInputOption: "RAW",
    requestBody: {
      values: updatedPaths.map((p) => [p]),
    },
  });

  console.log(
    `\n✅ Done! Downloaded ${downloadCount} new thumbnails, saved in: pictures/`,
  );
}

main().catch((error) => {
  console.error("Failed to download thumbnails:", error);
  process.exit(1);
});
