import type { Config } from "@netlify/functions";
import { isOwner } from "../lib/auth.mts";
import { getStore } from "@netlify/blobs";
import { readFeed, loadFeeds, type Feed } from "../lib/crawl.mts";
import { BIG } from "../lib/big.mts";
import seed from "../lib/seed.json" with { type: "json" };
import { normalizeJob } from "../lib/normalize.mts";

// Owner-only board discovery. Nothing is stored; results go back to the caller.
//  {action:"cdx", ats, crawl?, page}  -> candidate slugs from the Common Crawl index (plus page count)
//  {action:"test", ats, slugs[]}      -> for each slug, how many US roles its public board has
const HOSTS: Record<string, { pat: string; re: RegExp }[]> = {
  greenhouse: [{ pat: "boards.greenhouse.io/*", re: /^https?:\/\/boards\.greenhouse\.io\/([a-z0-9][a-z0-9_-]{1,60})(?:[\/?#]|$)/i }, { pat: "job-boards.greenhouse.io/*", re: /^https?:\/\/job-boards\.greenhouse\.io\/([a-z0-9][a-z0-9_-]{1,60})(?:[\/?#]|$)/i }],
  lever: [{ pat: "jobs.lever.co/*", re: /^https?:\/\/jobs\.lever\.co\/([a-z0-9][a-z0-9_-]{1,60})(?:[\/?#]|$)/i }],
  ashby: [{ pat: "jobs.ashbyhq.com/*", re: /^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9_%.-]{1,60})(?:[\/?#]|$)/i }],
};
const SKIP = new Set(["embed", "jobs", "careers", "api", "v1", "boards", "static", "assets", "robots.txt", "sitemap.xml", "favicon.ico"]);
const pretty = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export default async (req: Request) => {
  if (!isOwner(req)) return new Response("Unauthorized", { status: 401 });
  const b = await req.json();
  if (b.action === "cdx") {
    let crawl = b.crawl;
    if (!crawl) { const c = await fetch("https://index.commoncrawl.org/collinfo.json").then(r => r.json()); crawl = c[0].id; }
    const hosts = HOSTS[b.ats]; const h = hosts[b.h || 0];
    const base = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(h.pat)}&output=json&fl=url`;
    if (b.page == null) { const n = await fetch(base + "&showNumPages=true").then(r => r.text()); return Response.json({ crawl, hosts: hosts.length, pages: n.trim().slice(0, 200) }); }
    const r = await fetch(base + "&page=" + b.page, { signal: AbortSignal.timeout(24000) });
    const txt = await r.text(); const seen = new Set<string>();
    for (const line of txt.split("\n")) { const m = line.match(/"url": ?"([^"]+)"/); if (!m) continue; const s = h.re.exec(m[1])?.[1]?.toLowerCase(); if (s && !SKIP.has(s) && !s.includes("%")) seen.add(s); }
    return Response.json({ crawl, status: r.status, slugs: [...seen] });
  }
  if (b.action === "test") {
    const ats = b.ats as Feed["ats"];
    const res = await pool<string, any>(b.slugs as string[], 24, async slug => {
      try {
        let name = pretty(slug);
        const raw = await readFeed({ name, ats, slug });
        if (ats === "greenhouse" && raw.length) { try { const j = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()); if (j?.name) { name = String(j.name).trim(); raw.forEach(x => x.company = name); } } catch {} }
        const kept = raw.filter(x => normalizeJob(x, {})).length;
        return kept ? [slug, name, kept, raw.length] : null;
      } catch { return null; }
    });
    return Response.json(res.filter(Boolean));
  }
  if (b.action === "register") {
    // entries: [slug, name][] for one ats. Appends to the registry, skipping boards and companies we already have.
    const store = getStore("feed");
    const reg = ((await store.get("registry", { type: "json" }).catch(() => null)) as Feed[] | null) || [];
    const norm = (n: string) => n.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co|the|group|holdings|technologies|technology)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
    const all = await loadFeeds();
    const names = new Set<string>([...all.map(f => norm(f.name)), ...BIG.map(x => norm(x.name)), ...((seed as any).jobs as any[]).map(j => norm(j.company))]);
    const keys = new Set(all.map(f => f.ats + "|" + f.slug));
    let added = 0, dupe = 0;
    for (const [slug, name] of b.entries as [string, string][]) {
      const k = b.ats + "|" + slug, n = norm(name);
      if (keys.has(k) || !n || names.has(n)) { dupe++; continue; }
      keys.add(k); names.add(n); reg.push({ name, ats: b.ats, slug }); added++;
    }
    await store.setJSON("registry", reg);
    return Response.json({ added, dupe, registry: reg.length });
  }
  return new Response("bad action", { status: 400 });
};
export const config: Config = { path: "/api/discover", method: ["POST"] };
