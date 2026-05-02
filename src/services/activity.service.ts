import { db } from "../lib/db";

type RecordMessageInput = {
  messageId: string;
  guildId: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: string;
};

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}
function countLines(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

export class ActivityService {
  public static recordMessage(input: RecordMessageInput) {
    const content = input.content ?? "";
    const wordCount = countWords(content);
    const lineCount = countLines(content);
    const charCount = content.length;

    const insertLog = db.prepare(`
      INSERT OR IGNORE INTO message_logs (
        message_id,
        guild_id,
        channel_id,
        user_id,
        content,
        line_count,
        word_count,
        char_count,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLog.run(
      input.messageId,
      input.guildId,
      input.channelId,
      input.userId,
      content,
      lineCount,
      wordCount,
      charCount,
      input.createdAt,
    );
  }

  public static getUserStats(guildId: string, userId: string) {
    const stmt = db.prepare(`
      SELECT
        guild_id,
        user_id,
        COUNT(*) AS message_count,
        COALESCE(SUM(line_count), 0) AS line_count,
        COALESCE(SUM(word_count), 0) AS word_count,
        COALESCE(SUM(char_count), 0) AS char_count,
        MAX(created_at) AS last_message_at
      FROM message_logs
      WHERE guild_id = ? AND user_id = ?
      GROUP BY guild_id, user_id
    `);

    return stmt.get(guildId, userId) as
      | {
          guild_id: string;
          user_id: string;
          message_count: number;
          line_count: number;
          word_count: number;
          char_count: number;
          last_message_at: string | null;
        }
      | undefined;
  }

  public static getTopUsers(guildId: string, limit = 10) {
    const stmt = db.prepare(`
      SELECT
        guild_id,
        user_id,
        COUNT(*) AS message_count,
        COALESCE(SUM(line_count), 0) AS line_count,
        COALESCE(SUM(word_count), 0) AS word_count,
        COALESCE(SUM(char_count), 0) AS char_count,
        MAX(created_at) AS last_message_at
      FROM message_logs
      WHERE guild_id = ?
      GROUP BY guild_id, user_id
      ORDER BY word_count DESC, message_count DESC
      LIMIT ?
    `);

    return stmt.all(guildId, limit) as Array<{
      guild_id: string;
      user_id: string;
      message_count: number;
      line_count: number;
      word_count: number;
      char_count: number;
      last_message_at: string | null;
    }>;
  }
  public static getGuildTotals(guildId: string) {
    const stmt = db.prepare(`
    SELECT
      COUNT(*) AS message_count,
      COALESCE(SUM(line_count), 0) AS line_count,
      COALESCE(SUM(word_count), 0) AS word_count,
      COALESCE(SUM(char_count), 0) AS char_count
    FROM message_logs
    WHERE guild_id = ?
  `);

    return stmt.get(guildId) as {
      message_count: number;
      line_count: number;
      word_count: number;
      char_count: number;
    };
  }
}
