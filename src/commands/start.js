import { upsertUser, recordEvent } from "../services/store.js";
import { showHome } from "../features/library.js";

export default function register(bot) {
  bot.command("start", async (ctx) => {
    await upsertUser(ctx.from);
    await recordEvent("visit", ctx, { command: "start" });
    await showHome(ctx);
  });
}
