import { normalizeJob, annualPay, payFromText, type Job, type RawJob } from "./normalize.mts";
import { getStore } from "@netlify/blobs";
import extra from "./extra.json" with { type: "json" };

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

type Reader = { name: string; run: () => Promise<{ raw: RawJob[]; assumeUS?: boolean; src?: string }> };

function workday(name: string, host: string, tenant: string, site: string, cap = 2000): Reader {
  const api = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const base = `https://${host}/en-US/${site}`;
  const post = (body: object) => jget(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { name, run: async () => {
    const first = await post({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" });
    // Find the "United States" country facet so only US roles are paged.
    let facets: Record<string, string[]> = {};
    for (const f of first.facets || []) {
      const hit = (f.values || []).flatMap((v: any) => v.facetParameter ? [v] : (v.values || [])).find((v: any) => /^united states( of america)?$/i.test(v.descriptor || ""));
      if (hit && /country/i.test(f.facetParameter || "")) facets = { [f.facetParameter]: [hit.id] };
    }
    if (!Object.keys(facets).length) {
      // Fallback: the country facet can be nested one level down (e.g. Accenture).
      const walk = (f: any) => { for (const v of f?.values || []) { if (/country/i.test(f.facetParameter || "") && /^united states( of america)?$/i.test(v.descriptor || "") && v.id) facets = { [f.facetParameter]: [v.id] }; if (v?.values) walk(v); } };
      for (const f of first.facets || []) walk(f);
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
      jobs.set(String(p.id_icims || p.id), { company: "Amazon", title: p.title, location: city ? `${city}, ${st}` : String(p.location || ""), department: p.job_category || "", url: "https://www.amazon.jobs" + p.job_path, posted: d && !isNaN(+d) ? d.toISOString() : null, ...(payFromText([p.description, p.basic_qualifications, p.preferred_qualifications].filter(Boolean).join(" ")) || {}) });
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
    const out: RawJob[] = []; const re = /<a\s[^>]*?href="([^"]*\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const t = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/.exec(m[2]) || /class="job-title"[^>]*>([\s\S]*?)<\/span>/.exec(m[2]); const l = /class="job-location[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(m[2]); const d = /job-date-posted"[^>]*>([\s\S]*?)<\/span>/.exec(m[2]);
      const dm = d && /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d[1]);
      if (t && dec(t[1])) out.push({ company: name, title: dec(t[1]), location: l ? dec(l[1]) : "", department: "", url: origin + m[1], posted: dm ? `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}` : null });
    }
    if (!out.length) for (const c of html.split('class="sr-job-item"').slice(1)) { // alternate TalentBrew layout (Citi and others)
      const a = /<a [^>]*href="([^"]*\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); const l = /sr-job-location"[^>]*>([\s\S]*?)<\/span>/.exec(c);
      if (a) out.push({ company: name, title: dec(a[2]), location: l ? dec(l[1]) : "", department: "", url: origin + a[1], posted: null });
    }
    if (!out.length) for (const c of html.split('class="search-results__job-link"').slice(1)) { // TalentBrew layout with separate title/location/date spans (Boeing)
      const a = /href="([^"]*\/job\/[^"]+)"[^>]*>\s*<span class="search-results__job-title">([\s\S]*?)<\/span>/.exec(c); if (!a) continue;
      const l = /job-info location">([\s\S]*?)<\/span>/.exec(c); const d = /job-info date">\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(c);
      out.push({ company: name, title: dec(a[2]), location: l ? dec(l[1]) : "", department: "", url: origin + a[1], posted: d ? `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}` : null });
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

// Apple jobs: the careers site's own search API, 20 roles per page, newest first.
const APPLE: Reader = { name: "Apple", run: async () => {
  const get = async (p: number) => {
    const r = await fetch("https://jobs.apple.com/api/v1/search", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA["user-agent"], referer: "https://jobs.apple.com/en-us/search", origin: "https://jobs.apple.com" },
      body: JSON.stringify({ query: "", filters: { locations: ["postLocation-USA"] }, page: p, locale: "en-us", sort: "newest", format: { longDate: "MMMM D, YYYY", mediumDate: "MMM D, YYYY" } }), signal: AbortSignal.timeout(14000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return { rows: (j?.res?.searchResults || []) as any[], total: Number(j?.res?.totalRecords || 0) };
  };
  const first = await get(1);
  if (!first.rows.length) throw new Error("no results");
  const pages = Math.min(Math.ceil(first.total / 20), 400);
  const deadline = Date.now() + 22000;
  const rest = await pool(range(2, pages + 1, 1), 12, async p => (Date.now() > deadline ? [] : (await get(p)).rows));
  const raw: RawJob[] = [first.rows, ...rest].flatMap(x => x || []).map((e: any) => ({
    company: "Apple", title: e.postingTitle, department: e.team?.teamName || "",
    location: (e.locations || []).filter((l: any) => /united states/i.test(l.countryName || "")).map((l: any) => [l.city, l.stateProvince].filter(Boolean).join(", ") || l.name || "United States").join("; "),
    url: `https://jobs.apple.com/en-us/details/${e.positionId}/${e.transformedPostingTitle || ""}`, posted: e.postDateInGMT ? String(e.postDateInGMT).slice(0, 10) : null,
  }));
  return { raw: raw.filter(r => r.location && r.title), assumeUS: true };
} };

// Generic reader: job sitemap -> each job page's schema.org JobPosting data (only the first bytes of each page are read).
function sitemapJobs(name: string, sitemap: string, urlRe: RegExp, part = 0, parts = 1, assumeUS = false): Reader {
  const BROWSER = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1" };
  const readLd = async (url: string): Promise<any | null> => {
    const r = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(10000) });
    if (!r.ok || !r.body) return null;
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    try {
      while (buf.length < 60000) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const i = buf.search(/"(?:\\u0040|@)type"\s*:\s*"JobPosting"/);
        if (i >= 0) { const e = buf.indexOf("</script>", i); if (e >= 0) { const st = buf.lastIndexOf("<script", i); const body = buf.slice(buf.indexOf(">", st) + 1, e); return JSON.parse(body.replace(/\\u0040/g, "@")); } }
      }
    } finally { rd.cancel().catch(() => {}); }
    return null;
  };
  return { name, run: async () => {
    const xml = await (await fetch(sitemap, { headers: BROWSER, signal: AbortSignal.timeout(12000) })).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => urlRe.test(u));
    if (!urls.length) throw new Error("empty sitemap");
    const mine = urls.filter((_, i) => i % parts === part);
    const deadline = Date.now() + 24000;
    const out = await pool(mine, 24, async (u): Promise<RawJob | null> => {
      if (Date.now() > deadline) return null;
      const j = await readLd(u); if (!j?.title) return null;
      const locs = ([] as any[]).concat(j.jobLocation || []);
      const us = locs.filter(l => { const c = l?.address?.addressCountry; return !c || /^(US|USA|United States)/i.test(typeof c === "string" ? c : c?.name || ""); });
      if (!us.length && locs.length) return null;
      return { company: name, title: String(j.title), department: "", location: us.map(l => l?.name || [l?.address?.addressLocality, l?.address?.addressRegion].filter(Boolean).join(", ")).filter(Boolean).join("; "), url: u, posted: j.datePosted ? String(j.datePosted).slice(0, 10) : null };
    });
    const raw = out.filter(Boolean) as RawJob[];
    if (!raw.length) throw new Error("no postings read");
    return { raw, assumeUS };
  } };
}

