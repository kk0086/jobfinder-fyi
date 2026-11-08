import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";
import { getStore } from "@netlify/blobs";
import { runChunk, jobsPayload, TOTAL_BATCHES } from "../lib/store.mts";

// Owner-only manual refresh: POST /api/refresh?chunk=0..14
export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  // Owner-only: store a company list loaded from a browser (for sites that block server addresses), then refresh with ?chunk=N.
  if (q.get("import") === "wayfair") {
    const rows = await req.json().catch(() => null);
    if (!Array.isArray(rows) || !rows.length) return Response.json({ error: "body must be a non-empty array" }, { status: 400 });
    await getStore("feed").setJSON("import-wayfair", { at: new Date().toISOString(), rows });
    return Response.json({ stored: rows.length });
  }
  const c = +(q.get("chunk") ?? -1);
  if (!(c >= 0 && c < TOTAL_BATCHES)) return Response.json({ error: "chunk must be 0.." + (TOTAL_BATCHES - 1) }, { status: 400 });
  const r = await runChunk(c);
  await jobsPayload("us", true);
  return Response.json(r, { headers: { "cache-control": "no-store" } });
};
export const config: Config = { path: "/api/refresh", method: ["POST"] };
