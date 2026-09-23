import { Bot, Context } from "grammy";
import { config } from "./config.js";
import { classifyMessage, type MessageContext } from "./gemini.js";
import { log } from "./logger.js";
import { isApproved, recordCleanMessage, revokeApproval } from "./store.js";

function countEmojis(text: string): number {
  const matches = text.match(/\p{Extended_Pictographic}/gu);
  return matches?.length ?? 0;
}

function extractText(ctx: Context): string {
  const msg = ctx.message;
  if (!msg) return "";
  return [msg.text, msg.caption].filter(Boolean).join("\n").trim();
}

function buildContext(ctx: Context): MessageContext {
  const msg = ctx.message!;
  const text = extractText(ctx);
  const entities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
  const hasLinks =
    /https?:\/\/|t\.me\//i.test(text) ||
    entities.some((e) => e.type === "url" || e.type === "text_link");

  return {
    text,
    username: ctx.from?.username,
    firstName: ctx.from?.first_name,
    hasLinks,
    hasPhoto: Boolean(msg.photo?.length),
    hasVideo: Boolean(msg.video || msg.video_note),
    hasDocument: Boolean(msg.document),
    isForward: Boolean(
      "forward_origin" in msg && msg.forward_origin
        ? true
        : Boolean(
            (msg as { forward_date?: number }).forward_date ||
              (msg as { forward_from?: unknown }).forward_from,
          ),
    ),
    isExternalReply: Boolean(
      (msg as { external_reply?: unknown }).external_reply,
    ),
    emojiCount: countEmojis(text),
  };
}

function isProtectedChat(ctx: Context): boolean {
  return String(ctx.chat?.id) === String(config.telegramGroup);
}

const adminCache = new Map<string, { ids: Set<number>; expires: number }>();

async function getAdminIds(bot: Bot, chatId: string | number): Promise<Set<number>> {
  const key = String(chatId);
  const cached = adminCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.ids;

  const admins = await bot.api.getChatAdministrators(chatId);
  const ids = new Set(admins.map((a) => a.user.id));
  adminCache.set(key, { ids, expires: Date.now() + 5 * 60_000 });
  return ids;
}

async function isTrusted(bot: Bot, ctx: Context): Promise<boolean> {
  const username = ctx.from?.username?.toLowerCase();
  if (username && config.superUsers.includes(username)) return true;
  if (!ctx.from || !ctx.chat) return false;
  try {
    const admins = await getAdminIds(bot, ctx.chat.id);
    return admins.has(ctx.from.id);
  } catch {
    return false;
  }
}

async function notifyAdmin(bot: Bot, lines: string[]): Promise<void> {
  if (!config.adminGroup) return;
  try {
    await bot.api.sendMessage(config.adminGroup, lines.join("\n"), {
      link_preview_options: { is_disabled: true },
    });
    log.debug("Admin group notified");
  } catch (err) {
    log.error(
      "Failed to notify admin group",
      err instanceof Error ? err.message : err,
    );
  }
}

