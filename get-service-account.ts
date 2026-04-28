import "dotenv/config";

const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;

if (!clientEmail) {
  console.error("❌ GOOGLE_SHEETS_CLIENT_EMAIL not found in .env");
  console.log(
    "Please make sure your .env file contains the service account credentials.",
  );
  process.exit(1);
}

console.log("🔑 Service Account Email:", clientEmail);
console.log("\n📋 To allow the bot to write to your Google Sheet:");
console.log("1. Open your Google Sheet in a browser");
console.log("2. Click 'Share' button");
console.log("3. Paste the email above and give it 'Editor' access");
console.log("4. Click 'Send'");
console.log("\nThen run: npm run populate-sheet");
