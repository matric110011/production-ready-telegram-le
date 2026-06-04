import "dotenv/config";
import { run } from "@grammyjs/runner";
import { cfg } from "./lib/config.js";
import { connectDb, closeDb } from "./lib/db.js";
import { log, safeErr } from "./lib/log.js";

let runner = null;
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("unhandledRejection", (err) => {
  log.error("UnhandledRejection", { err: safeErr(err) });
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  log.error("UncaughtException", { err: safeErr(err) });
  process.exit(1);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutdown started");
  try {
    if (runner?.isRunning?.()) await runner.stop();
  } catch (err) {
    log.warn("Runner stop failed", { err: safeErr(err) });
  }
  await closeDb().catch((err) => log.warn("MongoDB close failed", { err: safeErr(err) }));
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function startPolling(bot) {
  let backoff = 2000;
  while (!shuttingDown) {
    try {
      log.info("Telegram polling preparing", { dropPendingUpdates: true });
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      log.info("Telegram polling started", { runner: "@grammyjs/runner" });
      runner = run(bot);
      await runner.task();
      backoff = 2000;
    } catch (err) {
      const msg = safeErr(err);
      const is409 = msg.includes("409") || msg.toLowerCase().includes("conflict");
      log.warn("Telegram polling failure", { conflict: is409, backoffMs: backoff, err: msg });
      try {
        if (runner?.isRunning?.()) await runner.stop();
      } catch (stopErr) {
        log.warn("Telegram runner stop after failure failed", { err: safeErr(stopErr) });
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 20000);
    }
  }
}

async function boot() {
  try {
    log.info("Boot start", {
      telegramTokenSet: !!cfg.TELEGRAM_BOT_TOKEN,
      mongodbUriSet: !!cfg.MONGODB_URI,
      storageChannelSet: !!cfg.STORAGE_CHANNEL_ID,
      adminIdsConfigured: cfg.BOT_ADMIN_IDS.length > 0,
      sponsorChatsConfigured: cfg.SPONSOR_CHAT_IDS.length > 0,
    });

    if (!cfg.TELEGRAM_BOT_TOKEN) {
      console.error("TELEGRAM_BOT_TOKEN is required. Add it in the Config tab and redeploy.");
      process.exit(1);
    }

    if (!cfg.BOT_ADMIN_IDS.length) {
      log.warn("No admins configured; admin features will be hidden", { adminIdsConfigured: false });
    }

    await connectDb();

    const { createBot } = await import("./bot.js");
    const { registerCommands } = await import("./commands/loader.js");
    const { registerLibrary } = await import("./features/library.js");
    const { startVipExpiryLoop } = await import("./jobs/vipExpiry.js");

    const bot = createBot(cfg.TELEGRAM_BOT_TOKEN);
    await bot.init();
    await registerCommands(bot);
    registerLibrary(bot);

    await bot.api.setMyCommands([
      { command: "start", description: "Open Code Vault" },
      { command: "help", description: "How to use Code Vault" },
    ]).catch((err) => log.warn("setMyCommands failed", { err: safeErr(err) }));

    startVipExpiryLoop(bot);

    setInterval(() => {
      const m = process.memoryUsage();
      log.info("Memory", { rssMB: Math.round(m.rss / 1e6), heapUsedMB: Math.round(m.heapUsed / 1e6) });
    }, 60000);

    await startPolling(bot);
  } catch (err) {
    log.error("Boot error", { code: err?.code, err: safeErr(err) });
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      console.error("Check that all ESM imports include .js extensions and referenced files exist.");
    }
    process.exit(1);
  }
}

boot();
