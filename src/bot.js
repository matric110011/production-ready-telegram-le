import { Bot } from "grammy";
import { log, safeErr } from "./lib/log.js";

export function createBot(token) {
  const bot = new Bot(token);

  bot.catch((err) => {
    log.error("Telegram bot handler error", {
      updateId: err.ctx?.update?.update_id,
      err: safeErr(err.error),
    });
  });

  return bot;
}
