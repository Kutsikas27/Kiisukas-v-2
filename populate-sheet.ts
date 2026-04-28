import "dotenv/config";
import SheetsService from "./src/services/sheets.service";

async function populateSheet() {
  try {
    console.log("Starting to populate Google Sheet with Wikidata artworks...");

    await SheetsService.populateSheetWithWikidata();

    console.log("✅ Successfully populated the sheet!");
    console.log("You can now use /pildimäng command in Discord.");
  } catch (error) {
    console.error("❌ Failed to populate sheet:", error);
    process.exit(1);
  }
}

populateSheet();
