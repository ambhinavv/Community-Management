import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  TELEGRAM_TOKEN: z.string().min(10),
  TELEGRAM_GROUP: z.string().min(1),
  ADMIN_GROUP: z.string().optional().default(""),
  SUPER_USER: z.string().optional().default(""),
  GEMINI_TOKEN: z.string().min(10),
  GEMINI_MODEL: z.string().optional().default("gemini-2.5-flash-lite"),
  DRY: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  FIRST_MESSAGES_COUNT: z.coerce.number().int().min(0).default(3),
  MIN_MSG_LEN: z.coerce.number().int().min(0).default(1),
  SPAM_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  DATA_DIR: z.string().optional().default("./data"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const e = parsed.data;

export const config = {
  telegramToken: e.TELEGRAM_TOKEN,
  telegramGroup: e.TELEGRAM_GROUP,
  adminGroup: e.ADMIN_GROUP || undefined,
  superUsers: e.SUPER_USER
    .split(",")
    .map((s) => s.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean),
  geminiToken: e.GEMINI_TOKEN,
  geminiModel: e.GEMINI_MODEL,
  dry: e.DRY,
  firstMessagesCount: e.FIRST_MESSAGES_COUNT,
  minMsgLen: e.MIN_MSG_LEN,
  spamConfidence: e.SPAM_CONFIDENCE,
  dataDir: e.DATA_DIR,
};
