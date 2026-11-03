import { getStore } from "@netlify/blobs";
import { readFeed, loadFeeds, type Feed } from "./crawl.mts";
import { BIG } from "./big.mts";
import { normalizeJob } from "./normalize.mts";
import seed from "./seed.json" with { type: "json" };

// Weekly Common Crawl search for company job boards (Greenhouse, Lever, Ashby) we do not have yet.
// It runs as a small state machine: each scheduled call does one step and saves where it got to, because a single
// function run is too short for the whole job. Common Crawl publishes a new crawl roughly monthly, so on weeks
// without one the run notices that and stops after the first step.
type ATS = Feed["ats"];
const ATSES: ATS[] = ["greenhouse", "lever", "ashby"];
const HOSTS: Record<ATS, { pat: string; re: RegExp }[]> = {
  greenhouse: [{ pat: "boards.greenhouse.io/*", re: /^https?:\/\/boards\.greenhouse\.io\/([a-z0-9][a-z0-9_-]{1,60})(?:[\/?#]|$)/i }, { pat: "job-boards.greenhouse.io/*", re: /^https?:\/\/job-boards\.greenhouse\.io\/([a-z0-9][a-z0-9_-]{1,60})(?:[\/?#]|$)/i }],
  lever: [{ pat: "jobs.lever.co/*", re: /^https?:\/\/jobs\.lever\.co\/([a-z0-9][a-z0-9_-]{1,60})(?:[\/?#]|$)/i }],
  ashby: [{ pat: "jobs.ashbyhq.com/*", re: /^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9_%.-]{1,60})(?:[\/?#]|$)/i }],
};
const SKIP = new Set(["embed", "jobs", "careers", "api", "v1", "boards", "static", "assets", "robots.txt", "sitemap.xml", "favicon.ico"]);
const pretty = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
const norm = (n: string) => n.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co|the|group|holdings|technologies|technology)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

type Task = { ats: ATS; h: number; page: number; count?: boolean; tries?: number };
type State = {
  phase: "idle" | "cdx" | "test" | "done";
  crawl?: string; lastCrawl?: string; startedAt?: string; finishedAt?: string;
  tasks?: Task[]; todo?: Record<ATS, string[]>; cursor?: Record<ATS, number>;
  stats: { pages: number; candidates: number; tested: number; added: number };
  partial?: boolean;
  log?: string;
};
const store = () => getStore({ name: "feed", consistency: "strong" });
const blank = (): State => ({ phase: "idle", stats: { pages: 0, candidates: 0, tested: 0, added: 0 } });

async function loadState(): Promise<State> { return ((await store().get("cc-state", { type: "json" }).catch(() => null)) as State | null) || blank(); }
const saveState = (s: State) => store().setJSON("cc-state", s);
const candKey = (ats: ATS) => `cc-cands-${ats}`;
const testedKey = (ats: ATS) => `cc-tested-${ats}`;

async function register(ats: ATS, entries: [string, string][]) {
  if (!entries.length) return 0;
  const st = store();
  const reg = ((await st.get("registry", { type: "json" }).catch(() => null)) as Feed[] | null) || [];
  const all = await loadFeeds();
  const names = new Set<string>([...all.map(f => norm(f.name)), ...BIG.map(x => norm(x.name)), ...((seed as any).jobs as any[]).map(j => norm(j.company))]);
  const keys = new Set(all.map(f => f.ats + "|" + f.slug));
  let added = 0;
  for (const [slug, name] of entries) {
    const k = ats + "|" + slug, n = norm(name);
    if (keys.has(k) || !n || names.has(n)) continue;
    keys.add(k); names.add(n); reg.push({ name, ats, slug }); added++;
  }
  if (added) await st.setJSON("registry", reg);
  return added;
}

async function testSlug(ats: ATS, slug: string): Promise<[string, string] | null> {
  try {
    let name = pretty(slug);
    const raw = await readFeed({ name, ats, slug });
    if (ats === "greenhouse" && raw.length) { try { const j = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()); if (j?.name) { name = String(j.name).trim(); raw.forEach(x => x.company = name); } } catch {} }
    return raw.some(x => normalizeJob(x, {})) ? [slug, name] : null;
  } catch { return null; }
}

export async function ccStatus() { const s = await loadState(); return { phase: s.phase, crawl: s.crawl, lastCrawl: s.lastCrawl, startedAt: s.startedAt, finishedAt: s.finishedAt, stats: s.stats, pendingPages: s.tasks?.length, log: s.log }; }
export async function ccReset(force = true) { const s = await loadState(); const n = blank(); if (!force) n.lastCrawl = s.lastCrawl; await saveState({ ...n, phase: "idle", lastCrawl: force ? undefined : s.lastCrawl }); return { ok: true }; }

// One scheduled step. Returns a short note for the log.
export async function ccStep(budgetMs = 22000): Promise<string> {
  const t0 = Date.now();
  const s = await loadState();

  if (s.phase === "idle" || s.phase === "done") {
    // Only start a new run when it has been 6+ days since the last one finished.
    if (s.finishedAt && Date.now() - Date.parse(s.finishedAt) < 6 * 864e5) return "waiting for next week";
    const c = await fetch("https://index.commoncrawl.org/collinfo.json", { signal: AbortSignal.timeout(15000) }).then(r => r.json());
    const crawl = c[0].id as string;
    if (crawl === s.lastCrawl) { s.phase = "done"; s.finishedAt = new Date().toISOString(); s.log = `no new crawl since ${crawl}`; await saveState(s); return s.log; }
    // One count task per host pattern; each turns into its page tasks when it runs (the index server is flaky, so one request per step).
    const tasks: Task[] = [];
    for (const ats of ATSES) for (let h = 0; h < HOSTS[ats].length; h++) tasks.push({ ats, h, page: 0, count: true });
    for (const ats of ATSES) await store().setJSON(candKey(ats), []);
    await saveState({ phase: "cdx", crawl, lastCrawl: s.lastCrawl, startedAt: new Date().toISOString(), tasks, stats: { pages: 0, candidates: 0, tested: 0, added: 0 }, log: `started crawl ${crawl}` });
    return `started ${crawl}`;
  }

  if (s.phase === "cdx") {
    const task = s.tasks!.shift();
    if (task) {
      const MAX = 6;
      try {
        const h = HOSTS[task.ats][task.h];
        const base = `https://index.commoncrawl.org/${s.crawl}-index?url=${encodeURIComponent(h.pat)}&output=json&fl=url`;
        if (task.count) {
          const r = await fetch(base + "&showNumPages=true", { signal: AbortSignal.timeout(15000) });
          const pages = r.ok ? Number(/"pages": ?(\d+)/.exec(await r.text())?.[1] || 0) : 0;
          if (!pages) throw new Error(`count HTTP ${r.status}`);
          for (let p = 0; p < pages; p++) s.tasks!.push({ ats: task.ats, h: task.h, page: p });
          s.stats.pages += pages;
        } else {
          const r = await fetch(base + `&page=${task.page}`, { signal: AbortSignal.timeout(Math.max(8000, budgetMs - 3000)) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const txt = await r.text();
          const seen = new Set<string>();
          for (const line of txt.split("\n")) { const m = line.match(/"url": ?"([^"]+)"/); if (!m) continue; const sl = h.re.exec(m[1])?.[1]?.toLowerCase(); if (sl && !SKIP.has(sl) && !sl.includes("%")) seen.add(sl); }
          const cur = ((await store().get(candKey(task.ats), { type: "json" }).catch(() => null)) as string[] | null) || [];
          const merged = new Set(cur); seen.forEach(x => merged.add(x));
          await store().setJSON(candKey(task.ats), [...merged]);
        }
      } catch (e: any) {
        task.tries = (task.tries || 0) + 1;
        if (task.tries < MAX) s.tasks!.push(task); else { s.partial = true; s.log = `gave up on ${task.ats} ${task.count ? "count" : "page " + task.page}: ${String(e?.message || e).slice(0, 60)}`; }
      }
    }
    if (!s.tasks!.length) {
      // Candidate list is complete: drop boards we already have or tested before.
      const known = new Set((await loadFeeds()).map(f => f.ats + "|" + f.slug));
      const todo = {} as Record<ATS, string[]>; let total = 0;
      for (const ats of ATSES) {
        const cands = ((await store().get(candKey(ats), { type: "json" }).catch(() => null)) as string[] | null) || [];
        const tested = new Set(((await store().get(testedKey(ats), { type: "json" }).catch(() => null)) as string[] | null) || []);
        todo[ats] = cands.filter(x => !known.has(ats + "|" + x) && !tested.has(x)); total += todo[ats].length;
      }
      s.todo = todo; s.cursor = { greenhouse: 0, lever: 0, ashby: 0 }; s.phase = "test"; s.stats.candidates = total; s.log = `${total} new slugs to test`;
    }
    await saveState(s);
    return s.log || "cdx step";
  }

  // test phase
  const found: Record<ATS, [string, string][]> = { greenhouse: [], lever: [], ashby: [] };
  let doneAll = true;
  await Promise.all(ATSES.map(async ats => {
    const list = s.todo![ats];
    while (s.cursor![ats] < list.length && Date.now() - t0 < budgetMs) {
      const part = list.slice(s.cursor![ats], s.cursor![ats] + 12);
      const res = await Promise.all(part.map(x => testSlug(ats, x)));
      res.forEach(r => r && found[ats].push(r));
      s.cursor![ats] += part.length; s.stats.tested += part.length;
    }
    if (s.cursor![ats] < list.length) doneAll = false;
  }));
  for (const ats of ATSES) s.stats.added += await register(ats, found[ats]);
  if (doneAll) {
    for (const ats of ATSES) {
      const prev = ((await store().get(testedKey(ats), { type: "json" }).catch(() => null)) as string[] | null) || [];
      await store().setJSON(testedKey(ats), [...new Set([...prev, ...s.todo![ats]])]);
      await store().setJSON(candKey(ats), []);
    }
    s.phase = "done"; s.finishedAt = new Date().toISOString(); s.lastCrawl = s.partial ? s.lastCrawl : s.crawl; s.todo = undefined; s.cursor = undefined;
    s.log = `finished${s.partial ? " (some index pages failed; will retry next week)" : ""}: tested ${s.stats.tested}, added ${s.stats.added} companies`;
  }
  await saveState(s);
  return s.log || `tested ${s.stats.tested}, added ${s.stats.added}`;
}
