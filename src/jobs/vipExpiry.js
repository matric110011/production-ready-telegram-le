import { getDb } from "../lib/db.js";
import { cfg } from "../lib/config.js";
import { log, safeErr } from "../lib/log.js";

let running = false;
let timer = null;

async function cycle(bot) {
  if (running) return;
  running = true;
  log.info("VIP expiry cycle run", { polling: true });
  try {
    const db = getDb();
    if (!db) return;
    const now = new Date();
    const expired = await db.collection("vipSubscriptions").find({
      status: "active",
      isLifetime: { $ne: true },
      expiresAt: { $lte: now },
    }).limit(50).toArray();

    for (const sub of expired) {
      await db.collection("vipSubscriptions").updateOne(
        { _id: sub._id },
        { $set: { status: "expired", expiredAt: now, updatedAt: now } },
      );
      await bot.api.sendMessage(sub.telegramUserId, "Your Code Vault VIP subscription has expired. Open My VIP Status for renewal instructions.").catch((err) => {
        log.warn("VIP expiry notification failed", { userId: sub.telegramUserId, err: safeErr(err) });
      });
    }
  } catch (err) {
    log.error("VIP expiry cycle failed", { collection: "vipSubscriptions", operation: "expiryLoop", err: safeErr(err) });
  } finally {
    running = false;
  }
}

export function startVipExpiryLoop(bot) {
  if (timer) return;
  log.info("VIP expiry polling started", { intervalMs: cfg.VIP_EXPIRY_CHECK_MS });
  timer = setInterval(() => cycle(bot), Math.max(60000, cfg.VIP_EXPIRY_CHECK_MS));
  cycle(bot).catch((err) => log.error("VIP expiry first cycle failed", { err: safeErr(err) }));
}

export function stopVipExpiryLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
