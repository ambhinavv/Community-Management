import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "./config.js";
import { log } from "./logger.js";

export type SpamVerdict = {
  spam: boolean;
  confidence: number;
  reason: string;
  source: "gemini" | "heuristic";
};

export type MessageContext = {
  text: string;
  username?: string;
  firstName?: string;
  hasLinks: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
  hasDocument: boolean;
  isForward: boolean;
  isExternalReply: boolean;
  emojiCount: number;
};

const SYSTEM = `You are a Telegram group anti-spam moderator for a crypto/wallet community.
Decide if a message is spam / scam / unwanted promotion.

Treat as SPAM when it is clearly:
- crypto/wallet drains, fake airdrops, giveaways, "send money / seed phrase"
- phishing, malware, adult spam, mass ads, crypto trading signals spam
- "DM me", paid promotion, recruiting bots, referral farms
- nonsense promo pasted into an unrelated community

Treat as NOT spam (ham) when it is:
- normal conversation, questions, support, memes among members
- users reporting wallet bugs, deposit/withdraw issues, balance problems
- discussing prices of real products/services in context
- off-topic chat that is rude but not advertising
- short greetings like "hi" / "thanks" without a pitch

Respond with ONLY valid JSON (no markdown):
{"spam":boolean,"confidence":number,"reason":string}
confidence is 0 to 1.`;

function extractJson(text: string): { spam: boolean; confidence: number; reason: string } {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as {
    spam?: unknown;
    confidence?: unknown;
    reason?: unknown;
  };
  return {
    spam: Boolean(parsed.spam),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason ?? "no reason"),
  };
}

function heuristicCheck(ctx: MessageContext): SpamVerdict | null {
  const t = ctx.text.trim();
  if (!t && (ctx.hasPhoto || ctx.hasVideo || ctx.hasDocument) && !ctx.hasLinks) {
    return null;
  }
  if (ctx.hasLinks && t.replace(/https?:\/\/\S+/gi, "").trim().length < 8) {
    return {
      spam: true,
      confidence: 0.85,
      reason: "Link-only / near link-only message",
      source: "heuristic",
    };
  }
  if (/giveaway|airdrop|free\s*nft|seed\s*phrase|private\s*key/i.test(t)) {
    return {
      spam: true,
      confidence: 0.9,
      reason: "Matched high-risk scam/giveaway patterns",
      source: "heuristic",
    };
  }
  return null;
}

let modelSingleton: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null =
  null;
let modelNameCached: string | null = null;

function getModel() {
  if (!modelSingleton || modelNameCached !== config.geminiModel) {
    const genAI = new GoogleGenerativeAI(config.geminiToken);
    modelSingleton = genAI.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
        responseMimeType: "application/json",
      },
    });
    modelNameCached = config.geminiModel;
    log.info(`Gemini model ready: ${config.geminiModel}`);
  }
  return modelSingleton;
}

export async function classifyMessage(ctx: MessageContext): Promise<SpamVerdict> {
  const text = ctx.text.trim();
  if (text.length < config.minMsgLen && !ctx.hasLinks && !ctx.hasPhoto) {
    log.checking("heuristic (too short)");
    return {
      spam: false,
      confidence: 0.6,
      reason: "Too short / low signal for spam",
      source: "heuristic",
    };
  }

  const hard = heuristicCheck(ctx);
  if (hard && hard.confidence >= 0.9) {
    log.checking("heuristic (high-risk pattern)");
    return hard;
  }

  log.checking(`gemini (${config.geminiModel})`);
  const prompt = `${SYSTEM}

Message metadata:
- username: ${ctx.username ?? "n/a"}
- first_name: ${ctx.firstName ?? "n/a"}
- has_links: ${ctx.hasLinks}
- has_photo: ${ctx.hasPhoto}
- has_video: ${ctx.hasVideo}
- has_document: ${ctx.hasDocument}
- is_forward: ${ctx.isForward}
- is_external_reply: ${ctx.isExternalReply}
- emoji_count: ${ctx.emojiCount}

Message text:
"""
${text || "[no text / media only]"}
"""`;

  try {
    const result = await getModel().generateContent(prompt);
    const raw = result.response.text();
    log.debug(`Gemini raw: ${raw.slice(0, 300)}`);
    const parsed = extractJson(raw);
    return {
      spam: parsed.spam && parsed.confidence >= config.spamConfidence,
      confidence: parsed.confidence,
      reason: parsed.reason,
      source: "gemini",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Gemini classification failed: ${msg}`);
    if (hard) {
      log.warn("Falling back to heuristic after Gemini error");
      return hard;
    }
    return {
      spam: false,
      confidence: 0,
      reason: `Gemini error: ${msg}`,
      source: "heuristic",
    };
  }
}
