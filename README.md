# TG Spam Bot (TypeScript + Gemini)

Self-hosted Telegram anti-spam bot. **Gemini decides** whether a message is spam — not a keyword list.

## How spam detection works

1. New users are checked for their first `FIRST_MESSAGES_COUNT` messages.
2. Each message is sent to **Gemini** with context (links, media, forwards, etc.).
3. Gemini returns JSON: `{ spam, confidence, reason }`.
4. If confidence ≥ `SPAM_CONFIDENCE`, the bot reports to the admin group (and bans when `DRY=false`).
5. Only obvious high-risk patterns (e.g. seed phrase / giveaway) short-circuit without Gemini.

## Quick start (local)

Requires Node.js 20+. **No PowerShell scripts** — run with Node:

```bash
node start.mjs
```

Or double-click `start.cmd`.

First-time install (use `npm.cmd` in PowerShell if `npm` is blocked):

```bash
npm.cmd install
```

Dev with reload:

```bash
node ./node_modules/tsx/dist/cli.mjs watch src/index.ts
```

## Docker

```bash
docker compose up -d --build
```

## Config (`.env`)

| Variable | Meaning |
|----------|---------|
| `TELEGRAM_TOKEN` | BotFather token |
| `TELEGRAM_GROUP` | Group to protect |
| `ADMIN_GROUP` | Private group for reports |
| `SUPER_USER` | Your username (no `@`) |
| `GEMINI_TOKEN` | Google AI Studio key |
| `GEMINI_MODEL` | Default `gemini-2.0-flash` |
| `DRY` | `true` = report only |
| `SPAM_CONFIDENCE` | Threshold 0–1 (default 0.7) |

## Admin commands

In the protected group, reply to a message with `/spam` or `/ban` (admins / super-users).

`/status` in admin chat shows bot status.

## Go live

1. Keep `DRY=true` and watch admin reports.
2. Set `DRY=false` and restart when ready for real bans.
