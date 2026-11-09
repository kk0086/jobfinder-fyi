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
  // Employers such as Cloudflare list some roles with only a work-mode word ("Hybrid"); we keep those as location unspecified rather than hide them.
  if (/^\s*(hybrid|distributed|flexible|multiple locations?|various( locations)?|anywhere)\s*$/i.test(loc)) return true;
  return /^\s*remote\s*$/i.test(loc) || /\bremote\b.*\b(us|america|americas)\b|\b(us|usa)\b.*\bremote\b/i.test(loc);
}


// ---- Non-US regions: Canada, United Kingdom, Ireland and EMEA (Europe, Middle East, Africa) ----
const COUNTRIES: [string, string, RegExp][] = [
  ["CA", "Canada", /\b(canada|toronto|vancouver|montreal|montréal|ottawa|calgary|edmonton|winnipeg|quebec|québec|ontario|british columbia|alberta|nova scotia|manitoba|saskatchewan|waterloo, on|mississauga|kitchener)\b/i],
  ["IE", "Ireland", /\b(ireland|dublin|cork|galway|limerick)\b/i],
  ["GB", "United Kingdom", /\b(united kingdom|u\.k\.|uk|england|scotland|wales|northern ireland|london|manchester|edinburgh|glasgow|bristol|leeds|birmingham|belfast|cardiff|oxford|reading, uk|great britain)\b/i],
  ["DE", "Germany", /\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|dusseldorf|leipzig|dresden)\b/i],
  ["FR", "France", /\b(france|paris|lyon|marseille|toulouse|nantes|bordeaux|lille)\b/i],
  ["NL", "Netherlands", /\b(netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague|den haag)\b/i],
  ["ES", "Spain", /\b(spain|españa|madrid|barcelona|valencia|seville|málaga|malaga)\b/i],
  ["PT", "Portugal", /\b(portugal|lisbon|lisboa|porto)\b/i],
  ["IT", "Italy", /\b(italy|italia|milan|milano|rome|roma|turin|torino)\b/i],
  ["BE", "Belgium", /\b(belgium|brussels|antwerp|ghent)\b/i],
  ["LU", "Luxembourg", /\b(luxembourg)\b/i],
  ["CH", "Switzerland", /\b(switzerland|zurich|zürich|geneva|basel|lausanne|zug)\b/i],
  ["AT", "Austria", /\b(austria|vienna|wien|graz|salzburg)\b/i],
  ["SE", "Sweden", /\b(sweden|stockholm|gothenburg|göteborg|malmö|malmo)\b/i],
  ["NO", "Norway", /\b(norway|oslo|bergen)\b/i],
  ["DK", "Denmark", /\b(denmark|copenhagen|københavn|aarhus)\b/i],
  ["FI", "Finland", /\b(finland|helsinki|espoo|tampere)\b/i],
  ["IS", "Iceland", /\b(iceland|reykjavik)\b/i],
  ["PL", "Poland", /\b(poland|warsaw|krakow|kraków|wroclaw|wrocław|gdansk|poznań|poznan)\b/i],
  ["CZ", "Czechia", /\b(czech republic|czechia|prague|praha|brno)\b/i],
  ["SK", "Slovakia", /\b(slovakia|bratislava)\b/i],
  ["HU", "Hungary", /\b(hungary|budapest)\b/i],
  ["RO", "Romania", /\b(romania|bucharest|cluj|iasi)\b/i],
  ["BG", "Bulgaria", /\b(bulgaria|sofia)\b/i],
  ["GR", "Greece", /\b(greece|athens|thessaloniki)\b/i],
  ["HR", "Croatia", /\b(croatia|zagreb)\b/i],
  ["RS", "Serbia", /\b(serbia|belgrade)\b/i],
  ["SI", "Slovenia", /\b(slovenia|ljubljana)\b/i],
  ["LT", "Lithuania", /\b(lithuania|vilnius|kaunas)\b/i],
  ["LV", "Latvia", /\b(latvia|riga)\b/i],
  ["EE", "Estonia", /\b(estonia|tallinn|tartu)\b/i],
  ["UA", "Ukraine", /\b(ukraine|kyiv|kiev|lviv)\b/i],
  ["MT", "Malta", /\b(malta)\b/i],
  ["CY", "Cyprus", /\b(cyprus|nicosia|limassol)\b/i],
  ["TR", "Türkiye", /\b(turkey|türkiye|turkiye|istanbul|ankara)\b/i],
  ["IL", "Israel", /\b(israel|tel aviv|tel-aviv|jerusalem|haifa|herzliya)\b/i],
  ["AE", "United Arab Emirates", /\b(united arab emirates|uae|dubai|abu dhabi)\b/i],
  ["SA", "Saudi Arabia", /\b(saudi arabia|riyadh|jeddah|ksa)\b/i],
  ["QA", "Qatar", /\b(qatar|doha)\b/i],
  ["EG", "Egypt", /\b(egypt|cairo)\b/i],
  ["ZA", "South Africa", /\b(south africa|johannesburg|cape town|pretoria|durban)\b/i],
  ["NG", "Nigeria", /\b(nigeria|lagos|abuja)\b/i],
  ["KE", "Kenya", /\b(kenya|nairobi)\b/i],
  ["MA", "Morocco", /\b(morocco|casablanca|rabat)\b/i],
];
const NAME_OF: Record<string, string> = Object.fromEntries(COUNTRIES.map(([c, n]) => [c, n]));
// Region words that name no single country ("Remote - EMEA", "Europe").
const EMEA_WORD = /\b(emea|europe|european union|\beu\b|middle east|africa|dach|nordics?|benelux)\b/i;

