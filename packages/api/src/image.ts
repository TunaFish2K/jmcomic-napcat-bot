import sharp from "sharp";
import { createHash } from "crypto";
import { IMAGE_DOWNLOAD_TIMEOUT_MS } from "./constants.js";
import type { PhotoInfo } from "./upstream.js";

export function getSliceCount(
  scrambleId: number,
  photoId: number,
  filename: string,
): number {
  if (photoId < scrambleId) return 0;
  if (filename.endsWith(".gif")) return 0;
  if (photoId < 268850) return 10;

  const hex = createHash("md5")
    .update(`${photoId}${filename.split(".")[0]}`)
    .digest("hex");
  return (
    (hex.charCodeAt(hex.length - 1) % (photoId < 421926 ? 10 : 8)) * 2 + 2
  );
}

export async function reverseImageBySlice(
  imageBuffer: Buffer,
  sliceCount: number,
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  const over = height % sliceCount;
  const move = Math.floor(height / sliceCount);

  const slices: { input: Buffer; top: number; left: number }[] = [];

  for (let i = 0; i < sliceCount; i++) {
    const sY = height - move * (i + 1) - over;
    let sliceHeight = move;
    if (i === 0) {
      sliceHeight += over;
    }

    const slice = await sharp(imageBuffer)
      .extract({ left: 0, top: sY, width, height: sliceHeight })
      .toBuffer();

    let dY = move * i;
    if (i !== 0) {
      dY += over;
    }

    slices.push({ input: slice, top: dY, left: 0 });
  }

  return await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(slices)
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    IMAGE_DOWNLOAD_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `Failed to download image: ${res.status} ${res.statusText}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

export async function processImage(
  buffer: Buffer,
  scrambleId: number,
  photoId: number,
  filename: string,
): Promise<Buffer | null> {
  try {
    const sliceCount = getSliceCount(scrambleId, photoId, filename);
    if (sliceCount > 0) {
      buffer = await reverseImageBySlice(buffer, sliceCount);
    } else {
      buffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    }
    return buffer;
  } catch (err) {
    console.error(`Failed to process image ${filename}:`, err);
    return null;
  }
}

export async function downloadCoverImage(
  photo: PhotoInfo,
): Promise<Buffer | null> {
  if (photo.images.length === 0) return null;
  const firstImage = photo.images[0]!;
  const photoId = parseInt(photo.id);
  try {
    const raw = await downloadImage(firstImage.url);
    const processed = await processImage(raw, photo.scrambleId, photoId, firstImage.name);
    if (!processed) return null;

    // resize cover to keep message size manageable
    return await sharp(processed)
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (err) {
    console.error(`Failed to download cover image for photo ${photo.id}:`, err);
    return null;
  }
}
