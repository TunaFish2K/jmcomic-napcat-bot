import { availableParallelism } from "os";

export const UPSTREAM_BASE_URL = process.env.JM_UPSTREAM_BASE_URL ?? "https://jmserver.2kb.fish";
export const UPSTREAM_TIMEOUT_MS = Number(process.env.JM_UPSTREAM_TIMEOUT_MS ?? 10000);

export const INFO_CACHE_TTL_SECONDS = Number(process.env.JM_INFO_CACHE_TTL ?? 600);
export const INFO_CACHE_MAX_KEYS = Number(process.env.JM_INFO_CACHE_MAX_KEYS ?? 100);

export const MAX_TASK_QUEUED = Number(process.env.JM_MAX_TASK_QUEUED ?? 100);

export const PDF_CACHE_DIR = process.env.JM_PDF_CACHE_DIR ?? "./cache/pdf";
export const PDF_CACHE_MAX_SIZE = Number(process.env.JM_PDF_CACHE_MAX_SIZE ?? 10 * 1024 * 1024 * 1024);

export const WORKER_POOL_SIZE = Number(process.env.JM_WORKER_POOL_SIZE ?? 3);
export const MAX_RETRIES = Number(process.env.JM_MAX_RETRIES ?? 3);
export const ERROR_TTL_MS = Number(process.env.JM_ERROR_TTL_MS ?? 60 * 60 * 1000);
export const IMAGE_DOWNLOAD_TIMEOUT_MS = Number(process.env.JM_IMAGE_DOWNLOAD_TIMEOUT ?? 120_000);
export const IMAGE_DOWNLOAD_RETRIES = Number(process.env.JM_IMAGE_DOWNLOAD_RETRIES ?? 3);
export const NETWORK_CONCURRENCY = Number(process.env.JM_NETWORK_CONCURRENCY ?? 15);
export const CPU_CONCURRENCY = Number(process.env.JM_CPU_CONCURRENCY ?? availableParallelism());
