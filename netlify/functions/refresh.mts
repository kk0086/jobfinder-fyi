import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";
import { runChunk, jobsPayload, TOTAL_BATCHES } from "../lib/store.mts";

// Owner-only manual refresh: POST /api/refresh?chunk=0..14
export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
  const c = +(new URL(req.url).searchParams.get("chunk") ?? -1);
  if (!(c >= 0 && c < TOTAL_BATCHES)) return Response.json({ error: "chunk must be 0.." + (TOTAL_BATCHES - 1) }, { status: 400 });
  const r = await runChunk(c);
  await jobsPayload(true);
  return Response.json(r, { headers: { "cache-control": "no-store" } });
};
export const config: Config = { path: "/api/refresh", method: ["POST"] };
