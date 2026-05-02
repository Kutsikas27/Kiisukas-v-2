import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const DB_NAME = "dekadents_db";

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

export const getMongoDb = async () => {
  if (!mongoUri) {
    throw new Error("MONGODB_URI puudub .env failist.");
  }

  if (!clientPromise) {
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 10_000,
    });
    clientPromise = client.connect();
  }

  const connectedClient = await clientPromise;

  return connectedClient.db(DB_NAME);
};
