import type { SendMessageSegment } from "node-napcat-ts";
import { Structs } from "node-napcat-ts";

export interface MiddlewareInput {
  id: string;
  userId: number;
}

type MiddlewareFn = (
  input: MiddlewareInput,
) => Promise<SendMessageSegment[] | null>;

const queryMiddlewares: MiddlewareFn[] = [];
const downloadMiddlewares: MiddlewareFn[] = [];

export function addQueryMiddleware(fn: MiddlewareFn): void {
  queryMiddlewares.push(fn);
}

export function addDownloadMiddleware(fn: MiddlewareFn): void {
  downloadMiddlewares.push(fn);
}

export async function runQueryMiddlewares(
  input: MiddlewareInput,
): Promise<SendMessageSegment[] | null> {
  for (const fn of queryMiddlewares) {
    const result = await fn(input);
    if (result) return result;
  }
  return null;
}

export async function runDownloadMiddlewares(
  input: MiddlewareInput,
): Promise<SendMessageSegment[] | null> {
  for (const fn of downloadMiddlewares) {
    const result = await fn(input);
    if (result) return result;
  }
  return null;
}

// ─── 规则 ───

const BLOCKED_IDS = new Set(["350234", "350235"]);
const BLOCK_REPLY = "这么喜欢董卓奖励你和董卓做呱😡😡😡";

addQueryMiddleware(async ({ id, userId }) => {
  if (BLOCKED_IDS.has(id)) {
    return [Structs.at(userId), Structs.text(`\n${BLOCK_REPLY}`)];
  }
  return null;
});

addDownloadMiddleware(async ({ id, userId }) => {
  if (BLOCKED_IDS.has(id)) {
    return [Structs.at(userId), Structs.text(`\n${BLOCK_REPLY}`)];
  }
  return null;
});
