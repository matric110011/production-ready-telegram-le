import { MongoClient } from "mongodb";
import { cfg } from "./config.js";
import { log, safeErr } from "./log.js";

let client = null;
let db = null;

export async function connectDb() {
  if (!cfg.MONGODB_URI) {
    log.warn("MongoDB disabled; MONGODB_URI not set", { collection: "all", operation: "connect" });
    return null;
  }

  if (db) return db;

  try {
    client = new MongoClient(cfg.MONGODB_URI, {
      maxPoolSize: 10,
      ignoreUndefined: true,
    });
    await client.connect();
    db = client.db();
    log.info("MongoDB connected", { mongodbUriSet: true });
    await ensureIndexes(db);
    await seedCategories(db);
    return db;
  } catch (err) {
    log.error("MongoDB connection failed", {
      collection: "all",
      operation: "connect",
      err: safeErr(err),
    });
    return null;
  }
}

export function getDb() {
  return db;
}

export async function closeDb() {
  if (client) await client.close();
  client = null;
  db = null;
}

async function safeIndex(collection, key, options = {}) {
  if (Object.keys(key).length === 1 && key._id === 1) return;
  try {
    await collection.createIndex(key, options);
  } catch (err) {
    log.error("MongoDB index failed", {
      collection: collection.collectionName,
      operation: "createIndex",
      err: safeErr(err),
    });
  }
}

async function ensureIndexes(database) {
  await safeIndex(database.collection("users"), { telegramUserId: 1 }, { unique: true });
  await safeIndex(database.collection("users"), { lastActiveAt: -1 });
  await safeIndex(database.collection("resources"), { status: 1, accessTier: 1, category: 1 });
  await safeIndex(database.collection("resources"), { title: "text", description: "text", tags: "text", category: "text" });
  await safeIndex(database.collection("vipSubscriptions"), { telegramUserId: 1, status: 1 });
  await safeIndex(database.collection("vipSubscriptions"), { expiresAt: 1, status: 1 });
  await safeIndex(database.collection("tasks"), { status: 1, createdAt: -1 });
  await safeIndex(database.collection("taskSubmissions"), { taskId: 1, telegramUserId: 1, status: 1 });
  await safeIndex(database.collection("activityEvents"), { eventType: 1, createdAt: -1 });
  await safeIndex(database.collection("activityEvents"), { telegramUserId: 1, createdAt: -1 });
  await safeIndex(database.collection("categories"), { slug: 1 }, { unique: true });
}

function slugify(value) {
  return String(value || "other")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "other";
}

async function seedCategories(database) {
  const { DEFAULT_CATEGORIES } = await import("./config.js");
  const now = new Date();
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
    const name = DEFAULT_CATEGORIES[i];
    try {
      await database.collection("categories").updateOne(
        { slug: slugify(name) },
        {
          $setOnInsert: {
            name,
            slug: slugify(name),
            isVisible: true,
            sortOrder: i,
            createdAt: now,
          },
          $set: { updatedAt: now },
        },
        { upsert: true },
      );
    } catch (err) {
      log.error("MongoDB seed category failed", {
        collection: "categories",
        operation: "updateOne",
        err: safeErr(err),
      });
    }
  }
}
