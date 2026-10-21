import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";

// Temporary owner-only tool: checks whether a careers API accepts requests from Netlify's servers.
export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
  const tests: { name: string; url: string; method?: string; body?: string; headers?: Record<string, string> }[] = await req.json();
  const out = await Promise.all(tests.map(async t => {
    try {
      const r = await fetch(t.url, { method: t.method || "GET", body: t.body, headers: { "user-agent": "jobfinder.fyi job board reader", accept: "application/json", ...(t.headers || {}) }, signal: AbortSignal.timeout(15000) });
      const x = await r.text();
      return { name: t.name, status: r.status, len: x.length, head: x.slice(0, 220).replace(/\s+/g, " ") };
    } catch (e: any) { return { name: t.name, error: String(e?.message || e) }; }
  }));
  return Response.json(out);
};
export const config: Config = { path: "/api/probe", method: ["POST"] };