// Returns the ISO country code for a non-US location, "EMEA" for region-wide wording, or "" if none is recognised.
export function countryOf(location: string): string {
  const loc = location || "";
  if (/,\s*(ON|BC|QC|AB|NS|MB|SK)\b/.test(loc)) return "CA"; // province codes are case-sensitive ("Remote, On-site" is not Ontario)
  if (/northern ireland/i.test(loc)) return "GB";
  for (const [code, , re] of COUNTRIES) if (re.test(loc)) return code;
  if (EMEA_WORD.test(loc)) return "EMEA";
  return "";
}
export const countryName = (cc: string) => NAME_OF[cc] || "Europe, Middle East & Africa";
// Which downloadable region a country code belongs to.
export const regionOf = (cc?: string) => !cc ? "us" : cc === "CA" ? "ca" : cc === "GB" ? "uk" : cc === "IE" ? "ie" : "emea";


function explicitUS(loc: string): boolean {
  if (/\b(united states|usa|u\.s\.a?\.?)\b/i.test(loc)) return true;
  for (const m of loc.matchAll(/,\s*([A-Z]{2})\b/g)) if (CODES.has(m[1])) return true;
  const low = loc.toLowerCase();
  for (const name of Object.keys(STATES)) if (name !== "georgia" && new RegExp(`\\b${esc(name)}\\b`).test(low)) return true;
  return false;
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
// Turns a posted pay range into an annual figure; returns null for anything implausible.
export function annualPay(min: any, max: any, interval: string): { min: number; max: number } | null {
  let a = Number(min), b = Number(max);
  if (!(a > 0)) return null;
  if (!(b > 0)) b = a;
  const iv = String(interval || "year").toLowerCase();
  const k = /hour/.test(iv) ? 2080 : /month/.test(iv) ? 12 : /week/.test(iv) ? 52 : /day/.test(iv) ? 260 : 1;
  a *= k; b *= k;
  if (a < 15000 || b > 5_000_000 || b < a) return null;
  return { min: Math.round(a), max: Math.round(b) };
}
// True when a description says the role needs US citizenship or a green card ("Must be a U.S. citizen or green card holder", "US Citizens and Permanent Residents only").
export function waFromText(text: string): boolean {
  if (!text) return false;
  const t = String(text).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  const cit = "(?:u\\.?s\\.?|united states|american)\\s+citizen(?:ship|s)?";
  const gc = "(?:green\\s*card|permanent\\s+resident|lawful\\s+permanent)";
  const res = [
    new RegExp("(?:must|required to|need to|have to|will need to)\\s+(?:be|hold|have)\\s+(?:a\\s+|an\\s+)?(?:current\\s+)?" + cit, "i"),
    new RegExp(cit + "\\s+(?:or|and|/)\\s+(?:a\\s+)?" + gc + "[^.]{0,40}(?:only|required|must)", "i"),
    new RegExp("(?:only|limited to|restricted to|open to)\\s+(?:u\\.?s\\.?\\s+)?citizens?[^.]{0,40}" + gc, "i"),
    new RegExp("(?:must|required to)\\s+be\\s+(?:a\\s+)?(?:u\\.?s\\.?\\s+)?(?:citizen|national)[^.]{0,30}" + gc, "i"),
    new RegExp(cit + "\\s+(?:is|are)\\s+required", "i"),
    new RegExp("(?:requires?|require)\\s+(?:u\\.?s\\.?|united states)\\s+citizenship", "i"),
    new RegExp("(?:u\\.?s\\.?|united states)\\s+citizenship\\s+(?:is\\s+)?(?:required|mandatory)", "i"),
  ];
  return res.some(r => r.test(t));
}
// Pay range plus the work-authorization flag, in the shape readers spread into a RawJob.
export function descInfo(text: string): { salary_min?: number; salary_max?: number; salary_cur?: string; wa?: boolean } {
  return { ...(payFromText(text) || {}), ...(waFromText(text) ? { wa: true } : {}) };
}
// Finds a posted USD pay range in free text ("The base pay range is $150,000 - $200,000"). Returns null when there is no clear range.
export function payFromText(text: string): { salary_min: number; salary_max: number; salary_cur: string } | null {
  if (!text) return null;
  const t = String(text).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const re = /(?<![A-Za-z])\$\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s?[kK])\b/g;
  const amt = (x: string) => /k$/i.test(x.trim()) ? parseFloat(x) * 1000 : parseFloat(x.replace(/,/g, ""));
  const hits: { i: number; end: number; v: number }[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(t))) hits.push({ i: m.index, end: m.index + m[0].length, v: amt(m[1]) });
  for (let k = 0; k + 1 < hits.length; k++) {
    const a = hits[k], b = hits[k + 1];
    if (b.i - a.end > 140 || a.v < 30000 || b.v <= a.v || b.v > a.v * 4 || b.v > 3_000_000) continue;
    if (/\b(per hour|hourly|\/hr|\/hour)\b/i.test(t.slice(a.end, b.end + 30))) continue;
    if (!/(salary|pay|compensation|base|range|earn|wage)/i.test(t.slice(Math.max(0, a.i - 400), a.i + 20))) continue;
    return { salary_min: Math.round(a.v), salary_max: Math.round(b.v), salary_cur: "USD" };
  }
  // Pay stated by location instead of as one range ("$212,000 in SF, $201,500 in Austin and $180,000 elsewhere"):
  // take the lowest and highest figures of the first cluster of amounts that follows a pay keyword.
  for (let k = 0; k < hits.length; k++) {
    const a = hits[k];
    if (a.v < 30000 || a.v > 3_000_000) continue;
    if (!/(salary|salaries|pay|compensation|base)/i.test(t.slice(Math.max(0, a.i - 300), a.i))) continue;
    const grp = [a];
    for (let m = k + 1; m < hits.length && hits[m].i - grp[grp.length - 1].end <= 160; m++) grp.push(hits[m]);
    if (grp.length < 2) continue;
    const vals = grp.map(g => g.v).filter(v => v >= 30000 && v <= 3_000_000);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (vals.length < 2 || hi === lo || hi > lo * 2 || /\b(per hour|hourly|\/hr|\/hour)\b/i.test(t.slice(a.end, grp[grp.length - 1].end + 30))) continue;
    return { salary_min: Math.round(lo), salary_max: Math.round(hi), salary_cur: "USD" };
  }
  return null;
}
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
  "UX design", "Human resources", "Legal", "Financial analyst", "Bizdev", "Marketing", "Customer support", "Sales", "Supply chain & logistics", "Operations", "Executive leadership",
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
  if (/\b(customer (support|service|care|success|experience|happiness|advocate|champion)|client (support|services?|success)|support (specialist|agent|representative|engineer|analyst|associate|lead|technician)|technical support|help ?desk|contact cent(?:er|re)|call cent(?:er|re)|care (specialist|agent|advocate|associate)|member (support|services?)|guest (support|services?|experience)|service desk|community support|tier [123] support)\b/.test(t) && !/\b(operations|marketing|counsel|attorney|recruit|software)\b/.test(t)) return "Customer support";
  if ((/\b(business development|biz ?dev|bd (manager|lead|director|associate|partner|head)|partnerships?|partner (manager|lead|director|development|success|alliances?)|alliances?|channel (manager|partner|lead|director|sales)|corporate development|corp dev|growth|strategic (partner|alliance)|ecosystem (manager|lead|partner)|market development|licensing)\b/.test(t) || /^(business development|biz ?dev|partnerships?|alliances?)$/i.test(department || "")) && !/\b(marketing|recruit|recruiter|counsel|attorney|legal|engineer|developer|designer|analyst intern)\b/.test(t)) return "Bizdev";
  if (/\b(marketing|brand|growth marketer|seo|sem\b|content (strategist|marketing|lead|manager|writer)|communications|public relations|\bpr\b|demand gen|lifecycle|community manager|social media|influencer|copywriter|creative (director|producer)|editorial|events? marketing|field marketing|partner marketing)\b/.test(t)) return "Marketing";
  if (/\b(sales|account (executive|manager|director|representative)|sdr|bdr|solutions? (engineer|consultant|architect)|pre-?sales|territory (manager|representative)|client partner)\b/.test(t) && !/\b(operations|ops|marketing|recruit|counsel|attorney|analyst intern)\b/.test(t)) return "Sales";
  if (/\b(supply chain|logistics|warehouse|warehousing|distribution (center|centre|associate|manager|operations)|fulfil?lment|inventory|procurement|purchasing|buyer|demand planner|demand planning|supply planner|supply planning|transportation|freight|shipping|receiving|material handler|forklift|delivery (driver|associate)|driver|courier|fleet|dispatch|mechanic|returns|order picker|picker|packer|stocker|load(er)?)\b/.test(t) || /\b(distribution|warehous|logistics|supply chain|fulfil?lment)\b/i.test(department || "")) { if (!/\b(engineer|developer|sales|marketing|counsel|attorney|recruit|trust|safety)\b/.test(t)) return "Supply chain & logistics"; }
  if (/\b(operations|operator|business operations|biz ?ops|ops (manager|lead|analyst|specialist)|chief of staff|facilities|workplace|program operations|strategy (and|&) operations|revenue operations|sales operations|trust (and|&) safety operations|support operations|operations (manager|analyst|lead|associate|specialist|director))\b/.test(t)) return "Operations";
  if (/\b(trust (and|&|\+) safety|trust ?& ?safety|content moderation|platform integrity|integrity (lead|manager|director|head))\b/.test(t) || /trust (and|&) safety/i.test(department || "")) return "Operations";
  // Leadership titles that fit no other family.
  if (/\b(vice president|vp|executive director|director|svp|senior vice president|chief (product|executive|financial|marketing|operating) officer|ceo|cfo|cmo|coo|cpo)\b/.test(t) && !/\b(assistant|coordinator|admin|administrator|intern)\b/.test(t)) return "Executive leadership";
  return null;
}

