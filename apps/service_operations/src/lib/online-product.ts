export interface MarketPriceResult {
  title: string;
  price: number;
  currency: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string;
}

export interface OnlineProductDetails {
  title: string;
  imageUrl: string;
  imageUrls: string[];
  price: number;
  currency: string;
  sourceName: string;
  sourceUrl: string;
  specifications: string;
  searchedAt: string;
  marketPrices: MarketPriceResult[];
  marketPriceMin: number;
  marketPriceMax: number;
  marketPriceMedian: number;
  marketPriceSampleCount: number;
  matchConfidence: number;
  matchReason: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36';
const LOOKUP_CACHE = new Map<string, { at:number; value:OnlineProductDetails }>();
const LOOKUP_CACHE_TTL = 15 * 60 * 1000;
const GENERIC = new Set(['the','and','for','with','from','india','price','prices','specification','specifications','specs','model','make','instrument','instruments','machine','equipment','meter','device','digital','online','buy','sale','supplier','suppliers','manufacturer','manufacturers']);

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function stripHtml(value: string) {
  return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeToken(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function tokens(value: string) { return stripHtml(value).toLowerCase().split(/[^a-z0-9]+/).map(normalizeToken).filter(x => x.length > 1); }
function unique<T>(values: T[]) { return [...new Set(values)]; }
function meaningfulTokens(value: string) { return unique(tokens(value).filter(t => !GENERIC.has(t))); }
function distinctiveModelTokens(value: string) {
  // Keep the meaningful model/brand chunks even when the bill uses slash-separated
  // internal codes such as DTECH/WLR/T/W. Single-letter suffixes are intentionally
  // ignored because they are too ambiguous on the public web.
  const raw = unique(String(value || '').toLowerCase().split(/[^a-z0-9]+/).map(normalizeToken).filter(t => t.length >= 2 && !['model','make','type','series','digital','instrument','meter'].includes(t)));
  const coded = raw.filter(t => /\d/.test(t) && t.length >= 2);
  return coded.length ? unique([...coded, ...raw.filter(t => t.length >= 3)]) : raw.filter(t => t.length >= 3);
}
function modelHasNumericIdentity(value: string) {
  return distinctiveModelTokens(value).some(t => /\d/.test(t));
}
function modelQueryVariants(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const chunks = unique(raw.split(/[^a-z0-9]+/i).map(x => x.trim()).filter(x => x.length >= 2));
  const strong = chunks.filter(x => x.length >= 3);
  return unique([
    raw,
    raw.replace(/[\/_-]+/g, ' ').replace(/\s+/g, ' ').trim(),
    strong.join(' '),
    strong[0] || '',
    strong[1] || ''
  ].filter(Boolean));
}
const MEASUREMENT_TOKEN = /^\d+(?:\.\d+)?(?:mm|cm|m|km|ft|in|kg|g|mg|v|kv|a|ma|hz|khz|mhz|ghz|bar|psi|ml|l|c)?$/i;
function expandedTokenSet(value: string) {
  const out = new Set<string>();
  for (const t of tokens(value)) {
    out.add(t);
    // Make "50 m" and "50m" equivalent. This was the main cause of valid
    // tape-length products being rejected by the strict matcher.
    const m = t.match(/^(\d+(?:\.\d+)?)(mm|cm|m|km|ft|in|kg|g|mg|v|kv|a|ma|hz|khz|mhz|ghz|bar|psi|ml|l|c)$/i);
    if (m) out.add(m[1]);
  }
  return out;
}
function coverage(haystack: string, wanted: string[]) {
  if (!wanted.length) return 1;
  const hay = expandedTokenSet(haystack);
  return wanted.filter(t => {
    if (hay.has(t)) return true;
    const m = t.match(/^(\d+(?:\.\d+)?)(mm|cm|m|km|ft|in|kg|g|mg|v|kv|a|ma|hz|khz|mhz|ghz|bar|psi|ml|l|c)$/i);
    return Boolean(m && hay.has(m[1]));
  }).length / wanted.length;
}
function compactAlphaNum(value: string) { return stripHtml(value).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function editDistance(a: string, b: string) {
  const aa = a.toLowerCase(), bb = b.toLowerCase();
  const row = Array.from({length: bb.length + 1}, (_, i) => i);
  for (let i = 1; i <= aa.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= bb.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (aa[i - 1] === bb[j - 1] ? 0 : 1));
      prev = saved;
    }
  }
  return row[bb.length];
}
function modelCandidates(haystack: string) {
  const raw = tokens(haystack).filter(t => t.length >= 2).slice(0, 220);
  const stem = (t: string) => t.replace(/^technologies$/i, 'tech').replace(/^technology$/i, 'tech');
  const out = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const a = stem(raw[i]); out.add(a);
    if (i + 1 < raw.length) out.add(a + stem(raw[i + 1]));
  }
  return [...out];
}
function modelCoverage(haystack: string, wanted: string[]) {
  if (!wanted.length) return 1;
  const hayTokens = expandedTokenSet(haystack);
  const compact = compactAlphaNum(haystack);
  const candidates = modelCandidates(haystack);
  return wanted.filter(t => {
    if (hayTokens.has(t) || compact.includes(t)) return true;
    // Safe typo/brand formatting recovery is alphabetic only. Numeric model codes
    // remain exact so WLR-100 can never silently match WLR-200.
    if (!/^[a-z]{5,}$/i.test(t)) return false;
    return candidates.some(c => Math.abs(c.length - t.length) <= 1 && editDistance(c, t) <= 1);
  }).length / wanted.length;
}
function normalizedPhrase(value: string) { return tokens(value).join(' '); }
function modelLikeTokens(value: string) {
  // Dimensions such as 50m/100mm are specifications, not competing model numbers.
  return unique(tokens(value).filter(t => /[a-z]/i.test(t) && /\d/.test(t) && t.length >= 3 && !MEASUREMENT_TOKEN.test(t)));
}
function numericSpecTokens(value: string) {
  return unique(tokens(value).filter(t => /^\d+(?:\.\d+)?$/.test(t)));
}
function safeProductOnlyFallback(row: { url:string; data: ReturnType<typeof extractStructured> }, productName: string) {
  const core = meaningfulTokens(productName);
  const titleText = `${row.data.title} ${decodeURIComponentSafe(row.url)}`;
  const fullText = `${titleText} ${row.data.specifications}`;
  const productCoverage = coverage(fullText, core);
  const titleCoverage = coverage(titleText, core);
  const criticalNumbers = numericSpecTokens(productName);
  const hay = expandedTokenSet(fullText);
  const specsMatch = criticalNumbers.every(t => hay.has(t));
  const competingModels = modelLikeTokens(row.data.title);
  // Product-only recovery is intentionally conservative: it is only for pages that
  // strongly match the product + critical numeric spec (e.g. 50 m) and do not publish
  // a competing alphanumeric model number.
  return productCoverage >= 0.78 && titleCoverage >= 0.5 && specsMatch && competingModels.length === 0;
}
function searchVariants(value: string) {
  const raw = String(value || '').trim();
  const spaced = raw.replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  const unitJoined = spaced.replace(/(\d+(?:\.\d+)?)\s+(mm|cm|m|km|ft|in|kg|g|mg|v|kv|a|ma|hz|khz|mhz|ghz|bar|psi|ml|l)\b/gi, '$1$2');
  return unique([raw, spaced, unitJoined].filter(Boolean));
}

async function fetchText(url: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow', cache: 'no-store', signal: controller.signal,
      headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml')) throw new Error('Not HTML');
    return { html: await res.text(), finalUrl: res.url };
  } finally { clearTimeout(timer); }
}

