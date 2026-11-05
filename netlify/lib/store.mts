import { getStore } from "@netlify/blobs";
import { crawlChunk, loadFeeds, FEED_CHUNKS } from "./crawl.mts";
import { crawlBig, BIG } from "./big.mts";

export const TOTAL_BATCHES = FEED_CHUNKS + BIG.length;
import { regionOf, type Job } from "./normalize.mts";
import seed from "./seed.json" with { type: "json" };

type ChunkBlob = { at: string; jobs: Job[]; report: { name: string; ok: boolean; total: number; kept: number; error?: string }[] };

export async function runChunk(chunk: number) {
  const store = getStore("feed");
  const prev = (await store.get(`v2-chunk-${chunk}`, { type: "json" }).catch(() => null)) as ChunkBlob | null;
  const { jobs, report } = chunk < FEED_CHUNKS ? await crawlChunk(chunk, 24000, prev?.jobs || []) : await crawlBig(chunk - FEED_CHUNKS);
  const failed = new Set(report.filter(r => !r.ok).map(r => r.name));
  // A company that failed this run keeps its previous roles instead of vanishing.
  const kept = prev ? prev.jobs.filter(j => failed.has(j.company)) : [];
  const out: ChunkBlob = { at: new Date().toISOString(), jobs: [...jobs, ...kept], report };
  await store.setJSON(`v2-chunk-${chunk}`, out);
  return { chunk, companies: report.length, failed: [...failed], roles: out.jobs.length, at: out.at };
}

const cache = new Map<string, { t: number; body: Uint8Array }>();
export const REGIONS = ["us", "ca", "uk", "ie", "emea"];

export async function loadAll() {
  const store = getStore("feed");
  const blobs = await Promise.all(Array.from({ length: TOTAL_BATCHES }, (_, i) => store.get(`v2-chunk-${i}`, { type: "json" }).catch(() => null) as Promise<ChunkBlob | null>));
  const feedNames = new Set([...(await loadFeeds()).map(f => f.name), ...BIG.map(b => b.name)]);
  const fresh = new Set<string>();
  const jobs: Job[] = [];
  let at = "";
  for (const b of blobs) {
    if (!b) continue;
    at = at > b.at ? at : b.at;
    for (const r of b.report) if (r.ok && feedNames.has(r.name)) fresh.add(r.name); // failed companies keep their last known (seed) roles
    jobs.push(...b.jobs.filter(j => feedNames.has(j.company) || (j as any).src === "search" || !b.report.length));
  }
  // Seed rows: browser-read companies always; feed companies only until their first live refresh.
  for (const j of (seed as any).jobs as Job[]) if (!feedNames.has(j.company) || !fresh.has(j.company)) jobs.push(j);
  // Search-sourced roles are only kept for employers we do not already read directly (no duplicates).
  const norm = (n: string) => n.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co|the|group|holdings|technologies|technology)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
  const known = new Set<string>([...feedNames].map(norm));
  const have = new Set<string>((seed as any).jobs.filter((j: Job) => !feedNames.has(j.company)).map((j: Job) => norm(j.company)));
  for (let i = jobs.length - 1; i >= 0; i--) if ((jobs[i] as any).src === "search") { const k = norm(jobs[i].company); if (known.has(k) || have.has(k)) jobs.splice(i, 1); }
  const seenUrl = new Set<string>();
  const unique = jobs.filter(j => { const k = j.company + "|" + j.url; if (seenUrl.has(k)) return false; seenUrl.add(k); return true; });
  // Roles stored before the family was renamed.
  for (const j of unique as any[]) if (j.role === "Executive") j.role = "Executive leadership";
  return { jobs: unique, at, blobs };
}

async function buildPayload(jobs: Job[], at: string, region: string) {
  const rows = jobs.filter(j => regionOf((j as any).cc) === region);
  const { gzipSync } = await import("node:zlib");
  const seedAt = (seed as any).generated_at as string;
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ generated_at: at || seedAt, seed_at: seedAt, region, companyCount: new Set(rows.map(j => j.company)).size, jobs: rows }))));
}

// Prebuilt copies of /api/jobs and the /jobs/<slug> pages, written by snapshot-scheduled so visitors never wait on loadAll().
const SNAP_MAX_AGE = 6 * 60 * 60 * 1000; // older than this and we rebuild live instead
const isFresh = (m: any) => m && typeof m.t === "number" && Date.now() - m.t < SNAP_MAX_AGE;

export async function writeSnapshot() {
  const { LANDINGS, renderLanding } = await import("./seo.mts");
  const store = getStore("feed");
  const { jobs, at } = await loadAll();
  const t = Date.now();
  for (const r of REGIONS) {
    const body = await buildPayload(jobs, at, r);
    await store.set(`snap-jobs-${r}`, body.slice().buffer, { metadata: { t } });
    cache.set(r, { t, body });
  }
  for (const l of LANDINGS) await store.set(`snap-page-${l.slug}`, renderLanding(l, jobs as any, at || new Date().toISOString()).html, { metadata: { t } });
  return { regions: REGIONS.length, pages: LANDINGS.length, jobs: jobs.length, at };
}

export async function snapshotPage(slug: string) {
  const r = await getStore("feed").getWithMetadata(`snap-page-${slug}`, { type: "text" }).catch(() => null);
  return r && isFresh(r.metadata) ? r.data : null;
}

// One gzipped payload per region ("us" is the default; roles without a country code are US).
export async function jobsPayload(region = "us", force = false) {
  if (!REGIONS.includes(region)) region = "us";
  const hit = cache.get(region);
  if (!force && hit && Date.now() - hit.t < 60 * 1000) return hit.body;
  if (!force) {
    const r = await getStore("feed").getWithMetadata(`snap-jobs-${region}`, { type: "arrayBuffer" }).catch(() => null);
    if (r && isFresh(r.metadata)) { const body = new Uint8Array(r.data); cache.set(region, { t: Date.now(), body }); return body; }
  }
  const { jobs, at } = await loadAll();
  const body = await buildPayload(jobs, at, region);
  cache.set(region, { t: Date.now(), body });
  return body;
}