// Oracle Recruiting (HCM) candidate sites: same API JPMorgan uses; US roles only.
function oracle(name: string, host: string, site: string, cap = 3000): Reader {
  const api = (o: number) => `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=50,offset=${o},sortBy=POSTING_DATES_DESC`;
  return { name, run: async () => {
    const first = await jget(api(0), { headers: { accept: "application/json" } });
    const total = Number(first?.items?.[0]?.TotalJobsCount || 0);
    const rest = await pool(range(50, Math.min(total, cap), 50), 8, o => jget(api(o), { headers: { accept: "application/json" } }));
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.items?.[0]?.requisitionList || []).filter((p: any) => /^(US|USA|United States)$/i.test(p.PrimaryLocationCountry || "")).map((p: any) => ({
      company: name, title: p.Title, location: (p.PrimaryLocation || "").replace(/,?\s*United States$/, ""), department: p.JobFamily || "",
      url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${p.Id}`, posted: p.PostedDate || null,
    }));
    return { raw, assumeUS: true };
  } };
}

// Jibe-powered career sites (AMD, Costco, ...): /api/jobs, 100 per page.
function jibePay(d: any) {
  const p = d.salary_min_value > 0 ? annualPay(d.salary_min_value, d.salary_max_value || d.salary_min_value, String(d.salary_value_type || d.salary_period || "year")) : null;
  if (p) return { salary_min: p.min, salary_max: p.max, salary_cur: String(d.salary_currency || "USD") };
  return payFromText([d.description, d.responsibilities, d.qualifications, d.compensation].filter(Boolean).join(" ")) || {};
}
function jibe(name: string, origin: string, all = false): Reader {
  return { name, run: async () => {
    const get = (p: number) => jget(`${origin}/api/jobs?page=${p}&limit=100&sortBy=posted_date&descending=true`);
    const first = await get(1);
    const total = Number(first?.totalCount || 0);
    const rest = await pool(range(2, Math.min(Math.ceil(total / 100), 40) + 1, 1), 6, get);
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.jobs || []).map((x: any) => x.data || x).map((d: any) => ({
      company: name, title: d.title, department: (d.categories || [])[0]?.name || d.department || "",
      location: d.full_location || d.location_name || [d.city, d.state].filter(Boolean).join(", "), country: d.country_code || d.country,
      url: d.apply_url ? String(d.apply_url).replace(/\/apply.*$/, "") : `${origin}/jobs/${d.slug || d.req_id}`, posted: d.posted_date || d.create_date || null,
      ...jibePay(d),
    })).filter((r: any) => all || !r.country || /^(US|USA|United States)/i.test(r.country));
    return { raw };
  } };
}

// Avature career sites (Deloitte): the search page lists 100 jobs per page as HTML articles (link, title, location in the last subtitle span).
function avature(name: string, origin: string, cap = 3000, assumeUS = true, path = "SearchJobs"): Reader {
  const page = async (o: number): Promise<RawJob[]> => {
    const r = await fetch(`${origin}/${path}/?jobRecordsPerPage=100&jobOffset=${o}&folderRecordsPerPage=100&folderOffset=${o}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const html = await r.text();
    const dec = (x: string) => x.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    const viaArticles = html.split("<article").slice(1).flatMap(a => {
      const m = /href="(https?:[^"]*\/(?:JobDetail|FolderDetail)\/[^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/.exec(a); if (!m) return [];
      const spans = [...a.matchAll(/<span[^>]*>\s*([^<]*?)\s*<\/span>/g)].map(x => dec(x[1])).filter(Boolean);
      return [{ company: name, title: dec(m[2]), location: (spans[spans.length - 1] || "").replace(/,\s*United States$/, ""), department: "", url: m[1] } as RawJob];
    });
    if (viaArticles.length) return viaArticles;
    // Alternate Avature layout (Delta): <li class="list__item"> with the location as "Country, State, City" in the first subtitle span.
    return html.split('<li class="list__item">').slice(1).flatMap(c => {
      const m = /href="(https?:[^"]*\/JobDetail\/[^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/.exec(c); if (!m) return [];
      const sp = /list__item__text__subtitle">\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/.exec(c);
      const parts = dec(sp ? sp[1] : "").replace(/\.$/, "").split(/,\s*/).filter(Boolean);
      const loc = parts[0] === "United States" ? parts.slice(1).reverse().join(", ") : parts.reverse().join(", ");
      return [{ company: name, title: dec(m[2]), location: loc, department: "", url: m[1].replace(/&amp;/g, "&") } as RawJob];
    });
  };
  return { name, run: async () => {
    const pages = await pool(range(0, cap, 100), 6, page);
    const raw = pages.flat().filter(Boolean) as RawJob[];
    if (!raw.length) throw new Error("no jobs read");
    return { raw, assumeUS };
  } };
}

// Wayfair careers: the list page loads every open role from one JSON endpoint (needs the page's session cookie and CSRF token).
function wayfair(name: string): Reader {
  const UAH = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const CC: Record<string, string> = { "United States": "US", Canada: "CA", "United Kingdom": "GB", Ireland: "IE", Germany: "DE", India: "IN", China: "CN" };
  const slugOf = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "-");
  const live = async (): Promise<any[]> => {
    const pg = await fetch("https://www.wayfair.com/careers/jobs", { headers: { "user-agent": UAH, accept: "text/html" }, signal: AbortSignal.timeout(15000) });
    if (!pg.ok) throw new Error(`page HTTP ${pg.status}`);
    const tok = /"csrfToken":"([^"]+)"/.exec(await pg.text())?.[1];
    const ck = (pg.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    if (!tok) throw new Error("no csrf token");
    const r = await fetch("https://www.wayfair.com/a/careers/careers/job_search_data", { headers: { "user-agent": UAH, accept: "application/json", "x-requested-with": "XMLHttpRequest", "x-csrf-token": tok, cookie: ck, referer: "https://www.wayfair.com/careers/jobs" }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`data HTTP ${r.status}`);
    const list = ((await r.json()) as any)?.jobListData;
    if (!Array.isArray(list)) throw new Error("no jobs read");
    return list.filter((x: any) => x.isActive !== false && !x.isHidden && x.title).map((x: any) => ({ id: x.requisitionId || x.id, title: x.title, team: x.teamName || x.category?.name || "", loc: x.location?.name || "", country: x.location?.country || "", created: x.createdDate || "", desc: x.description || x.briefDescription || "" }));
  };
  return { name, run: async () => {
    // Wayfair's bot protection blocks server addresses, so the owner can load the list from a browser (POST /api/refresh?import=wayfair).
    let rows: any[] = [];
    try { rows = await live(); } catch (e: any) {
      const j: any = await getStore("feed").get("import-wayfair", { type: "json" }).catch(() => null);
      if (!j?.rows?.length) throw e;
      rows = j.rows;
    }
    if (!rows.length) throw new Error("no jobs read");
    const raw: RawJob[] = rows.map((x: any) => ({ company: name, title: x.title, department: x.team || "", location: x.loc || "", country: CC[x.country] || undefined,
      url: `https://www.wayfair.com/careers/job/${slugOf(x.title)}/2-${x.id}`, posted: x.created ? String(x.created).slice(0, 10) : null,
      ...(payFromText(String(x.desc || "")) || {}) } as RawJob));
    return { raw, assumeUS: false };
  } };
}

// iCIMS career portals (Alaska Airlines): /jobs/search?ss=1&in_iframe=1&pr=N lists 50 roles per page as HTML rows.
function icims(name: string, hosts: string[]): Reader {
  const dec = (x: string) => x.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  const loc = (x: string) => { const p = x.split("-").map(v => v.trim()).filter(Boolean); return /^(US|USA)$/i.test(p[0] || "") && p.length >= 3 ? `${p.slice(2).join(" ")}, ${p[1]}` : p.length >= 3 ? p.slice(2).join(" ") + ", " + p[1] + ", " + p[0] : x; };
  return { name, run: async () => {
    const raw: RawJob[] = []; let okPages = 0;
    for (const h of hosts) for (let pr = 0; pr < 30; pr++) {
      const r = await fetch(`https://${h}/jobs/search?ss=1&in_iframe=1&pr=${pr}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) break; okPages++;
      const rows = (await r.text()).split('class="row"').slice(1); let n = 0;
      for (const c of rows) {
        const a = /href="([^"]*\/jobs\/\d+\/[^"]*\/job)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/.exec(c); if (!a) continue; n++;
        const l = /Job Locations<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(c); const d = /class="col-xs-12 description">([\s\S]*?)<\/div>/.exec(c);
        raw.push({ company: name, title: dec(a[2]), location: l ? loc(dec(l[1])) : "", department: "", url: a[1], posted: null, ...(d ? payFromText(dec(d[1])) || {} : {}) } as RawJob);
      }
      if (!n) break;
    }
    if (!okPages || !raw.length) throw new Error("no jobs read");
    return { raw };
  } };
}

// Workable career sites (apply.workable.com/<slug>): public JSON search API, paged by token.
function workable(name: string, slug: string, assumeUS = false): Reader {
  return { name, run: async () => {
    const raw: RawJob[] = [];
    let token: string | undefined;
    for (let i = 0; i < 12; i++) {
      const j: any = await jget(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }) });
      for (const x of j?.results || []) raw.push({ company: name, title: x.title, department: (x.department || [])[0] || "", location: [x.location?.city, x.location?.region, x.location?.country].filter(Boolean).join(", "), url: `https://apply.workable.com/${slug}/j/${x.shortcode}/`, posted: x.published || null, remote: x.remote === true || /remote/i.test(x.workplace || "") ? true : null });
      token = j?.nextPage; if (!token) break;
    }
    if (!raw.length) throw new Error("no jobs read");
    return { raw, assumeUS };
  } };
}

// Phenom People career sites (eBay, Chewy, Cisco, Lowe's, UPS, ...): /widgets search API, 100 per page.
function phenom(name: string, origin: string, locale = "us/en", cap = 2000): Reader {
  const [cc, lang] = locale.split("/");
  const post = (from: number) => jget(`${origin}/widgets`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({
    lang: `${lang}_${cc}`, deviceType: "desktop", country: cc, pageName: "search-results", ddoKey: "refineSearch", sortBy: "Most recent", subsearch: "", from, jobs: true, counts: true,
    all_fields: ["category", "country", "state", "city", "type"], size: 100, clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: "page11", siteType: "external", keywords: "", global: true, selected_fields: {}, sort: { order: "desc", field: "postedDate" }, locationData: {},
  }) });
  return { name, run: async () => {
    const first = await post(0);
    const d0 = first?.refineSearch;
    const total = Math.min(Number(d0?.totalHits || 0), cap);
    if (!d0?.data?.jobs) throw new Error("no data");
    const rest = await pool(range(100, total, 100), 6, post);
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.refineSearch?.data?.jobs || []).map((j: any) => ({
      company: name, title: j.title, department: j.category || "", country: j.country,
      location: j.location || [j.city, j.state].filter(Boolean).join(", "),
      url: `${origin}/${locale}/job/${j.jobId || j.jobSeqNo}`, posted: j.postedDate || null,
    })).filter((r: any) => !r.country || /^(US|USA|United States)/i.test(r.country));
    return { raw };
  } };
}

// Walmart careers: its search endpoint returns roughly the 100-170 best matches per phrase, so each reader runs a set of role phrases and merges the results.
const WM_Q1 = ["software engineer", "data scientist", "machine learning", "product manager", "technical program manager", "cloud", "devops", "site reliability", "cybersecurity", "mobile", "ios", "android", "backend", "frontend", "full stack", "platform", "network", "database", "QA test", "ux designer"];
const WM_Q2 = ["data analyst", "business intelligence", "analytics", "director", "senior director", "vice president", "advertising", "marketing", "ecommerce", "pricing", "merchandising", "buyer", "category", "strategy", "consultant", "program manager", "project manager", "operations manager", "supply chain", "logistics"];
const WM_Q3 = ["finance", "accounting", "tax", "treasury", "audit", "risk", "compliance", "legal counsel", "human resources", "recruiter", "talent", "communications", "content", "brand", "creative", "sales", "account manager", "customer", "sourcing", "procurement"];
const WM_Q4 = ["real estate", "facilities", "construction", "energy", "sustainability", "health", "pharmacy", "clinical", "payments", "fintech", "insurance", "research", "scientist", "architect", "engineer", "manager", "specialist", "analyst", "associate", "lead"];
function walmart(name: string, queries: string[]): Reader {
  const gql = async (query: string, page: number) => {
    const r = await fetch("https://careers.walmart.com/api/graphql", { method: "POST", signal: AbortSignal.timeout(12000),
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", origin: "https://careers.walmart.com", referer: "https://careers.walmart.com/us/en/results" },
      body: JSON.stringify({ queryId: "b09f52ab-9c7f-421f-8a2a-d990b6f288a8", variables: { request: { query, isBasicSearch: false, filter: "" }, locale: "en_US", page, size: 100 } }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j: any = await r.json();
    const jobs = j?.data?.hybridCombinedSearchV2?.jobs;
    if (!Array.isArray(jobs)) throw new Error("no data");
    return jobs as any[];
  };
  return { name, run: async () => {
    const seen = new Map<string, RawJob>();
    const deadline = Date.now() + 21000;
    let okQueries = 0;
    await pool(queries, 5, async q => {
      let quiet = 0;
      for (let p = 0; p < 12 && quiet < 2 && Date.now() < deadline; p++) {
        const jobs = await gql(q, p);
        if (p === 0) okQueries++;
        let fresh = 0;
        for (const j of jobs) {
          const m = j.metadata || {}; const id = m.jobId; if (!id || seen.has(id) || !m.jobPostingTitle) continue;
          fresh++;
          seen.set(id, { company: name, title: m.jobPostingTitle, department: m.workgroupDesc || "", country: "US",
            location: [m.primaryLocationCity ? String(m.primaryLocationCity).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "", m.primaryLocationState].filter(Boolean).join(", "),
            url: `https://careers.walmart.com/us/en/jobs/${id}`, posted: null } as RawJob);
        }
        quiet = fresh ? 0 : quiet + 1;
      }
    });
    if (!okQueries || !seen.size) throw new Error("no results");
    return { raw: [...seen.values()], assumeUS: true };
  } };
}

// Atlassian careers: one JSON listing of every role (the site's own endpoint).
const ATLASSIAN: Reader = { name: "Atlassian", run: async () => {
  const j = await jget("https://www.atlassian.com/endpoint/careers/listings");
  if (!Array.isArray(j) || !j.length) throw new Error("no listings");
  const raw: RawJob[] = j.map((e: any) => {
    const us = (e.locations || []).filter((l: string) => /united states|\bUSA?\b/i.test(l));
    return us.length ? { company: "Atlassian", title: e.title, department: e.category || "", location: us.map((l: string) => l.split(" - ").slice(-1)[0].trim() || l).join("; "),
      url: `https://www.atlassian.com/company/careers/details/${e.id}`, posted: e.portalJobPost?.updatedDate ? String(e.portalJobPost.updatedDate).slice(0, 10) : null, ...(payFromText([e.compensation, e.overview, e.responsibilities, e.qualifications].filter(Boolean).join(" ")) || {}) } : null;
  }).filter(Boolean) as RawJob[];
  return { raw, assumeUS: true };
} };

// Nike careers: server-rendered result pages (10 per page) that embed each role's data as escaped JSON.
const NIKE: Reader = { name: "Nike", run: async () => {
  const BROWSER = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };
  const get = async (p: number): Promise<{ rows: RawJob[]; total: number }> => {
    const r = await fetch(`https://careers.nike.com/jobs/page/${p}`, { headers: BROWSER, signal: AbortSignal.timeout(14000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.text();
    const total = Number(/of (\d[\d,]*) jobs/i.exec(h)?.[1]?.replace(/,/g, "") || 0);
    const dj = (t?: string) => { if (!t) return ""; try { return JSON.parse(`"${t}"`) as string; } catch { return t; } };
    const rows = h.split('"requisitionID":"').slice(1).map(c => {
      const id = /^([^"]+)"/.exec(c)?.[1]; const t = /"title":"((?:[^"\\]|\\.)*)"/.exec(c)?.[1];
      const cs = dj(/"cityState":"((?:[^"\\]|\\.)*)"/.exec(c)?.[1]); const country = /"countryAbbr":"([A-Z]{2})"/.exec(c)?.[1] || "";
      if (!id || !t) return null;
      const title = dj(t);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return { company: "Nike", title, location: country === "US" ? cs : cs ? `${cs}, ${country}` : "", department: "", url: `https://careers.nike.com/${slug}/job/${id}`, posted: null } as RawJob;
    }).filter(Boolean) as RawJob[];
    return { rows, total };
  };
  const first = await get(1);
  if (!first.rows.length) throw new Error("no results");
  const pages = first.total ? Math.min(Math.ceil(first.total / 10), 200) : 160;
  const deadline = Date.now() + 22000;
  const rest = await pool(range(2, pages + 1, 1), 10, async p => (Date.now() > deadline ? [] : (await get(p)).rows));
  const seen = new Map<string, RawJob>();
  for (const r of [...first.rows, ...rest.flat()]) if (r) seen.set(r.url, r);
  return { raw: [...seen.values()] };
} };

// SmartRecruiters public postings API (US only).
function smartrecruiters(name: string, id: string): Reader {
  const api = (o: number) => `https://api.smartrecruiters.com/v1/companies/${id}/postings?country=us&limit=100&offset=${o}`;
  return { name, run: async () => {
    const first = await jget(api(0));
    const rest = await pool(range(100, Math.min(first?.totalFound || 0, 2500), 100), 5, o => jget(api(o)));
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.content || []).map((p: any) => ({
      company: name, title: p.name, location: [p.location?.city, (p.location?.region || "").length === 2 ? String(p.location.region).toUpperCase() : p.location?.region].filter(Boolean).join(", "),
      department: p.department?.label || "", url: `https://jobs.smartrecruiters.com/${id}/${p.id}`, posted: p.releasedDate || null,
    }));
    return { raw, assumeUS: true };
  } };
}

// Clinch-hosted career sites (same template as Etsy): server-rendered search pages with job cards.
function clinch(name: string, origin: string, path = "/jobs/search"): Reader {
  const dec = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const BROWSER = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" };
  const page = async (p: number): Promise<RawJob[]> => {
    const r = await fetch(`${origin}${path}?page=${p}`, { signal: AbortSignal.timeout(14000), headers: BROWSER });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.text();
    return h.split("job-search-results-card-body").slice(1).map(c => {
      const a = /<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); const l = /job-component-location[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/.exec(c);
      return a ? { company: name, title: dec(a[2]), location: l ? dec(l[1]) : "", department: "", url: a[1].startsWith("http") ? a[1] : origin + a[1], posted: null } : null;
    }).filter(Boolean) as RawJob[];
  };
  return { name, run: async () => {
    const seen = new Map<string, RawJob>();
    for (let p = 1; p <= 40; p++) { const rows = await page(p); if (!rows.length) break; const before = seen.size; rows.forEach(r => seen.set(r.url, r)); if (seen.size === before) break; }
    if (!seen.size) throw new Error("no results");
    return { raw: [...seen.values()] };
  } };
}

// Oracle Taleo career sections (for example Costco). The search page is plain HTML; each result row has the job id, title, department and location.
function taleo(name: string, host: string, org: string, cws: string): Reader {
  const base = `https://${host}/${host.startsWith("phf") ? "phf02" : "ats"}/ats/careers/v2`;
  const dec = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  const H = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" };
  const rows = async (extra: string): Promise<RawJob[]> => {
    const r = await fetch(`${base}/searchResults?org=${org}&cws=${cws}${extra}`, { signal: AbortSignal.timeout(14000), headers: H });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.text(); const out: RawJob[] = [];
    const re = /rid=(\d+)"\s+class="viewJobLink">([\s\S]*?)<\/a>\s*<\/h4>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(h))) out.push({ company: name, title: dec(m[2]), location: dec(m[4]), department: dec(m[3]).replace(/^\d+\s*-\s*/, ""), url: `${base}/viewRequisition?org=${org}&cws=${cws}&rid=${m[1]}`, posted: null });
    return out;
  };
  return { name, run: async () => {
    const seen = new Map<string, RawJob>();
    // The page shows 10 roles at a time and has no usable paging link, so read it sorted six ways and combine them.
    (await rows("")).forEach(x => seen.set(x.url, x));
    const views = [0, 1, 2].flatMap(c => ["A", "D"].map(o => `&act=sort&sortColumn=${c}&sortOrder=${o}`));
    for (const v of views) { try { (await rows(v)).forEach(x => seen.set(x.url, x)); } catch {} }
    if (!seen.size) throw new Error("no results");
    return { raw: [...seen.values()] };
  } };
}

// Vaia Talents company pages (a job board that mirrors a company's postings). The job list is embedded in the page as JSON.
function vaia(name: string, page: string): Reader {
  const CITY_ST: Record<string, string> = { "palo alto": "CA", "san francisco": "CA", "san jose": "CA", "mountain view": "CA", "sunnyvale": "CA", "los angeles": "CA", "san diego": "CA", "new york": "NY", "seattle": "WA", "austin": "TX", "boston": "MA", "chicago": "IL" };
  return { name, run: async () => {
    const r = await fetch(page, { signal: AbortSignal.timeout(14000), headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = (await r.text()).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'");
    const re = /"jobId":\[0,(\d+)\],"url":\[0,"([^"]+)"\],"title":\[0,"([^"]+)"\],"companyName":\[0,"[^"]*"\],"city":\[0,(?:"([^"]*)"|null)\](?:[^{}]*?"postedLabel":\[0,(?:"([^"]*)"|null)\])?/g;
    const out = new Map<string, RawJob>(); let m: RegExpExecArray | null;
    const now = Date.now();
    while ((m = re.exec(h))) {
      const city = (m[4] || "").trim(), st = CITY_ST[city.toLowerCase()];
      const pm = /(\d+)\s+(day|hour|week|month)/i.exec(m[5] || "");
      const posted = /today|just/i.test(m[5] || "") ? new Date(now).toISOString() : pm ? new Date(now - +pm[1] * ({ hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 } as any)[pm[2].toLowerCase()]).toISOString() : null;
      const title = m[3].replace(/\s*[-–]\s*rednote\s*$/i, "").replace(/^rednote\s+/i, "").trim();
      out.set(m[2], { company: name, title, location: city ? (st ? `${city}, ${st}` : city) : "", department: "", url: m[2], posted });
    }
    if (!out.size) throw new Error("no results");
    return { raw: [...out.values()], assumeUS: true };
  } };
}

function bytedancePay(x: any) {
  const i = x.job_post_info || {};
  const p = i.min_salary > 0 ? annualPay(i.min_salary, i.max_salary || i.min_salary, "year") : null;
  if (p) return { salary_min: p.min, salary_max: p.max, salary_cur: String(i.currency || "USD") };
  return payFromText([x.description, x.requirement].filter(Boolean).join(" ")) || {};
}
// ByteDance careers (joinbytedance.com): the public search API the site itself calls.
function bytedance(name: string, origin: string, cap = 1500): Reader {
  const post = (offset: number) => jget("https://jobs.bytedance.com/api/v1/public/supplier/search/job/posts", { method: "POST", headers: { "content-type": "application/json", "accept-language": "en-US", "website-path": "en", "x-tt-env": "boe_epam_api", origin }, body: JSON.stringify({ recruitment_id_list: [], job_category_id_list: [], subject_id_list: [], location_code_list: [], keyword: "", limit: 50, offset }) });
  return { name, run: async () => {
    const first = await post(0);
    const total = Math.min(Number(first?.data?.count || 0), cap);
    if (!first?.data?.job_post_list) throw new Error("no data");
    const rest = await pool(range(50, total, 50), 5, post);
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.data?.job_post_list || []).map((x: any) => {
      const c = x.city_info || {}; const loc = [c.en_name, c.parent?.en_name, c.parent?.parent?.en_name].filter(Boolean);
      return { company: name, title: x.title, location: loc.join(", "), department: x.job_category?.en_name || "", url: `${origin}/search/${x.id}`, posted: null, ...bytedancePay(x) };
    });
    return { raw };
  } };
}

// Adzuna job search (second source for companies we do not read directly). Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.
const ADZUNA_QUERIES = ["product manager", "senior product manager", "principal product manager", "director product management", "trust and safety", "technical program manager", "software engineer", "data scientist"]; // 8 queries x 3 pages = 24 calls per run (free tier is 25)
const ADZUNA: Reader = { name: "Adzuna search", run: async () => {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
  const get = (q: string, p: number) => jget(`https://api.adzuna.com/v1/api/jobs/us/search/${p}?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}&results_per_page=50&what=${encodeURIComponent(q)}&sort_by=date&max_days_old=30&content-type=application/json`);
  const found = new Map<string, RawJob>();
  const reqs = ADZUNA_QUERIES.flatMap(q => [1, 2, 3].map(p => ({ q, p })));
  await pool(reqs, 2, async ({ q, p }) => {
    const j = await get(q, p);
    for (const r of j?.results || []) {
      const loc = (r.location?.display_name || "").trim();
      found.set(String(r.id), { company: String(r.company?.display_name || "").trim(), title: r.title, location: loc, department: r.category?.label || "", url: r.redirect_url, posted: r.created || null, ...(String(r.salary_is_predicted) !== "1" && r.salary_min > 0 ? (p2 => p2 ? { salary_min: p2.min, salary_max: p2.max, salary_cur: "USD" } : {})(annualPay(r.salary_min, r.salary_max || r.salary_min, "year")) : {}) });
    }
  });
  const raw = [...found.values()].filter(r => r.company && r.title);
  if (!raw.length) throw new Error("no results");
  return { raw, assumeUS: true, src: "search" };
} };

// Shopify: the sitemap lists every job page; each page's first ~30KB holds the title (h1), location (p after it) and discipline.
const SHOPIFY: Reader = { name: "Shopify", run: async () => {
  const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml,application/xml", "accept-language": "en-US,en;q=0.9" };
  const dec = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const sm = await fetch("https://www.shopify.com/careers/sitemap.xml", { signal: AbortSignal.timeout(15000), headers: UA });
  if (!sm.ok) throw new Error(`HTTP ${sm.status}`);
  const urls = [...new Set([...(await sm.text()).matchAll(/<loc>(https:\/\/www\.shopify\.com\/careers\/[a-z0-9-]+_[0-9a-f-]{36})<\/loc>/g)].map(m => m[1]))];
  const out: RawJob[] = [];
  await pool(urls, 12, async url => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: UA }); if (!r.ok || !r.body) return;
      const rd = r.body.getReader(); const dc = new TextDecoder(); let h = "";
      while (h.length < 32000) { const { done, value } = await rd.read(); if (done) break; h += dc.decode(value, { stream: true }); if (/<\/h1>\s*<p[^>]*>[\s\S]*?<\/p>/.test(h) && /extra-discipline/.test(h)) break; }
      rd.cancel().catch(() => {});
      const t = /<h1[^>]*>([\s\S]*?)<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/.exec(h); const d = /data-component-extra-discipline="([^"]*)"/.exec(h);
      if (t) out.push({ company: "Shopify", title: dec(t[1]), location: dec(t[2]), department: d ? dec(d[1]) : "", url, posted: null });
    } catch {}
  });
  if (!out.length) throw new Error("no results");
  return { raw: out };
} };

