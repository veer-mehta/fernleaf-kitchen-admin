import { apiPost } from "@/lib/api";

const MAX_SIDE = 1280;

// Phone cameras produce 3-8 MB photos. Redrawing the picture smaller on a canvas and saving it
// as JPEG brings it to a few hundred KB, which uploads quickly on mobile data and fits the
// server's 1 MB limit. (Drawing also bakes in the camera's rotation.)
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read that picture"))), "image/jpeg", 0.8),
  );
}

// Returns the stored picture's path, e.g. "/images/12".
export async function uploadImage(file: File): Promise<string> {
  let blob: Blob;
  try {
    blob = await shrink(file);
  } catch {
    throw new Error("Could not read that file. Choose a JPEG, PNG or WebP picture.");
  }
  const { url } = await apiPost<{ url: string }>("/images", blob);
  return url;
}
