import { config } from "./config.js";
import { createBot } from "./bot.js";
import { log } from "./logger.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 8,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      const wait = Math.min(30_000, 1500 * i);
      log.warn(
        `${label} failed (${i}/${attempts}): ${msg}. Retrying in ${Math.round(wait / 1000)}s...`,
      );
      await sleep(wait);
    }
  }
  throw last;
}

async function main() {
  log.info("TG Spam Bot (TypeScript + Gemini)");
  log.info(`Group:   ${config.telegramGroup}`);
  log.info(`Admin:   ${config.adminGroup ?? "(none)"}`);
  log.info(`Gemini:  ${config.geminiModel}`);
  log.info(`Dry:     ${config.dry}`);
  if (config.dry) {
    log.warn(
      "DRY MODE: detects spam but does not ban/delete. Set DRY=false to enforce.",
    );
  }

  const bot = createBot();

  const me = await withRetry("Telegram getMe", () => bot.api.getMe());
  log.info(`Bot:     @${me.username}`);

  try {
    const chat = await bot.api.getChat(config.telegramGroup);
    log.info(
      `Chat:    ${"title" in chat ? chat.title : config.telegramGroup}`,
    );
  } catch (err) {
    log.warn(
      "Cannot access TELEGRAM_GROUP. Is the bot a member/admin?",
      err instanceof Error ? err.message : err,
    );
  }

  await bot.start({
    onStart: () => log.info("Listening for messages... (logging every check)"),
  });
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  log.error(
    "Could not reach api.telegram.org. Try stable internet, disable VPN, or set HTTPS_PROXY in .env.",
  );
  process.exit(1);
});
