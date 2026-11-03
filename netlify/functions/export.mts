import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";

// Owner-only export of the stored visit records.
//   GET /api/export?index=1        -> list of days that have records
//   GET /api/export?day=YYYY-MM-DD -> every visit record for that day
export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  const u = new URL(req.url), store = getStore("sessions");
  const hdr = { "cache-control": "no-store" };
  if (u.searchParams.get("index")) {
    const { directories } = await store.list({ prefix: "s/", directories: true });
    const days = (directories || []).map(d => d.replace(/^s\//, "").replace(/\/$/, "")).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return Response.json({ days }, { headers: hdr });
  }
  const day = u.searchParams.get("day") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response("bad day", { status: 400 });
  const { blobs } = await store.list({ prefix: `s/${day}/` });
  const out: any[] = [];
  for (let i = 0; i < blobs.length; i += 50) {
    const got = await Promise.all(blobs.slice(i, i + 50).map(b => store.get(b.key, { type: "json" }).catch(() => null)));
    out.push(...got.filter(Boolean));
  }
  return Response.json({ day, count: out.length, visits: out }, { headers: hdr });
};
export const config: Config = { path: "/api/export", method: ["GET"] };
