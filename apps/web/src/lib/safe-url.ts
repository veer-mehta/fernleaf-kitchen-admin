// A link from the database is only turned into a clickable <a href> if it is a plain web address.
// The API already refuses anything else, but the screen checks again so that a "javascript:" or
// "data:" address (for example one inserted straight into the database) can never become a link.
export function safeHref(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\/\S+$/i.test(url) ? url : undefined;
}

// Where to load a stored picture from: an uploaded photo ("/images/12") is served by the API
// through the /api proxy; anything else must be a plain web address.
export function imageSrc(ref: string | null | undefined): string | undefined {
  return ref && /^\/images\/\d+$/.test(ref) ? `/api${ref}` : safeHref(ref);
}
