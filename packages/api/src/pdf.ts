import { PDFDocument } from "pdf-lib";
import pLimit from "p-limit";
import sharp from "sharp";
import { PhotoInfo } from "./upstream.js";
import {
  processImage,
  downloadImage,
} from "./image.js";
import {
  NETWORK_CONCURRENCY,
  CPU_CONCURRENCY,
  IMAGE_DOWNLOAD_RETRIES,
} from "./constants.js";

export interface ProgressInfo {
  processed: number;
  total: number;
}

interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  name: string;
}

async function downloadImageWithRetry(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= IMAGE_DOWNLOAD_RETRIES; attempt++) {
    try {
      return await downloadImage(url);
    } catch (err) {
      lastErr = err;
      if (attempt < IMAGE_DOWNLOAD_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastErr;
}

export async function generatePDF(
  photo: PhotoInfo,
  onProgress?: (info: ProgressInfo) => void,
  onFirstImage?: (elapsed: number, total: number) => void,
): Promise<Buffer> {
  const pdfDocument = await PDFDocument.create();
  const photoId = parseInt(photo.id);
  const total = photo.images.length;
  const netPool = pLimit(NETWORK_CONCURRENCY);
  const cpuPool = pLimit(CPU_CONCURRENCY);

  const buffer: (ProcessedImage | null | undefined)[] = new Array(total);
  let nextToEmbed = 0;
  let embeddedCount = 0;
  let completedCount = 0;
  let firstReported = false;
  let finalized = false;

  return new Promise<Buffer>((resolve, reject) => {
    async function flushEmbed() {
      while (nextToEmbed < total && buffer[nextToEmbed] !== undefined) {
        const img = buffer[nextToEmbed];
        if (img) {
          let pdfImage;
          try {
            pdfImage = await pdfDocument.embedJpg(img.data);
          } catch (err) {
            console.error(`Failed to embed ${img.name} (photo ${photo.id}):`, err);
            nextToEmbed++;
            continue;
          }

          const page = pdfDocument.addPage([img.width, img.height]);
          page.drawImage(pdfImage, { x: 0, y: 0, width: img.width, height: img.height });
          embeddedCount++;
          onProgress?.({ processed: embeddedCount, total });
        }
        nextToEmbed++;
      }
    }

    function finalize() {
      if (finalized) return;
      finalized = true;
      if (pdfDocument.getPageCount() === 0) {
        reject(new Error("No images could be embedded into PDF"));
      } else {
        pdfDocument.save().then((b) => resolve(Buffer.from(b))).catch(reject);
      }
    }

    const pipelineStarted = Date.now();

    for (let idx = 0; idx < total; idx++) {
      const image = photo.images[idx]!;
      (async () => {
        try {
          const raw = await netPool(async () => {
            try {
              return await downloadImageWithRetry(image.url);
            } catch (err) {
              console.error(`Failed to download ${image.name} (photo ${photo.id}):`, err);
              return null;
            }
          });

          if (!raw) {
            buffer[idx] = null;
            return;
          }

          const processed = await cpuPool(async () => {
            const buf = await processImage(raw, photo.scrambleId, photoId, image.name);
            if (!buf) return null;

            let metadata;
            try {
              metadata = await sharp(buf).metadata();
            } catch {
              return null;
            }
            return { data: buf, width: metadata.width!, height: metadata.height!, name: image.name } as ProcessedImage;
          });

          if (!firstReported && processed) {
            firstReported = true;
            onFirstImage?.(Date.now() - pipelineStarted, total);
          }

          buffer[idx] = processed;
        } catch {
          buffer[idx] = null;
        } finally {
          completedCount++;
          try {
            await flushEmbed();
          } catch (err) {
            console.error("flushEmbed failed:", err);
          }
          if (completedCount === total) finalize();
        }
      })();
    }
  });
}
