export const NEWS_IMAGE_INPUT_BYTES = 8 * 1024 * 1024;
export const NEWS_IMAGE_OUTPUT_BYTES = 1024 * 1024;
export const NEWS_IMAGE_STORAGE_BYTES = 32 * 1024 * 1024;
export const NEWS_IMAGE_MAX_PIXELS = 20_000_000;
export const NEWS_IMAGE_MAX_EDGE = 1600;
export const NEWS_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

export function newsImagePath(id: string): string {
  return `/api/news/images/${id}`;
}

export function validNewsImageId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