// ---- Job normalization --------------------------------------------------
export interface RawJob { company: string; title: string; location: string; department: string; url: string; posted?: string | null; updated?: string | null; remote?: boolean | null; salary_min?: number | null; salary_max?: number | null; salary_cur?: string | null; gh_id?: number | string | null; wa?: boolean }

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
  let cc = "";
  if (!opts.assumeUS) {
    const c0 = countryOf(loc);
    // An explicit US marker (state code or name, "United States") wins; a city name alone ("Cambridge, UK") does not.
    const nonUS = c0 && (/,\s*(ON|BC|QC|AB|NS|MB|SK)\b/.test(loc) || !explicitUS(loc));
    if (nonUS) cc = c0; else if (!isUS(loc)) return null;
  }
  const remote = j.remote != null ? !!j.remote : /\bremote\b/i.test(loc + " " + j.title);
  let states = cc ? [countryName(cc)] : findStates(loc);
  if (!states.length) states = remote ? ["Remote (US)"] : ["Unspecified"];
  return {
    company: j.company.trim(), title: j.title.trim(), location: loc, states,
    department: dept || inferDepartment(j.title), department_inferred: !dept,
    role: family, domains: findDomains(j.title, dept), example: false,
    seniority: seniority(j.title), remote, posted: iso(j.posted), updated: iso(j.updated),
    url: j.url.trim(), salary_min: j.salary_min ?? null, salary_max: j.salary_max ?? null, ...(j.salary_min ? { salary_cur: (j.salary_cur || "USD").toUpperCase() } : {}), ...(j.gh_id ? { gh_id: j.gh_id } : {}), ...(cc ? { cc } : {}), ...(j.wa ? { wa: 1 } : {}),
  };
}
export type Job = NonNullable<ReturnType<typeof normalizeJob>>;
