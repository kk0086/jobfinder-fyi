import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Job } from "./normalize.mts";
import { esc, money, CSS, ORIGIN } from "./seo.mts";

// One indexable page per job: /job/<company>-<title>-<id>. Records are grouped into 256 shard blobs (snap-job-xx, by the first two characters of the id)
// so a page view reads one small blob. A job that is missing from its shard has closed and gets a 410.
export type Rec = { i: string; t: string; c: string; l: string; d: string; r: string; s: string; p: string; u: string; a?: number; b?: number; k?: string; w?: 1; sp?: 1; rm?: 1; cc?: string; dm: string[]; sm: [string, string, string, string][] };

// Which jobs go in /sitemap-jobs.xml. Phase 1: roles posted in the last 14 days, newest first, capped. Raise MAP_MAX / MAP_DAYS to widen.
export const MAP_DAYS = 14, MAP_MAX = 5000;

const kebab = (s: string) => s.toLowerCase().replace(/&/g, " and ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const jobId = (j: { company: string; url: string }) => createHash("sha1").update(j.company + "|" + j.url).digest("hex").slice(0, 10);
export const jobSlug = (j: { company: string; title: string; url: string }) => (kebab(j.company + " " + j.title).slice(0, 80).replace(/-+$/, "") || "job") + "-" + jobId(j);
export const SLUG_RE = /^([a-z0-9-]*)-([0-9a-f]{10})$/;

export async function writeJobShards(jobs: Job[], store: any = getStore("feed")) {
  const ts = (j: any) => Date.parse(j.posted || "") || 0;
  const list = jobs.filter(j => j.url && j.title && j.company).sort((a, b) => ts(b) - ts(a));
  const byCoRole = new Map<string, any[]>(), byRole = new Map<string, any[]>();
  for (const j of list as any[]) {
    const k1 = j.company + "|" + j.role, k2 = j.role + "|" + (j.cc || "US");
    const a = byCoRole.get(k1) || byCoRole.set(k1, []).get(k1)!; if (a.length < 8) a.push(j);
    const b = byRole.get(k2) || byRole.set(k2, []).get(k2)!; if (b.length < 40) b.push(j);
  }
  const brief = (j: any): [string, string, string, string] => [jobSlug(j), j.title, j.company, j.location || ""];
  const shards = new Map<string, Rec[]>();
  const seenId = new Set<string>();
  for (const j of list as any[]) {
    const id = jobId(j); if (seenId.has(id)) continue; seenId.add(id);
    const pick: any[] = [];
    const add = (arr?: any[]) => { for (const x of arr || []) { if (pick.length >= 5) return; if (x !== j && x.url !== j.url && !pick.includes(x)) pick.push(x); } };
    add(byCoRole.get(j.company + "|" + j.role)?.slice(0, 3));
    add(byRole.get(j.role + "|" + (j.cc || "US")));
    const rec: Rec = { i: id, t: j.title, c: j.company, l: j.location || "", d: j.department || "", r: j.role || "", s: j.seniority || "", p: j.posted || "", u: j.url, dm: (j.domains || []).slice(0, 3), sm: pick.map(brief) };
    if (j.salary_min) { rec.a = j.salary_min; rec.b = j.salary_max || j.salary_min; rec.k = j.salary_cur || "USD"; }
    if (j.wa) rec.w = 1; if (j.sp) rec.sp = 1; if (j.remote) rec.rm = 1; if (j.cc) rec.cc = j.cc;
    const sh = id.slice(0, 2); (shards.get(sh) || shards.set(sh, []).get(sh)!).push(rec);
  }
  const names = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, "0"));
  const t = Date.now(); let k = 0;
  const worker = async () => { while (k < names.length) { const n = names[k++]; await store.setJSON(`snap-job-${n}`, shards.get(n) || [], { metadata: { t } }); } };
  await Promise.all(Array.from({ length: 12 }, worker));
  const cutoff = t - MAP_DAYS * 864e5;
  const map = (list as any[]).filter(j => ts(j) > cutoff && ts(j) <= t + 36e5).slice(0, MAP_MAX).map(j => [jobSlug(j), j.posted.slice(0, 10)]);
  await store.setJSON("snap-job-sitemap", map);
  return { jobs: seenId.size, sitemap: map.length };
}

