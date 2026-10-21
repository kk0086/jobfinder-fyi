import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";
import { fromSpec } from "../lib/big.mts";
import { normalizeJob } from "../lib/normalize.mts";

// Temporary owner-only tool: runs one reader spec and reports what it would collect (nothing is stored).
export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
  const specs: any[] = await req.json();
  const out = await Promise.all(specs.map(async s => {
    const t = Date.now();
    try {
      const { raw, assumeUS } = await fromSpec(s).run();
      const kept = raw.map(x => normalizeJob(x, { assumeUS })).filter(Boolean) as any[];
      return { name: s.name, ok: true, raw: raw.length, kept: kept.length, ms: Date.now() - t, sample: raw.slice(0, 2).map(r => `${r.title} | ${r.location} | ${r.url}`) };
    } catch (e: any) { return { name: s.name, ok: false, ms: Date.now() - t, error: String(e?.message || e).slice(0, 120) }; }
  }));
  return Response.json(out);
};
export const config: Config = { path: "/api/trial", method: ["POST"] };
