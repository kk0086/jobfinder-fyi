import { getStore } from "@netlify/blobs";
import { crawlChunk, FEEDS, FEED_CHUNKS, chunkOf } from "./crawl.mts";
import { crawlBig, BIG } from "./big.mts";

export const TOTAL_BATCHES = FEED_CHUNKS + BIG.length;
import type { Job } from "./normalize.mts";
import seed from "./seed.json" with { type: "json" };

type ChunkBlob = { at: string; jobs: Job[]; report: { name: string; ok: boolean; total: number; kept: number; error?: string }[] };

export async function runChunk(chunk: number) {
  const store = getStore("feed");
  const prev = (await store.get(`chunk-${chunk}`, { type: "json" }).catch(() => null)) as ChunkBlob | null;
  const { jobs, report } = chunk < FEED_CHUNKS ? await crawlChunk(chunk) : await crawlBig(chunk - FEED_CHUNKS);
  const failed = new Set(report.filter(r => !r.ok).map(r => r.name));
  // A company that failed this run keeps its previous roles instead of vanishing.
  const kept = prev ? prev.jobs.filter(j => failed.has(j.company)) : [];
  const out: ChunkBlob = { at: new Date().toISOString(), jobs: [...jobs, ...kept], report };
  await store.setJSON(`chunk-${chunk}`, out);
  return { chunk, companies: report.length, failed: [...failed], roles: out.jobs.length, at: out.at };
}

let cache: { t: number; body: Uint8Array } | null = null;

export async function loadAll() {
  const store = getStore("feed");
  const blobs = await Promise.all(Array.from({ length: TOTAL_BATCHES }, (_, i) => store.get(`chunk-${i}`, { type: "json" }).catch(() => null) as Promise<ChunkBlob | null>));
  const fresh = new Set<string>();
  const jobs: Job[] = [];
  let at = "";
  for (const b of blobs) {
    if (!b) continue;
    at = at > b.at ? at : b.at;
    for (const r of b.report) fresh.add(r.name);
    jobs.push(...b.jobs);
  }
  const feedNames = new Set([...FEEDS.map(f => f.name), ...BIG.map(b => b.name)]);
  // Seed rows: browser-read companies always; feed companies only until their first live refresh.
  for (const j of (seed as any).jobs as Job[]) if (!feedNames.has(j.company) || !fresh.has(j.company)) jobs.push(j);
  return { jobs, at, blobs };
}

export async function jobsPayload(force = false) {
  if (!force && cache && Date.now() - cache.t < 60 * 1000) return cache.body;
  const { jobs, at } = await loadAll();
  const { gzipSync } = await import("node:zlib");
  const seedAt = (seed as any).generated_at as string;
  const body = gzipSync(Buffer.from(JSON.stringify({ generated_at: at || seedAt, seed_at: seedAt, companyCount: (seed as any).companyCount, jobs })));
  cache = { t: Date.now(), body };
  return body;
}
