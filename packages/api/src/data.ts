import assert from "assert";
import path from "path";
import fs from "fs/promises";
import { createHash } from "crypto";
import { ERROR_TTL_MS } from "./constants.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface PDFRecord {
  id: string
  size: number
  createdAt: number
}

interface MetadataFile {
  version: number
  records: PDFRecord[]
}

class AsyncLock {
  #promise: Promise<void> = Promise.resolve()

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.#promise
    let release: () => void
    this.#promise = new Promise(resolve => { release = resolve })
    await prev
    try {
      return await fn()
    } finally {
      release!()
    }
  }
}

export class PDFCache {
  #cacheFolder: string
  #maxSizeBytes: number
  #records: PDFRecord[] = []
  #totalSize = 0
  #lock = new AsyncLock()

  constructor(cacheFolder: string, maxSizeBytes: number) {
    this.#cacheFolder = path.resolve(cacheFolder)
    this.#maxSizeBytes = maxSizeBytes
  }

  get maxSize(): number {
    return this.#maxSizeBytes
  }

  get totalSize(): number {
    return this.#totalSize
  }

  get recordCount(): number {
    return this.#records.length
  }

  get cacheFolder(): string {
    return this.#cacheFolder
  }

  async init(): Promise<void> {
    await fs.mkdir(this.#cacheFolder, { recursive: true })
    await this.#loadMetadata()
  }

  async has(id: string): Promise<boolean> {
    const record = this.#records.find(r => r.id === id)
    if (!record) return false
    return await fileExists(this.#filePath(id))
  }

  async get(id: string): Promise<string | null> {
    if (!(await this.has(id))) return null
    return this.#filePath(id)
  }

  async set(id: string, buffer: Uint8Array): Promise<void> {
    return this.#lock.acquire(async () => {
      const filePath = this.#filePath(id)
      await fs.writeFile(filePath, buffer)

      const existingIdx = this.#records.findIndex(r => r.id === id)
      if (existingIdx !== -1) {
        this.#totalSize -= this.#records[existingIdx]!.size
        this.#records.splice(existingIdx, 1)
      }

      const size = buffer.byteLength
      this.#records.push({ id, size, createdAt: Date.now() })
      this.#totalSize += size

      await this.#evict()
      await this.#saveMetadata()
    })
  }

  async delete(id: string): Promise<void> {
    return this.#lock.acquire(async () => {
      const idx = this.#records.findIndex(r => r.id === id)
      if (idx === -1) return

      this.#totalSize -= this.#records[idx]!.size
      this.#records.splice(idx, 1)

      try {
        await fs.unlink(this.#filePath(id))
      } catch {
        // file might already be deleted manually
      }

      await this.#saveMetadata()
    })
  }

  getStats() {
    return {
      totalSize: this.#totalSize,
      maxSize: this.#maxSizeBytes,
      recordCount: this.#records.length,
      cacheFolder: this.#cacheFolder,
    }
  }

  #fileName(id: string): string {
    return createHash("sha256").update(id).digest("hex") + ".pdf"
  }

  #filePath(id: string): string {
    return path.join(this.#cacheFolder, this.#fileName(id))
  }

  async #loadMetadata(): Promise<void> {
    const metadataPath = path.join(this.#cacheFolder, "metadata.json")
    try {
      const raw = await fs.readFile(metadataPath, "utf-8")
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // v1: plain array of records
        this.#records = parsed.filter(
          (r: any): r is PDFRecord =>
            typeof r.id === "string" && typeof r.size === "number" && typeof r.createdAt === "number",
        )
      } else if (
        typeof parsed === "object" &&
        parsed !== null &&
        parsed.version === 2 &&
        Array.isArray(parsed.records)
      ) {
        this.#records = parsed.records.filter(
          (r: any): r is PDFRecord =>
            typeof r.id === "string" && typeof r.size === "number" && typeof r.createdAt === "number",
        )
      } else {
        throw new Error("metadata format not recognized")
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Failed to load PDF cache metadata, starting fresh:", err)
      }
      this.#records = []
    }

    this.#totalSize = 0
    const valid: PDFRecord[] = []
    for (const record of this.#records) {
      if (await fileExists(this.#filePath(record.id))) {
        valid.push(record)
        this.#totalSize += record.size
      }
    }

    if (valid.length !== this.#records.length) {
      this.#records = valid
      await this.#saveMetadata()
    }
  }

  async #saveMetadata(): Promise<void> {
    const metadataPath = path.join(this.#cacheFolder, "metadata.json")
    const tmpPath = metadataPath + ".tmp"
    const data: MetadataFile = { version: 2, records: this.#records }
    await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8")
    await fs.rename(tmpPath, metadataPath)
  }

  async #evict(): Promise<void> {
    while (this.#records.length > 0 && this.#totalSize > this.#maxSizeBytes) {
      const oldest = this.#records.shift()!
      this.#totalSize -= oldest.size
      try {
        await fs.unlink(this.#filePath(oldest.id))
      } catch {
        // file might already be deleted manually
      }
    }
  }
}