function extractMeta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const p of patterns) { const m = html.match(p); if (m?.[1]) return decodeHtml(m[1].trim()); }
  return '';
}

function toAbsoluteUrl(value: string, base: string) {
  try { const u = new URL(decodeHtml(value), base); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; }
}

function parsePriceText(text: string) {
  const normalized = stripHtml(text).replace(/,/g, '');
  const patterns = [
    /(?:₹|INR|Rs\.?|MRP\s*[:\-]?)\s*([0-9]{2,9}(?:\.\d{1,2})?)/i,
    /([0-9]{2,9}(?:\.\d{1,2})?)\s*(?:INR|rupees?)/i
  ];
  for (const p of patterns) {
    const m = normalized.match(p); if (!m) continue;
    const n = Number(m[1]); if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function collectJsonLd(html: string) {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const parsed = JSON.parse(decodeHtml(m[1]).trim()); Array.isArray(parsed) ? out.push(...parsed) : out.push(parsed); } catch { /* malformed retailer JSON-LD */ }
  }
  return out;
}

function walk(value: any, fn: (obj: any) => void) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  if (Array.isArray(value)) value.forEach(v => walk(v, fn)); else Object.values(value).forEach(v => walk(v, fn));
}

function extractStructured(html: string, baseUrl: string, wanted: string) {
  let title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title');
  const images: string[] = [];
  const addImage = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return;
    const abs = toAbsoluteUrl(v.trim(), baseUrl);
    if (!abs || /logo|icon|sprite|avatar|banner|placeholder|1x1/i.test(abs)) return;
    if (!images.includes(abs) && images.length < 10) images.push(abs);
  };
  addImage(extractMeta(html, 'og:image')); addImage(extractMeta(html, 'twitter:image'));
  let price = 0; let currency = 'INR'; const specs: string[] = [];
  for (const root of collectJsonLd(html)) {
    walk(root, (obj) => {
      if (!title && typeof obj.name === 'string') title = obj.name;
      const image = obj.image;
      if (Array.isArray(image)) image.forEach((v: any) => addImage(typeof v === 'string' ? v : v?.url));
      else if (typeof image === 'string') addImage(image); else if (image?.url) addImage(image.url);
      const offer = obj.offers; const offers = Array.isArray(offer) ? offer : offer ? [offer] : [];
      for (const o of offers) {
        const candidate = Number(String(o?.price ?? o?.lowPrice ?? '').replace(/,/g, ''));
        if (!price && Number.isFinite(candidate) && candidate > 0) price = candidate;
        if (typeof o?.priceCurrency === 'string') currency = o.priceCurrency;
      }
      const props = Array.isArray(obj.additionalProperty) ? obj.additionalProperty : [];
      for (const prop of props) {
        const k = String(prop?.name || '').trim(), v = String(prop?.value || '').trim();
        if (k && v && specs.length < 16 && !specs.includes(`${k}: ${v}`)) specs.push(`${k}: ${v}`);
      }
      if (specs.length < 3 && typeof obj.description === 'string') {
        const desc = stripHtml(obj.description).slice(0, 1000); if (desc && !specs.includes(desc)) specs.push(desc);
      }
    });
  }
  // Add only <img> elements whose ALT text strongly matches the requested product.
  // Support the lazy-loading attributes used by IndiaMART and many B2B catalog sites.
  const wantedCore = meaningfulTokens(wanted);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = (tag.match(/\balt=["']([^"']+)["']/i)?.[1] || '').trim();
    if (wantedCore.length && alt && coverage(alt, wantedCore) < Math.min(0.67, Math.max(0.45, 2 / wantedCore.length))) continue;
    let src = tag.match(/\b(?:data-src|data-original|data-lazy-src|data-image|src)=["']([^"']+)["']/i)?.[1] || '';
    if (!src) {
      const srcset = tag.match(/\b(?:data-srcset|srcset)=["']([^"']+)["']/i)?.[1] || '';
      src = srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
    }
    if (src) addImage(src);
  }
  // Some modern product pages expose the real product image only inside JSON/state.
  // Because this extraction runs only after the page identity is verified, these URLs
  // are safe fallbacks and prevent a blank image when <img> is JS-rendered.
  if (!images.length) {
    for (const m of html.matchAll(/["'](?:image|imageUrl|image_url|originalImage|largeImage)["']\s*:\s*["'](https?:\/\/[^"']+?\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) {
      addImage(m[1].replace(/\\\//g, '/'));
      if (images.length >= 4) break;
    }
  }
  if (!price) {
    const metaPrice = extractMeta(html, 'product:price:amount') || extractMeta(html, 'og:price:amount');
    const n = Number(String(metaPrice || '').replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) price = n;
  }
  if (!price) {
    const itemPrice = html.match(/(?:itemprop=["']price["'][^>]*(?:content|value)=["']([0-9][0-9,.]*)["']|(?:content|value)=["']([0-9][0-9,.]*)["'][^>]*itemprop=["']price["'])/i);
    const n = Number(String(itemPrice?.[1] || itemPrice?.[2] || '').replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) price = n;
  }
  // Retailer pages frequently lazy-load product photos without og:image or
  // JSON-LD. Recover those images only when the image tag itself is related to the
  // requested product, so logos/banners are not promoted to the service form.
  if (!images.length) {
    const wantedTokens = meaningfulTokens(wanted);
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const alt = decodeHtml(tag.match(/\b(?:alt|title)=["']([^"']*)["']/i)?.[1] || '');
      const candidate = tag.match(/\b(?:data-original|data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] || '';
      if (!candidate) continue;
      const related = wantedTokens.length === 0 || coverage(`${alt} ${candidate}`, wantedTokens) >= Math.min(0.5, wantedTokens.length <= 2 ? 0.5 : 0.34);
      if (!related) continue;
      addImage(candidate);
      if (images.length >= 4) break;
    }
  }
  if (!price) price = parsePriceText(html.slice(0, 350000));
  if (!title) { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); title = m ? stripHtml(m[1]) : ''; }
  if (!specs.length) { const desc = extractMeta(html, 'description') || extractMeta(html, 'og:description'); if (desc) specs.push(stripHtml(desc).slice(0, 1000)); }
  return { title: stripHtml(title).slice(0, 220), imageUrl: images[0] || '', imageUrls: images, price, currency, specifications: specs.filter(Boolean).slice(0, 16).join('\n') };
}

function ddgTarget(href: string) {
  const decoded = decodeHtml(href);
  try { const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, 'https://duckduckgo.com'); const uddg = url.searchParams.get('uddg'); return uddg ? decodeURIComponent(uddg) : url.toString(); } catch { return ''; }
}

async function searchDdg(query: string, limit = 12) {
  const { html } = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, 3500);
  const urls: string[] = [];
  for (const m of html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["']/gi)) {
    const target = ddgTarget(m[1]); if (target && /^https?:\/\//i.test(target) && !urls.includes(target)) urls.push(target); if (urls.length >= limit) break;
  }
  return urls;
}

async function searchBing(query: string, limit = 12) {
  const { html } = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=in&setlang=en`, 3500);
  const urls: string[] = [];
  for (const m of html.matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["']/gi)) {
    const target = decodeHtml(m[1]); if (/^https?:\/\//i.test(target) && !urls.includes(target)) urls.push(target); if (urls.length >= limit) break;
  }
  return urls;
}

async function searchGoogle(query: string, limit = 12) {
  const { html } = await fetchText(`https://www.google.com/search?hl=en&gl=in&num=10&filter=0&q=${encodeURIComponent(query)}`, 3500);
  const urls: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    let href = decodeHtml(m[1]);
    if (href.startsWith('/url?')) {
      try { href = new URL(href, 'https://www.google.com').searchParams.get('q') || ''; } catch { href = ''; }
    }
    if (!/^https?:\/\//i.test(href) || /google\./i.test(new URL(href).hostname)) continue;
    if (!urls.includes(href)) urls.push(href);
    if (urls.length >= limit) break;
  }
  return urls;
}

async function searchIndiaMartDirect(query: string, limit = 12) {
  const { html } = await fetchText(`https://dir.indiamart.com/search.mp?ss=${encodeURIComponent(query)}`, 4500);
  const urls: string[] = [];
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = toAbsoluteUrl(m[1], 'https://dir.indiamart.com/');
    if (!href || !/indiamart\.com/i.test(href) || /search\.mp|\/impcat\//i.test(href)) continue;
    if (!urls.includes(href)) urls.push(href);
    if (urls.length >= limit) break;
  }
  return urls;
}

interface SearchIndexCard { url:string; title:string; snippet:string; imageUrl?:string; }

async function searchBingCards(query: string, limit = 10): Promise<SearchIndexCard[]> {
  const { html } = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=in&setlang=en`, 3500);
  const cards: SearchIndexCard[] = [];
  for (const block of html.matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const body = block[1];
    const link = body.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = decodeHtml(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripHtml(link[2]);
    const snippet = stripHtml(body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || body.match(/<div[^>]+class=["'][^"']*b_caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    cards.push({ url, title, snippet });
    if (cards.length >= limit) break;
  }
  return cards;
}

async function searchDdgCards(query: string, limit = 10): Promise<SearchIndexCard[]> {
  const { html } = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, 3500);
  const cards: SearchIndexCard[] = [];
  for (const block of html.matchAll(/<div[^>]+class=["'][^"']*result[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["'][^"']*result|$)/gi)) {
    const body = block[1];
    const link = body.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = ddgTarget(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripHtml(link[2]);
    const snippet = stripHtml(body.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] || '');
    cards.push({ url, title, snippet });
    if (cards.length >= limit) break;
  }
  return cards;
}

async function searchBingImages(query: string, limit = 10): Promise<SearchIndexCard[]> {
  const { html } = await fetchText(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&cc=in&setlang=en&form=HDRSC3`, 4500);
  const cards: SearchIndexCard[] = [];
  for (const m of html.matchAll(/<a[^>]+class=["'][^"']*iusc[^"']*["'][^>]+\bm=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const meta = JSON.parse(decodeHtml(m[1]));
      const url = String(meta.purl || meta.surl || '').trim();
      const imageUrl = String(meta.murl || '').trim();
      const title = stripHtml(String(meta.t || meta.desc || ''));
      if (!/^https?:\/\//i.test(url) || !/^https?:\/\//i.test(imageUrl)) continue;
      cards.push({ url, imageUrl, title, snippet:'' });
      if (cards.length >= limit) break;
    } catch { /* Bing image metadata changes occasionally */ }
  }
  return cards;
}

function identity(row: { url:string; data: ReturnType<typeof extractStructured> }, productName: string, makeModel: string) {
  const core = meaningfulTokens(productName);
  const model = distinctiveModelTokens(makeModel);
  const titleText = `${row.data.title} ${decodeURIComponentSafe(row.url)}`;
  const fullText = `${titleText} ${row.data.specifications}`;
  const productCoverage = coverage(fullText, core);
  const titleCoverage = coverage(titleText, core);
  const modelCoverageValue = model.length ? modelCoverage(fullText, model) : 1;
  const modelTitleCoverage = model.length ? modelCoverage(titleText, model) : 1;
  const wantedPhrase = normalizedPhrase([productName, makeModel].filter(Boolean).join(' '));
  const titlePhrase = normalizedPhrase(row.data.title);
  const exactPhrase = Boolean(wantedPhrase && titlePhrase.includes(wantedPhrase));
  const candidateModels = modelLikeTokens(row.data.title);
  const conflictingModels = model.length ? candidateModels.filter(t => !model.includes(t) && !core.includes(t)) : [];
  const genericPage = /\/search|\/impcat|category|categories|catalogue|catalog\b|suppliers?\b/i.test(row.url) && !/product|proddetail/i.test(row.url);

  let identityScore = productCoverage * 5 + titleCoverage * 3 + modelCoverageValue * 5 + modelTitleCoverage * 2;
  if (exactPhrase) identityScore += 3;
  if (row.data.price > 0) identityScore += 1;
  if (row.data.imageUrl) identityScore += 1;
  if (row.data.specifications) identityScore += 0.75;
  if (/indiamart\.com/i.test(row.url)) identityScore += 0.5;
  if (conflictingModels.length) identityScore -= Math.min(6, conflictingModels.length * 2.5);
  if (genericPage) identityScore -= 2;

  const minProduct = core.length <= 1 ? 1 : core.length === 2 ? 0.5 : 0.6;
  const numericModel = modelHasNumericIdentity(makeModel);
  // Keep real numeric/alphanumeric model numbers strict. Alphabetic slash-style
  // internal codes are frequently shortened by supplier pages, so one strong model
  // or brand chunk in the title is enough when the product identity itself is strong.
  const requiredModelCoverage = numericModel ? (model.length === 1 ? 1 : 0.67) : (model.length ? Math.min(0.5, 1 / model.length) : 1);
  const requiredTitleModelCoverage = numericModel ? 0.5 : (model.length ? Math.min(0.5, 1 / model.length) : 1);
  const strictModel = model.length ? modelCoverageValue >= requiredModelCoverage && modelTitleCoverage >= requiredTitleModelCoverage : true;
  // A supplier may title the page simply "Water Level Indicator" while placing tape
  // length/model information in the specification table. When the full page strongly
  // matches both product and model, allow that shorter title without accepting a
  // conflicting model or category/search page.
  const requiredProductTitleCoverage = productCoverage >= 0.8 && strictModel ? Math.min(0.34, minProduct) : Math.min(0.5, minProduct);
  const accepted = productCoverage >= minProduct && titleCoverage >= requiredProductTitleCoverage && strictModel && conflictingModels.length === 0 && !genericPage;
  const confidence = Math.max(0, Math.min(1, (identityScore - 5) / 12));
  return { accepted, confidence, identityScore, productCoverage, modelCoverage:modelCoverageValue, conflictingModels };
}

function decodeURIComponentSafe(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function detailsScore(d: ReturnType<typeof extractStructured>) { return (d.price > 0 ? 1.5 : 0) + (d.imageUrl ? 1 : 0) + (d.specifications ? 0.75 : 0); }
function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Online source'; } }
function median(values: number[]) { const a=[...values].sort((x,y)=>x-y); if (!a.length) return 0; const i=Math.floor(a.length/2); return a.length%2?a[i]:(a[i-1]+a[i])/2; }
function sanePrices(values: number[]) {
  const clean=values.filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b); if (clean.length < 3) return clean;
  const med=median(clean); return clean.filter(v => v >= med/5 && v <= med*5);
}

async function fetchCandidateRows(candidates: string[], productName: string, makeModel: string, limit = 12) {
  const wanted = [productName, makeModel].filter(Boolean).join(' ').trim();
  const uniqueUrls = unique(candidates).slice(0, limit);
  const fetched = await Promise.allSettled(uniqueUrls.map(async (url) => {
    const page = await fetchText(url, 5000);
    const finalUrl = page.finalUrl || url;
    const data = extractStructured(page.html, finalUrl, wanted);
    const match = identity({ url:finalUrl, data }, productName, makeModel);
    return { url: finalUrl, data, ...match, score: match.identityScore + detailsScore(data) };
  }));
  return fetched
    .filter((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled')
    .map(x => x.value)
    .filter(x => x.accepted)
    .sort((a,b) => b.score - a.score);
}

async function searchIndexRows(queries: string[], productName: string, makeModel: string, wantImages = false) {
  const jobs = queries.slice(0, 5).flatMap(q => wantImages ? [searchBingImages(q, 8)] : [searchBingCards(q, 8), searchDdgCards(q, 8)]);
  const settled = await Promise.allSettled(jobs);
  const cards: SearchIndexCard[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const card of result.value) {
      const key = `${card.url}|${card.imageUrl || ''}`;
      if (seen.has(key)) continue;
      seen.add(key); cards.push(card);
      if (cards.length >= 24) break;
    }
  }
  const wanted = [productName, makeModel].filter(Boolean).join(' ').trim();
  return cards.map(card => {
    const combined = `${card.title} ${card.snippet}`;
    const data = {
      title:card.title || wanted,
      imageUrl:card.imageUrl || '',
      imageUrls:card.imageUrl ? [card.imageUrl] : [],
      price:wantImages ? 0 : parsePriceText(combined),
      currency:'INR',
      specifications:card.snippet || ''
    };
    const match = identity({ url:card.url, data }, productName, makeModel);
    return { url:card.url, data, ...match, score:match.identityScore + detailsScore(data) - (wantImages ? 0.1 : 0.25) };
  }).filter(row => row.accepted).sort((a,b)=>b.score-a.score);
}

async function gatherSearchUrls(queries: string[], domainFilter?: RegExp) {
  const qset = queries.slice(0, 5);
  const jobs = qset.flatMap(q => [searchDdg(q, 8), searchBing(q, 8), searchGoogle(q, 8)]);
  // IndiaMART's own search is a valuable recovery when public search engines do not
  // index a supplier's current product page.
  if (domainFilter) jobs.push(...qset.slice(0, 3).map(q => searchIndiaMartDirect(q.replace(/^site:indiamart\.com\s*/i, ''), 8)));
  const results = await Promise.allSettled(jobs);
  const urls: string[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const u of result.value) {
      if ((!domainFilter || domainFilter.test(u)) && !urls.includes(u)) urls.push(u);
      if (urls.length >= 16) return urls;
    }
  }
  return urls.slice(0, 16);
}

function priceRowsFrom(sourceRows: any[], wanted: string) {
  const out: MarketPriceResult[] = [];
  const seen = new Set<string>();
  for (const row of sourceRows) {
    const currency = String(row.data.currency || 'INR').toUpperCase();
    if (!row.data.price || (currency !== 'INR' && currency !== '₹')) continue;
    const sourceName = host(row.url);
    const key = `${sourceName.toLowerCase()}|${Number(row.data.price).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: row.data.title || wanted, price: Number(row.data.price), currency:'INR', sourceName, sourceUrl:row.url, imageUrl:row.data.imageUrl || '' });
  }
  const accepted = sanePrices(out.map(r => r.price));
  return out.filter(r => accepted.includes(r.price)).slice(0, 6);
}

export async function lookupOnlineProduct(productName: string, makeModel = ''): Promise<OnlineProductDetails> {
  const cleanName = String(productName || '').trim().replace(/^#+\s*/, '');
  const cleanModel = String(makeModel || '').trim().replace(/^#+\s*/, '');
  const wanted = [cleanName, cleanModel].filter(Boolean).join(' ').trim();
  if (!cleanName) throw new Error('Product name is required');
  const cacheKey = `${cleanName.toLowerCase()}|${cleanModel.toLowerCase()}`;
  const cached = LOOKUP_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < LOOKUP_CACHE_TTL) return cached.value;

  const nameVariants = searchVariants(cleanName);
  const modelVariants = searchVariants(cleanModel);
  const modelSearches = modelQueryVariants(cleanModel);
  const nameRaw = nameVariants[0] || cleanName;
  const nameNormalized = nameVariants[nameVariants.length - 1] || cleanName;
  const modelRaw = modelVariants[0] || cleanModel;
  const modelNormalized = modelVariants[modelVariants.length - 1] || cleanModel;
  const majorModel = distinctiveModelTokens(cleanModel).join(' ');
  const modelPrimary = modelSearches[0] || modelRaw;
  const modelShort = modelSearches[2] || modelSearches[1] || majorModel || modelNormalized;
  const modelBrand = modelSearches[3] || '';
  const modelFamily = modelSearches[4] || '';
  const exact = `"${[nameRaw, modelPrimary].filter(Boolean).join(' ')}"`;
  const indiaQueries = unique([
    `site:indiamart.com ${exact} price`,
    cleanModel ? `site:indiamart.com "${modelPrimary}" "${nameNormalized}"` : `site:indiamart.com "${nameNormalized}" price`,
    cleanModel ? `site:indiamart.com ${modelShort} "${nameNormalized}" price` : '',
    cleanModel && modelBrand ? `site:indiamart.com "${modelBrand}" "${nameNormalized}" price` : '',
    cleanModel && modelFamily ? `site:indiamart.com "${modelFamily}" "${nameNormalized}" price` : ''
  ].filter(Boolean));
  const webQueries = unique([
    `${exact} price India specifications`,
    cleanModel ? `"${modelPrimary}" "${nameNormalized}" product price India` : `"${nameNormalized}" product price India`,
    cleanModel ? `${modelShort} ${nameNormalized} price image India` : '',
    cleanModel && modelBrand ? `"${modelBrand}" "${nameNormalized}" price image India` : '',
    cleanModel && modelFamily ? `"${modelFamily}" "${nameNormalized}" price image India` : ''
  ].filter(Boolean));
  // Discover IndiaMART and fallback web candidates concurrently. We only download
  // fallback product pages when IndiaMART is missing a verified image/price/spec.
  const [indiaCandidates, webCandidates] = await Promise.all([
    gatherSearchUrls(indiaQueries, /indiamart\.com/i),
    gatherSearchUrls(webQueries)
  ]);
  // Download IndiaMART and fallback candidate pages concurrently. Identity rules
  // still prefer IndiaMART, but a blocked marketplace no longer delays the fallback.
  let [indiaRows, webRows] = await Promise.all([
    fetchCandidateRows(indiaCandidates, cleanName, cleanModel, 8),
    fetchCandidateRows(webCandidates.filter(u => !/indiamart\.com/i.test(u)), cleanName, cleanModel, 8)
  ]);
  let indiaHasImage = indiaRows.some(r => Boolean(r.data.imageUrl));
  let indiaHasPrice = indiaRows.some(r => Number(r.data.price || 0) > 0);
  let indiaHasSpecs = indiaRows.some(r => Boolean(r.data.specifications));

  // If direct product HTML is blocked, search-index cards can still provide a URL,
  // price/snippet and identity evidence. Run both index fallbacks at the same time.
  const needIndiaIndex = !indiaRows.length || !indiaHasPrice;
  const needWebIndex = !webRows.length || !webRows.some(r => Number(r.data.price || 0) > 0);
  if (needIndiaIndex || needWebIndex) {
    const [indiaIndex, webIndex] = await Promise.all([
      needIndiaIndex ? searchIndexRows(indiaQueries, cleanName, cleanModel, false) : Promise.resolve([]),
      needWebIndex ? searchIndexRows(webQueries, cleanName, cleanModel, false) : Promise.resolve([])
    ]);
    if (indiaIndex.length) indiaRows = [...indiaRows, ...indiaIndex.filter(r => /indiamart\.com/i.test(r.url))].sort((a,b)=>b.score-a.score);
    if (webIndex.length) webRows = [...webRows, ...webIndex.filter(r => !/indiamart\.com/i.test(r.url))].sort((a,b)=>b.score-a.score);
  }

  indiaHasImage = indiaRows.some(r => Boolean(r.data.imageUrl));
  indiaHasPrice = indiaRows.some(r => Number(r.data.price || 0) > 0);
  indiaHasSpecs = indiaRows.some(r => Boolean(r.data.specifications));

  // Last image-only fallback: Bing Images exposes the original image URL and product
  // page URL. We still pass every card through the same strict product+model identity
  // check, so a different model is not accepted just to avoid a blank image.
  if (!indiaHasImage && !webRows.some(r => Boolean(r.data.imageUrl))) {
    const imageRows = await searchIndexRows([...indiaQueries, ...webQueries], cleanName, cleanModel, true);
    const indiaImages = imageRows.filter(r => /indiamart\.com/i.test(r.url));
    if (indiaImages.length) indiaRows = [...indiaRows, ...indiaImages].sort((a,b)=>b.score-a.score);
    else webRows = [...webRows, ...imageRows].sort((a,b)=>b.score-a.score);
  }

  let usedProductOnlyFallback = false;
  // Some internal alphabetic model codes are not published verbatim by marketplaces.
  // If the exact-code pass found nothing, recover only on a very strong product +
  // numeric-spec match, and never when the public page advertises another model code.
  if (!indiaRows.length && !webRows.length && cleanModel && !modelHasNumericIdentity(cleanModel)) {
    const fallbackQueries = unique([
      `site:indiamart.com "${nameNormalized}" price`,
      `"${nameNormalized}" price India`,
      `"${nameNormalized}" image specifications India`
    ]);
    const [fallbackTextRows, fallbackImageRows] = await Promise.all([
      searchIndexRows(fallbackQueries, cleanName, '', false),
      searchIndexRows(fallbackQueries, cleanName, '', true)
    ]);
    const recovered = [...fallbackTextRows, ...fallbackImageRows]
      .filter((row, index, all) => all.findIndex(x => x.url === row.url && x.data.imageUrl === row.data.imageUrl) === index)
      .filter(row => safeProductOnlyFallback(row, cleanName))
      .sort((a,b)=>b.score-a.score);
    if (recovered.length) {
      usedProductOnlyFallback = true;
      const recoveredIndia = recovered.filter(r => /indiamart\.com/i.test(r.url));
      const recoveredWeb = recovered.filter(r => !/indiamart\.com/i.test(r.url));
      if (recoveredIndia.length) indiaRows = recoveredIndia;
      else webRows = recoveredWeb;
    }
  }

  const rows = [...indiaRows, ...webRows].sort((a,b)=>b.score-a.score);
  const bestIndia = indiaRows[0] || null;
  const best = bestIndia || rows[0] || null;

  if (!best) {
    return {
      title:wanted, imageUrl:'', imageUrls:[], price:0, currency:'INR', sourceName:'No verified exact match', sourceUrl:'', specifications:'',
      searchedAt:new Date().toISOString(), marketPrices:[], marketPriceMin:0, marketPriceMax:0, marketPriceMedian:0, marketPriceSampleCount:0,
      matchConfidence:0, matchReason:'No online result passed the strict product/model identity checks.'
    };
  }

  // Exact price must come from one verified product/model listing, never from an
  // average/median. Prefer an IndiaMART listing that contains BOTH the product image
  // and price; otherwise use the best verified IndiaMART price row, then web fallback.
  const indiaMarketPrices = priceRowsFrom(indiaRows, wanted);
  const webMarketPrices = priceRowsFrom(webRows, wanted);
  const marketPrices = indiaMarketPrices.length ? indiaMarketPrices : webMarketPrices;
  const exactSourceRow =
    indiaRows.find(r => Number(r.data.price || 0) > 0 && Boolean(r.data.imageUrl)) ||
    indiaRows.find(r => Number(r.data.price || 0) > 0) ||
    webRows.find(r => Number(r.data.price || 0) > 0 && Boolean(r.data.imageUrl)) ||
    webRows.find(r => Number(r.data.price || 0) > 0) ||
    null;
  const exactOnlinePrice = Math.max(0, Number(exactSourceRow?.data?.price || 0));
  const vals = marketPrices.map(r => r.price);

  // Images come only from high-confidence rows matching the same requested identity.
  // Never mix images from low-confidence or conflicting models. When the exact price
  // row also has an image, that same listing supplies the primary image.
  const trustedRows = rows.filter(r => r.confidence >= Math.max(0.45, best.confidence - 0.12));
  const preferredImageRows = indiaRows.some(r => r.data.imageUrl) ? indiaRows : trustedRows;
  const imageRows = exactSourceRow
    ? [exactSourceRow, ...preferredImageRows.filter(r => r.url !== exactSourceRow.url)]
    : preferredImageRows;
  const imageUrls: string[] = [];
  for (const row of imageRows) {
    if (row.confidence < 0.42) continue;
    for (const img of row.data.imageUrls || []) {
      if (img && !imageUrls.includes(img)) imageUrls.push(img);
      if (imageUrls.length >= 4) break;
    }
    if (imageUrls.length >= 4) break;
  }

  const specificationRow = (exactSourceRow?.data?.specifications ? exactSourceRow : null) || indiaRows.find(r => r.data.specifications) || trustedRows.find(r => r.data.specifications) || best;
  const sourceUrl = exactSourceRow?.url || best.url;
  const sourceLabel = exactSourceRow ? (/indiamart\.com/i.test(exactSourceRow.url) ? 'IndiaMART' : host(exactSourceRow.url)) : (/indiamart\.com/i.test(best.url) ? 'IndiaMART' : host(best.url));
  const confidence = Math.max(0, Math.min(1, Number((exactSourceRow || best).confidence || 0)));

  const result: OnlineProductDetails = {
    title: exactSourceRow?.data?.title || best.data.title || wanted,
    imageUrl: imageUrls[0] || (best.confidence >= 0.42 ? best.data.imageUrl : ''),
    imageUrls,
    price: exactOnlinePrice,
    currency:'INR',
    sourceName:sourceLabel,
    sourceUrl,
    specifications:specificationRow?.data?.specifications || '',
    searchedAt:new Date().toISOString(),
    marketPrices,
    marketPriceMin:vals.length ? Math.min(...vals) : exactOnlinePrice,
    marketPriceMax:vals.length ? Math.max(...vals) : exactOnlinePrice,
    marketPriceMedian:vals.length ? median(vals) : exactOnlinePrice,
    marketPriceSampleCount:vals.length || (exactOnlinePrice > 0 ? 1 : 0),
    matchConfidence:confidence,
    matchReason: usedProductOnlyFallback
      ? 'Internal model code was not published verbatim online. Product identity and critical numeric specification were verified with no competing public model number; review the image before final save.'
      : cleanModel ? 'Exact product name + model verified; the displayed price comes from one matched listing and the repair margin is calculated from that value.' : 'Product identity verified from the product name before accepting price/image.'
  };
  LOOKUP_CACHE.set(cacheKey, { at:Date.now(), value:result });
  return result;
}
