import { normalizeJob, type Job, type RawJob } from "./normalize.mts";

// Readers for large companies that have their own careers systems (not Greenhouse/Ashby/Lever).
// Each returns raw roles; the caller normalizes them into role families.
const UA = { "user-agent": "jobfinder.fyi job board reader", accept: "application/json" };
async function jget(url: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (attempt) throw e; }
  }
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = undefined as any; } } }));
  return out;
}
const range = (from: number, to: number, step: number) => { const a: number[] = []; for (let x = from; x < to; x += step) a.push(x); return a; };

// One search phrase per role family, used by the readers that need a keyword to page through results.
const QUERIES = ["product manager", "software engineer", "data engineer", "machine learning engineer", "business intelligence", "technical program manager", "program manager", "ux designer", "recruiter", "legal counsel", "financial analyst", "marketing manager", "operations manager"];

type Reader = { name: string; run: () => Promise<{ raw: RawJob[]; assumeUS?: boolean }> };

function workday(name: string, host: string, tenant: string, site: string, cap = 2000): Reader {
  const api = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const base = `https://${host}/en-US/${site}`;
  const post = (body: object) => jget(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { name, run: async () => {
    const first = await post({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" });
    // Find the "United States" country facet so only US roles are paged.
    let facets: Record<string, string[]> = {};
    for (const f of first.facets || []) {
      const hit = (f.values || []).flatMap((v: any) => v.facetParameter ? [v] : (v.values || [])).find((v: any) => /^united states( of america)?$/i.test(v.descriptor || ""));
      if (hit && /country/i.test(f.facetParameter || "")) facets = { [f.facetParameter]: [hit.id] };
    }
    const hasUS = Object.keys(facets).length > 0;
    const head = await post({ appliedFacets: facets, limit: 20, offset: 0, searchText: "" });
    const total = Math.min(head.total || 0, cap);
    const pages = await pool(range(20, total, 20), 8, o => post({ appliedFacets: facets, limit: 20, offset: o, searchText: "" }));
    const now = Date.now();
    const raw: RawJob[] = [head, ...pages].flatMap(p => (p?.jobPostings || [])).map((j: any) => {
      const m = /(\d+)\+?\s+Day/i.exec(j.postedOn || "");
      const posted = /today/i.test(j.postedOn || "") ? new Date(now).toISOString() : /yesterday/i.test(j.postedOn || "") ? new Date(now - 864e5).toISOString() : m && !/30\+/.test(j.postedOn) ? new Date(now - +m[1] * 864e5).toISOString() : null;
      const pathLoc = (j.externalPath || "").split("/")[2] || "";
      const loc = /^\d+ Locations?$/i.test(j.locationsText || "") || !j.locationsText ? pathLoc.replace(/-+/g, " ") : j.locationsText;
      return { company: name, title: j.title, location: loc, department: "", url: base + j.externalPath, posted };
    });
    return { raw, assumeUS: hasUS };
  } };
}

function eightfold(name: string, host: string, domain: string, careersBase: string, queries: string[], pagesPer: number): Reader {
  return { name, run: async () => {
    const jobs = new Map<string, RawJob>();
    const reqs = queries.flatMap(q => range(0, pagesPer * 10, 10).map(s => ({ q, s })));
    await pool(reqs, 16, async ({ q, s }) => {
      const j = await jget(`https://${host}/api/pcsx/search?domain=${domain}&query=${encodeURIComponent(q)}&location=United%20States&start=${s}&sort_by=timestamp`);
      for (const p of j?.data?.positions || []) {
        const loc = (p.standardizedLocations?.[0] || p.locations?.[0] || "").replace(/, US$/, "").replace(/^United States, /, "").replace(", United States of America", "");
        const us = (p.standardizedLocations || []).some((l: string) => /, US$/.test(l)) || (p.locations || []).some((l: string) => /United States/.test(l));
        if (!us) continue;
        jobs.set(String(p.id), { company: name, title: p.name, location: loc, department: p.department || "", url: `${careersBase}/${p.id}`, posted: p.postedTs ? new Date(p.postedTs * 1000).toISOString() : null });
      }
    });
    return { raw: [...jobs.values()] };
  } };
}

const AMAZON: Reader = { name: "Amazon", run: async () => {
  const jobs = new Map<string, RawJob>();
  const reqs = QUERIES.flatMap(q => range(0, 400, 100).map(o => ({ q, o })));
  await pool(reqs, 10, async ({ q, o }) => {
    const j = await jget(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&country[]=USA&result_limit=100&offset=${o}&sort=recent`);
    for (const p of j?.jobs || []) {
      const [, st, city] = String(p.location || "").split(", ");
      const d = p.posted_date ? new Date(p.posted_date + " 12:00 UTC") : null;
      jobs.set(String(p.id_icims || p.id), { company: "Amazon", title: p.title, location: city ? `${city}, ${st}` : String(p.location || ""), department: p.job_category || "", url: "https://www.amazon.jobs" + p.job_path, posted: d && !isNaN(+d) ? d.toISOString() : null });
    }
  });
  return { raw: [...jobs.values()] };
} };

const SERVICENOW: Reader = { name: "ServiceNow", run: async () => {
  const first = await jget("https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?country=us&limit=100&offset=0");
  const rest = await pool(range(100, Math.min(first.totalFound || 0, 1500), 100), 5, o => jget(`https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?country=us&limit=100&offset=${o}`));
  const raw: RawJob[] = [first, ...rest].flatMap(p => p?.content || []).map((p: any) => ({
    company: "ServiceNow", title: p.name, location: [p.location?.city, (p.location?.region || "").length === 2 ? p.location.region.toUpperCase() : p.location?.region].filter(Boolean).join(", "),
    department: p.department?.label || "", url: `https://jobs.smartrecruiters.com/ServiceNow/${p.id}`, posted: p.releasedDate || null,
  }));
  return { raw, assumeUS: true };
} };

const JPM: Reader = { name: "JPMorgan Chase", run: async () => {
  const pages = await pool(range(0, 2000, 50), 8, o => jget(`https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1001,limit=50,offset=${o},sortBy=POSTING_DATES_DESC`, { headers: { accept: "application/json" } }));
  const raw: RawJob[] = pages.flatMap(p => p?.items?.[0]?.requisitionList || []).filter((p: any) => p.PrimaryLocationCountry === "US").map((p: any) => ({
    company: "JPMorgan Chase", title: p.Title, location: (p.PrimaryLocation || "").replace(", United States", ""), department: p.JobFamily || "",
    url: `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${p.Id}`, posted: p.PostedDate || null,
  }));
  return { raw, assumeUS: true };
} };


// Radancy / TalentBrew career sites (Intuit, Palo Alto Networks): the site's own results endpoint lists every role, 100 per page.
function radancy(name: string, origin: string, prefix: string, org: string): Reader {
  const url = (p: number) => `${origin}${prefix}/search-jobs/results?ActiveFacetID=0&CurrentPage=${p}&RecordsPerPage=100&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&CustomFacetName=&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SortCriteria=0&SortDirection=0&SearchType=5&OrganizationIds=${org}&PostalCode=&ResultsType=0&fc=&fl=&fcf=&afc=&afl=&afcf=`;
  const dec = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  const parse = (html: string): RawJob[] => {
    const out: RawJob[] = []; const re = /<a href="([^"]*\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const t = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[2]); const l = /class="job-location"[^>]*>([\s\S]*?)<\/span>/.exec(m[2]); const d = /job-date-posted"[^>]*>([\s\S]*?)<\/span>/.exec(m[2]);
      const dm = d && /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d[1]);
      out.push({ company: name, title: t ? dec(t[1]) : "", location: l ? dec(l[1]) : "", department: "", url: origin + m[1], posted: dm ? `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}` : null });
    }
    return out;
  };
  const page = async (p: number) => { const j = await jget(url(p)); return { html: String(j?.results || ""), }; };
  return { name, run: async () => {
    const first = await page(1);
    const tp = Number(/data-total-pages="(\d+)"/.exec(first.html)?.[1] || 1);
    const rest = await pool(range(2, Math.min(tp, 30) + 1, 1), 6, async p => (await page(p)).html);
    return { raw: [first.html, ...rest].flatMap(h => (h ? parse(h) : [])) };
  } };
}

