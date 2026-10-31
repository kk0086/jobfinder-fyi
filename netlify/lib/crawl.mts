import { normalizeJob, type Job, type RawJob } from "./normalize.mts";
import feeds from "./feeds.json" with { type: "json" };

export type Feed = { name: string; ats: "greenhouse" | "ashby" | "lever"; slug: string };
export const FEEDS = feeds as Feed[];
export const FEED_CHUNKS = 6;
export const CHUNKS = FEED_CHUNKS; // feed batches; browser-less big-company batches follow (see store.mts)
export const chunkOf = (i: number) => i % FEED_CHUNKS;

async function getJson(url: string, ms = 12000): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "jobfinder.fyi job board reader" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

export async function readFeed(f: Feed): Promise<RawJob[]> {
  if (f.ats === "greenhouse") {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${f.slug}/jobs`);
    return (j.jobs || []).map((x: any) => ({
      company: f.name, title: x.title, location: x.location?.name || "", department: "",
      url: x.absolute_url || `https://job-boards.greenhouse.io/${f.slug}/jobs/${x.id}`,
      posted: x.first_published, updated: x.updated_at,
    }));
  }
  if (f.ats === "ashby") {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${f.slug}`);
    return (j.jobs || []).filter((x: any) => x.isListed !== false).map((x: any) => ({
      company: f.name, title: x.title,
      location: [x.location, ...(x.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean).join("; "),
      department: x.department || x.team || "", url: x.jobUrl || `https://jobs.ashbyhq.com/${f.slug}/${x.id}`,
      posted: x.publishedAt, remote: x.isRemote ?? null,
    }));
  }
  const j = await getJson(`https://api.lever.co/v0/postings/${f.slug}?mode=json`);
  return (Array.isArray(j) ? j : []).map((x: any) => ({
    company: f.name, title: x.text, location: x.categories?.location || (x.categories?.allLocations || []).join("; ") || "",
    department: x.categories?.department || x.categories?.team || "", url: x.hostedUrl || `https://jobs.lever.co/${f.slug}/${x.id}`,
    posted: x.createdAt,
  }));
}

export type CompanyResult = { name: string; ok: boolean; total: number; kept: number; error?: string };

// Reads every feed in one chunk and returns normalized roles plus a per-company report.
export async function crawlChunk(chunk: number, budgetMs = 24000) {
  const started = Date.now();
  const mine = FEEDS.filter((_, i) => chunkOf(i) === chunk);
  const jobs: Job[] = [];
  const report: CompanyResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < mine.length) {
      const f = mine[next++];
      if (Date.now() - started > budgetMs) { report.push({ name: f.name, ok: false, total: 0, kept: 0, error: "out of time" }); continue; }
      try {
        let raw: RawJob[];
        try { raw = await readFeed(f); }
        catch (e) { if (Date.now() - started > 10000) throw e; raw = await readFeed(f); } // one quick retry while there is time

        const seen = new Set<string>();
        let kept = 0;
        for (const r of raw) {
          if (!r.title || !r.url || seen.has(r.url)) continue;
          seen.add(r.url);
          const n = normalizeJob(r);
          if (n) { jobs.push(n); kept++; }
        }
        report.push({ name: f.name, ok: true, total: raw.length, kept });
      } catch (e: any) {
        report.push({ name: f.name, ok: false, total: 0, kept: 0, error: String(e?.message || e).slice(0, 80) });
      }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  return { jobs, report, names: mine.map(m => m.name) };
}