export type Spec = { kind: "workday" | "oracle" | "radancy" | "eightfold" | "jibe" | "phenom" | "sitemap" | "builtin" | "smartrecruiters" | "clinch" | "taleo" | "vaia" | "walmart" | "bytedance" | "avature" | "workable" | "wayfair" | "icims"; name: string; [k: string]: any };
export function fromSpec(s: Spec): Reader {
  switch (s.kind) {
    case "workday": return workday(s.name, s.host, s.tenant, s.site, s.cap || 2000);
    case "oracle": return oracle(s.name, s.host, s.site, s.cap || 3000);
    case "radancy": return radancy(s.name, s.origin, s.prefix || "", String(s.org));
    case "eightfold": return eightfold(s.name, s.host, s.domain, s.careersBase, s.queries || QUERIES, s.pagesPer || 30);
    case "jibe": return jibe(s.name, s.origin, !!s.all);
    case "clinch": return clinch(s.name, s.origin, s.path || "/jobs/search");
    case "smartrecruiters": return smartrecruiters(s.name, s.id);
    case "builtin": { const b = BIG.find(x => x.name === s.name); if (!b) throw new Error("not found"); return b; }
    case "sitemap": return sitemapJobs(s.name, s.sitemap, new RegExp(s.pattern), s.part || 0, s.parts || 1, !!s.assumeUS);
    case "avature": return avature(s.name, s.origin, s.cap || 3000, s.assumeUS !== false, (s as any).path || "SearchJobs");
    case "workable": return workable(s.name, s.slug, !!s.assumeUS);
    case "taleo": return taleo(s.name, s.host, s.org, String(s.cws));
    case "vaia": return vaia(s.name, s.page);
    case "wayfair": return wayfair(s.name);
    case "icims": return icims(s.name, s.hosts);
    case "bytedance": return bytedance(s.name, s.origin);
    case "walmart": return walmart(s.name, (s as any).queries || WM_Q1);
    case "phenom": return phenom(s.name, s.origin, s.locale || "us/en");
  }
  throw new Error("unknown kind");
}

