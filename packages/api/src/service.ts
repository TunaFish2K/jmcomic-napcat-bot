import NodeCache from "node-cache";
import {
  INFO_CACHE_MAX_KEYS,
  INFO_CACHE_TTL_SECONDS,
  MAX_RETRIES,
  MAX_TASK_QUEUED,
  PDF_CACHE_DIR,
  PDF_CACHE_MAX_SIZE,
  WORKER_POOL_SIZE,
} from "./constants.js";
import {
  queryPhotoUpstream,
  queryAlbumUpstream,
  PhotoInfo,
  AlbumPhoto,
} from "./upstream.js";
import {
  TaskQueue,
  PDFCache,
  getTaskState,
  setTaskState,
  deleteTaskState,
} from "./data.js";
import { generatePDF, type ProgressInfo } from "./pdf.js";
import { downloadCoverImage } from "./image.js";
import { CPU_CONCURRENCY } from "./constants.js";

export interface InfoResponse {
  name: string;
  description: string | null;
  views: string | null;
  likes: string | null;
  authors: string[] | null;
  tags: string[] | null;
  works: string[] | null;
  actors: string[] | null;
  cover: string | null;
}

export interface TaskProgress {
  totalImages: number;
  processedImages: number;
  startedAt: number;
  etaSeconds?: number | undefined;
}

export type TaskStatusResult =
  | { status: "ready" }
  | { status: "pending" | "processing" | "not_found"; progress?: TaskProgress }
  | { status: "error"; error: string };

// --- error helpers ---

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if ("message" in err && typeof (err as any).message === "string")
      return (err as any).message;
    try {
      return JSON.stringify(err);
    } catch {
      return "未知错误";
    }
  }
  return String(err);
}

function translateError(err: unknown): string {
  const msg = extractErrorMessage(err);

  if (msg.includes("No images could be embedded"))
    return "本子没有可用图片，无法生成 PDF";

  return "未找到该本子，请检查 ID 是否正确";
}

// --- lifecycle ---

const infoCache = new NodeCache({
  stdTTL: INFO_CACHE_TTL_SECONDS,
  maxKeys: INFO_CACHE_MAX_KEYS,
});

const toPDFQueue = new TaskQueue(MAX_TASK_QUEUED);
const pdfCache = new PDFCache(PDF_CACHE_DIR, PDF_CACHE_MAX_SIZE);

let shuttingDown = false;
let activeWorkers = 0;

export async function initService(): Promise<void> {
  await pdfCache.init();
  console.log(
    `PDF cache initialized: ${pdfCache.recordCount} records, ${(pdfCache.totalSize / 1024 / 1024).toFixed(1)}MB / ${(pdfCache.maxSize / 1024 / 1024 / 1024).toFixed(1)}GB`,
  );
}

export function startWorkers(): void {
  for (let i = 0; i < WORKER_POOL_SIZE; i++) {
    runWorker().catch((err) => console.error("Worker crashed:", err));
  }
  console.log(`Started ${WORKER_POOL_SIZE} PDF workers`);
}

export async function shutdownService(): Promise<void> {
  if (shuttingDown) return;
  console.log("Shutting down gracefully...");
  shuttingDown = true;
  toPDFQueue.wakeAll();

  return new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (activeWorkers === 0) {
        clearInterval(check);
        console.log("All workers finished, exiting");
        resolve();
      }
    }, 100);
  });
}

// --- internal helpers ---

function combinePhotoAndAlbumToInfo(
  photo: PhotoInfo,
  album: AlbumPhoto | null,
  coverBuffer: Buffer | null,
): InfoResponse {
  return {
    name: photo.name,
    description: album?.description ?? null,
    views: album?.totalViews ?? null,
    likes: album?.likes ?? null,
    authors: album?.author ?? null,
    tags: album?.tags ?? null,
    works: album?.works ?? null,
    actors: album?.actors ?? null,
    cover: coverBuffer
      ? `data:image/jpeg;base64,${coverBuffer.toString("base64")}`
      : null,
  };
}

