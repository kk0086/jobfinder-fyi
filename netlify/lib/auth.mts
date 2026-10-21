import { createHash, timingSafeEqual } from "node:crypto";

// SHA-256 of the owner's admin key (the key itself is never stored in the repo).
const KEY_HASH = "e4c18a31f0ecf58d21e1b0e4934d439540bb2fb59e50e1bd82e8c5a1f73b3743";
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function isOwner(req: Request): boolean {
  const given = req.headers.get("x-admin-key") || "";
  if (!given) return false;
  if (same(createHash("sha256").update(given).digest("hex"), KEY_HASH)) return true;
  const env = Netlify.env.get("ADMIN_KEY") || "";
  return !!env && same(given, env);
}
