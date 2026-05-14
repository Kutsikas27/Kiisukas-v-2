import { getMongoDb } from "../lib/mongo";
import type { Collection } from "mongodb";
import { DateTime } from "luxon";

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
  last_message_at: string | null;
};

export type ActivityPeriod = "all" | "day" | "week" | "year";

type UserActivityDocument = {
  guildId: string;
  userId: string;
  lineCount: number;
  wordCount: number;
  lastMessageAt: string | null;
};

type UserActivityPeriodDocument = UserActivityDocument & {
  period: Exclude<ActivityPeriod, "all">;
  periodKey: string;
};

type GuildTotals = {
  line_count: number;
  word_count: number;
};

const USER_ACTIVITY_COLLECTION = "user_activity";
const USER_ACTIVITY_PERIOD_COLLECTION = "user_activity_periods";
const TALLINN_TIMEZONE = "Europe/Tallinn";

let indexesReady: Promise<void> | null = null;
let periodIndexesReady: Promise<void> | null = null;

async function getUserActivityCollection() {
  const db = await getMongoDb();
  const collection = db.collection<UserActivityDocument>(
    USER_ACTIVITY_COLLECTION,
  );

  indexesReady ??= createIndexes(collection);
  await indexesReady;

  return collection;
}

async function getUserActivityPeriodCollection() {
  const db = await getMongoDb();
  const collection = db.collection<UserActivityPeriodDocument>(
    USER_ACTIVITY_PERIOD_COLLECTION,
  );

  periodIndexesReady ??= createPeriodIndexes(collection);
  await periodIndexesReady;

  return collection;
}

async function createIndexes(collection: Collection<UserActivityDocument>) {
  await collection.createIndex({ guildId: 1, userId: 1 }, { unique: true });
  await collection.createIndex({ guildId: 1, wordCount: -1, lineCount: -1 });
}

async function createPeriodIndexes(
  collection: Collection<UserActivityPeriodDocument>,
) {
  await collection.createIndex(
    { guildId: 1, userId: 1, period: 1, periodKey: 1 },
    { unique: true },
  );
  await collection.createIndex({
    guildId: 1,
    period: 1,
    periodKey: 1,
    wordCount: -1,
    lineCount: -1,
  });
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

function getPeriodKeys(createdAt: string) {
  const dateTime = DateTime.fromISO(createdAt, { zone: "utc" }).setZone(
    TALLINN_TIMEZONE,
  );

  return {
    day: dateTime.toFormat("yyyy-LL-dd"),
    week: `${dateTime.weekYear}-W${String(dateTime.weekNumber).padStart(
      2,
      "0",
    )}`,
    year: String(dateTime.year),
  } satisfies Record<Exclude<ActivityPeriod, "all">, string>;
}

export class ActivityService {
  public static async recordMessage(input: RecordMessageInput) {
    const content = input.content ?? "";
    const wordCount = countWords(content);
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

    const periodCollection = await getUserActivityPeriodCollection();
    const periodKeys = getPeriodKeys(input.createdAt);

    await Promise.all(
      (Object.entries(periodKeys) as Array<
        [Exclude<ActivityPeriod, "all">, string]
      >).map(([period, periodKey]) =>
        periodCollection.updateOne(
          {
            guildId: input.guildId,
            userId: input.userId,
            period,
            periodKey,
          },
          {
            $inc: {
              lineCount: 1,
              wordCount,
            },
            $set: {
              lastMessageAt: input.createdAt,
            },
            $setOnInsert: {
              guildId: input.guildId,
              userId: input.userId,
              period,
              periodKey,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  public static async getUserStats(
    guildId: string,
    userId: string,
    period: ActivityPeriod = "all",
  ) {
    const collection =
      period === "all"
        ? await getUserActivityCollection()
        : await getUserActivityPeriodCollection();
    const query =
      period === "all"
        ? { guildId, userId }
        : { guildId, userId, period, periodKey: getCurrentPeriodKey(period) };
    const document = await collection.findOne(query);

    return document ? mapUserActivity(document) : undefined;
  }

  public static async getTopUsers(
    guildId: string,
    limit = 10,
    period: ActivityPeriod = "all",
  ) {
    const collection =
      period === "all"
        ? await getUserActivityCollection()
        : await getUserActivityPeriodCollection();
    const query =
      period === "all"
        ? { guildId }
        : { guildId, period, periodKey: getCurrentPeriodKey(period) };
    const documents = await collection
      .find(query)
      .sort({ wordCount: -1, lineCount: -1 })
      .limit(limit)
      .toArray();

    return documents.map(mapUserActivity);
  }

  public static async getGuildTotals(
    guildId: string,
    period: ActivityPeriod = "all",
  ) {
    const collection =
      period === "all"
        ? await getUserActivityCollection()
        : await getUserActivityPeriodCollection();
    const match =
      period === "all"
        ? { guildId }
        : { guildId, period, periodKey: getCurrentPeriodKey(period) };
    const [totals] = await collection
      .aggregate<GuildTotals>([
        { $match: match },
        {
          $group: {
            _id: null,
            line_count: { $sum: "$lineCount" },
            word_count: { $sum: "$wordCount" },
          },
        },
        { $project: { _id: 0 } },
      ])
      .toArray();

    return (
      totals ?? {
        line_count: 0,
        word_count: 0,
      }
    );
  }
}

function getCurrentPeriodKey(period: Exclude<ActivityPeriod, "all">): string {
  return getPeriodKeys(new Date().toISOString())[period];
}

function mapUserActivity(document: UserActivityDocument): UserActivityStats {
  return {
    guild_id: document.guildId,
    user_id: document.userId,
    line_count: document.lineCount ?? 0,
    word_count: document.wordCount ?? 0,
    last_message_at: document.lastMessageAt ?? null,
  };
}