const memo = new Map<string, { t: number; recs: Map<string, Rec> | null }>();
export async function findJob(id: string): Promise<{ rec: Rec | null; shardOk: boolean }> {
  const sh = id.slice(0, 2);
  let hit = memo.get(sh);
  if (!hit || Date.now() - hit.t > 10 * 60 * 1000) {
    const arr = (await getStore("feed").get(`snap-job-${sh}`, { type: "json" }).catch(() => null)) as Rec[] | null;
    hit = { t: Date.now(), recs: arr ? new Map(arr.map(r => [r.i, r])) : null };
    memo.set(sh, hit);
    if (memo.size > 6) memo.delete(memo.keys().next().value!);
  }
  return { rec: hit.recs?.get(id) || null, shardOk: !!hit.recs };
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase());
const plain = (s: string) => esc(s);
function head(title: string, desc: string, url: string, robots: string, ld?: any) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Job Finder</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">${robots ? `<meta name="robots" content="${robots}">` : ""}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${ORIGIN}/icon-512.png"><meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}
<style>${CSS}.tags{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.tags span{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;font-weight:600}.tags .g{color:var(--pay)}.tags .r{color:#c43a27}.co{font-size:16px;color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:14px 0}.apply{display:inline-block;background:#c43a27;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:13px 24px;margin:6px 0}.hint{color:var(--muted);font-size:13px;margin-left:10px}.badge{display:inline-block;background:#fdecea;color:#c43a27;font-weight:700;font-size:13px;border-radius:999px;padding:4px 12px}</style></head>
<body><div class="w"><div class="top"><a class="logo" href="/" aria-label="Job Finder home"><img src="/logo.png?v=2" alt="Job Finder" width="56" height="56"></a><a class="home" href="/">Search all jobs</a></div>`;
}
const foot = `<footer><span>&copy; 2026 Jobfinder.fyi</span><a href="/">Search all jobs</a><a href="/jobs/new-jobs-today">New jobs today</a><a href="/privacy.html">Privacy</a></footer></div></body></html>`;
const simHtml = (sm: Rec["sm"]) => sm.length ? `<h2>Similar jobs</h2><ul class="jobs">${sm.map(s => `<li><a href="/job/${esc(s[0])}"><span class="t">${esc(s[1])}</span><span class="c">${esc(s[2])}${s[3] ? " · " + esc(s[3]) : ""}</span></a></li>`).join("")}</ul>` : "";

export function renderJob(r: Rec): string {
  const slug = jobSlug({ company: r.c, title: r.t, url: r.u });
  const url = `${ORIGIN}/job/${slug}`;
  const ageD = r.p ? (Date.now() - Date.parse(r.p)) / 864e5 : NaN;
  const age = !(ageD >= 0) ? "" : ageD < 1 ? "Posted today" : ageD < 30 ? `Posted ${Math.round(ageD)} day${Math.round(ageD) === 1 ? "" : "s"} ago` : `Posted ${new Date(r.p).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  const pay = r.a ? `${money(r.a, r.k)}${r.b && r.b !== r.a ? "–" + money(r.b, r.k) : ""} a year` : "";
  const place = r.l || (r.rm ? "Remote" : "");
  const sum = `${r.c} is hiring for ${/^[aeiou]/i.test(r.t) ? "an" : "a"} ${r.t}${place ? ` (${place})` : ""}. This is ${r.rm ? "a remote-friendly " : "a "}${r.s && r.s !== "Mid" ? r.s.toLowerCase() + "-level " : ""}${r.r ? r.r.toLowerCase() : "tech"} role${r.d ? ` in ${r.d}` : ""}${r.dm.length ? `, with a focus on ${r.dm.join(", ").replace(/, ([^,]*)$/, " and $1")}` : ""}.${pay ? ` The posted pay range is ${pay}.` : ""}${r.sp ? " The posting says visa sponsorship is available." : ""}${r.w ? " The posting says US citizenship or a green card is required." : ""} Job Finder found this opening on ${r.c}'s own careers page. Apply there for the full description.`;
  const title = `${r.t} at ${r.c}${r.l ? ` – ${r.l}` : ""}`;
  const desc = `${r.t} at ${r.c}${r.l ? ` in ${r.l}` : ""}.${pay ? " " + pay + "." : ""}${age ? " " + age + "." : ""} Apply on the employer's site.`.slice(0, 160);
  const [city, reg] = (r.l || "").split(",").map(x => x.trim());
  const ld: any = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Job Finder", item: ORIGIN + "/" }, { "@type": "ListItem", position: 2, name: r.t, item: url }] },
  ] };
  if (r.p) {
    const jp: any = { "@type": "JobPosting", title: r.t, description: `<p>${esc(sum)}</p>`, datePosted: r.p.slice(0, 10), hiringOrganization: { "@type": "Organization", name: r.c },
      directApply: false, url, identifier: { "@type": "PropertyValue", name: r.c, value: r.i } };
    const country = r.cc || "US";
    if (r.l) jp.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: city || r.l, ...(reg && reg.length <= 3 ? { addressRegion: reg } : {}), addressCountry: country } };
    if (r.rm) { jp.jobLocationType = "TELECOMMUTE"; jp.applicantLocationRequirements = { "@type": "Country", name: country }; if (!r.l) delete jp.jobLocation; }
    if (r.a) jp.baseSalary = { "@type": "MonetaryAmount", currency: r.k || "USD", value: { "@type": "QuantitativeValue", minValue: r.a, maxValue: r.b || r.a, unitText: "YEAR" } };
    if (jp.jobLocation || jp.applicantLocationRequirements) ld["@graph"].push(jp);
  }
  const tags = [pay && `<span class="g">${esc(pay)}</span>`, r.s && `<span>${esc(r.s)}</span>`, r.r && `<span>${esc(r.r)}</span>`, r.rm && `<span>Remote-friendly</span>`, r.sp && `<span class="g">H1-B sponsorship available</span>`, r.w && `<span class="r">US Citizen/GC only</span>`].filter(Boolean).join("");
  return head(title, desc, url, "", ld) + `
<nav class="crumb"><a href="/">Job Finder</a> › ${r.r ? esc(r.r) + " › " : ""}${esc(r.c)}</nav>
<div class="card"><h1>${esc(r.t)}</h1>
<div class="co"><b>${esc(r.c)}</b>${place ? " · " + esc(place) : ""}${age ? " · " + esc(age) : ""}</div>
<div class="tags">${tags}</div>
<p>${plain(sum)}</p>
<a class="apply" href="${esc(r.u)}" rel="nofollow noopener" target="_blank">Apply on ${esc(r.c)}'s site ↗</a><span class="hint">Opens the employer's own application page.</span></div>
${simHtml(r.sm)}
<h2>Keep exploring</h2><div class="rel"><a href="/?q=${encodeURIComponent(r.c)}">All ${esc(r.c)} jobs</a>${r.r ? `<a href="/?q=${encodeURIComponent(r.r)}">More ${esc(r.r)} jobs</a>` : ""}<a href="/jobs/new-jobs-today">New jobs today</a><a href="/">Search all jobs</a></div>
` + foot;
}

// A job that has closed: HTTP 410, kept out of the index, with a way back to search. The words come from the URL.
export function renderClosed(slug: string): string {
  const words = titleCase((slug.match(SLUG_RE)?.[1] || "").replace(/-/g, " ")).slice(0, 90) || "This job";
  return head(`${words} – no longer available`, "This job is no longer listed on the employer's careers page.", `${ORIGIN}/job/${slug}`, "noindex,follow") + `
<div class="card"><span class="badge">No longer available</span><h1>${esc(words)}</h1><p>This job is no longer listed on the employer's careers page. Search thousands of current openings instead.</p><a class="apply" href="/">Search all jobs</a></div>
<h2>Keep exploring</h2><div class="rel"><a href="/jobs/new-jobs-today">New jobs today</a><a href="/jobs/software-engineer">Software engineer jobs</a><a href="/jobs/product-manager">Product manager jobs</a></div>
` + foot;
}
