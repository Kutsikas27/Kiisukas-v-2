import { getMongoDb } from "../lib/mongo";
import type { Collection } from "mongodb";

type UserPointsDocument = {
  guildId: string;
  userId: string;
  points: number;
};

type UserPoints = {
  guild_id: string;
  user_id: string;
  points: number;
};

const USER_POINTS_COLLECTION = "user_points";

let indexesReady: Promise<void> | null = null;

async function getUserPointsCollection() {
  const db = await getMongoDb();
  const collection = db.collection<UserPointsDocument>(USER_POINTS_COLLECTION);

  indexesReady ??= createIndexes(collection);
  await indexesReady;

  return collection;
}

async function createIndexes(collection: Collection<UserPointsDocument>) {
  await collection.createIndex({ guildId: 1, userId: 1 }, { unique: true });
  await collection.createIndex({ guildId: 1, points: -1 });
}

export class PointsService {
  public static async addPoints(guildId: string, userId: string, points: number) {
    const collection = await getUserPointsCollection();

    await collection.updateOne(
      { guildId, userId },
      {
        $inc: { points },
        $setOnInsert: { guildId, userId },
      },
      { upsert: true },
    );
  }

  public static async getPoints(guildId: string, userId: string): Promise<number> {
    const collection = await getUserPointsCollection();
    const document = await collection.findOne({ guildId, userId });

    return document?.points ?? 0;
  }

  public static async getTopUsers(guildId: string, limit = 10) {
    const collection = await getUserPointsCollection();
    const documents = await collection
      .find({ guildId })
      .sort({ points: -1 })
      .limit(limit)
      .toArray();

    return documents.map(mapUserPoints);
  }
}

function mapUserPoints(document: UserPointsDocument): UserPoints {
  return {
    guild_id: document.guildId,
    user_id: document.userId,
    points: document.points ?? 0,
  };
}
