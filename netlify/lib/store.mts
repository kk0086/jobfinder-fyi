import { getStore } from "@netlify/blobs";
import { crawlChunk, loadFeeds, FEED_CHUNKS, chunkOf } from "./crawl.mts";
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
  await store.set("dirty-at", String(Date.now())).catch(() => {});
  return { chunk, companies: report.length, failed: [...failed], roles: out.jobs.length, at: out.at };
}

// Companies that hire the most (or that people watch closely) are re-read several times a day instead of once.
// Their roles live in one small blob (v2-hot); loadAll prefers it over the daily chunk until the next daily refresh overtakes it.
export const HOT_NAMES = ["Anthropic", "OpenAI", "xAI", "Databricks", "Stripe", "Anduril", "SpaceX", "Palantir", "Coinbase", "Cloudflare", "DoorDash", "Roblox", "Waymo", "Zoox", "CoreWeave", "Crusoe", "Verkada", "Brex", "Lucid Motors", "Veeva Systems", "Speechify", "Harvey", "Zipline", "Braze", "Rocket Lab Corporation", "Axon", "Garmin", "Esri", "Intuitive Surgical", "Carvana", "Relativity Space", "True Anomaly", "Xometry", "K2 Space", "Fluidstack", "World Labs", "AMI Labs", "Recursive Superintelligence", "General Intuition", "Scale AI", "Anyscale", "Figma", "Airbnb", "Pinterest", "Reddit", "Discord", "Instacart", "Lyft", "Robinhood", "Ramp", "Plaid", "Datadog", "MongoDB", "Okta", "Twilio", "Snowflake", "Mistral AI", "Cohere", "Perplexity", "Cursor", "Notion", "Linear"];
type HotBlob = { at: string; co: Record<string, { at: string; jobs: Job[] }> };

export async function runHot(budgetMs = 24000) {
  const store = getStore("feed");
  const want = new Set(HOT_NAMES);
  const feeds = await loadFeeds();
  const mine = feeds.map((f, i) => ({ f, i })).filter(x => want.has(x.f.name));
  const prevHot = ((await store.get("v2-hot", { type: "json" }).catch(() => null)) as HotBlob | null) || { at: "", co: {} };
  // Pay and work-authorization lookups are remembered per role, so seed with what the company already has.
  const chunks = [...new Set(mine.map(x => chunkOf(x.i)))];
  const old = new Map<string, any[]>();
  for (const c of chunks) {
    const b = (await store.get(`v2-chunk-${c}`, { type: "json" }).catch(() => null)) as ChunkBlob | null;
    for (const j of b?.jobs || []) { if (!want.has(j.company)) continue; (old.get(j.company) || old.set(j.company, []).get(j.company)!).push(j); }
  }
  const co: HotBlob["co"] = { ...prevHot.co };
  const report: { name: string; ok: boolean; total: number; kept: number }[] = [];
  const started = Date.now();
  for (const c of chunks) {
    if (Date.now() - started > budgetMs) break;
    const names = new Set(mine.filter(x => chunkOf(x.i) === c).map(x => x.f.name));
    const prevJobs = [...names].flatMap(n => co[n]?.jobs || old.get(n) || []);
    const { jobs, report: rep } = await crawlChunk(c, Math.max(4000, budgetMs - (Date.now() - started)), prevJobs, names);
    const now = new Date().toISOString();
    for (const r of rep) {
      report.push(r);
      if (r.ok) co[r.name] = { at: now, jobs: jobs.filter(j => j.company === r.name) };
    }
  }
  const out: HotBlob = { at: new Date().toISOString(), co };
  await store.setJSON("v2-hot", out);
  await store.set("dirty-at", String(Date.now())).catch(() => {});
  return { hot: mine.length, ok: report.filter(r => r.ok).length, failed: report.filter(r => !r.ok).map(r => r.name), at: out.at };
}

const cache = new Map<string, { t: number; body: Uint8Array }>();
export const REGIONS = ["us", "ca", "uk", "ie", "emea"];

