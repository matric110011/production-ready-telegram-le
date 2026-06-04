import { ObjectId } from "mongodb";
import { getDb } from "../lib/db.js";
import { cfg } from "../lib/config.js";
import { log, safeErr } from "../lib/log.js";

export const PAGE_SIZE = 5;

export function slugify(value) {
  return String(value || "other")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "other";
}

export function cleanMutable(obj) {
  const copy = { ...obj };
  delete copy._id;
  delete copy.createdAt;
  return copy;
}

function col(name) {
  const db = getDb();
  if (!db) return null;
  return db.collection(name);
}

export async function upsertUser(from) {
  if (!from?.id) return null;
  const users = col("users");
  if (!users) return null;
  const now = new Date();
  const mutable = cleanMutable({
    username: from.username || "",
    firstName: from.first_name || "",
    lastName: from.last_name || "",
    languageCode: from.language_code || "",
    lastSeenAt: now,
    lastActiveAt: now,
    updatedAt: now,
  });

  try {
    await users.updateOne(
      { telegramUserId: String(from.id) },
      {
        $setOnInsert: {
          telegramUserId: String(from.id),
          role: "user",
          isBlocked: false,
          totalVisits: 0,
          totalDownloads: 0,
          createdAt: now,
          firstSeenAt: now,
        },
        $set: mutable,
        $inc: { totalVisits: 1 },
      },
      { upsert: true },
    );
    return users.findOne({ telegramUserId: String(from.id) });
  } catch (err) {
    log.error("MongoDB user upsert failed", { collection: "users", operation: "updateOne", err: safeErr(err) });
    return null;
  }
}

