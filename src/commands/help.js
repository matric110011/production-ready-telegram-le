import { recordEvent } from "../services/store.js";
import { showHelp } from "../features/library.js";

export default function register(bot) {
  bot.command("help", async (ctx) => {
    await recordEvent("help_command", ctx, { command: "help" });
    await showHelp(ctx);
  });
}