export async function loadAll() {
  const store = getStore("feed");
  const [blobs, hotBlob] = await Promise.all([
    Promise.all(Array.from({ length: TOTAL_BATCHES }, (_, i) => store.get(`v2-chunk-${i}`, { type: "json" }).catch(() => null) as Promise<ChunkBlob | null>)),
    store.get("v2-hot", { type: "json" }).catch(() => null) as Promise<HotBlob | null>,
  ]);
  // A hot company's roles win only while its hot read is newer than the daily chunk that also holds it.
  const chunkAt = new Map<string, string>();
  for (const b of blobs) if (b) for (const r of b.report) chunkAt.set(r.name, b.at);
  const hotUse = new Map<string, Job[]>();
  for (const [n, h] of Object.entries(hotBlob?.co || {})) if (h.at > (chunkAt.get(n) || "")) hotUse.set(n, h.jobs);
  const feedNames = new Set([...(await loadFeeds()).map(f => f.name), ...BIG.map(b => b.name)]);
  const fresh = new Set<string>();
  const jobs: Job[] = [];
  let at = "";
  for (const b of blobs) {
    if (!b) continue;
    at = at > b.at ? at : b.at;
    for (const r of b.report) if (r.ok && feedNames.has(r.name)) fresh.add(r.name); // failed companies keep their last known (seed) roles
    jobs.push(...b.jobs.filter(j => !hotUse.has(j.company) && (feedNames.has(j.company) || (j as any).src === "search" || !b.report.length)));
  }
  for (const [n, hj] of hotUse) { if (feedNames.has(n)) { fresh.add(n); jobs.push(...hj); } }
  if (hotBlob?.at && hotUse.size) at = at > hotBlob.at ? at : hotBlob.at;
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

// Big job families are served separately (/api/jobs-more) so the first page load stays small; the main payload only carries their counts.
export const LAZY_ROLES = ["Customer support", "Sales", "Supply chain & logistics"];

async function buildPayload(jobs: Job[], at: string, region: string, more = false) {
  const rows = jobs.filter(j => regionOf((j as any).cc) === region);
  const { gzipSync } = await import("node:zlib");
  const seedAt = (seed as any).generated_at as string;
  const lazyRows = rows.filter(j => LAZY_ROLES.includes(j.role));
  const body = more
    ? { generated_at: at || seedAt, region, jobs: lazyRows }
    : { generated_at: at || seedAt, seed_at: seedAt, region, companyCount: new Set(rows.map(j => j.company)).size,
        new24: rows.filter(j => { const t = Date.parse((j as any).posted || ""); return t && Date.now() - t <= 864e5 && t <= Date.now() + 36e5; }).length,
        lazy: Object.fromEntries(LAZY_ROLES.map(r => [r, lazyRows.filter(j => j.role === r).length])), jobs: rows.filter(j => !LAZY_ROLES.includes(j.role)) };
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(body))));
}

// Prebuilt copies of /api/jobs and the /jobs/<slug> pages, written by snapshot-scheduled so visitors never wait on loadAll().
const SNAP_MAX_AGE = 6 * 60 * 60 * 1000; // older than this and we rebuild live instead
const isFresh = (m: any) => m && typeof m.t === "number" && Date.now() - m.t < SNAP_MAX_AGE;

export async function writeSnapshot() {
  const { LANDINGS, renderLanding, renderHub, HUB_SLUG } = await import("./seo.mts");
  const store = getStore("feed");
  const { jobs, at } = await loadAll();
  const t = Date.now();
  for (const r of REGIONS) {
    const body = await buildPayload(jobs, at, r);
    await store.set(`snap-jobs-${r}`, body.slice().buffer, { metadata: { t } });
    cache.set(r, { t, body });
    const more = await buildPayload(jobs, at, r, true);
    await store.set(`snap-jobs-more-${r}`, more.slice().buffer, { metadata: { t } });
    cache.set(r + "+more", { t, body: more });
  }
  for (const l of LANDINGS) await store.set(`snap-page-${l.slug}`, renderLanding(l, jobs as any, at || new Date().toISOString()).html, { metadata: { t } });
  await store.set(`snap-page-${HUB_SLUG}`, renderHub(jobs as any, at || new Date().toISOString()).html, { metadata: { t } });
  return { regions: REGIONS.length, pages: LANDINGS.length + 1, jobs: jobs.length, at };
}

// Rebuilds only when a refresh has written something since the last build, or the last build is 2 hours old (keeps the 24h new-jobs count and relative ages current).
export async function snapshotIfNeeded() {
  const store = getStore("feed");
  const num = async (k: string) => Number((await store.get(k).catch(() => "")) || 0);
  const [dirty, last] = await Promise.all([num("dirty-at"), num("snap-at")]);
  if (last && dirty <= last && Date.now() - last < 2 * 3600 * 1000) return { skipped: true, dirty, last };
  const t0 = Date.now();
  const r = await writeSnapshot();
  await store.set("snap-at", String(t0)).catch(() => {});
  return r;
}

export async function snapshotPage(slug: string) {
  const r = await getStore("feed").getWithMetadata(`snap-page-${slug}`, { type: "text" }).catch(() => null);
  return r && isFresh(r.metadata) ? r.data : null;
}

// One gzipped payload per region ("us" is the default; roles without a country code are US).
export async function jobsPayload(region = "us", force = false, more = false) {
  if (!REGIONS.includes(region)) region = "us";
  const key = more ? region + "+more" : region;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.t < 60 * 1000) return hit.body;
  if (!force) {
    const r = await getStore("feed").getWithMetadata(`snap-jobs-${more ? "more-" : ""}${region}`, { type: "arrayBuffer" }).catch(() => null);
    if (r && isFresh(r.metadata)) { const body = new Uint8Array(r.data); cache.set(key, { t: Date.now(), body }); return body; }
  }
  const { jobs, at } = await loadAll();
  const body = await buildPayload(jobs, at, region, more);
  cache.set(key, { t: Date.now(), body });
  return body;
}
