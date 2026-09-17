import fs from 'fs/promises';
import path from 'path';
import { getDefaultGoogleOAuthClient } from './default-google-oauth';
import { DATA_DIR, JOBS_FILE, SETTINGS_FILE, UPLOADS_DIR } from './paths';
import { DEFAULT_SETTINGS } from './defaults';
import type { AppSettings, EstimateStatus, JobStatus, JobsDatabase, RepairCategory, ServiceJob, ServiceProduct } from '@/types/service-job';

let writeChain: Promise<void> = Promise.resolve();
let ensurePromise: Promise<void> | null = null;
let dbCache: JobsDatabase | null = null;
let settingsCache: AppSettings | null = null;

const VALID_STATUSES = new Set<JobStatus>([
  'DRAFT','RECEIVED','ESTIMATE_PENDING','APPROVAL_PENDING','REPAIRING','READY','DISPATCHED','CLOSED'
]);
const VALID_REPAIR_CATEGORIES = new Set<RepairCategory>(['MINIMUM_30','MAXIMUM_50']);
const VALID_ESTIMATE_STATUSES = new Set<EstimateStatus>(['PENDING_PRICE','PRICE_CONFIRMED','ESTIMATE_READY','SENT_TO_CUSTOMER','APPROVED']);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function tryReadJson<T>(file: string, attempts = 4): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown = new Error('JSON file is empty.');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const text = await fs.readFile(file, 'utf8');
      if (!text.trim()) throw new Error('JSON file is empty.');
      return { ok: true, value: JSON.parse(text) as T };
    } catch (error) {
      lastError = error;
      // A previous build could be replacing/copying a JSON file at the same moment.
      // Brief retries prevent a temporary zero-byte/truncated view becoming a hard failure.
      if (attempt + 1 < attempts) await wait(45 * (attempt + 1));
    }
  }
  return { ok: false, error: lastError };
}

