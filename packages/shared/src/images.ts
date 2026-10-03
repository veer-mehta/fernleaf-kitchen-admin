import { z } from "zod";

// What a dish picture or delivery photo may point to: a web address, or the path of a photo
// uploaded to this app ("/images/12"). Nothing else, so a "javascript:" or "data:" address can
// never be stored and later shown as a link or image.
export const imageRef = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/\S+$/i.test(v) || /^\/images\/\d+$/.test(v), "Use an uploaded photo or a link starting with http:// or https://");
