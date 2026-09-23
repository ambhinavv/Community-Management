import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export type ApprovedStore = {
  users: Record<string, { username?: string; messageCount: number; approved: boolean }>;
};

const storePath = () => path.join(config.dataDir, "approved-users.json");

async function ensure(): Promise<ApprovedStore> {
  await mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await readFile(storePath(), "utf8");
    return JSON.parse(raw) as ApprovedStore;
  } catch {
    return { users: {} };
  }
}

async function save(store: ApprovedStore): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(storePath(), JSON.stringify(store, null, 2), "utf8");
}

export async function getUser(userId: number) {
  const store = await ensure();
  return store.users[String(userId)];
}

export async function isApproved(userId: number): Promise<boolean> {
  const u = await getUser(userId);
  return Boolean(u?.approved);
}

/** Count a clean message toward approval. Returns true if newly approved. */
export async function recordCleanMessage(
  userId: number,
  username?: string,
): Promise<{ approved: boolean; newlyApproved: boolean }> {
  const store = await ensure();
  const key = String(userId);
  const current = store.users[key] ?? {
    username,
    messageCount: 0,
    approved: false,
  };
  if (username) current.username = username;
  if (current.approved) {
    return { approved: true, newlyApproved: false };
  }

  current.messageCount += 1;
  const newlyApproved = current.messageCount >= config.firstMessagesCount;
  if (newlyApproved) current.approved = true;
  store.users[key] = current;
  await save(store);
  return { approved: current.approved, newlyApproved };
}

export async function revokeApproval(userId: number): Promise<void> {
  const store = await ensure();
  delete store.users[String(userId)];
  await save(store);
}
