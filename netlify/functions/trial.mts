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
    if (s.kind === "fetch") {
      try {
        const r = await fetch(s.url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", ...(s.headers || {}) }, method: s.method || "GET", body: s.body, signal: AbortSignal.timeout(15000) });
        const x = await r.text(); const i = s.find ? x.search(new RegExp(s.find)) : 0;
        return { name: s.name, ok: true, raw: x.length, kept: i, ms: Date.now() - t, sample: [`${r.status} ` + x.slice(Math.max(0, i), Math.max(0, i) + (s.n || 300)).replace(/\s+/g, " ")] };
      } catch (e: any) { return { name: s.name, ok: false, ms: Date.now() - t, error: String(e?.message || e).slice(0, 120) }; }
    }
    try {
      const { raw, assumeUS } = await fromSpec(s).run();
      const kept = raw.map(x => normalizeJob(x, { assumeUS })).filter(Boolean) as any[];
      return { name: s.name, ok: true, raw: raw.length, kept: kept.length, ms: Date.now() - t, sample: raw.slice(0, 2).map(r => `${r.title} | ${r.location} | ${r.url}`) };
    } catch (e: any) { return { name: s.name, ok: false, ms: Date.now() - t, error: String(e?.message || e).slice(0, 120) }; }
  }));
  return Response.json(out);
};
export const config: Config = { path: "/api/trial", method: ["POST"] };
