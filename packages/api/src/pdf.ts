import { PDFDocument } from "pdf-lib";
import pLimit from "p-limit";
import { PhotoInfo } from "./upstream.js";
import {
  processImage,
  downloadImage,
  getImageMetadata,
  type ProcessedImage,
} from "./image.js";
import { PDF_DOWNLOAD_CONCURRENCY } from "./constants.js";

export async function generatePDF(photo: PhotoInfo): Promise<Buffer> {
  const pdfDocument = await PDFDocument.create();
  const photoId = parseInt(photo.id);
  const limit = pLimit(PDF_DOWNLOAD_CONCURRENCY);

  const processedImages = await Promise.all(
    photo.images.map((image) =>
      limit(async (): Promise<ProcessedImage | null> => {
        let rawBuffer: Buffer;
        try {
          rawBuffer = await downloadImage(image.url);
        } catch (err) {
          console.error(`Failed to download ${image.name}:`, err);
          return null;
        }

        const processed = await processImage(
          rawBuffer,
          photo.scrambleId,
          photoId,
          image.name,
        );
        if (processed === null) return null;

        let metadata;
        try {
          metadata = await getImageMetadata(processed);
        } catch {
          console.error(`Failed to read metadata for ${image.name}, skipping`);
          return null;
        }

        return {
          data: processed,
          width: metadata.width!,
          height: metadata.height!,
        };
      }),
    ),
  );

  for (const image of processedImages) {
    if (image === null) continue;

    let pdfImage;
    try {
      pdfImage = await pdfDocument.embedJpg(image.data);
    } catch (err) {
      console.error(`Failed to embed image into PDF:`, err);
      continue;
    }

    const page = pdfDocument.addPage([image.width, image.height]);
    page.drawImage(pdfImage, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  if (pdfDocument.getPageCount() === 0) {
    throw new Error("No images could be embedded into PDF");
  }

  return Buffer.from(await pdfDocument.save());
}
