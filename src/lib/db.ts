import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const localDataPath = path.join(process.cwd(), "data", "bot.sqlite");
const dbPath = process.env.DB_PATH ?? (fs.existsSync("/data") ? "/data/bot.sqlite" : localDataPath);
const resolvedDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
const dbDir = path.dirname(resolvedDbPath);
fs.mkdirSync(dbDir, { recursive: true });

type DB = InstanceType<typeof Database>;
export const db: DB = new Database(resolvedDbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS user_points (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)  );
`);
