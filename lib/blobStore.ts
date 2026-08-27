import { put } from "@vercel/blob";

/**
 * Uploads a judged photo to Vercel Blob for the dispute record (doc §5, §7).
 * Returns null when BLOB_READ_WRITE_TOKEN isn't configured - the local dev
 * fallback, so `npm run dev` can still exercise AI judging without a Blob
 * store connected. The image is judged from its in-memory bytes either way;
 * this only affects whether a durable copy is kept.
 */
export async function uploadPhoto(buffer: Buffer, contentType: string, keyHint: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const blob = await put(`race-photos/${keyHint}-${Date.now()}.jpg`, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return blob.url;
}
