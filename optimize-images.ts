import sharp from "sharp";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const PICTURES_DIR = path.join(process.cwd(), "pictures");

async function optimizeImages() {
  try {
    const files = await fs.readdir(PICTURES_DIR);
    const imageFiles = files.filter(
      (file) => /\.(webp|jpg|jpeg|png)$/i.test(file) && file !== ".gitkeep",
    );

    console.log(`Found ${imageFiles.length} images to optimize`);

    for (const fileName of imageFiles) {
      const inputPath = path.join(PICTURES_DIR, fileName);
      const outputPath = path.join(
        PICTURES_DIR,
        fileName.replace(/\.(webp|jpg|jpeg|png)$/i, ".png"),
      );

      try {
        console.log(`Optimizing: ${fileName}`);

        const imageBuffer = await fs.readFile(inputPath);

        await sharp(imageBuffer)
          .resize({
            width: 300,
            height: 450,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png({ palette: true, colors: 256, quality: 70 })
          .toFile(outputPath);

        // If output file is different from input, remove old file
        if (outputPath !== inputPath) {
          await fs.unlink(inputPath);
          console.log(
            `✅ Replaced with optimized: ${path.basename(outputPath)}`,
          );
        } else {
          console.log(`✅ Optimized in place: ${fileName}`);
        }
      } catch (error) {
        console.error(`❌ Failed to optimize ${fileName}:`, error);
      }
    }

    console.log("✅ Image optimization complete!");
  } catch (error) {
    console.error("Failed to optimize images:", error);
    process.exit(1);
  }
}

optimizeImages();
