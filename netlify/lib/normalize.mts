// Port of the Python normalizer used by build_dashboard.py, plus role-family classification.
// Keep both in sync: the Python build handles the browser-read companies, this handles the live feeds.

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));
const CITIES: Record<string, string> = {
  "san francisco": "CA", sf: "CA", "los angeles": "CA", "san diego": "CA", "san jose": "CA", "palo alto": "CA",
  "mountain view": "CA", sunnyvale: "CA", "santa clara": "CA", "new york city": "NY", nyc: "NY", "new york": "NY",
  brooklyn: "NY", seattle: "WA", sea: "WA", bellevue: "WA", redmond: "WA", austin: "TX", dallas: "TX", houston: "TX",
  chicago: "IL", chi: "IL", boston: "MA", cambridge: "MA", atlanta: "GA", atl: "GA", denver: "CO", boulder: "CO",
  miami: "FL", tampa: "FL", orlando: "FL", portland: "OR", phoenix: "AZ", "salt lake city": "UT", raleigh: "NC",
  durham: "NC", charlotte: "NC", philadelphia: "PA", pittsburgh: "PA", "washington dc": "DC", "washington, d.c.": "DC",
  dc: "DC", minneapolis: "MN", detroit: "MI", nashville: "TN",
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findStates(location: string): string[] {
  const found: string[] = [];
  const text = location || "";
  for (const m of text.matchAll(/,\s*([A-Z]{2})\b/g)) if (CODES.has(m[1]) && !found.includes(m[1])) found.push(m[1]);
  const low = text.toLowerCase();
  for (const [name, code] of Object.entries(STATES)) {
    if (new RegExp(`\\b${esc(name)}\\b`).test(low) && !found.includes(code)) {
      if (name === "washington" && /washington,?\s*d\.?c/.test(low)) continue;
      found.push(code);
    }
  }
  for (const [name, code] of Object.entries(CITIES)) {
    if (new RegExp(`(?<![a-z])${esc(name)}(?![a-z])`).test(low) && !found.includes(code)) found.push(code);
  }
  return found;
}

const NON_US = /\b(canada|toronto|vancouver|montreal|ontario|united kingdom|uk\b|london|england|scotland|ireland|dublin|india|bangalore|bengaluru|hyderabad|mumbai|pune|delhi|gurgaon|germany|berlin|munich|france|paris|spain|madrid|barcelona|netherlands|amsterdam|poland|warsaw|portugal|lisbon|italy|milan|sweden|stockholm|denmark|copenhagen|norway|finland|switzerland|zurich|israel|tel aviv|singapore|japan|tokyo|korea|seoul|china|beijing|shanghai|hong kong|taiwan|australia|sydney|melbourne|new zealand|brazil|sao paulo|são paulo|mexico|argentina|colombia|chile|uae|dubai|saudi|turkey|istanbul|egypt|nigeria|kenya|south africa|philippines|manila|indonesia|jakarta|vietnam|thailand|malaysia|emea|apac|latam|europe)\b/i;

export function isUS(location: string): boolean {
  const loc = location || "";
  if (!loc.trim()) return false;
  const states = findStates(loc);
  if (states.length) return true;
  if (/\b(united states|usa|u\.s\.a?\.?)\b/i.test(loc)) return true;
  if (NON_US.test(loc)) return false;
  return /^\s*remote\s*$/i.test(loc) || /\bremote\b.*\b(us|america|americas)\b|\b(us|usa)\b.*\bremote\b/i.test(loc);
}

const SENIORITY_RULES: [string, RegExp][] = [
  ["Executive", /\b(chief|cxo|ceo|cto|cfo|coo|cmo|vp|vice president|svp|evp|head of)\b/],
  ["Director", /\b(director|general manager)\b/],
  ["Principal+", /\b(principal|staff|distinguished|fellow|group product)/],
  ["Senior", /\b(senior|sr\.?|lead)\b/],
  ["Intern", /\b(intern|internship|co-?op)\b/],
  ["Entry", /\b(entry[- ]level|junior|jr\.?|associate|new grad|graduate|early career|apprentice)\b/],
  ["Manager", /(?<!product )\bmanager\b/],
];
export function seniority(title: string): string {
  const t = (title || "").toLowerCase();
  for (const [label, re] of SENIORITY_RULES) if (re.test(t)) return label;
  return "Mid";
}

const DOMAIN_RULES: [string, RegExp][] = [
  ["Trust & Safety", /\b(?:trust|safety|integrity|abuse|fraud|moderation|deceptive|adversarial|scam|civility|child|minor|content compliance|ads review|policy)/],
  ["Ads & Monetization", /\b(?:ads?\b|advertis|monetiz|revenue|subscription|marketing tech|sponsored|performance solutions|client partner)/],
  ["Payments & Fintech", /\b(?:payment|payments|wallet|billing|card\b|credit|lending|loan|fintech|finance|financial|checkout|ledger|money movement|banking|pricing|payout|capital markets|underwriting)/],
  ["Marketplace & Commerce", /\b(?:marketplace|seller|buyer|merchant|shopping|catalog|commerce|retail|delivery|dash(?:er|mart|pass)|supply|vertical|grocery|listings?|hosts?\b|guest|services\b|experiences)/],
  ["AI & Machine Learning", /\b(?:ai\b|a\.i\.|machine learning|ml\b|llm|applied scien|generative|genai|foundation ai|agent|copilot)/],
  ["Search & Discovery", /\b(?:search|discovery|recommend|feed\b|personaliz|relevance|ranking|homefeed|query)/],
  ["Platform & Developer", /\b(?:api\b|apis\b|developer|infrastructure|tooling|tech foundations|internal tools|data platform|ml platform|reliability|observability|devex|sdk|cloud)/],
  ["Growth & Consumer", /\b(?:growth|consumer|onboarding|lifecycle|retention|engagement|activation|acquisition|rider|savings|app experience|membership|loyalty)/],
  ["Community & Social", /\b(?:community|social|creator|connections|messaging|communications?|content|chat|notifications|media)/],
  ["Data & Analytics", /\b(?:data\b|analytics|insights|measurement|experimentation|metrics)/],
  ["Security & Identity", /\b(?:security|identity|iam\b|auth\b|authentication|privacy|account (?:safety|security|management)|access)/],
  ["Customer Experience", /\b(?:customer (?:care|support|experience)|support\b|help center|service quality|contact center|care\b)/],
  ["Enterprise & B2B", /\b(?:enterprise|b2b|business|for business|partner(?:s|ship)?\b|smb|agency|advertiser)/],
];
export function findDomains(title: string, dept: string): string[] {
  const text = `${title} ${dept}`.toLowerCase();
  const f = DOMAIN_RULES.filter(([, re]) => re.test(text)).map(([l]) => l);
  return f.length ? f : ["General"];
}

const DEPT_RULES: [string, RegExp][] = [
  ["Legal & Policy", /\b(?:counsel|legal|attorney|polic|compliance|regulatory|privacy|intellectual property|ip\b|public affairs|government)/],
  ["Trust & Security", /\b(?:trust|safety|security|investigat|fraud|abuse|integrity)/],
  ["Data & ML", /\b(?:data scien|machine learning|ml\b|applied scien|research scien|analytic|analyst|data engineer|quantitative|ai research|data science)/],
  ["Engineering", /\b(?:engineer|developer|software|sre\b|devops|architect|firmware|infrastructure|technical program|tpm\b|it support|network|information technology)/],
  ["Product & Design", /\b(?:product|designer|design\b|ux\b|ui\b|creative)/],
  ["Sales & Partnerships", /\b(?:account (?:executive|manager|management)|accounts management|sales|client|partnership|partner\b|business development|merchant|go-to-market|gtm|new business|solutions)/],
  ["Marketing & Comms", /\b(?:marketing|brand|seo\b|social|communications|content|influencer|editorial|community|curator)/],
  ["Finance", /\b(?:finance|financial|accounting|tax|payroll|treasury|audit|fp&a|risk|procurement)/],
  ["People & Recruiting", /\b(?:people|recruit|talent|hr\b|mobility)/],
  ["Operations & Strategy", /\b(?:operations|operator|program|site manager|fleet|supply|logistics|market manager|strategy|strategic|support|fellow|chief of staff|executive business partner|coordinator|assistant|platform manager|liaison|asset management|intelligence|specialist|repair|depot|lead\b)/],
];
export function inferDepartment(title: string): string {
  const t = (title || "").toLowerCase();
  for (const [l, re] of DEPT_RULES) if (re.test(t)) return l;
  return "Other";
}

// ---- Role families -------------------------------------------------------
export const FAMILIES = [
  "Product management", "Software engineering", "Data engineering", "Technical program management", "Program management",
  "UX design", "Human resources", "Legal", "Financial analyst", "Marketing", "Operations",
] as const;

const PRODUCT_TITLE = /\b(product (manager|management|lead|owner)|(director|head|vp|vice president|group|principal|staff|senior|sr\.?)( technical)?( of)? product\b)/i;
const PRODUCT_EXCLUDE = /product (marketing|design|program|operations|analyst|policy)|production/i;

export function roleFamily(title: string, department: string): string | null {
  const t = (title || "").toLowerCase();
  if (/^product management$/i.test(department || "") || (PRODUCT_TITLE.test(title || "") && !PRODUCT_EXCLUDE.test(title || ""))) return "Product management";
  if (/\b(technical program|tpm\b)/.test(t)) return "Technical program management";
  if (/\bprogram (manager|management|lead|director|operations)\b|\bprogram managers\b/.test(t) && !/product program/.test(t)) return "Program management";
  if (/\b(ux|ui\/ux|ui|user experience|product design|designer|interaction design|visual design|brand design|content design|design lead|design manager|user research|ux research|design systems)\b/.test(t) && !/engineer|developer|sales|ui engineer/.test(t)) return "UX design";
  if (/\b(data engineer|analytics engineer|data platform engineer|data infrastructure|etl|big data|data pipeline|data warehouse|machine learning|ml|mlops|ml ?ops|business intelligence|bi|applied scientist|research scientist|data scientist)\b/.test(t) && !/\b(recruiter|sourcer|counsel|attorney|marketing|sales|account|partner|designer)\b/.test(t)) return "Data engineering";
  if (/\b(engineer|developer|sde|software architect|swe|programmer)\b/.test(t) && !/\b(sales|solutions?|support|customer|field|forward deployed|mechanical|electrical|hardware|civil|manufacturing|facilities|process|industrial|chemical|biomedical|construction|rf |antenna|asic|silicon|fpga|validation|quality engineer|test technician|manufactur|reliability engineer \(hardware\)|site reliability technician|pre-?sales|implementation|technical support|success engineer)\b/.test(t)) return "Software engineering";
  if (/\b(counsel|attorney|legal|paralegal|compliance|regulatory|litigation|contracts? (manager|specialist|counsel)|general counsel|privacy counsel|ip counsel|policy counsel)\b/.test(t) && !/\b(policy (manager|lead|analyst|operations)|trust|safety)\b/.test(t)) return "Legal";
  if (/\b(financial|finance|fp&a|accountant|accounting|controller|treasury|tax|audit|revenue accounting|business finance|strategic finance|investment analyst|payroll)\b/.test(t)) return "Financial analyst";
  if (/\b(recruit|recruiter|talent acquisition|talent partner|sourcer|human resources|\bhr\b|hrbp|people partner|people business partner|people operations|people partner|total rewards|compensation|benefits (manager|specialist|analyst)|learning (and|&) development|employee experience|people experience|workforce planning|diversity|dei\b)/.test(t)) return "Human resources";
  if (/\b(marketing|brand|growth marketer|seo|sem\b|content (strategist|marketing|lead|manager|writer)|communications|public relations|\bpr\b|demand gen|lifecycle|community manager|social media|influencer|copywriter|creative (director|producer)|editorial|events? marketing|field marketing|partner marketing)\b/.test(t)) return "Marketing";
  if (/\b(operations|operator|business operations|biz ?ops|supply chain|logistics|ops (manager|lead|analyst|specialist)|chief of staff|fulfillment|procurement|facilities|workplace|program operations|strategy (and|&) operations|revenue operations|sales operations|trust (and|&) safety operations|support operations|operations (manager|analyst|lead|associate|specialist|director))\b/.test(t)) return "Operations";
  return null;
}

// ---- Job normalization --------------------------------------------------
export interface RawJob { company: string; title: string; location: string; department: string; url: string; posted?: string | null; updated?: string | null; remote?: boolean | null }

const iso = (s?: string | number | null) => {
  if (s === undefined || s === null || s === "") return null;
  const d = new Date(typeof s === "number" ? s : String(s));
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export function normalizeJob(j: RawJob, opts: { assumeUS?: boolean } = {}) {
  const loc = (j.location || "").trim();
  const dept = (j.department || "").trim();
  const family = roleFamily(j.title, dept);
  if (!family) return null;
  if (!opts.assumeUS && !isUS(loc)) return null;
  const remote = j.remote != null ? !!j.remote : /\bremote\b/i.test(loc + " " + j.title);
  let states = findStates(loc);
  if (!states.length) states = remote ? ["Remote (US)"] : ["Unspecified"];
  return {
    company: j.company.trim(), title: j.title.trim(), location: loc, states,
    department: dept || inferDepartment(j.title), department_inferred: !dept,
    role: family, domains: findDomains(j.title, dept), example: false,
    seniority: seniority(j.title), remote, posted: iso(j.posted), updated: iso(j.updated),
    url: j.url.trim(), salary_min: null, salary_max: null,
  };
}
export type Job = NonNullable<ReturnType<typeof normalizeJob>>;
