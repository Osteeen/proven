// The app's public address comes from configuration (AUTH_URL), never from the
// request: the dev server reports itself as "localhost" even when the site is
// served on 127.0.0.1, and browsers keep cookies separately for the two.
export function appUrl(): string {
  const url = process.env.AUTH_URL;
  if (!url) throw new Error("AUTH_URL is not set");
  return url.replace(/\/$/, "");
}
