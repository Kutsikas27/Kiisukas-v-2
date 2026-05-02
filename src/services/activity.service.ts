import { getMongoDb } from "../lib/mongo";
import type { Collection } from "mongodb";

type RecordMessageInput = {
  guildId: string;
  userId: string;
  content: string;
  createdAt: string;
};

type UserActivityStats = {
  guild_id: string;
  user_id: string;
  line_count: number;
  word_count: number;
  char_count: number;
  last_message_at: string | null;
};

type UserActivityDocument = {
  guildId: string;
  userId: string;
  lineCount: number;
  wordCount: number;
  charCount: number;
  lastMessageAt: string | null;
};

type GuildTotals = {
  line_count: number;
  word_count: number;
  char_count: number;
};

const USER_ACTIVITY_COLLECTION = "user_activity";

let indexesReady: Promise<void> | null = null;

async function getUserActivityCollection() {
  const db = await getMongoDb();
  const collection = db.collection<UserActivityDocument>(
    USER_ACTIVITY_COLLECTION,
  );

  indexesReady ??= createIndexes(collection);
  await indexesReady;

  return collection;
}

async function createIndexes(collection: Collection<UserActivityDocument>) {
  await collection.createIndex({ guildId: 1, userId: 1 }, { unique: true });
  await collection.createIndex({ guildId: 1, wordCount: -1, lineCount: -1 });
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

export class ActivityService {
  public static async recordMessage(input: RecordMessageInput) {
    const content = input.content ?? "";
    const wordCount = countWords(content);
    const charCount = content.length;
    const collection = await getUserActivityCollection();

    await collection.updateOne(
      {
        guildId: input.guildId,
        userId: input.userId,
      },
      {
        $inc: {
          lineCount: 1,
          wordCount,
          charCount,
        },
        $set: {
          lastMessageAt: input.createdAt,
        },
        $setOnInsert: {
          guildId: input.guildId,
          userId: input.userId,
        },
      },
      { upsert: true },
    );
  }

  public static async getUserStats(guildId: string, userId: string) {
    const collection = await getUserActivityCollection();
    const document = await collection.findOne({ guildId, userId });

    return document ? mapUserActivity(document) : undefined;
  }

  public static async getTopUsers(guildId: string, limit = 10) {
    const collection = await getUserActivityCollection();
    const documents = await collection
      .find({ guildId })
      .sort({ wordCount: -1, lineCount: -1 })
      .limit(limit)
      .toArray();

    return documents.map(mapUserActivity);
  }

  public static async getGuildTotals(guildId: string) {
    const collection = await getUserActivityCollection();
    const [totals] = await collection
      .aggregate<GuildTotals>([
        { $match: { guildId } },
        {
          $group: {
            _id: null,
            line_count: { $sum: "$lineCount" },
            word_count: { $sum: "$wordCount" },
            char_count: { $sum: "$charCount" },
          },
        },
        { $project: { _id: 0 } },
      ])
      .toArray();

    return (
      totals ?? {
        line_count: 0,
        word_count: 0,
        char_count: 0,
      }
    );
  }
}

function mapUserActivity(document: UserActivityDocument): UserActivityStats {
  return {
    guild_id: document.guildId,
    user_id: document.userId,
    line_count: document.lineCount ?? 0,
    word_count: document.wordCount ?? 0,
    char_count: document.charCount ?? 0,
    last_message_at: document.lastMessageAt ?? null,
  };
}
