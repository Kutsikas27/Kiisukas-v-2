import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME ?? "kiisukas";

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

export const getMongoDb = async () => {
  if (!mongoUri) {
    throw new Error("MONGODB_URI puudub .env failist.");
  }

  if (!clientPromise) {
    client = new MongoClient(mongoUri);
    clientPromise = client.connect();
  }

  const connectedClient = await clientPromise;

  return connectedClient.db(dbName);
};
