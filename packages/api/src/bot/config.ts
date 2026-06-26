export const NAPCAT_WS_URL = process.env.NAPCAT_WS_URL ?? "ws://localhost:3001";
export const NAPCAT_ACCESS_TOKEN = process.env.NAPCAT_ACCESS_TOKEN ?? "";
export const POLL_INTERVAL_MS = Number(process.env.JM_POLL_INTERVAL_MS ?? 2000);
export const MAX_POLL_ATTEMPTS = Number(process.env.JM_MAX_POLL_ATTEMPTS ?? 150);
export const RATE_LIMIT_WINDOW_MS = Number(process.env.JM_RATE_LIMIT_WINDOW_MS ?? 10000);
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.JM_RATE_LIMIT_MAX_REQUESTS ?? 3);
