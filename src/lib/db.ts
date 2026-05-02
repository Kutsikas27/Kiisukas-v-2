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
  CREATE TABLE IF NOT EXISTS user_activity (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    line_count INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    PRIMARY KEY (guild_id, user_id)  );

  CREATE TABLE IF NOT EXISTS user_points (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)  );

  CREATE TABLE IF NOT EXISTS message_logs (
    message_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    line_count INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_message_logs_guild_user
    ON message_logs (guild_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_message_logs_guild_created_at
    ON message_logs (guild_id, created_at);
`);