async function handleSpam(
  bot: Bot,
  ctx: Context,
  verdict: Awaited<ReturnType<typeof classifyMessage>>,
): Promise<void> {
  const user = ctx.from!;
  const mention = user.username ? `@${user.username}` : user.first_name;
  const preview = extractText(ctx).slice(0, 400);

  log.verdict({
    spam: true,
    confidence: verdict.confidence,
    reason: verdict.reason,
    source: verdict.source,
    userId: user.id,
    username: user.username,
  });

  await notifyAdmin(bot, [
    config.dry ? "DRY RUN — would ban" : "SPAM banned",
    `User: ${mention} (${user.id})`,
    `Source: ${verdict.source}`,
    `Confidence: ${(verdict.confidence * 100).toFixed(0)}%`,
    `Reason: ${verdict.reason}`,
    `Text: ${preview || "[media]"}`,
  ]);

  if (config.dry) {
    log.action(`DRY — would ban ${mention} (${user.id})`);
    return;
  }

  try {
    await ctx.deleteMessage();
    log.action(`Deleted message from ${mention}`);
  } catch (err) {
    log.error("deleteMessage failed", err instanceof Error ? err.message : err);
  }

  try {
    await ctx.banChatMember(user.id);
    await revokeApproval(user.id);
    log.action(`Banned ${mention} (${user.id})`);
  } catch (err) {
    log.error("banChatMember failed", err instanceof Error ? err.message : err);
  }
}

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "TG Spam Bot (TypeScript + Gemini). Add me as admin with delete + ban rights.",
    );
  });

  bot.command("status", async (ctx) => {
    const trusted =
      (await isTrusted(bot, ctx)) ||
      String(ctx.chat?.id) === String(config.adminGroup);
    if (!trusted) return;
    await ctx.reply(
      [
        "Status: online",
        `Group: ${config.telegramGroup}`,
        `Dry: ${config.dry}`,
        `Model: ${config.geminiModel}`,
        `First messages checked: ${config.firstMessagesCount}`,
      ].join("\n"),
    );
  });

  bot.hears(/^\/?(spam|ban)\b/i, async (ctx) => {
    if (!isProtectedChat(ctx)) return;
    if (!(await isTrusted(bot, ctx))) return;

    const reply = ctx.message?.reply_to_message;
    if (!reply?.from) {
      await ctx.reply("Reply to a user's message with /spam or /ban.");
      return;
    }

    const target = reply.from;
    log.action(
      `Admin @${ctx.from?.username ?? "?"} marked spam → ${target.username ? `@${target.username}` : target.id}`,
    );
    await notifyAdmin(bot, [
      config.dry ? "DRY — admin marked spam" : "Admin spam action",
      `Target: ${target.username ? `@${target.username}` : target.first_name} (${target.id})`,
      `By: @${ctx.from?.username ?? "admin"}`,
    ]);

    if (config.dry) return;

    try {
      await bot.api.deleteMessage(ctx.chat!.id, reply.message_id);
    } catch {
      /* ignore */
    }
    try {
      await ctx.banChatMember(target.id);
      await revokeApproval(target.id);
      log.action(`Banned ${target.id} via admin /spam`);
    } catch (err) {
      log.error("manual ban failed", err instanceof Error ? err.message : err);
    }
  });

  bot.on("message", async (ctx) => {
    if (!isProtectedChat(ctx)) {
      log.skip("other chat", ctx.chat?.id as number | undefined);
      return;
    }
    if (!ctx.from || ctx.from.is_bot) {
      log.skip("bot or no from");
      return;
    }
    if (await isTrusted(bot, ctx)) {
      log.skip("trusted/admin", ctx.from.id);
      return;
    }

    if (
      !ctx.message.text &&
      !ctx.message.caption &&
      !ctx.message.photo &&
      !ctx.message.video &&
      !ctx.message.document &&
      !ctx.message.animation
    ) {
      log.skip("empty/service message", ctx.from.id);
      return;
    }

    if (await isApproved(ctx.from.id)) {
      log.skip("already approved", ctx.from.id);
      return;
    }

    const messageCtx = buildContext(ctx);
    log.message({
      userId: ctx.from.id,
      username: ctx.from.username,
      text: messageCtx.text,
    });

    const verdict = await classifyMessage(messageCtx);

    log.verdict({
      spam: verdict.spam,
      confidence: verdict.confidence,
      reason: verdict.reason,
      source: verdict.source,
      userId: ctx.from.id,
      username: ctx.from.username,
    });

    if (verdict.spam) {
      await handleSpam(bot, ctx, verdict);
      return;
    }

    const { newlyApproved, approved } = await recordCleanMessage(
      ctx.from.id,
      ctx.from.username,
    );
    if (newlyApproved) {
      log.action(
        `Approved user ${ctx.from.id} (@${ctx.from.username ?? "n/a"}) after clean messages`,
      );
    } else if (!approved) {
      log.debug(
        `Clean message counted toward approval for ${ctx.from.id}`,
      );
    }
  });

  bot.catch((err) => {
    log.error("Bot error", err.error);
  });

  return bot;
}
