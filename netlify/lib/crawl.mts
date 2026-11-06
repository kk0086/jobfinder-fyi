import { normalizeJob, annualPay, payFromText, type Job, type RawJob } from "./normalize.mts";
import { getStore } from "@netlify/blobs";
import feeds from "./feeds.json" with { type: "json" };

export type Feed = { name: string; ats: "greenhouse" | "ashby" | "lever"; slug: string };
export const FEEDS = feeds as Feed[];
export const FEED_CHUNKS = 48;
export const CHUNKS = FEED_CHUNKS; // feed batches; browser-less big-company batches follow (see store.mts)
export const chunkOf = (i: number) => i % FEED_CHUNKS;

// Company boards = the built-in list (feeds.json) + boards registered later from the admin discovery tool (stored in Blobs).
// The registry is append-only, so a company keeps the same position (and batch) once added.
let feedCache: { t: number; list: Feed[] } | null = null;
export async function loadFeeds(): Promise<Feed[]> {
  if (feedCache && Date.now() - feedCache.t < 60000) return feedCache.list;
  let reg: Feed[] = [];
  try { reg = ((await getStore({ name: "feed", consistency: "strong" }).get("registry", { type: "json" })) as Feed[]) || []; } catch {}
  const seen = new Set(FEEDS.map(f => f.ats + "|" + f.slug));
  const list = [...FEEDS];
  for (const f of reg) { if (!f?.slug || !f?.name) continue; const k = f.ats + "|" + f.slug; if (seen.has(k)) continue; seen.add(k); list.push(f); }
  feedCache = { t: Date.now(), list };
  return list;
}

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
      posted: x.first_published, updated: x.updated_at, gh_id: x.id,
    }));
  }
  if (f.ats === "ashby") {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${f.slug}?includeCompensation=true`);
    return (j.jobs || []).filter((x: any) => x.isListed !== false).map((x: any) => ({
      company: f.name, title: x.title,
      location: [x.location, ...(x.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean).join("; "),
      department: x.department || x.team || "", url: x.jobUrl || `https://jobs.ashbyhq.com/${f.slug}/${x.id}`,
      posted: x.publishedAt, remote: x.isRemote ?? null, ...ashbyPay(x, x.descriptionPlain),
    }));
  }
  const j = await getJson(`https://api.lever.co/v0/postings/${f.slug}?mode=json`);
  return (Array.isArray(j) ? j : []).map((x: any) => ({
    company: f.name, title: x.text, location: x.categories?.location || (x.categories?.allLocations || []).join("; ") || "",
    department: x.categories?.department || x.categories?.team || "", url: x.hostedUrl || `https://jobs.lever.co/${f.slug}/${x.id}`,
    posted: x.createdAt, ...leverPay(x),
  }));
}

function ashbyPay(x: any, text?: string) {
  try {
    const c = (x.compensation?.summaryComponents || []).find((c: any) => /salary/i.test(c.compensationType || "") && c.minValue);
    const p = c && annualPay(c.minValue, c.maxValue, String(c.interval || ""));
    if (p) return { salary_min: p.min, salary_max: p.max, salary_cur: c.currencyCode || "USD" };
    // Many Ashby employers leave the structured range empty and state pay in the description instead.
    const t = payFromText(String(text || ""));
    return t?.salary_min ? { salary_min: t.salary_min, salary_max: t.salary_max, salary_cur: t.salary_cur || "USD" } : {};
  } catch { return {}; }
}
function leverPay(x: any) {
  try {
    const r = x.salaryRange; const p = r && annualPay(r.min, r.max, String(r.interval || ""));
    return p ? { salary_min: p.min, salary_max: p.max, salary_cur: r.currency || "USD" } : {};
  } catch { return {}; }
}

// Greenhouse only publishes pay on each job's own record, so it costs one request per job.
// Results are remembered on the job itself (sal_at) and only re-checked after a week.
const GH_PRIORITY: Record<string, number> = { Director: 0, "Principal+": 0, Executive: 1, Senior: 1, Manager: 2, Mid: 2, Entry: 3, Intern: 3 };
async function ghPay(slug: string, id: any) {
  const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?pay_transparency=true`, 8000);
  const r = (j.pay_input_ranges || []).find((r: any) => r.min_cents > 0);
  const p = r && annualPay(r.min_cents / 100, (r.max_cents || r.min_cents) / 100, "year");
  if (p) return { min: p.min, max: p.max, cur: r.currency_type || "USD" };
  // Many employers leave the structured range empty and state pay in the description instead.
  const text = String(j.content || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#39;|&quot;/g, " ").replace(/\s+/g, " ");
  const t = payFromText(text);
  return t?.salary_min ? { min: t.salary_min, max: t.salary_max || t.salary_min, cur: t.salary_cur || "USD" } : null;
}

export type CompanyResult = { name: string; ok: boolean; total: number; kept: number; error?: string };

// Reads every feed in one chunk and returns normalized roles plus a per-company report.
export async function crawlChunk(chunk: number, budgetMs = 24000, prevJobs: any[] = []) {
  const started = Date.now();
  const mine = (await loadFeeds()).filter((_, i) => chunkOf(i) === chunk);
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

  // Greenhouse pay: reuse what we already learned, then look up new roles with whatever time is left.
  try {
    const slugOf = new Map(mine.filter(f => f.ats === "greenhouse").map(f => [f.name, f.slug]));
    const old = new Map<string, any>(prevJobs.map(j => [j.url, j]));
    const week = Date.now() - 7 * 864e5;
    const todo: Job[] = [];
    for (const j of jobs as any[]) {
      if (!j.gh_id || j.salary_min) continue;
      const o = old.get(j.url);
      if (o?.salary_min) { j.salary_min = o.salary_min; j.salary_max = o.salary_max; j.salary_cur = o.salary_cur; j.sal_at = o.sal_at; continue; }
      if (o?.sal_at && o.sal_v === 2 && Date.parse(o.sal_at) > week) { j.sal_at = o.sal_at; j.sal_v = 2; continue; }
      todo.push(j);
    }
    todo.sort((a: any, b: any) => (GH_PRIORITY[a.seniority] ?? 2) - (GH_PRIORITY[b.seniority] ?? 2));
    let k = 0;
    const pw = async () => {
      while (k < todo.length && Date.now() - started < budgetMs) {
        const j: any = todo[k++], slug = slugOf.get(j.company);
        if (!slug) continue;
        try {
          const p = await ghPay(slug, j.gh_id);
          j.sal_at = new Date().toISOString(); j.sal_v = 2;
          if (p) { j.salary_min = p.min; j.salary_max = p.max; j.salary_cur = p.cur; }
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: 10 }, pw));
  } catch {}
  return { jobs, report, names: mine.map(m => m.name) };
}