async function resolveTaskStatus(id: string): Promise<TaskStatusResult> {
  if (await pdfCache.has(id)) return { status: "ready" };
  const state = getTaskState(id);
  if (state) {
    if (state.status === "error")
      return { status: "error", error: state.error ?? "Unknown error" };
    if (state.status === "processing" && state.totalImages != null) {
      return {
        status: "processing",
        progress: {
          totalImages: state.totalImages,
          processedImages: state.processedImages ?? 0,
          startedAt: state.startedAt ?? Date.now(),
          etaSeconds: state.etaSeconds,
        },
      };
    }
    return { status: state.status };
  }
  return { status: "not_found" };
}

// --- service functions ---

export function isInfoCached(id: string): boolean {
  return infoCache.has(id);
}

export async function queryInfo(id: string): Promise<InfoResponse> {
  const cached = infoCache.get(id) as InfoResponse | undefined;
  if (cached) return cached;

  const [photoResult, albumResult] = await Promise.all([
    queryPhotoUpstream(id),
    queryAlbumUpstream(id).catch(() => null),
  ]);

  if (!photoResult.success) {
    throw new Error(translateError(photoResult.error));
  }

  const photo = photoResult.result;
  const album = albumResult?.result ?? null;
  const coverBuffer = await downloadCoverImage(photo);
  const info = combinePhotoAndAlbumToInfo(photo, album, coverBuffer);
  infoCache.set(id, info);
  return info;
}

export async function enqueuePDF(id: string): Promise<TaskStatusResult> {
  if (shuttingDown)
    return { status: "error", error: "Service shutting down" };

  const status = await resolveTaskStatus(id);
  if (status.status !== "not_found") return status;

  const pushed = toPDFQueue.push(id);
  if (!pushed) return { status: "error", error: "Queue full" };

  setTaskState(id, {
    status: "pending",
    retryCount: 0,
    updatedAt: Date.now(),
  });
  return { status: "pending" };
}

export async function queryPDFStatus(id: string): Promise<TaskStatusResult> {
  return resolveTaskStatus(id);
}

export async function readPDFBuffer(id: string): Promise<Buffer> {
  const cachedPath = await pdfCache.get(id);
  if (!cachedPath) throw new Error("PDF not cached");
  const fs = await import("fs/promises");
  return fs.readFile(cachedPath);
}

// --- workers ---

async function runWorker() {
  while (!shuttingDown) {
    await toPDFQueue.wait();
    if (shuttingDown) break;

    const id = toPDFQueue.consume();
    if (id === null) continue;

    activeWorkers++;
    const state = getTaskState(id);
    const retryCount = state?.retryCount ?? 0;
    setTaskState(id, {
      status: "processing",
      retryCount,
      updatedAt: Date.now(),
    });

    try {
      const result = await queryPhotoUpstream(id);
      if (!result.success)
        throw new Error(translateError(result.error));

      const photo = result.result;
      const startedAt = Date.now();
      const totalImages = photo.images.length;
      setTaskState(id, {
        status: "processing",
        retryCount,
        totalImages,
        startedAt,
        processedImages: 0,
        updatedAt: Date.now(),
      });

      const buffer = await generatePDF(
        photo,
        (p: ProgressInfo) => {
          setTaskState(id, {
            status: "processing",
            retryCount,
            totalImages,
            startedAt,
            processedImages: p.processed,
            updatedAt: Date.now(),
          });
        },
        (elapsed: number, total: number) => {
          const etaSeconds = Math.round((elapsed * total) / CPU_CONCURRENCY / 1000);
          setTaskState(id, {
            status: "processing",
            retryCount,
            totalImages: total,
            startedAt,
            processedImages: 1,
            etaSeconds,
            updatedAt: Date.now(),
          });
        },
      );

      await pdfCache.set(id, buffer);
      deleteTaskState(id);
      console.log(`PDF generated and cached: ${id}`);
    } catch (err) {
      const message = translateError(err);
      console.error(`Failed to generate PDF for ${id}:`, err);

      if (retryCount < MAX_RETRIES) {
        const pushed = toPDFQueue.push(id);
        if (pushed) {
          setTaskState(id, {
            status: "pending",
            retryCount: retryCount + 1,
            updatedAt: Date.now(),
          });
        } else {
          setTaskState(id, {
            status: "error",
            error: "Queue full on retry",
            retryCount,
            updatedAt: Date.now(),
          });
        }
      } else {
        setTaskState(id, {
          status: "error",
          error: message,
          retryCount,
          updatedAt: Date.now(),
        });
      }
    } finally {
      activeWorkers--;
    }
  }
}
