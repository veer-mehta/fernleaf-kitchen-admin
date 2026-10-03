// A link from the database is only turned into a clickable <a href> if it is a plain web address.
// The API already refuses anything else, but the screen checks again so that a "javascript:" or
// "data:" address (for example one inserted straight into the database) can never become a link.
export function safeHref(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\/\S+$/i.test(url) ? url : undefined;
}