export async function markUserActive(from) {
  if (!from?.id) return;
  const users = col("users");
  if (!users) return;
  try {
    await users.updateOne(
      { telegramUserId: String(from.id) },
      {
        $setOnInsert: { telegramUserId: String(from.id), createdAt: new Date(), firstSeenAt: new Date() },
        $set: {
          username: from.username || "",
          firstName: from.first_name || "",
          lastName: from.last_name || "",
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    log.error("MongoDB user activity failed", { collection: "users", operation: "updateOne", err: safeErr(err) });
  }
}

export async function recordEvent(eventType, ctxOrUserId, metadata = {}) {
  const events = col("activityEvents");
  if (!events) return;
  const from = ctxOrUserId?.from || null;
  const telegramUserId = from?.id ? String(from.id) : String(ctxOrUserId || "");
  try {
    await events.insertOne({
      telegramUserId,
      eventType,
      metadata: cleanMutable(metadata),
      });
  } catch (err) {
    log.error("MongoDB activity insert failed", { collection: "activityEvents", operation: "insertOne", err: safeErr(err) });
  }
}

export async function listCategories(page = 0) {
  const categories = col("categories");
  if (!categories) return { rows: [], total: 0 };
  const skip = Math.max(0, page) * PAGE_SIZE;
  try {
    const q = { isVisible: { $ne: false } };
    const [rows, total] = await Promise.all([
      categories.find(q).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(PAGE_SIZE).toArray(),
      categories.countDocuments(q),
    ]);
    return { rows, total };
  } catch (err) {
    log.error("MongoDB category list failed", { collection: "categories", operation: "find", err: safeErr(err) });
    return { rows: [], total: 0 };
  }
}

export async function ensureCategory(name, adminId = "system") {
  const categories = col("categories");
  if (!categories) return { name, slug: slugify(name) };
  const now = new Date();
  const slug = slugify(name);
  try {
    await categories.updateOne(
      { slug },
      {
        $setOnInsert: {
          name,
          slug,
          isVisible: true,
          sortOrder: 999,
          createdByAdminId: String(adminId),
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
    return categories.findOne({ slug });
  } catch (err) {
    log.error("MongoDB category upsert failed", { collection: "categories", operation: "updateOne", err: safeErr(err) });
    return { name, slug };
  }
}

export async function createResource(data) {
  const resources = col("resources");
  if (!resources) return null;
  const now = new Date();
  const doc = {
    title: data.title,
    description: data.description || "",
    category: data.category || "Other",
    categorySlug: slugify(data.category || "Other"),
    tags: Array.isArray(data.tags) ? data.tags : [],
    accessTier: data.accessTier === "vip" ? "vip" : "free",
    storageChatId: String(data.storageChatId || cfg.STORAGE_CHANNEL_ID || ""),
    storageMessageId: Number(data.storageMessageId),
    contentType: data.contentType || "message",
    uploadedByAdminId: String(data.uploadedByAdminId || ""),
    status: "published",
    viewCount: 0,
    downloadCount: 0,
    failedDeliveryCount: 0,
    updatedAt: now,
    publishedAt: now,
  };
  try {
    const res = await resources.insertOne(doc);
    return { ...doc, _id: res.insertedId };
  } catch (err) {
    log.error("MongoDB resource insert failed", { collection: "resources", operation: "insertOne", err: safeErr(err) });
    return null;
  }
}

export async function listResources({ page = 0, categorySlug = "", tier = "", search = "" } = {}) {
  const resources = col("resources");
  if (!resources) return { rows: [], total: 0 };
  const q = { status: "published" };
  if (categorySlug) q.categorySlug = categorySlug;
  if (tier === "free" || tier === "vip") q.accessTier = tier;
  if (search) q.$text = { $search: search };
  const skip = Math.max(0, page) * PAGE_SIZE;
  try {
    const [rows, total] = await Promise.all([
      resources.find(q).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).toArray(),
      resources.countDocuments(q),
    ]);
    return { rows, total };
  } catch (err) {
    log.error("MongoDB resource list failed", { collection: "resources", operation: "find", err: safeErr(err) });
    return { rows: [], total: 0 };
  }
}

export async function getResource(id) {
  const resources = col("resources");
  if (!resources || !ObjectId.isValid(id)) return null;
  try {
    return resources.findOne({ _id: new ObjectId(id), status: { $ne: "deleted" } });
  } catch (err) {
    log.error("MongoDB resource read failed", { collection: "resources", operation: "findOne", err: safeErr(err) });
    return null;
  }
}

export async function incrementResource(id, field) {
  const resources = col("resources");
  if (!resources || !ObjectId.isValid(id)) return;
  const allowed = ["viewCount", "downloadCount", "failedDeliveryCount"];
  if (!allowed.includes(field)) return;
  try {
    await resources.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { [field]: 1 }, $set: { updatedAt: new Date(), lastAccessedAt: new Date() } },
    );
  } catch (err) {
    log.error("MongoDB resource increment failed", { collection: "resources", operation: "updateOne", err: safeErr(err) });
  }
}

export async function setResourceStatus(id, status) {
  const resources = col("resources");
  if (!resources || !ObjectId.isValid(id)) return false;
  try {
    await resources.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
    );
    return true;
  } catch (err) {
    log.error("MongoDB resource status failed", { collection: "resources", operation: "updateOne", err: safeErr(err) });
    return false;
  }
}

export async function getVipStatus(userId) {
  const vips = col("vipSubscriptions");
  if (!vips || !userId) return { active: false, subscription: null };
  try {
    const sub = await vips.findOne({ telegramUserId: String(userId), status: "active" }, { sort: { } });
    if (!sub) return { active: false, subscription: null };
    if (sub.isLifetime) return { active: true, subscription: sub };
    if (sub.expiresAt && new Date(sub.expiresAt).getTime() > Date.now()) return { active: true, subscription: sub };
    await vips.updateOne(
      { _id: sub._id },
      { $set: { status: "expired", expiredAt: new Date(), updatedAt: new Date() } },
    );
    return { active: false, subscription: { ...sub, status: "expired" } };
  } catch (err) {
    log.error("MongoDB VIP read failed", { collection: "vipSubscriptions", operation: "findOne", err: safeErr(err) });
    return { active: false, subscription: null };
  }
}

export async function grantVip({ telegramUserId, days, isLifetime = false, grantedByAdminId = "", note = "" }) {
  const vips = col("vipSubscriptions");
  if (!vips) return null;
  const now = new Date();
  const current = await getVipStatus(telegramUserId);
  const base = current.active && current.subscription?.expiresAt ? new Date(current.subscription.expiresAt) : now;
  const expiresAt = isLifetime ? null : new Date(base.getTime() + Number(days || cfg.DEFAULT_VIP_DAYS || 30) * 86400000);
  try {
    await vips.updateMany(
      { telegramUserId: String(telegramUserId), status: "active" },
      { $set: { status: "replaced", updatedAt: now } },
    );
    const doc = {
      telegramUserId: String(telegramUserId),
      status: "active",
      startedAt: now,
      expiresAt,
      isLifetime,
      durationDays: isLifetime ? null : Number(days || cfg.DEFAULT_VIP_DAYS || 30),
      grantedByAdminId: String(grantedByAdminId || ""),
      note,
      updatedAt: now,
    };
    const res = await vips.insertOne(doc);
    return { ...doc, _id: res.insertedId };
  } catch (err) {
    log.error("MongoDB VIP grant failed", { collection: "vipSubscriptions", operation: "insertOne", err: safeErr(err) });
    return null;
  }
}

export async function removeVip(telegramUserId, adminId = "") {
  const vips = col("vipSubscriptions");
  if (!vips) return false;
  try {
    await vips.updateMany(
      { telegramUserId: String(telegramUserId), status: "active" },
      { $set: { status: "cancelled", cancelledByAdminId: String(adminId), updatedAt: new Date() } },
    );
    return true;
  } catch (err) {
    log.error("MongoDB VIP remove failed", { collection: "vipSubscriptions", operation: "updateMany", err: safeErr(err) });
    return false;
  }
}

export async function listVip(status = "active", limit = 10) {
  const vips = col("vipSubscriptions");
  if (!vips) return [];
  try {
    return vips.find({ status }).sort({ }).limit(limit).toArray();
  } catch (err) {
    log.error("MongoDB VIP list failed", { collection: "vipSubscriptions", operation: "find", err: safeErr(err) });
    return [];
  }
}

export async function createTask(data) {
  const tasks = col("tasks");
  if (!tasks) return null;
  const now = new Date();
  const doc = {
    title: data.title,
    instructions: data.instructions,
    rewardType: data.rewardVipDays ? "vip_days" : "none",
    rewardVipDays: Number(data.rewardVipDays || 0),
    status: "active",
    createdByAdminId: String(data.createdByAdminId || ""),
    updatedAt: now,
  };
  try {
    const res = await tasks.insertOne(doc);
    return { ...doc, _id: res.insertedId };
  } catch (err) {
    log.error("MongoDB task insert failed", { collection: "tasks", operation: "insertOne", err: safeErr(err) });
    return null;
  }
}

export async function listTasks(status = "active") {
  const tasks = col("tasks");
  if (!tasks) return [];
  try {
    return tasks.find({ status }).sort({ createdAt: -1 }).limit(20).toArray();
  } catch (err) {
    log.error("MongoDB task list failed", { collection: "tasks", operation: "find", err: safeErr(err) });
    return [];
  }
}

export async function getTask(id) {
  const tasks = col("tasks");
  if (!tasks || !ObjectId.isValid(id)) return null;
  try {
    return tasks.findOne({ _id: new ObjectId(id) });
  } catch (err) {
    log.error("MongoDB task read failed", { collection: "tasks", operation: "findOne", err: safeErr(err) });
    return null;
  }
}

export async function submitTask({ taskId, telegramUserId, messageId, text }) {
  const subs = col("taskSubmissions");
  if (!subs || !ObjectId.isValid(taskId)) return null;
  const now = new Date();
  const doc = {
    taskId: new ObjectId(taskId),
    telegramUserId: String(telegramUserId),
    submissionMessageId: Number(messageId),
    submissionText: String(text || "").slice(0, 2000),
    status: "pending",
    submittedAt: now,
    updatedAt: now,
  };
  try {
    const res = await subs.insertOne(doc);
    return { ...doc, _id: res.insertedId };
  } catch (err) {
    log.error("MongoDB task submission insert failed", { collection: "taskSubmissions", operation: "insertOne", err: safeErr(err) });
    return null;
  }
}

export async function listSubmissions(status = "pending") {
  const subs = col("taskSubmissions");
  if (!subs) return [];
  try {
    return subs.find({ status }).sort({ submittedAt: 1 }).limit(20).toArray();
  } catch (err) {
    log.error("MongoDB submission list failed", { collection: "taskSubmissions", operation: "find", err: safeErr(err) });
    return [];
  }
}

export async function reviewSubmission(id, status, adminId, note = "") {
  const subs = col("taskSubmissions");
  if (!subs || !ObjectId.isValid(id)) return null;
  try {
    await subs.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, reviewedByAdminId: String(adminId), reviewNote: note, reviewedAt: new Date(), updatedAt: new Date() } },
    );
    return subs.findOne({ _id: new ObjectId(id) });
  } catch (err) {
    log.error("MongoDB submission review failed", { collection: "taskSubmissions", operation: "updateOne", err: safeErr(err) });
    return null;
  }
}