// Google DeepMind: its roles live on Google's careers site, filtered with company=DeepMind (same embedded data as GOOGLE).
const DEEPMIND: Reader = { name: "Google DeepMind", run: async () => {
  const base = "https://www.google.com/about/careers/applications/jobs/results/";
  const get = async (page: number) => {
    const r = await fetch(`${base}?company=DeepMind&location=United%20States&page=${page}`, { headers: { "user-agent": UA["user-agent"], "accept-language": "en-US" }, signal: AbortSignal.timeout(14000) });
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
    seen.set(id, { company: "Google DeepMind", title, location: us.map((l: any[]) => l[0]).join("; "), department: "", url: `${base}${id}-${slug}`, posted: null });
  } };
  const first = await get(1); add(first.rows);
  const pages = Math.min(Math.ceil((first.total || 0) / 20), 15);
  await pool(range(2, pages + 1, 1), 3, async p => { add((await get(p)).rows); });
  if (!seen.size) throw new Error("no DeepMind roles");
  return { raw: [...seen.values()], assumeUS: true };
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
  APPLE,
  sitemapJobs("Meta", "https://www.metacareers.com/jobsearch/sitemap.xml", /job_details\/\d+/, 0, 2),
  sitemapJobs("Meta", "https://www.metacareers.com/jobsearch/sitemap.xml", /job_details\/\d+/, 1, 2),
  sitemapJobs("Activision Blizzard", "https://careers.activision.com/sitemap.xml", /careers\.activision\.com\/job\//),
  ...(extra as Spec[]).map(fromSpec),
  ATLASSIAN,
  NIKE,
  ADZUNA,
  SHOPIFY,
  taleo("Costco", "phf.tbe.taleo.net", "COSTCO", "41"),
  jibe("McAfee", "https://careers.mcafee.com"),
  vaia("RedNote", "https://talents.vaia.com/companies/rednote/"),
  bytedance("ByteDance", "https://joinbytedance.com"),
  workday("DraftKings", "draftkings.wd1.myworkdayjobs.com", "draftkings", "DraftKings"),
  workday("Priceline", "priceline.wd1.myworkdayjobs.com", "priceline", "Priceline"),
  avature("Deloitte", "https://apply.deloitte.com/en_US/careers", 3000),
  workday("Accenture", "accenture.wd103.myworkdayjobs.com", "accenture", "AccentureCareers", 1200),
  workday("Sunrun", "sunrun.wd5.myworkdayjobs.com", "sunrun", "Sunrun_Careers"),
  phenom("Circle (USDC)", "https://careers.circle.com"),
  avature("Bain & Company", "https://careers.bain.com/jobs", 1500, false),
  smartrecruiters("Care.com", "Carecom1"),
  workday("Overstock", "overstock.wd5.myworkdayjobs.com", "overstock", "BedBathandBeyond_Careers"),
  workday("JD.com", "jd.wd103.myworkdayjobs.com", "jd", "Careers_at_JD"),
  workday("Rakuten", "rakuten.wd1.myworkdayjobs.com", "rakuten", "RakutenAmericas"),
  smartrecruiters("Mattel", "MattelInc"),
  workday("Marvell", "marvell.wd1.myworkdayjobs.com", "marvell", "MarvellCareers"),
  phenom("Warner Bros. Discovery", "https://careers.wbd.com", "global/en"),
  workable("Bayut", "bayutdubizzle"),
  workable("Progyny", "progyny"),
  jibe("Yelp", "https://community.yelp.careers"),
  workday("Grubhub", "wonder.wd1.myworkdayjobs.com", "wonder", "Grubhub_Careers"),
  workday("Levi Strauss & Co.", "levistraussandco.wd5.myworkdayjobs.com", "levistraussandco", "External"),
  workday("Gap Inc.", "gapinc.wd1.myworkdayjobs.com", "gapinc", "GAPINC"),
  workday("Aritzia", "aritzia.wd3.myworkdayjobs.com", "aritzia", "External"),
  workday("Saks Fifth Avenue", "saks.wd1.myworkdayjobs.com", "saks", "careers_at_saks"),
  avature("Lululemon", "https://careers.lululemon.com/en_US/careers"),
  phenom("Dollar Tree", "https://careers.dollartree.com"),
  DEEPMIND,
  smartrecruiters("LinkedIn", "LinkedIn3"),
  workday("Memorial Sloan Kettering", "msk.wd108.myworkdayjobs.com", "msk", "MSKCC_Careers_Primary"),
  workday("Remitly", "remitly.wd5.myworkdayjobs.com", "remitly", "Remitly_Careers"),
  radancy("Mayo Clinic", "https://jobs.mayoclinic.org", "", "33647"),
  workday("Bloom Energy", "bloomenergy.wd1.myworkdayjobs.com", "bloomenergy", "BloomEnergyCareers"),
  radancy("ALDI", "https://careers.aldi.us", "", "61"),
  workday("3M", "3m.wd1.myworkdayjobs.com", "3m", "Search"),
  eightfold("Eaton", "eaton.eightfold.ai", "eaton.com", "https://eaton.eightfold.ai/careers/job", [""], 40),
  walmart("Walmart", WM_Q1),
  walmart("Walmart", WM_Q2),
  walmart("Walmart", WM_Q3),
  walmart("Walmart", WM_Q4),
  wayfair("Wayfair"),
  oracle("Marriott", "ejwl.fa.us2.oraclecloud.com", "MI_CS_1", 5000),
  workday("Yahoo", "ouryahoo.wd5.myworkdayjobs.com", "ouryahoo", "careers"),
  radancy("Boeing", "https://jobs.boeing.com", "", "185"),
  jibe("PepsiCo", "https://pepsico.jibeapply.com"),
  avature("Delta Air Lines", "https://delta.avature.net/en_US/careers", 1000, false),
  icims("Alaska Airlines", ["corporatejobs-alaskaair.icims.com", "maintenancejobs-alaskaair.icims.com"]),
];

export async function crawlBig(i: number) {
  const r = BIG[i];
  try {
    const { raw, assumeUS, src } = await r.run();
    const seen = new Set<string>(); const jobs: Job[] = [];
    for (const x of raw) { if (!x.title || !x.url || seen.has(x.url)) continue; seen.add(x.url); const n = normalizeJob(x, { assumeUS }); if (n) { if (src) (n as any).src = src; jobs.push(n); } }
    return { jobs, report: [{ name: r.name, ok: true, total: raw.length, kept: jobs.length }], names: [r.name] };
  } catch (e: any) {
    return { jobs: [] as Job[], report: [{ name: r.name, ok: false, total: 0, kept: 0, error: String(e?.message || e).slice(0, 80) }], names: [r.name] };
  }
}