export type TaskStatus = "pending" | "processing" | "ready" | "error";

export interface TaskState {
  status: TaskStatus;
  error?: string;
  retryCount: number;
  updatedAt: number;
  totalImages?: number;
  processedImages?: number;
  startedAt?: number;
  etaSeconds?: number;
}

const taskStates = new Map<string, TaskState>();
const MAX_TASK_STATES = 1000;

export function getTaskState(id: string): TaskState | null {
  const state = taskStates.get(id);
  if (!state) return null;
  if (state.status === "error" && Date.now() - state.updatedAt > ERROR_TTL_MS) {
    taskStates.delete(id);
    return null;
  }
  return state;
}

export function setTaskState(id: string, state: TaskState): void {
  // Clean up expired error states first
  for (const [key, value] of taskStates) {
    if (
      value.status === "error" &&
      Date.now() - value.updatedAt > ERROR_TTL_MS
    ) {
      taskStates.delete(key);
    }
  }

  // If still at capacity, evict the oldest expired-or-error state only
  if (taskStates.size >= MAX_TASK_STATES && !taskStates.has(id)) {
    for (const [key, value] of taskStates) {
      if (value.status === "error") {
        taskStates.delete(key);
        break;
      }
    }
  }

  taskStates.set(id, state);
}

export function deleteTaskState(id: string): void {
  taskStates.delete(id);
}

/**
 * a simple ringed buffer, used for pushing and consuming pdf generating tasks.
 */
export class TaskQueue {
  #maxSize;
  #memory;
  #start = 0;
  #size = 0;
  #ids = new Set<string>();
  #waiters: Array<() => void> = [];

  constructor(maxSize: number) {
    assert(maxSize > 0);
    this.#maxSize = maxSize;
    this.#memory = new Array<string | undefined>(maxSize).fill(undefined);
  }
  get maxSize() {
    return this.#maxSize;
  }

  get empty() {
    return this.#size < 1;
  }

  get full() {
    return this.#size >= this.#maxSize;
  }

  get length() {
    return this.#size;
  }

  has(value: string) {
    return this.#ids.has(value);
  }

  push(id: string) {
    if (this.has(id)) {
      return true;
    }
    if (this.#size >= this.#maxSize) {
      return false;
    }

    this.#memory[(this.#start + this.#size) % this.#maxSize] = id;
    this.#size += 1;
    this.#ids.add(id);
    this.#wakeOne();
    return true;
  }
  consume() {
    if (this.#size < 1) return null;
    const value = this.#memory[this.#start]!;
    this.#memory[this.#start] = undefined;
    this.#start = (this.#start + 1) % this.#maxSize;
    this.#size -= 1;
    this.#ids.delete(value);
    return value;
  }

  async wait(): Promise<void> {
    if (!this.empty) return;
    await new Promise<void>(resolve => this.#waiters.push(resolve));
  }

  wakeAll(): void {
    for (const waiter of this.#waiters) {
      waiter();
    }
    this.#waiters = [];
  }

  #wakeOne(): void {
    const waiter = this.#waiters.shift();
    waiter?.();
  }
}