export async function getStats() {
  const db = getDb();
  if (!db) return null;
  const now = Date.now();
  const day = new Date(now - 86400000);
  const week = new Date(now - 7 * 86400000);
  const month = new Date(now - 30 * 86400000);
  try {
    const users = db.collection("users");
    const resources = db.collection("resources");
    const vips = db.collection("vipSubscriptions");
    const tasks = db.collection("tasks");
    const subs = db.collection("taskSubmissions");
    const events = db.collection("activityEvents");
    const [
      totalUsers,
      activeDaily,
      activeWeekly,
      activeMonthly,
      totalVisits,
      deliveries,
      totalResources,
      freeResources,
      vipResources,
      activeVip,
      expiredVip,
      taskCount,
      pendingSubs,
      approvedSubs,
      failedDeliveries,
      byCategory,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ lastActiveAt: { $gte: day } }),
      users.countDocuments({ lastActiveAt: { $gte: week } }),
      users.countDocuments({ lastActiveAt: { $gte: month } }),
      events.countDocuments({ eventType: "visit" }),
      events.countDocuments({ eventType: "delivery_success" }),
      resources.countDocuments({ status: "published" }),
      resources.countDocuments({ status: "published", accessTier: "free" }),
      resources.countDocuments({ status: "published", accessTier: "vip" }),
      vips.countDocuments({ status: "active" }),
      vips.countDocuments({ status: "expired" }),
      tasks.countDocuments({}),
      subs.countDocuments({ status: "pending" }),
      subs.countDocuments({ status: "approved" }),
      events.countDocuments({ eventType: "delivery_failed" }),
      resources.aggregate([
        { $match: { status: "published" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]).toArray(),
    ]);
    return { totalUsers, activeDaily, activeWeekly, activeMonthly, totalVisits, deliveries, totalResources, freeResources, vipResources, activeVip, expiredVip, taskCount, pendingSubs, approvedSubs, failedDeliveries, byCategory };
  } catch (err) {
    log.error("MongoDB stats failed", { collection: "multiple", operation: "aggregate", err: safeErr(err) });
    return null;
  }
}