// Google careers: the results page embeds its data as a script literal (AF_initDataCallback ds:1), 20 roles per page.
const GOOGLE: Reader = { name: "Google", run: async () => {
  const base = "https://www.google.com/about/careers/applications/jobs/results/";
  const get = async (q: string, page: number) => {
    const r = await fetch(`${base}?q=${encodeURIComponent(q)}&location=United%20States&page=${page}`, { headers: { "user-agent": UA["user-agent"], "accept-language": "en-US" }, signal: AbortSignal.timeout(14000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.text();
    const a = h.indexOf("AF_initDataCallback({key: 'ds:1'"); if (a < 0) return { rows: [] as any[], total: 0 };
    const d = h.indexOf("data:", a) + 5, e = h.indexOf(", sideChannel", d);
    const data = JSON.parse(h.slice(d, e));
    return { rows: (data?.[0] || []) as any[], total: Number(data?.[2] || 0) };
  };
  const seen = new Map<string, RawJob>();
  const add = (rows: any[]) => { for (const e of rows) {
    const id = e?.[0], title = e?.[1]; if (!id || !title) continue;
    const locs = (e as any[]).find(x => Array.isArray(x) && x.length && Array.isArray(x[0]) && typeof x[0][0] === "string" && x[0].length >= 6 && x[0][x[0].length - 1].length === 2);
    const us = (locs || []).filter((l: any[]) => l[l.length - 1] === "US");
    if (!us.length) continue;
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    seen.set(id, { company: "Google", title, location: us.map((l: any[]) => l[0]).join("; "), department: "", url: `${base}${id}-${slug}`, posted: null });
  } };
  const deadline = Date.now() + 22000;
  await pool(QUERIES, 4, async q => {
    const first = await get(q, 1); add(first.rows);
    const pages = Math.min(Math.ceil((first.total || 0) / 20), 20);
    await pool(range(2, pages + 1, 1), 3, async p => { if (Date.now() > deadline) return; add((await get(q, p)).rows); });
  });
  return { raw: [...seen.values()], assumeUS: true };
} };

// Uber careers (jobs.uber.com): the site's own search API, 10 roles per page, US only. Every role family is kept.
const UBER: Reader = { name: "Uber", run: async () => {
  const get = (page: number) => jget(`https://jobs.uber.com/api/jobs/search/?search=&countries=United+States&page=${page}`);
  const first = await get(1);
  if (!first?.jobs?.length) throw new Error("no results");
  const rest = await pool(range(2, Math.min(first.totalPages || 1, 80) + 1, 1), 8, async p => (await get(p))?.jobs || []);
  const raw: RawJob[] = [first.jobs, ...rest].flatMap(x => x || []).map((e: any) => ({
    company: "Uber", title: e.Title, department: (e.Teams || [])[0] || e.AdditionalText || "",
    location: (e.Locations || []).filter((l: any) => !l.Country || /united states/i.test(l.Country)).map((l: any) => String(l.Address || [l.City, l.Region].filter(Boolean).join(", ")).replace(/,?\s*(USA|United States)$/i, "")).filter(Boolean).join("; ") || "United States",
    url: `https://jobs.uber.com/en/jobs/${e.Id}/`, posted: e.DisplayDate ? String(e.DisplayDate).slice(0, 10) : null,
  }));
  return { raw, assumeUS: true };
} };

// Etsy careers (Clinch-hosted): server-rendered search pages, 30 roles per page. Needs a browser-like User-Agent.
const ETSY: Reader = { name: "Etsy", run: async () => {
  const dec = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const page = async (p: number): Promise<RawJob[]> => {
    const r = await fetch(`https://careers.etsy.com/jobs/search?page=${p}`, { signal: AbortSignal.timeout(14000), headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.text();
    return h.split("job-search-results-card-body").slice(1).map(c => {
      const a = /<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); const l = /job-component-location[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/.exec(c);
      return a ? { company: "Etsy", title: dec(a[2]), location: l ? dec(l[1]) : "", department: "", url: a[1], posted: null } : null;
    }).filter(Boolean) as RawJob[];
  };
  const out: RawJob[] = [];
  for (let p = 1; p <= 12; p++) { const rows = await page(p); if (!rows.length) break; out.push(...rows); }
  if (!out.length) throw new Error("no results");
  return { raw: out };
} };

export const BIG: Reader[] = [
  AMAZON,
  eightfold("Microsoft", "apply.careers.microsoft.com", "microsoft.com", "https://apply.careers.microsoft.com/careers/job", QUERIES, 30),
  eightfold("PayPal", "paypal.eightfold.ai", "paypal.com", "https://paypal.eightfold.ai/careers/job", [""], 40),
  JPM,
  SERVICENOW,
  workday("NVIDIA", "nvidia.wd5.myworkdayjobs.com", "nvidia", "NVIDIAExternalCareerSite"),
  workday("Salesforce", "salesforce.wd12.myworkdayjobs.com", "salesforce", "External_Career_Site"),
  workday("Adobe", "adobe.wd5.myworkdayjobs.com", "adobe", "external_experienced"),
  workday("Mastercard", "mastercard.wd1.myworkdayjobs.com", "mastercard", "CorporateCareers"),
  GOOGLE,
  radancy("Intuit", "https://jobs.intuit.com", "", "27595"),
  radancy("Palo Alto Networks", "https://jobs.paloaltonetworks.com", "/en", "47263"),
  UBER,
  ETSY,
];

export async function crawlBig(i: number) {
  const r = BIG[i];
  try {
    const { raw, assumeUS } = await r.run();
    const seen = new Set<string>(); const jobs: Job[] = [];
    for (const x of raw) { if (!x.title || !x.url || seen.has(x.url)) continue; seen.add(x.url); const n = normalizeJob(x, { assumeUS }); if (n) jobs.push(n); }
    return { jobs, report: [{ name: r.name, ok: true, total: raw.length, kept: jobs.length }], names: [r.name] };
  } catch (e: any) {
    return { jobs: [] as Job[], report: [{ name: r.name, ok: false, total: 0, kept: 0, error: String(e?.message || e).slice(0, 80) }], names: [r.name] };
  }
}
