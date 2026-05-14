import { getMongoDb } from "../lib/mongo";
import type { Collection } from "mongodb";
import { DateTime } from "luxon";

type RecordMessageInput = {
  guildId: string;
  userId: string;
  displayName: string;
  username: string;
  content: string;
  createdAt: string;
};

type UserActivityStats = {
  guild_id: string;
  user_id: string;
  display_name: string | null;
  username: string | null;
  line_count: number;
  word_count: number;
  last_message_at: string | null;
};

export type ActivityPeriod = "all" | "week" | "month" | "year";

type UserActivityDocument = {
  guildId: string;
  userId: string;
  displayName?: string | null;
  username?: string | null;
  lineCount: number;
  wordCount: number;
  lastMessageAt: string | null;
};

type UserActivityPeriodDocument = UserActivityDocument & {
  period?: Exclude<ActivityPeriod, "all">;
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
    { guildId: 1, userId: 1, periodKey: 1 },
    { unique: true },
  );
  await collection.createIndex({
    guildId: 1,
    periodKey: 1,
    wordCount: -1,
    lineCount: -1,
  });
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

function getTallinnDateTime(value: string | Date = new Date()) {
  const dateTime =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: "utc" })
      : DateTime.fromISO(value, { zone: "utc" });

  return dateTime.setZone(TALLINN_TIMEZONE);
}

function getDailyPeriodKey(value: string | Date = new Date()): string {
  return getTallinnDateTime(value).toFormat("yyyy-LL-dd");
}

function getPeriodKeyRange(period: Exclude<ActivityPeriod, "all">) {
  const now = getTallinnDateTime();
  const start = now.startOf(period);
  const end = now.endOf(period);

  return {
    startKey: start.toFormat("yyyy-LL-dd"),
    endKey: end.toFormat("yyyy-LL-dd"),
  };
}

function getPeriodMatch(
  guildId: string,
  period: Exclude<ActivityPeriod, "all">,
) {
  const { startKey, endKey } = getPeriodKeyRange(period);
  const legacyPeriodKey = getLegacyPeriodKey(period);

  return {
    guildId,
    $or: [
      {
        periodKey: {
          $gte: startKey,
          $lte: endKey,
        },
      },
      {
        period,
        periodKey: legacyPeriodKey,
      },
    ],
  };
}

function getUserPeriodMatch(
  guildId: string,
  userId: string,
  period: Exclude<ActivityPeriod, "all">,
) {
  return {
    ...getPeriodMatch(guildId, period),
    userId,
  };
}

function mapPeriodAggregate(document: UserActivityDocument): UserActivityDocument {
  return {
    guildId: document.guildId,
    userId: document.userId,
    displayName: document.displayName ?? null,
    username: document.username ?? null,
    lineCount: document.lineCount ?? 0,
    wordCount: document.wordCount ?? 0,
    lastMessageAt: document.lastMessageAt ?? null,
  };
}

function getPeriodAggregationPipeline(match: Record<string, unknown>) {
  return [
    { $match: match },
    { $sort: { lastMessageAt: -1 } },
    {
      $group: {
        _id: {
          guildId: "$guildId",
          userId: "$userId",
        },
        guildId: { $first: "$guildId" },
        userId: { $first: "$userId" },
        displayName: { $first: "$displayName" },
        username: { $first: "$username" },
        lineCount: { $sum: "$lineCount" },
        wordCount: { $sum: "$wordCount" },
        lastMessageAt: { $max: "$lastMessageAt" },
      },
    },
    { $project: { _id: 0 } },
  ];
}

function getLegacyPeriodKeys(createdAt: string) {
  const dateTime = DateTime.fromISO(createdAt, { zone: "utc" }).setZone(
    TALLINN_TIMEZONE,
  );

  return {
    week: `${dateTime.weekYear}-W${String(dateTime.weekNumber).padStart(
      2,
      "0",
    )}`,
    month: dateTime.toFormat("yyyy-LL"),
    year: String(dateTime.year),
  } satisfies Record<Exclude<ActivityPeriod, "all">, string>;
}

function getLegacyPeriodKey(period: Exclude<ActivityPeriod, "all">): string {
  return getLegacyPeriodKeys(new Date().toISOString())[period];
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
          displayName: input.displayName,
          username: input.username,
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
    const periodKey = getDailyPeriodKey(input.createdAt);

    await periodCollection.updateOne(
      {
        guildId: input.guildId,
        userId: input.userId,
        periodKey,
      },
      {
        $inc: {
          lineCount: 1,
          wordCount,
        },
        $set: {
          displayName: input.displayName,
          username: input.username,
          lastMessageAt: input.createdAt,
        },
        $setOnInsert: {
          guildId: input.guildId,
          userId: input.userId,
          periodKey,
        },
      },
      { upsert: true },
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
    if (period !== "all") {
      const [document] = await collection
        .aggregate<UserActivityDocument>(
          getPeriodAggregationPipeline(
            getUserPeriodMatch(guildId, userId, period),
          ),
        )
        .toArray();

      return document ? mapUserActivity(mapPeriodAggregate(document)) : undefined;
    }

    const document = await collection.findOne({ guildId, userId });

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
    if (period !== "all") {
      const documents = await collection
        .aggregate<UserActivityDocument>([
          ...getPeriodAggregationPipeline(getPeriodMatch(guildId, period)),
          { $sort: { wordCount: -1, lineCount: -1 } },
          { $limit: limit },
        ])
        .toArray();

      return documents.map((document) =>
        mapUserActivity(mapPeriodAggregate(document)),
      );
    }

    const documents = await collection
      .find({ guildId })
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
      period === "all" ? { guildId } : getPeriodMatch(guildId, period);
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

function mapUserActivity(document: UserActivityDocument): UserActivityStats {
  return {
    guild_id: document.guildId,
    user_id: document.userId,
    display_name: document.displayName ?? null,
    username: document.username ?? null,
    line_count: document.lineCount ?? 0,
    word_count: document.wordCount ?? 0,
    last_message_at: document.lastMessageAt ?? null,
  };
}