async function writeRawJsonAtomic(file: string, payload: unknown) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.repair.tmp`;
  await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
  try { await fs.rename(temp, file); }
  catch {
    await fs.copyFile(temp, file);
    await fs.rm(temp, { force: true });
  }
}

async function recoveryCandidates(file: string): Promise<string[]> {
  const basename = path.basename(file);
  const candidates: string[] = [];
  const sameDir = path.dirname(file);
  try {
    const entries = await fs.readdir(sameDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      const baseLower = basename.toLowerCase();
      if (lower === `${baseLower}.bak` || lower === `${baseLower}.backup` || lower.startsWith(`${baseLower}.good-`)) {
        candidates.push(path.join(sameDir, entry.name));
      }
    }
  } catch { /* no sibling recovery files */ }

  // Main-server migration always makes versioned copies here before replacing data.
  // Look only on corruption, so normal startup remains fast.
  let realData = DATA_DIR;
  try { realData = await fs.realpath(DATA_DIR); } catch { /* regular non-junction data folder */ }
  const stateRoot = path.dirname(realData);
  const backupRoot = path.join(stateRoot, 'MainServerBackups');
  try {
    const stamps = await fs.readdir(backupRoot, { withFileTypes: true });
    for (const stamp of stamps) {
      if (!stamp.isDirectory()) continue;
      for (const folder of ['ServiceData', 'Servicing_Gmail_settings_data', 'Servicing___Gmail_settings_data']) {
        candidates.push(path.join(backupRoot, stamp.name, folder, basename));
      }
    }
  } catch { /* no migration backups yet */ }

  const existing: Array<{ file: string; time: number }> = [];
  for (const candidate of candidates) {
    try {
      const st = await fs.stat(candidate);
      if (st.isFile() && st.size > 0) existing.push({ file: candidate, time: st.mtimeMs });
    } catch { /* candidate missing */ }
  }
  return existing.sort((a,b) => b.time - a.time).map(item => item.file);
}

async function preserveCorruptFile(file: string) {
  try {
    const st = await fs.stat(file);
    if (!st.isFile() || st.size === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(file, `${file}.corrupt-${stamp}.bak`);
  } catch { /* best effort; never block the form */ }
}

async function readJsonRecovering<T>(file: string, fallback: T): Promise<T> {
  const current = await tryReadJson<T>(file);
  if (current.ok) return current.value;

  for (const candidate of await recoveryCandidates(file)) {
    const recovered = await tryReadJson<T>(candidate, 1);
    if (!recovered.ok) continue;
    await preserveCorruptFile(file);
    await writeRawJsonAtomic(file, recovered.value);
    return recovered.value;
  }

  // Keep any damaged bytes beside the live file, then self-heal with a safe baseline.
  // This makes the UI usable again without silently deleting the only old copy.
  await preserveCorruptFile(file);
  await writeRawJsonAtomic(file, fallback);
  return fallback;
}

async function ensureData() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await Promise.all([fs.mkdir(DATA_DIR, { recursive:true }), fs.mkdir(UPLOADS_DIR, { recursive:true })]);
      try { await fs.access(JOBS_FILE); }
      catch {
        const initial: JobsDatabase = { version:1, nextSerial:1, jobs:[] };
        await fs.writeFile(JOBS_FILE, JSON.stringify(initial, null, 2), 'utf8');
      }
      try { await fs.access(SETTINGS_FILE); }
      catch { await fs.writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8'); }
    })().catch((error) => { ensurePromise = null; throw error; });
  }
  await ensurePromise;
}

async function atomicWrite(file: string, payload: unknown) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(payload, null, 2);
  await fs.writeFile(temp, json, 'utf8');
  try {
    await fs.rename(temp, file);
  } catch {
    await fs.writeFile(file, json, 'utf8');
    await fs.rm(temp, { force: true });
  }
  if (file === JOBS_FILE) dbCache = normalizeDb(payload as JobsDatabase);
  if (file === SETTINGS_FILE) settingsCache = payload as AppSettings;
}

function normalizeProduct(product: Partial<ServiceProduct>, jobStatus: JobStatus): ServiceProduct {
  const repairCategory: RepairCategory = VALID_REPAIR_CATEGORIES.has(product.repairCategory as RepairCategory)
    ? product.repairCategory as RepairCategory
    : 'MINIMUM_30';
  const presetPercent = repairCategory === 'MAXIMUM_50' ? 50 : 30;
  const rawPercent = Number(product.repairPercent);
  const repairPercent = Number.isFinite(rawPercent) && rawPercent >= 0 && rawPercent <= 100 ? rawPercent : presetPercent;
  const onlinePrice = Math.max(0, Number(product.onlinePrice ?? product.productValue ?? 0));
  const onlinePriceConfirmed = Boolean(product.onlinePriceConfirmed);
  const legacyEstimate = Math.max(0, Number(product.repairEstimate || 0));
  const calculatedEstimate = onlinePrice > 0
    ? Number((onlinePrice * repairPercent / 100).toFixed(2))
    : legacyEstimate;
  const inferredEstimateStatus: EstimateStatus = onlinePriceConfirmed && calculatedEstimate > 0
    ? 'ESTIMATE_READY'
    : onlinePriceConfirmed
      ? 'PRICE_CONFIRMED'
      : 'PENDING_PRICE';
  const estimateStatus = VALID_ESTIMATE_STATUSES.has(product.estimateStatus as EstimateStatus)
    ? product.estimateStatus as EstimateStatus
    : inferredEstimateStatus;

  return {
    id: product.id || crypto.randomUUID(),
    productName: String(product.productName || ''),
    makeModel: String(product.makeModel || ''),
    serialNo: String(product.serialNo || ''),
    qty: Math.max(0, Number(product.qty || 1)),
    status: VALID_STATUSES.has(product.status as JobStatus) ? product.status as JobStatus : jobStatus,
    complaint: String(product.complaint || ''),
    repairWork: String(product.repairWork || ''),
    productValue: onlinePrice > 0 ? onlinePrice : Math.max(0, Number(product.productValue || 0)),
    repairEstimate: calculatedEstimate,
    repairCategory,
    repairPercent,
    onlinePrice,
    onlinePriceSource: String(product.onlinePriceSource || ''),
    onlinePriceConfirmed,
    onlinePriceCheckedAt: String(product.onlinePriceCheckedAt || ''),
    estimateStatus,
    productImageUrl: String(product.productImageUrl || ''),
    productSpecifications: String(product.productSpecifications || ''),
    onlineProductUrl: String(product.onlineProductUrl || ''),
    onlineDetailsTitle: String(product.onlineDetailsTitle || ''),
    onlineDetailsFetchedAt: String(product.onlineDetailsFetchedAt || ''),
    onlineLookupQuery: String(product.onlineLookupQuery || ''),
    productImageUrls: Array.isArray(product.productImageUrls) ? product.productImageUrls.map(String).filter(Boolean).slice(0, 4) : (product.productImageUrl ? [String(product.productImageUrl)] : []),
    marketPriceMin: Math.max(0, Number(product.marketPriceMin || 0)),
    marketPriceMax: Math.max(0, Number(product.marketPriceMax || 0)),
    marketPriceMedian: Math.max(0, Number(product.marketPriceMedian || 0)),
    marketPriceSampleCount: Math.max(0, Math.floor(Number(product.marketPriceSampleCount || 0)))
  };
}

function normalizeJob(job: ServiceJob): ServiceJob {
  // Remove legacy remote-sync metadata from older saved jobs.
  delete (job as any).driveSync;
  if (!VALID_STATUSES.has(job.status)) job.status = 'RECEIVED';
  // V1.0.7 removes the India/Export choice. Existing records remain readable but are treated as India.
  job.marketType = 'INDIA';
  job.customer = {
    ...job.customer,
    country: 'India',
    currency: 'INR'
  };
  job.products = Array.isArray(job.products) ? job.products.map((p) => normalizeProduct(p, job.status)) : [];
  job.totals = calculateTotals(job);
  return job;
}

function normalizeDb(raw: JobsDatabase): JobsDatabase {
  const jobs = Array.isArray(raw?.jobs) ? raw.jobs : [];
  let maxSerial = 0;
  for (const job of jobs) {
    const match = String(job.jobNo || '').match(/-(\d+)$/);
    if (match) maxSerial = Math.max(maxSerial, Number(match[1]) || 0);
    normalizeJob(job);
  }
  return {
    version: 1,
    nextSerial: Math.max(Number(raw?.nextSerial || 1), maxSerial + 1, 1),
    jobs
  };
}

export async function readDb(): Promise<JobsDatabase> {
  if (dbCache) return dbCache;
  await ensureData();
  const raw = await readJsonRecovering<JobsDatabase>(JOBS_FILE, { version:1, nextSerial:1, jobs:[] });
  dbCache = normalizeDb(raw);
  return dbCache;
}

export function mutateDb<T>(fn: (db: JobsDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeChain.catch(() => undefined).then(async () => {
    const db = await readDb();
    const value = await fn(db);
    await atomicWrite(JOBS_FILE, db);
    return value;
  });
  writeChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function getSettings(): Promise<AppSettings> {
  if (settingsCache) return settingsCache;
  await ensureData();
  const raw = await readJsonRecovering<Partial<AppSettings>>(SETTINGS_FILE, DEFAULT_SETTINGS);
  // Server-only default credential. It lives in LOCALAPPDATA on the main server,
  // outside the Git repository, so GitHub never receives the OAuth client secret.
  let bundled: { client_id?: string; client_secret?: string } = {};
  if (!raw.googleOAuthRefreshToken) {
    try { bundled = (await getDefaultGoogleOAuthClient()) || {}; }
    catch { /* Existing uploaded credentials remain available if no local default exists. */ }
  }
  settingsCache = {
    companyName: String(raw.companyName || DEFAULT_SETTINGS.companyName),
    branchNames: Array.isArray(raw.branchNames) && raw.branchNames.length ? raw.branchNames.map(String).filter(Boolean) : DEFAULT_SETTINGS.branchNames,
    defaultBranch: String(raw.defaultBranch || DEFAULT_SETTINGS.defaultBranch),
    autoLookupProductDetails: raw.autoLookupProductDetails !== false,
    autoSendOnSave: true,
    autoSendEmail: true,
    autoSendWhatsApp: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: 'nunuescbe@gmail.com',
    smtpPassword: '',
    senderName: String(raw.senderName || DEFAULT_SETTINGS.senderName),
    // A saved/uploaded OAuth client is an intentional override. The bundled
    // company JSON is only the fallback so the app is ready by default.
    googleOAuthClientId: String(raw.googleOAuthClientId || bundled.client_id || process.env.SERVICEFLOW_GOOGLE_OAUTH_CLIENT_ID || ''),
    googleOAuthClientSecret: String(raw.googleOAuthClientSecret || bundled.client_secret || process.env.SERVICEFLOW_GOOGLE_OAUTH_CLIENT_SECRET || ''),
    googleOAuthRefreshToken: String(raw.googleOAuthRefreshToken || ''),
    googleOAuthEmail: String(raw.googleOAuthEmail || ''),
    formVisionEnabled: (raw as any).formVisionEnabled !== false,
    formVisionModel: String((raw as any).formVisionModel || process.env.GEMINI_MODEL || DEFAULT_SETTINGS.formVisionModel),
    geminiApiKey: String((raw as any).geminiApiKey || process.env.GEMINI_API_KEY || '')
  };
  return settingsCache;
}

export async function saveSettings(settings: AppSettings) {
  await ensureData();
  const normalized: AppSettings = {
    companyName: String(settings.companyName || DEFAULT_SETTINGS.companyName),
    branchNames: Array.isArray(settings.branchNames) && settings.branchNames.length ? settings.branchNames.map(String).filter(Boolean) : DEFAULT_SETTINGS.branchNames,
    defaultBranch: String(settings.defaultBranch || DEFAULT_SETTINGS.defaultBranch),
    autoLookupProductDetails: settings.autoLookupProductDetails !== false,
    autoSendOnSave: true,
    autoSendEmail: true,
    autoSendWhatsApp: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: 'nunuescbe@gmail.com',
    smtpPassword: '',
    senderName: String(settings.senderName || DEFAULT_SETTINGS.senderName),
    googleOAuthClientId: String(settings.googleOAuthClientId || '').trim(),
    googleOAuthClientSecret: String(settings.googleOAuthClientSecret || '').trim(),
    googleOAuthRefreshToken: String(settings.googleOAuthRefreshToken || '').trim(),
    googleOAuthEmail: String(settings.googleOAuthEmail || '').trim(),
    formVisionEnabled: settings.formVisionEnabled !== false,
    formVisionModel: String(settings.formVisionModel || DEFAULT_SETTINGS.formVisionModel),
    geminiApiKey: String(settings.geminiApiKey || '').trim()
  };
  await atomicWrite(SETTINGS_FILE, normalized);
  return normalized;
}

export function calculateTotals(job: Pick<ServiceJob, 'products' | 'totals'>) {
  const productValue = job.products.reduce((sum, p) => sum + Number(p.productValue || 0) * Number(p.qty || 0), 0);
  const repairEstimate = job.products.reduce((sum, p) => sum + Number(p.repairEstimate || 0) * Number(p.qty || 0), 0);
  const discount = Math.max(0, Number(job.totals?.discount || 0));
  const calculatedTotal = Math.max(0, repairEstimate - discount);
  const totalEstimateManual = Boolean(job.totals?.totalEstimateManual);
  const manualTotal = Math.max(0, Number(job.totals?.totalEstimate || 0));
  return {
    productValue,
    repairEstimate,
    discount,
    totalEstimate: totalEstimateManual ? manualTotal : calculatedTotal,
    totalEstimateManual
  };
}

export async function listJobs() {
  const db = await readDb();
  return db.jobs.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getJob(id: string) {
  const db = await readDb();
  return db.jobs.find((job) => job.id === id) || null;
}

export async function createJob(input: Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'>) {
  return mutateDb((db) => {
    const now = new Date().toISOString();
    const year = new Date(input.jobDate || now).getFullYear();
    let serial = Math.max(1, db.nextSerial || 1);
    let jobNo = `SJC-${year}-${String(serial).padStart(4, '0')}`;
    while (db.jobs.some((job) => job.jobNo === jobNo)) {
      serial += 1;
      jobNo = `SJC-${year}-${String(serial).padStart(4, '0')}`;
    }
    db.nextSerial = serial + 1;
    const products = input.products.map((p) => normalizeProduct(p, input.status || 'RECEIVED'));
    const job: ServiceJob = {
      ...input,
      marketType: 'INDIA',
      customer: { ...input.customer, country: 'India', currency: 'INR' },
      products,
      id: crypto.randomUUID(),
      jobNo,
      totals: calculateTotals({ products, totals: input.totals } as ServiceJob),
      createdAt: now,
      updatedAt: now
    };
    db.jobs.push(job);
    return job;
  });
}

export async function updateJob(id: string, patch: Partial<ServiceJob>) {
  return mutateDb((db) => {
    const index = db.jobs.findIndex((job) => job.id === id);
    if (index < 0) return null;
    const existing = db.jobs[index];
    const nextStatus = VALID_STATUSES.has(patch.status as JobStatus) ? patch.status as JobStatus : existing.status;
    const products = (patch.products || existing.products).map((p) => normalizeProduct(p, nextStatus));
    const next: ServiceJob = {
      ...existing,
      ...patch,
      id: existing.id,
      jobNo: existing.jobNo,
      marketType: 'INDIA',
      customer: { ...existing.customer, ...(patch.customer || {}), country: 'India', currency: 'INR' },
      receipt: { ...existing.receipt, ...(patch.receipt || {}) },
      dispatch: { ...existing.dispatch, ...(patch.dispatch || {}) },
      payment: { ...existing.payment, ...(patch.payment || {}) },
      signoff: { ...existing.signoff, ...(patch.signoff || {}) },
      products,
      attachments: patch.attachments || existing.attachments,
      updatedAt: new Date().toISOString()
    };
    next.totals = calculateTotals(next);
    db.jobs[index] = next;
    return next;
  });
}

export async function deleteJob(id: string) {
  return mutateDb(async (db) => {
    const index = db.jobs.findIndex((job) => job.id === id);
    if (index < 0) return false;
    const [job] = db.jobs.splice(index, 1);
    await fs.rm(path.join(UPLOADS_DIR, job.id), { recursive: true, force: true });
    return true;
  });
}
