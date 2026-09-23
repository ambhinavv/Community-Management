type Level = "info" | "warn" | "error" | "debug";

function stamp(): string {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function line(level: Level, message: string, extra?: unknown): void {
  const prefix = `[${stamp()}] ${level.toUpperCase().padEnd(5)}`;
  if (extra !== undefined) {
    console.log(`${prefix} ${message}`, extra);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => line("info", msg, extra),
  warn: (msg: string, extra?: unknown) => line("warn", msg, extra),
  error: (msg: string, extra?: unknown) => line("error", msg, extra),
  debug: (msg: string, extra?: unknown) => line("debug", msg, extra),

  message(opts: {
    userId: number;
    username?: string;
    text: string;
  }): void {
    const who = opts.username ? `@${opts.username}` : String(opts.userId);
    const preview = opts.text.replace(/\s+/g, " ").slice(0, 160);
    line("info", `MSG  ${who} (${opts.userId}): ${preview || "[media]"}`);
  },

  skip(reason: string, userId?: number): void {
    line("debug", `SKIP ${reason}${userId != null ? ` user=${userId}` : ""}`);
  },

  checking(source: string): void {
    line("info", `CHECK via ${source}...`);
  },

  verdict(opts: {
    spam: boolean;
    confidence: number;
    reason: string;
    source: string;
    userId: number;
    username?: string;
  }): void {
    const who = opts.username ? `@${opts.username}` : String(opts.userId);
    const tag = opts.spam ? "SPAM" : "HAM ";
    line(
      "info",
      `${tag} ${who} | source=${opts.source} | conf=${(opts.confidence * 100).toFixed(0)}% | ${opts.reason}`,
    );
  },

  action(msg: string): void {
    line("info", `ACTION ${msg}`);
  },
};
