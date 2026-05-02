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
      family: 4,
      serverSelectionTimeoutMS: 3_000,
    });
    clientPromise = client.connect().catch((error) => {
      client = null;
      clientPromise = null;
      throw error;
    });
  }

  const connectedClient = await clientPromise;

  return connectedClient.db(DB_NAME);
};
