import { normalizeJob, type Job, type RawJob } from "./normalize.mts";
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
    if (!out.length) for (const c of html.split('class="sr-job-item"').slice(1)) { // alternate TalentBrew layout (Citi and others)
      const a = /<a [^>]*href="([^"]*\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); const l = /sr-job-location"[^>]*>([\s\S]*?)<\/span>/.exec(c);
      if (a) out.push({ company: name, title: dec(a[2]), location: l ? dec(l[1]) : "", department: "", url: origin + a[1], posted: null });
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
function oracle(name: string, host: string, site: string): Reader {
  const api = (o: number) => `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=50,offset=${o},sortBy=POSTING_DATES_DESC`;
  return { name, run: async () => {
    const first = await jget(api(0), { headers: { accept: "application/json" } });
    const total = Number(first?.items?.[0]?.TotalJobsCount || 0);
    const rest = await pool(range(50, Math.min(total, 3000), 50), 8, o => jget(api(o), { headers: { accept: "application/json" } }));
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.items?.[0]?.requisitionList || []).filter((p: any) => /^(US|USA|United States)$/i.test(p.PrimaryLocationCountry || "")).map((p: any) => ({
      company: name, title: p.Title, location: (p.PrimaryLocation || "").replace(/,?\s*United States$/, ""), department: p.JobFamily || "",
      url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${p.Id}`, posted: p.PostedDate || null,
    }));
    return { raw, assumeUS: true };
  } };
}

// Jibe-powered career sites (AMD, Costco, ...): /api/jobs, 100 per page.
function jibe(name: string, origin: string): Reader {
  return { name, run: async () => {
    const get = (p: number) => jget(`${origin}/api/jobs?page=${p}&limit=100&sortBy=posted_date&descending=true`);
    const first = await get(1);
    const total = Number(first?.totalCount || 0);
    const rest = await pool(range(2, Math.min(Math.ceil(total / 100), 40) + 1, 1), 6, get);
    const raw: RawJob[] = [first, ...rest].flatMap(p => p?.jobs || []).map((x: any) => x.data || x).map((d: any) => ({
      company: name, title: d.title, department: (d.categories || [])[0]?.name || d.department || "",
      location: d.full_location || d.location_name || [d.city, d.state].filter(Boolean).join(", "), country: d.country_code || d.country,
      url: d.apply_url ? String(d.apply_url).replace(/\/apply.*$/, "") : `${origin}/jobs/${d.slug || d.req_id}`, posted: d.posted_date || d.create_date || null,
    })).filter((r: any) => !r.country || /^(US|USA|United States)/i.test(r.country));
    return { raw };
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

// Atlassian careers: one JSON listing of every role (the site's own endpoint).
const ATLASSIAN: Reader = { name: "Atlassian", run: async () => {
  const j = await jget("https://www.atlassian.com/endpoint/careers/listings");
  if (!Array.isArray(j) || !j.length) throw new Error("no listings");
  const raw: RawJob[] = j.map((e: any) => {
    const us = (e.locations || []).filter((l: string) => /united states|\bUSA?\b/i.test(l));
    return us.length ? { company: "Atlassian", title: e.title, department: e.category || "", location: us.map((l: string) => l.split(" - ").slice(-1)[0].trim() || l).join("; "),
      url: `https://www.atlassian.com/company/careers/details/${e.id}`, posted: e.portalJobPost?.updatedDate ? String(e.portalJobPost.updatedDate).slice(0, 10) : null } : null;
  }).filter(Boolean) as RawJob[];
  return { raw, assumeUS: true };
} };

export type Spec = { kind: "workday" | "oracle" | "radancy" | "eightfold" | "jibe" | "phenom"; name: string; [k: string]: any };
export function fromSpec(s: Spec): Reader {
  switch (s.kind) {
    case "workday": return workday(s.name, s.host, s.tenant, s.site, s.cap || 2000);
    case "oracle": return oracle(s.name, s.host, s.site);
    case "radancy": return radancy(s.name, s.origin, s.prefix || "", String(s.org));
    case "eightfold": return eightfold(s.name, s.host, s.domain, s.careersBase, s.queries || QUERIES, s.pagesPer || 30);
    case "jibe": return jibe(s.name, s.origin);
    case "phenom": return phenom(s.name, s.origin, s.locale || "us/en");
  }
  throw new Error("unknown kind");
}

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
