import "server-only";
import sharp from "sharp";
import { NEWS_IMAGE_INPUT_BYTES, NEWS_IMAGE_OUTPUT_BYTES, NEWS_IMAGE_MAX_EDGE, NEWS_IMAGE_MAX_PIXELS, NEWS_IMAGE_TYPES } from "@/core/domain/news/image";
import { HttpError } from "@/shared/server/http";

/** Decode then re-encode raster pixels; uploaded metadata and scripts never reach readers. */
export async function optimizeNewsImage(input: Uint8Array, contentType: string) {
  const expected = new Map<string, string>([["image/jpeg", "jpeg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "heif"]]);
  if (!NEWS_IMAGE_TYPES.some((type) => type === contentType)) throw new HttpError(415, "Choose a JPEG, PNG, WebP, or AVIF image.", "IMAGE_TYPE_UNSUPPORTED");
  if (input.byteLength === 0 || input.byteLength > NEWS_IMAGE_INPUT_BYTES) throw new HttpError(413, "Choose an image smaller than 8 MB.", "IMAGE_TOO_LARGE");
  try {
    const image = sharp(input, { limitInputPixels: NEWS_IMAGE_MAX_PIXELS, animated: true, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== expected.get(contentType) || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height) {
      throw new HttpError(415, "Choose a still JPEG, PNG, WebP, or AVIF image.", "IMAGE_TYPE_UNSUPPORTED");
    }
    const output = await image.rotate().resize({ width: NEWS_IMAGE_MAX_EDGE, height: NEWS_IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (output.data.byteLength > NEWS_IMAGE_OUTPUT_BYTES) throw new HttpError(413, "This image is too detailed. Reduce its dimensions and try again.", "IMAGE_TOO_LARGE");
    return { data: new Uint8Array(output.data), width: output.info.width, height: output.info.height, bytes: output.data.byteLength };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The image could not be decoded. Choose a valid image under 20 megapixels.", "IMAGE_INVALID");
  }
}

export async function readNewsImageBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > NEWS_IMAGE_INPUT_BYTES) throw new HttpError(413, "Choose an image smaller than 8 MB.", "IMAGE_TOO_LARGE");
  if (!request.body) throw new HttpError(400, "Choose an image to upload.", "IMAGE_EMPTY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > NEWS_IMAGE_INPUT_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Choose an image smaller than 8 MB.", "IMAGE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new HttpError(400, "Choose an image to upload.", "IMAGE_EMPTY");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
