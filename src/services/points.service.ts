import { db } from "../lib/db";

export class PointsService {
  public static addPoints(guildId: string, userId: string, points: number) {
    const upsertPoints = db.prepare(`
      INSERT INTO user_points (
        guild_id,
        user_id,
        points
      )
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        points = points + excluded.points
    `);

    upsertPoints.run(guildId, userId, points);
  }

  public static getPoints(guildId: string, userId: string): number {
    const stmt = db.prepare(`
      SELECT points
      FROM user_points
      WHERE guild_id = ? AND user_id = ?
    `);

    const result = stmt.get(guildId, userId) as { points: number } | undefined;
    return result?.points ?? 0;
  }

  public static getTopUsers(guildId: string, limit = 10) {
    const stmt = db.prepare(`
      SELECT
        guild_id,
        user_id,
        points
      FROM user_points
      WHERE guild_id = ?
      ORDER BY points DESC
      LIMIT ?
    `);

    return stmt.all(guildId, limit) as Array<{
      guild_id: string;
      user_id: string;
      points: number;
    }>;
  }
}
