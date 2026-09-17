'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Calculator, Camera, Check, Download, Eye,
  FileImage, FileSpreadsheet, FileText, Film, PackageOpen, Plus,
  Save, ScanText, Sparkles, Trash2, Upload, X
} from 'lucide-react';
import { blankJob, newProduct } from '@/lib/defaults';
import type { DraftJob } from '@/components/HandwrittenFormImport';
const PaperJobCardPreview = dynamic(() => import('@/components/PaperJobCardPreview'), { ssr:false });
const HandwrittenFormImport = dynamic(() => import('@/components/HandwrittenFormImport'), { ssr:false });
import type {
  AppSettings, EstimateStatus, ProductStatus, ProofCategory, RepairCategory,
  ServiceAttachment, ServiceJob, ServiceProduct
} from '@/types/service-job';

type EditableJob = Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'> & Partial<Pick<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'>>;

type SmartSuggestions = {
  customers: Array<{name:string; phone:string; email:string; address:string; city:string; state:string; gstin:string; contactPerson:string}>;
  products: Array<{productName:string; makeModel:string; complaint:string; repairWork:string}>;
  people: string[];
  dispatchModes: string[];
};

const EMPTY_SUGGESTIONS: SmartSuggestions = { customers:[], products:[], people:[], dispatchModes:[] };

const statuses: ServiceJob['status'][] = ['DRAFT','RECEIVED','ESTIMATE_PENDING','APPROVAL_PENDING','REPAIRING','READY','DISPATCHED','CLOSED'];
const estimateStatuses: EstimateStatus[] = ['PENDING_PRICE','PRICE_CONFIRMED','ESTIMATE_READY','SENT_TO_CUSTOMER','APPROVED'];
const proofCategories: ProofCategory[] = ['RECEIPT','INSPECTION','BEFORE_REPAIR','AFTER_REPAIR','CUSTOMER_APPROVAL','DISPATCH','OTHER'];
const DRAFT_KEY = 'servicejob-new-draft';
const SETTINGS_CACHE_KEY = 'serviceflow:settings:last-good:v1';
const DASHBOARD_SNAPSHOT_KEY = 'serviceflow:dashboard:last-good:v1';

function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function money(n: number) { return Number(n || 0).toFixed(2); }
function repairPercent(category: RepairCategory) { return category === 'MAXIMUM_50' ? 50 : 30; }
function repairCategoryLabel(category: RepairCategory) { return category === 'MAXIMUM_50' ? 'Maximum Repair · 50%' : 'Minimum Repair · 30%'; }

function hydrateProduct(raw: Partial<ServiceProduct>, fallbackStatus: ProductStatus): ServiceProduct {
  const base = newProduct();
  const repairCategory = raw.repairCategory === 'MAXIMUM_50' ? 'MAXIMUM_50' : 'MINIMUM_30';
  const presetPercent = repairPercent(repairCategory);
  const rawPercent = Number(raw.repairPercent);
  const percent = Number.isFinite(rawPercent) && rawPercent >= 0 && rawPercent <= 100 ? rawPercent : presetPercent;
  const onlinePrice = Math.max(0, Number(raw.onlinePrice ?? raw.productValue ?? 0));
  const onlinePriceConfirmed = Boolean(raw.onlinePriceConfirmed);
  const importedFormPrice = String(raw.onlinePriceSource || '').startsWith('Imported handwritten service form');
  const estimate = importedFormPrice && Number(raw.repairEstimate || 0) > 0
    ? Math.max(0, Number(raw.repairEstimate || 0))
    : onlinePrice > 0
      ? Number((onlinePrice * percent / 100).toFixed(2))
      : Math.max(0, Number(raw.repairEstimate || 0));
  return {
    ...base,
    ...raw,
    id: raw.id || base.id,
    status: raw.status || fallbackStatus,
    repairCategory,
    repairPercent: percent,
    onlinePrice,
    onlinePriceConfirmed,
    productValue: onlinePrice > 0 ? onlinePrice : Math.max(0, Number(raw.productValue || 0)),
    repairEstimate: estimate,
    onlinePriceSource: raw.onlinePriceSource || '',
    onlinePriceCheckedAt: raw.onlinePriceCheckedAt || '',
    estimateStatus: raw.estimateStatus || (onlinePriceConfirmed && estimate > 0 ? 'ESTIMATE_READY' : onlinePriceConfirmed ? 'PRICE_CONFIRMED' : 'PENDING_PRICE'),
    productImageUrl: raw.productImageUrl || '',
    productSpecifications: raw.productSpecifications || '',
    onlineProductUrl: raw.onlineProductUrl || '',
    onlineDetailsTitle: raw.onlineDetailsTitle || '',
    onlineDetailsFetchedAt: raw.onlineDetailsFetchedAt || '',
    onlineLookupQuery: raw.onlineLookupQuery || '',
    productImageUrls: Array.isArray(raw.productImageUrls) ? raw.productImageUrls : raw.productImageUrl ? [raw.productImageUrl] : [],
    marketPriceMin: Math.max(0, Number(raw.marketPriceMin || 0)),
    marketPriceMax: Math.max(0, Number(raw.marketPriceMax || 0)),
    marketPriceMedian: Math.max(0, Number(raw.marketPriceMedian || 0)),
    marketPriceSampleCount: Math.max(0, Number(raw.marketPriceSampleCount || 0))
  };
}

function hydrateJob(raw: Partial<ServiceJob>): EditableJob {
  const base = blankJob();
  return {
    ...base,
    ...raw,
    marketType: 'INDIA',
    customer: { ...base.customer, ...(raw.customer || {}), country: 'India', currency: 'INR' },
    receipt: { ...base.receipt, ...(raw.receipt || {}) },
    dispatch: { ...base.dispatch, ...(raw.dispatch || {}) },
    payment: { ...base.payment, ...(raw.payment || {}) },
    signoff: { ...base.signoff, ...(raw.signoff || {}) },
    products: Array.isArray(raw.products) && raw.products.length
      ? raw.products.map((p) => hydrateProduct(p, raw.status || 'RECEIVED'))
      : base.products,
    attachments: raw.attachments || [],
  };
}

function cleanNewDraft(raw: unknown): EditableJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const hydrated = hydrateJob(raw as Partial<ServiceJob>);
  return {
    ...hydrated,
    id: undefined,
    jobNo: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    attachments: [],
  };
}

export default function JobEditor({ jobId, autoPreview = false }: { jobId?: string; autoPreview?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<EditableJob>(() => blankJob());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [suggestions, setSuggestions] = useState<SmartSuggestions>(EMPTY_SUGGESTIONS);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [proofCategory, setProofCategory] = useState<ProofCategory>('INSPECTION');
  const [previewOpen, setPreviewOpen] = useState(autoPreview);
  const [handwrittenImportOpen, setHandwrittenImportOpen] = useState(false);
  const [returnToDashboardAfterPreview, setReturnToDashboardAfterPreview] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [lookupBusy, setLookupBusy] = useState<Record<string, boolean>>({});
  const [whatsappLoginOpen, setWhatsappLoginOpen] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<any>(null);
  const [whatsappRetrying, setWhatsappRetrying] = useState(false);
  const pendingWhatsappJobIdRef = useRef<string | null>(null);
  const whatsappRetryLockRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const createdIdRef = useRef<string | null>(null);
  const saveLockRef = useRef(false);
  const autoLookupTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoLookupRequestedRef = useRef<Record<string, string>>({});
  const suggestionsRequestedRef = useRef(false);

  useEffect(() => {
    if (autoPreview && jobId && typeof window !== 'undefined') window.history.replaceState(null, '', `/jobs/${jobId}`);
  }, [autoPreview, jobId]);

  useEffect(() => {
    if (!previewOpen || !returnToDashboardAfterPreview || whatsappLoginOpen) return;
    const timer = window.setTimeout(() => {
      router.replace('/');
      router.refresh();
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [previewOpen, returnToDashboardAfterPreview, whatsappLoginOpen, router]);

  useEffect(() => {
    // ULTRA-FAST: a brand-new service form opens without waiting for any network/API call.
    // Reuse the last settings instantly, then refresh them only after the first paint.
    try {
      const cached = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (cached) {
        const cachedSettings = JSON.parse(cached) as AppSettings;
        setSettings(cachedSettings);
        if (!jobId) setJob(prev => ({ ...prev, branchName: cachedSettings.defaultBranch || prev.branchName }));
      }
    } catch { /* ignore invalid settings cache */ }

    if (jobId) {
      // Open an existing job from the dashboard's last-good snapshot immediately.
      // The live record refreshes in the background, so cached speed never replaces real data.
      try {
        const snapRaw = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
        if (snapRaw) {
          const snap = JSON.parse(snapRaw);
          const cachedJob = Array.isArray(snap?.jobs) ? snap.jobs.find((item: ServiceJob) => item.id === jobId) : null;
          if (cachedJob) { setJob(hydrateJob(cachedJob)); setLoading(false); }
        }
      } catch { /* ignore invalid dashboard cache */ }
      void fetch(`/api/jobs/${jobId}`, { cache: 'no-store' }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Unable to load job');
        setJob(hydrateJob(d.job));
      }).catch(e => setError(e.message)).finally(() => setLoading(false));
    } else {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        try {
          const restored = cleanNewDraft(JSON.parse(raw));
          if (restored) setJob(restored);
        } catch { /* ignore invalid local draft */ }
      }
    }

    let cancelled = false;
    const refreshSettings = () => {
      void fetch('/api/settings', { cache:'no-store' }).then(r => r.json()).then(d => {
        if (cancelled || !d?.settings) return;
        setSettings(d.settings);
        try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(d.settings)); } catch {}
        if (!jobId) setJob(prev => ({ ...prev, branchName: prev.branchName || d.settings.defaultBranch || prev.branchName }));
      }).catch(() => undefined);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | undefined;
    let settingsTimer: number | undefined;
    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(refreshSettings, { timeout: 1500 });
    } else {
      settingsTimer = window.setTimeout(refreshSettings, 900);
    }
    return () => {
      cancelled = true;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (settingsTimer !== undefined) window.clearTimeout(settingsTimer);
    };
  }, [jobId]);

  function ensureSuggestions() {
    // Suggestions can traverse historical jobs, so do not spend any startup time on them.
    // Load once on the first actual form interaction instead.
    if (suggestionsRequestedRef.current) return;
    suggestionsRequestedRef.current = true;
    void fetch('/api/suggestions', { cache:'no-store' })
      .then(r => r.json()).then(d => setSuggestions({ ...EMPTY_SUGGESTIONS, ...d }))
      .catch(() => undefined);
  }

  useEffect(() => {
    // Writing the entire draft on every keystroke can freeze older PCs. Debounce it.
    if (jobId || createdIdRef.current || job.id) return;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(job)); } catch {}
    }, 350);
    return () => window.clearTimeout(timer);
  }, [job, jobId]);

  const totals = useMemo(() => {
    const productValue = job.products.reduce((s,p) => s + Number(p.productValue || 0) * Number(p.qty || 0), 0);
    const repairEstimate = job.products.reduce((s,p) => s + Number(p.repairEstimate || 0) * Number(p.qty || 0), 0);
    const discount = Number(job.totals.discount || 0);
    const calculatedTotal = Math.max(0, repairEstimate - discount);
    const totalEstimateManual = Boolean(job.totals.totalEstimateManual);
    const manualTotal = Math.max(0, Number(job.totals.totalEstimate || 0));
    return {
      productValue,
      repairEstimate,
      discount,
      totalEstimate: totalEstimateManual ? manualTotal : calculatedTotal,
      totalEstimateManual
    };
  }, [job.products, job.totals.discount, job.totals.totalEstimate, job.totals.totalEstimateManual]);

  useEffect(() => {
    if (job.totals.productValue !== totals.productValue || job.totals.repairEstimate !== totals.repairEstimate || job.totals.totalEstimate !== totals.totalEstimate || Boolean(job.totals.totalEstimateManual) !== totals.totalEstimateManual) {
      setJob(prev => ({ ...prev, totals }));
    }
  }, [totals]); // eslint-disable-line react-hooks/exhaustive-deps

  function customer<K extends keyof ServiceJob['customer']>(key: K, value: ServiceJob['customer'][K]) {
    setJob(prev => ({ ...prev, customer: { ...prev.customer, [key]: value, country: 'India', currency: 'INR' } }));
  }
  function customerNameWithSuggestion(value: string) {
    const match = suggestions.customers.find(item => item.name.localeCompare(value, undefined, { sensitivity:'accent' }) === 0);
    setJob(prev => ({
      ...prev,
      customer: match ? {
        ...prev.customer,
        name:value,
        phone:prev.customer.phone || match.phone,
        email:prev.customer.email || match.email,
        address:prev.customer.address || match.address,
        city:prev.customer.city || match.city,
        state:prev.customer.state || match.state,
        gstin:prev.customer.gstin || match.gstin,
        contactPerson:prev.customer.contactPerson || match.contactPerson,
        country:'India', currency:'INR'
      } : { ...prev.customer, name:value, country:'India', currency:'INR' }
    }));
  }

  function productNameWithSuggestion(index:number, value:string) {
    const matches=suggestions.products.filter(item => item.productName.localeCompare(value, undefined, { sensitivity:'accent' }) === 0);
    const uniqueModels=[...new Set(matches.map(item=>item.makeModel).filter(Boolean))];
    const one=matches[0];
    product(index,{
      productName:value,
      ...(uniqueModels.length===1 ? { makeModel:uniqueModels[0] } : {}),
      ...(one?.complaint ? { complaint:job.products[index]?.complaint || one.complaint } : {}),
      ...(one?.repairWork ? { repairWork:job.products[index]?.repairWork || one.repairWork } : {})
    });
  }

  function receipt<K extends keyof ServiceJob['receipt']>(key: K, value: ServiceJob['receipt'][K]) { setJob(prev => ({ ...prev, receipt: { ...prev.receipt, [key]: value } })); }
  function dispatch<K extends keyof ServiceJob['dispatch']>(key: K, value: ServiceJob['dispatch'][K]) { setJob(prev => ({ ...prev, dispatch: { ...prev.dispatch, [key]: value } })); }
  function payment<K extends keyof ServiceJob['payment']>(key: K, value: ServiceJob['payment'][K]) { setJob(prev => ({ ...prev, payment: { ...prev.payment, [key]: value } })); }
  function signoff<K extends keyof ServiceJob['signoff']>(key: K, value: ServiceJob['signoff'][K]) { setJob(prev => ({ ...prev, signoff: { ...prev.signoff, [key]: value } })); }

  function product(index: number, patch: Partial<ServiceProduct>) {
    const current = job.products[index];
    if (current && (patch.productName !== undefined || patch.makeModel !== undefined)) {
      if (autoLookupTimersRef.current[current.id]) clearTimeout(autoLookupTimersRef.current[current.id]);
      delete autoLookupRequestedRef.current[current.id];
    }
    setJob(prev => ({
      ...prev,
      products: prev.products.map((p,i) => {
        if (i !== index) return p;
        const identityChanged =
          (patch.productName !== undefined && patch.productName !== p.productName) ||
          (patch.makeModel !== undefined && patch.makeModel !== p.makeModel);
        const merged = {
          ...p,
          ...patch,
          ...(identityChanged ? {
            productImageUrl: '',
            productImageUrls: [],
            productSpecifications: '',
            onlineProductUrl: '',
            onlineDetailsTitle: '',
            onlineDetailsFetchedAt: '',
            onlineLookupQuery: '',
            marketPriceMin: 0,
            marketPriceMax: 0,
            marketPriceMedian: 0,
            marketPriceSampleCount: 0,
            onlinePrice: 0,
            onlinePriceSource: '',
            onlinePriceConfirmed: false,
            onlinePriceCheckedAt: '',
            productValue: 0,
            repairEstimate: 0,
            estimateStatus: 'PENDING_PRICE' as EstimateStatus
          } : {})
        } as ServiceProduct;
        const category: RepairCategory = merged.repairCategory === 'MAXIMUM_50' ? 'MAXIMUM_50' : 'MINIMUM_30';
        const categoryChanged = patch.repairCategory !== undefined;
        const requestedPercent = patch.repairPercent !== undefined
          ? Number(patch.repairPercent)
          : categoryChanged
            ? repairPercent(category)
            : Number(merged.repairPercent || repairPercent(category));
        const percent = Math.min(100, Math.max(0, Number.isFinite(requestedPercent) ? requestedPercent : repairPercent(category)));
        const onlinePrice = Math.max(0, Number(merged.onlinePrice || 0));
        const confirmed = Boolean(merged.onlinePriceConfirmed);
        const importedFormPrice = String(merged.onlinePriceSource || '').startsWith('Imported handwritten service form');
        const pricingEdited = patch.repairCategory !== undefined || patch.repairPercent !== undefined || patch.onlinePrice !== undefined;
        const calculated = importedFormPrice && !pricingEdited && Number(merged.repairEstimate || 0) > 0
          ? Number(merged.repairEstimate)
          : onlinePrice > 0 ? Number((onlinePrice * percent / 100).toFixed(2)) : 0;
        const pricingChanged = patch.repairCategory !== undefined || patch.repairPercent !== undefined || patch.onlinePrice !== undefined;
        const estimateStatus = patch.estimateStatus
          ? patch.estimateStatus
          : confirmed && onlinePrice > 0 && pricingChanged
            ? 'ESTIMATE_READY'
            : merged.estimateStatus;
        return {
          ...merged,
          repairCategory: category,
          repairPercent: percent,
          productValue: onlinePrice > 0 ? onlinePrice : merged.productValue,
          repairEstimate: calculated,
          estimateStatus
        };
      })
    }));
  }

  async function lookupOnlineDetails(index: number, quiet = false): Promise<ServiceProduct | null> {
    const snapshot = job.products[index];
    const productName = String(snapshot?.productName || '').trim();
    const makeModel = String(snapshot?.makeModel || '').trim();
    if (!snapshot || !productName || !makeModel) {
      if (!quiet) setError('Enter both Product Name and Make / Model before searching online details.');
      return null;
    }
    const lookupQuery = `${productName.toLowerCase()}|||${makeModel.toLowerCase()}`;
    setLookupBusy(prev => ({ ...prev, [snapshot.id]: true }));
    try {
      const res = await fetch('/api/products/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: snapshot.productName, makeModel: snapshot.makeModel })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Online product lookup failed');
      const d = data.details || {};
      let updatedRow: ServiceProduct | null = null;
      setJob(prev => ({
        ...prev,
        products: prev.products.map((row, i) => {
          if (i !== index || row.id !== snapshot.id) return row;
          const currentQuery = `${String(row.productName || '').trim().toLowerCase()}|||${String(row.makeModel || '').trim().toLowerCase()}`;
          if (currentQuery !== lookupQuery) return row; // user changed the product while the request was running
          const queryChanged = String(row.onlineLookupQuery || '') !== lookupQuery;
          const suggestedPrice = Math.max(0, Number(d.price || d.marketPriceMedian || 0));
          const manualOverride = String(row.onlinePriceSource || '').trim() === 'Manual price override';
          // Fresh online lookups always refresh an automatically sourced price to the exact
          // matching listing value. Only an explicit staff override is preserved.
          const nextPrice = !queryChanged && manualOverride && Number(row.onlinePrice || 0) > 0
            ? Number(row.onlinePrice)
            : suggestedPrice;
          const category = row.repairCategory === 'MAXIMUM_50' ? 'MAXIMUM_50' : 'MINIMUM_30';
          const percent = Math.min(100, Math.max(0, Number(row.repairPercent ?? repairPercent(category))));
          const nextEstimate = nextPrice > 0 ? Number((nextPrice * percent / 100).toFixed(2)) : 0;
          const images = Array.isArray(d.imageUrls) ? d.imageUrls.map(String).filter(Boolean).slice(0, 4) : [];
          const primaryImage = String(d.imageUrl || images[0] || row.productImageUrl || '');
          if (primaryImage && !images.includes(primaryImage)) images.unshift(primaryImage);
          const next: ServiceProduct = {
            ...row,
            productImageUrl: primaryImage,
            productImageUrls: images.length ? images.slice(0, 4) : (row.productImageUrls || []),
            productSpecifications: String(d.specifications || row.productSpecifications || ''),
            onlineProductUrl: String(d.sourceUrl || row.onlineProductUrl || ''),
            onlineDetailsTitle: String(d.title || row.onlineDetailsTitle || row.productName),
            onlineDetailsFetchedAt: String(d.searchedAt || new Date().toISOString()),
            onlineLookupQuery: lookupQuery,
            marketPriceMin: Math.max(0, Number(d.marketPriceMin || suggestedPrice || 0)),
            marketPriceMax: Math.max(0, Number(d.marketPriceMax || suggestedPrice || 0)),
            marketPriceMedian: Math.max(0, Number(d.marketPriceMedian || suggestedPrice || 0)),
            marketPriceSampleCount: Math.max(0, Number(d.marketPriceSampleCount || (suggestedPrice > 0 ? 1 : 0))),
            onlinePrice: nextPrice,
            onlinePriceConfirmed: queryChanged ? false : row.onlinePriceConfirmed,
            onlinePriceCheckedAt: queryChanged ? '' : row.onlinePriceCheckedAt,
            onlinePriceSource: queryChanged
              ? String(d.sourceName || d.sourceUrl || 'Online market search')
              : (row.onlinePriceSource || String(d.sourceName || d.sourceUrl || 'Online market search')),
            productValue: nextPrice,
            repairPercent: percent,
            repairEstimate: nextEstimate,
            estimateStatus: queryChanged ? 'PENDING_PRICE' : row.estimateStatus
          };
          updatedRow = next;
          return next;
        })
      }));
      if (!quiet) {
        const gotImage = Boolean(String(d.imageUrl || '').trim() || (Array.isArray(d.imageUrls) && d.imageUrls.length));
        const gotPrice = Number(d.price || 0) > 0;
        const gotSpecs = Boolean(String(d.specifications || '').trim());
        if (!gotImage && !gotPrice && !gotSpecs) {
          setSavedMessage('');
          setError(String(d.matchReason || 'No verified exact online match found for this Product Name + Make / Model.'));
        } else {
          const parts = [gotImage ? 'image' : '', gotPrice ? 'exact price' : '', gotSpecs ? 'specifications' : ''].filter(Boolean);
          setSavedMessage(`Verified online ${parts.join(', ')} updated${gotPrice ? '; repair margin recalculated automatically.' : '.'}`);
          setError('');
        }
      }
      return updatedRow;
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLookupBusy(prev => ({ ...prev, [snapshot.id]: false }));
    }
  }

  function triggerProductLookupNow(index: number) {
    const row = job.products[index];
    const productName = String(row?.productName || '').trim();
    const makeModel = String(row?.makeModel || '').trim();
    if (!row || !productName || !makeModel) {
      setError('Enter both Product Name and Make / Model, then press Enter to search.');
      return;
    }
    if (autoLookupTimersRef.current[row.id]) {
      clearTimeout(autoLookupTimersRef.current[row.id]);
      delete autoLookupTimersRef.current[row.id];
    }
    const key = `${productName.toLowerCase()}|||${makeModel.toLowerCase()}`;
    autoLookupRequestedRef.current[row.id] = key;
    setSavedMessage('');
    setError('');
    void lookupOnlineDetails(index, false).then(result => {
      if (!result) delete autoLookupRequestedRef.current[row.id];
    });
  }

  useEffect(() => {
    if (!settings?.autoLookupProductDetails) return;
    const timers = autoLookupTimersRef.current;
    job.products.forEach((p, index) => {
      const name = String(p.productName || '').trim();
      const model = String(p.makeModel || '').trim();
      if (name.length < 2 || !model) return;
      const key = `${name.toLowerCase()}|||${model.toLowerCase()}`;
      const importedFormPrice = String(p.onlinePriceSource || '').startsWith('Imported handwritten service form');
      if (importedFormPrice) return; // handwritten form values stay authoritative until staff changes Product/Model or price
      if (!key || p.onlineLookupQuery === key || autoLookupRequestedRef.current[p.id] === key) return;
      if (timers[p.id]) clearTimeout(timers[p.id]);
      timers[p.id] = setTimeout(() => {
        autoLookupRequestedRef.current[p.id] = key;
        void lookupOnlineDetails(index, true).then(result => {
          if (!result) delete autoLookupRequestedRef.current[p.id];
        });
      }, 300);
    });
    return () => {
      Object.values(timers).forEach(timer => clearTimeout(timer));
      Object.keys(timers).forEach(key => delete timers[key]);
    };
  }, [settings?.autoLookupProductDetails, job.products]); // auto-search after product name/model entry

  async function openWhatsAppWebLogin() {
    setWhatsappRetrying(true);
    setError('');
    try {
      const status = await fetch('/api/whatsapp/prepare', { method:'POST', cache:'no-store' }).then(r => r.json());
      setWhatsappStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWhatsappRetrying(false);
    }
  }

  async function refreshWhatsAppLogin() {
    try {
      const status = await fetch('/api/whatsapp/status', { cache:'no-store' }).then(r => r.json());
      setWhatsappStatus(status);
      const pendingId = pendingWhatsappJobIdRef.current;
      if (status.ready && pendingId && !whatsappRetryLockRef.current) {
        whatsappRetryLockRef.current = true;
        setWhatsappRetrying(true);
        try {
          const res = await fetch(`/api/jobs/${pendingId}/send-estimate`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ force:false, channels:['whatsapp'] })
          });
          const data = await res.json();
          if (res.ok && data.job) setJob(hydrateJob(data.job));
          if (data.results?.whatsapp?.status === 'SENT' || data.results?.whatsapp?.status === 'ALREADY_SENT') {
            pendingWhatsappJobIdRef.current = null;
            setWhatsappLoginOpen(false);
            setSavedMessage(prev => `${prev || 'Job saved'} — WhatsApp sent successfully — returning to dashboard`);
            setPreviewOpen(true);
            setReturnToDashboardAfterPreview(true);
          } else if (data.results?.whatsapp?.detail) {
            setError(data.results.whatsapp.detail);
          }
        } finally { whatsappRetryLockRef.current = false; setWhatsappRetrying(false); }
      }
    } catch { /* polling is best effort */ }
  }

  useEffect(() => {
    if (!whatsappLoginOpen) return;
    void refreshWhatsAppLogin();
    const timer = setInterval(() => { void refreshWhatsAppLogin(); }, 2500);
    return () => clearInterval(timer);
  }, [whatsappLoginOpen, whatsappRetrying]);

  async function save() {
    if (saveLockRef.current) return;
    saveLockRef.current = true;
    setSaving(true); setError(''); setSavedMessage('');
    try {
      let workingJob: EditableJob = job;
      if (settings?.autoLookupProductDetails) {
        const enriched = [...workingJob.products];
        for (let i = 0; i < enriched.length; i++) {
          const p = enriched[i];
          if (!p.productName?.trim() || !p.makeModel?.trim()) continue;
          if (String(p.onlinePriceSource || '').startsWith('Imported handwritten service form')) continue;
          const lookupKey = `${String(p.productName).trim().toLowerCase()}|||${String(p.makeModel).trim().toLowerCase()}`;
          if (p.onlineLookupQuery === lookupKey && p.productImageUrl && p.productSpecifications && p.onlineProductUrl && Number(p.onlinePrice || 0) > 0) continue;
          try {
            const res = await fetch('/api/products/lookup', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productName: p.productName, makeModel: p.makeModel })
            });
            const data = await res.json();
            if (!res.ok) continue;
            const d = data.details || {};
            const suggestedPrice = Math.max(0, Number(d.price || d.marketPriceMedian || 0));
            const queryChanged = p.onlineLookupQuery !== lookupKey;
            const manualOverride = String(p.onlinePriceSource || '').trim() === 'Manual price override';
            const nextPrice = !queryChanged && manualOverride && Number(p.onlinePrice || 0) > 0
              ? Number(p.onlinePrice)
              : suggestedPrice;
            const percent = Math.min(100, Math.max(0, Number(p.repairPercent ?? repairPercent(p.repairCategory))));
            const images = Array.isArray(d.imageUrls) ? d.imageUrls.map(String).filter(Boolean).slice(0, 4) : [];
            const primaryImage = String(d.imageUrl || images[0] || p.productImageUrl || '');
            if (primaryImage && !images.includes(primaryImage)) images.unshift(primaryImage);
            enriched[i] = {
              ...p,
              productImageUrl: primaryImage,
              productImageUrls: images.length ? images.slice(0, 4) : (p.productImageUrls || []),
              productSpecifications: String(d.specifications || p.productSpecifications || ''),
              onlineProductUrl: String(d.sourceUrl || p.onlineProductUrl || ''),
              onlineDetailsTitle: String(d.title || p.onlineDetailsTitle || p.productName),
              onlineDetailsFetchedAt: String(d.searchedAt || new Date().toISOString()),
              onlineLookupQuery: lookupKey,
              marketPriceMin: Math.max(0, Number(d.marketPriceMin || suggestedPrice || 0)),
              marketPriceMax: Math.max(0, Number(d.marketPriceMax || suggestedPrice || 0)),
              marketPriceMedian: Math.max(0, Number(d.marketPriceMedian || suggestedPrice || 0)),
              marketPriceSampleCount: Math.max(0, Number(d.marketPriceSampleCount || (suggestedPrice > 0 ? 1 : 0))),
              onlinePrice: nextPrice,
              onlinePriceConfirmed: queryChanged ? false : p.onlinePriceConfirmed,
              onlinePriceCheckedAt: queryChanged ? '' : p.onlinePriceCheckedAt,
              onlinePriceSource: queryChanged ? String(d.sourceName || d.sourceUrl || 'Online market search') : (p.onlinePriceSource || String(d.sourceName || d.sourceUrl || 'Online market search')),
              productValue: nextPrice,
              repairPercent: percent,
              repairEstimate: nextPrice > 0 ? Number((nextPrice * percent / 100).toFixed(2)) : 0,
              estimateStatus: queryChanged ? 'PENDING_PRICE' : p.estimateStatus
            };
          } catch { /* online enrichment is best-effort; local save must still succeed */ }
        }
        workingJob = { ...workingJob, products: enriched };
        setJob(workingJob);
      }

      // Save & Preview is the explicit staff confirmation point. If the displayed market
      // price/source and calculated estimate are usable, confirm them here so the same
      // click can persist the job and trigger automatic customer delivery.
      const confirmedAt = new Date().toISOString();
      let confirmedAny = false;
      const saveConfirmedProducts = workingJob.products.map((p) => {
        const onlinePrice = Math.max(0, Number(p.onlinePrice || p.productValue || 0));
        const source = String(p.onlinePriceSource || p.onlineProductUrl || '').trim() || (p.onlineLookupQuery ? 'Online market lookup' : 'Manual price override');
        const percent = Math.min(100, Math.max(0, Number(p.repairPercent ?? repairPercent(p.repairCategory))));
        const importedFormPrice = String(p.onlinePriceSource || '').startsWith('Imported handwritten service form');
        const estimate = importedFormPrice && Number(p.repairEstimate || 0) > 0
          ? Math.max(0, Number(p.repairEstimate || 0))
          : onlinePrice > 0 ? Number((onlinePrice * percent / 100).toFixed(2)) : Math.max(0, Number(p.repairEstimate || 0));
        if (onlinePrice <= 0 || estimate <= 0) return { ...p, repairPercent: percent, repairEstimate: estimate };
        confirmedAny = true;
        return {
          ...p,
          onlinePrice,
          productValue: onlinePrice,
          onlinePriceSource: source,
          onlinePriceConfirmed: true,
          onlinePriceCheckedAt: confirmedAt,
          repairPercent: percent,
          repairEstimate: estimate,
          estimateStatus: p.estimateStatus === 'APPROVED' ? 'APPROVED' : 'ESTIMATE_READY' as EstimateStatus,
          status: p.status === 'RECEIVED' ? 'ESTIMATE_PENDING' as ProductStatus : p.status
        };
      });
      workingJob = {
        ...workingJob,
        status: confirmedAny && workingJob.status === 'RECEIVED' ? 'ESTIMATE_PENDING' : workingJob.status,
        products: saveConfirmedProducts
      };
      setJob(workingJob);

      const targetId = jobId || createdIdRef.current;
      const url = targetId ? `/api/jobs/${targetId}` : '/api/jobs';
      const method = targetId ? 'PUT' : 'POST';
      const payload = { ...workingJob, marketType: 'INDIA', customer: { ...workingJob.customer, country: 'India', currency: 'INR' } };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      let saved: ServiceJob = data.job;
      if (!targetId) createdIdRef.current = saved.id;
      if (pendingFiles.length) {
        const form = new FormData();
        pendingFiles.forEach(f => form.append('files', f));
        form.append('category', proofCategory);
        const uploadRes = await fetch(`/api/jobs/${saved.id}/attachments`, { method: 'POST', body: form });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Proof upload failed');
        saved = uploadData.job;
        setPendingFiles([]);
      }

      let sendSummary = '';
      let needsWhatsAppLogin = false;
      const ready = saved.products.length > 0 && saved.products.every((p) => Boolean(p.onlinePriceConfirmed) && Number(p.onlinePrice || 0) > 0 && Number(p.repairEstimate || 0) > 0);
      if (ready && (saved.customer.email || saved.customer.phone)) {
        try {
          const sendRes = await fetch(`/api/jobs/${saved.id}/send-estimate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ force:false }) });
          const sendData = await sendRes.json();
          if (sendRes.ok && sendData.job) saved = sendData.job;
          const sentChannels = [sendData.results?.email?.status === 'SENT' ? 'Email' : '', sendData.results?.whatsapp?.status === 'SENT' ? 'WhatsApp' : ''].filter(Boolean).join(' + ');
          const alreadyChannels = [sendData.results?.email?.status === 'ALREADY_SENT' ? 'Email already sent' : '', sendData.results?.whatsapp?.status === 'ALREADY_SENT' ? 'WhatsApp already sent' : ''].filter(Boolean).join(', ');
          const skippedChannels = [sendData.results?.email?.status === 'SKIPPED' ? 'email missing' : '', sendData.results?.whatsapp?.status === 'SKIPPED' ? 'WhatsApp number missing' : ''].filter(Boolean).join(', ');
          if (sentChannels) sendSummary = ` — ${sentChannels} sent automatically${skippedChannels ? ` (${skippedChannels})` : ''}`;
          else if (alreadyChannels) sendSummary = ` — ${alreadyChannels}`;
          if (sendData.needsWhatsAppLogin || sendData.results?.whatsapp?.status === 'LOGIN_REQUIRED') {
            needsWhatsAppLogin = true;
            pendingWhatsappJobIdRef.current = saved.id;
            setWhatsappLoginOpen(true);
            sendSummary += ' — WhatsApp login required';
          }
        } catch { /* saving remains successful even when a remote message provider is temporarily unavailable */ }
      }

      localStorage.removeItem(DRAFT_KEY);
      setJob(hydrateJob(saved));
      setSavedMessage(`${saved.jobNo} saved successfully${sendSummary}${needsWhatsAppLogin ? '' : ' — returning to dashboard automatically'}`);
      setPreviewOpen(true);
      setReturnToDashboardAfterPreview(!needsWhatsAppLogin);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  async function removeAttachment(a: ServiceAttachment) {
    if (!job.id || !confirm(`Remove proof file "${a.fileName}"?`)) return;
    const res = await fetch(`/api/jobs/${job.id}/attachments/${a.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) setJob(hydrateJob(data.job)); else setError(data.error || 'Delete failed');
  }

  async function deleteJob() {
    if (!job.id || !confirm(`Delete ${job.jobNo}? This also deletes local proof files.`)) return;
    const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/');
  }

  if (loading) return <div className="panel empty">Loading job card…</div>;

  return (
    <div className="stack20 editorPage" onPointerDownCapture={ensureSuggestions} onInputCapture={ensureSuggestions}>
      <datalist id="sf-customer-names">{suggestions.customers.map(c => <option key={c.name} value={c.name}>{c.phone || c.city}</option>)}</datalist>
      <datalist id="sf-contact-people">{[...new Set([...suggestions.customers.map(c=>c.contactPerson).filter(Boolean), ...suggestions.people])].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-cities">{[...new Set(suggestions.customers.map(c=>c.city).filter(Boolean))].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-states">{[...new Set(suggestions.customers.map(c=>c.state).filter(Boolean))].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-product-names">{[...new Set(suggestions.products.map(p=>p.productName).filter(Boolean))].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-product-models">{[...new Set(suggestions.products.map(p=>p.makeModel).filter(Boolean))].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-complaints">{[...new Set(suggestions.products.map(p=>p.complaint).filter(Boolean))].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-repair-work">{[...new Set(suggestions.products.map(p=>p.repairWork).filter(Boolean))].map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-dispatch-modes">{suggestions.dispatchModes.map(v=><option key={v} value={v}/>)}</datalist>
      <datalist id="sf-people">{suggestions.people.map(v=><option key={v} value={v}/>)}</datalist>
      <section className="editorHeader">
        <div className="editorTitle">
          <Link href="/" className="iconButton" title="Back"><ArrowLeft size={20}/></Link>
          <div><p className="eyebrow">SERVICE JOB CARD</p><h1>{job.jobNo || 'New Service Job'}</h1><p className="muted">Receive the instrument, auto-fetch the current market price, choose the repair margin and save the estimate.</p></div>
        </div>
        <div className="headerActions">
          {!jobId && currentStep === 0 && <button className="button" type="button" onClick={() => setHandwrittenImportOpen(true)}><ScanText size={17}/> Upload Service Form</button>}
          <button className="button" type="button" onClick={() => setPreviewOpen(true)}><Eye size={17}/> Preview</button>
          {currentStep === 5 && <button className="button primary large" disabled={saving} onClick={() => void save()}><Save size={18}/>{saving ? 'Saving & Sending…' : 'Save & Preview'}</button>}
        </div>
      </section>

      {(error || savedMessage) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || <><Check size={17}/>{savedMessage}</>}</div>}

      <section className="workflowStepper" aria-label="Service job workflow">
        {[
          ['Customer','Customer & contact'],
          ['Receipt','Receipt details'],
          ['Product','Product, image, price & repair'],
          ['Proof','Photos & service proof'],
          ['Dispatch','Dispatch & payment'],
          ['Review','Sign-off & save']
        ].map(([title,sub], idx) => <button key={title} type="button" className={`workflowStep ${idx === currentStep ? 'active' : ''} ${idx < currentStep ? 'done' : ''}`} onClick={() => setCurrentStep(idx)}>
          <span className="workflowStepNo">{idx < currentStep ? <Check size={15}/> : idx + 1}</span>
          <span><b>{title}</b><small>{sub}</small></span>
        </button>)}
      </section>

      <section className="panel compactPanel quickStrip">
        <div className="field grow"><label>Job Date</label><input type="date" value={job.jobDate} onChange={e => setJob(p => ({...p, jobDate:e.target.value}))}/></div>
        <div className="field grow"><label>Status</label><select value={job.status} onChange={e => setJob(p => ({...p, status:e.target.value as ServiceJob['status']}))}>{statuses.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div className="field grow"><label>Office</label><select value={job.officeType} onChange={e => setJob(p => ({...p, officeType:e.target.value as ServiceJob['officeType']}))}><option value="HEAD_OFFICE">Head Office</option><option value="BRANCH_OFFICE">Branch Office</option></select></div>
        <div className="field grow"><label>Enquiry Branch</label><select value={job.branchName} onChange={e => setJob(p => ({...p, branchName:e.target.value}))}>{(settings?.branchNames || [job.branchName]).map(b => <option key={b}>{b}</option>)}</select></div>
        <div className="field grow"><label>Old / Paper S.No (optional)</label><input value={job.legacySerialNo} onChange={e => setJob(p => ({...p, legacySerialNo:e.target.value}))} placeholder="e.g. 0866"/></div>
      </section>

      {currentStep === 0 && <section className="panel workflowPanel">
        <div className="sectionHead"><div><span className="step">01</span><div><h2>Customer Details</h2><p>All service jobs are India jobs. No India/Export selection is required.</p></div></div></div>
        <div className="formGrid three">
          <Field label="Company / Customer Name" required><input autoFocus={!job.id} list="sf-customer-names" autoComplete="off" value={job.customer.name} onChange={e => customerNameWithSuggestion(e.target.value)} placeholder="Type to reuse a saved customer"/></Field>
          <Field label="Contact Person"><input list="sf-contact-people" autoComplete="off" value={job.customer.contactPerson} onChange={e => customer('contactPerson',e.target.value)} placeholder="Type to reuse a saved contact"/></Field>
          <Field label="Customer Mobile / WhatsApp No."><input value={job.customer.phone} onChange={e => customer('phone',e.target.value)} placeholder="10-digit mobile or +91 number"/></Field>
          <Field label="Email"><input type="email" value={job.customer.email} onChange={e => customer('email',e.target.value)} placeholder="service@example.com"/></Field>
          <Field label="City"><input list="sf-cities" autoComplete="off" value={job.customer.city} onChange={e => customer('city',e.target.value)}/></Field>
          <Field label="State"><input list="sf-states" autoComplete="off" value={job.customer.state} onChange={e => customer('state',e.target.value)}/></Field>
          <Field label="GSTIN"><input value={job.customer.gstin} onChange={e => customer('gstin',e.target.value)}/></Field>
          <Field label="Address" span="full"><textarea rows={2} value={job.customer.address} onChange={e => customer('address',e.target.value)} placeholder="Complete service / billing address"/></Field>
        </div>
      </section>}

      {currentStep === 1 && <section className="panel workflowPanel">
        <div className="sectionHead"><div><span className="step">02</span><div><h2>Receipt Details</h2><p>Track how the instrument reached service.</p></div></div></div>
        <div className="formGrid four">
          <Field label="MR No"><input value={job.receipt.mrNo} onChange={e => receipt('mrNo',e.target.value)}/></Field>
          <Field label="MR Date"><input type="date" value={job.receipt.mrDate} onChange={e => receipt('mrDate',e.target.value)}/></Field>
          <Field label="Mode of Receipt"><select value={job.receipt.mode} onChange={e => { const mode = e.target.value as ServiceJob['receipt']['mode']; setJob(prev => ({ ...prev, receipt: { ...prev.receipt, mode, reference: mode === 'DIRECT' ? '' : prev.receipt.reference } })); }}><option value="DIRECT">Direct</option><option value="COURIER">Courier</option><option value="OTHER">Other</option></select></Field>
          <Field label="Receipt Reference"><input value={job.receipt.reference} disabled={job.receipt.mode === 'DIRECT'} onChange={e => receipt('reference',e.target.value)} placeholder={job.receipt.mode === 'DIRECT' ? 'Disabled for Direct receipt' : 'Courier AWB / handover reference'}/></Field>
        </div>
      </section>}

      {currentStep === 2 && <section className="panel workflowPanel productWorkflowPanel">
        <div className="sectionHead"><div><span className="step">03</span><div><h2>Product, Market Details & Repair Estimate</h2><p>Enter Product Name and Make / Model. The exact matching image and online price are fetched automatically, then the selected repair margin is calculated immediately.</p></div></div><button className="button" type="button" onClick={() => setJob(p => ({...p, products:[...p.products,newProduct()]}))}><Plus size={16}/> Add Product</button></div>
        <div className="productsStack">
          {job.products.map((p,i) => <div className="productCard" key={p.id}>
            <div className="productCardHead"><div><b>Product {i+1}</b><span className={`estimateState ${String(p.estimateStatus || 'PENDING_PRICE').toLowerCase()}`}>{label(p.estimateStatus || 'PENDING_PRICE')}</span></div>{job.products.length > 1 && <button type="button" className="iconButton danger" onClick={() => setJob(prev => ({...prev,products:prev.products.filter((_,idx)=>idx!==i)}))}><X size={17}/></button>}</div>
            <div className="formGrid four">
              <Field label="Product Name" required><input list="sf-product-names" autoComplete="off" value={p.productName} onChange={e => productNameWithSuggestion(i,e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && p.makeModel.trim()) { e.preventDefault(); triggerProductLookupNow(i); } }} placeholder="Type to reuse a saved product" title="Choose a saved product or enter a new Product Name; add Make / Model to start online lookup"/></Field>
              <Field label="Make / Model" required><input list="sf-product-models" autoComplete="off" value={p.makeModel} onChange={e => product(i,{makeModel:e.target.value})} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerProductLookupNow(i); } }} enterKeyHint="search" placeholder="Type or choose a saved model" title="Press Enter after Product Name + Model to search immediately; automatic lookup also starts after both fields are entered"/></Field>
              <Field label="Serial No"><input value={p.serialNo} onChange={e => product(i,{serialNo:e.target.value})}/></Field>
              <Field label="Qty"><input type="number" min="1" value={p.qty} onChange={e => product(i,{qty:Number(e.target.value)})}/></Field>
              <Field label="Product Status"><select value={p.status || job.status} onChange={e => product(i,{status:e.target.value as ProductStatus})}>{statuses.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Estimate Status"><select value={p.estimateStatus || 'PENDING_PRICE'} onChange={e => product(i,{estimateStatus:e.target.value as EstimateStatus})}>{estimateStatuses.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Customer Complaint" span="half"><input list="sf-complaints" autoComplete="off" value={p.complaint} onChange={e => product(i,{complaint:e.target.value})} placeholder="Type or choose a previous complaint"/></Field>
              <Field label="Repair / Work Required" span="half"><input list="sf-repair-work" autoComplete="off" value={p.repairWork} onChange={e => product(i,{repairWork:e.target.value})} placeholder="Type or choose previous repair work"/></Field>
            </div>
            <div className="repairPricingBox">
              {lookupBusy[p.id] && <div className="autoLookupStatus"><Sparkles size={14}/> Verifying exact product + model, then fetching its image, specifications and exact online price…</div>}
              {!lookupBusy[p.id] && p.productName.trim() && !p.makeModel.trim() && <div className="autoLookupStatus"><Sparkles size={14}/> Enter the Make / Model to start the exact product search.</div>}
              {!lookupBusy[p.id] && p.productName.trim() && p.makeModel.trim() && !p.onlineLookupQuery && <div className="autoLookupStatus"><Sparkles size={14}/> Press Enter to search now, or <button type="button" className="inlineLookupButton" onClick={() => triggerProductLookupNow(i)}>Search Product</button></div>}
              {(p.productImageUrl || p.productSpecifications) && <div className="onlineProductDetails">
                <div>
                  <div className="onlineProductImage">{p.productImageUrl ? <img src={p.productImageUrl} alt={p.productName}/> : <PackageOpen size={34}/>}</div>
                  {(p.productImageUrls || []).length > 1 && <div className="onlineImageThumbs">{(p.productImageUrls || []).slice(0,4).map((url,idx)=><button type="button" key={`${url}-${idx}`} className={url===p.productImageUrl?'active':''} onClick={()=>product(i,{productImageUrl:url})}><img src={url} alt={`${p.productName} ${idx+1}`}/></button>)}</div>}
                </div>
                <div className="onlineProductMeta">
                  {p.productSpecifications ? <p>{p.productSpecifications}</p> : <p>Specifications not found online.</p>}
                </div>
              </div>}
              <div className="formGrid four pricingGrid">
                <Field label="Current Market Price Used (INR)"><input type="text" inputMode="decimal" value={Number(p.onlinePrice || 0) > 0 ? String(p.onlinePrice) : ''} placeholder="" onChange={e => { const raw=e.target.value.replace(/[^0-9.]/g,''); product(i,{onlinePrice:raw === '' ? 0 : Number(raw),onlinePriceSource:'Manual price override',onlinePriceConfirmed:false,onlinePriceCheckedAt:'',estimateStatus:'PENDING_PRICE'}); }}/></Field>
                <Field label="Repair Category"><select value={p.repairCategory || 'MINIMUM_30'} onChange={e => product(i,{repairCategory:e.target.value as RepairCategory,onlinePriceConfirmed:false,onlinePriceCheckedAt:''})}><option value="MINIMUM_30">Minimum Repair · 30%</option><option value="MAXIMUM_50">Maximum Repair · 50%</option></select></Field>
                <Field label="Repair Margin (%)"><input type="number" min="0" max="100" step="1" value={Number(p.repairPercent ?? repairPercent(p.repairCategory))} onChange={e => product(i,{repairPercent:Number(e.target.value),onlinePriceConfirmed:false,onlinePriceCheckedAt:'',estimateStatus:'PENDING_PRICE'})}/></Field>
                <Field label="Calculated Repair Estimate"><div className="calculatedAmount"><Calculator size={16}/><b>{Number(p.repairEstimate || 0) > 0 ? `INR ${money(p.repairEstimate)}` : ''}</b></div></Field>
              </div>
              {Number(p.onlinePrice || 0) > 0 && <div className="formulaText">Exact online price INR {money(p.onlinePrice)} × {Number(p.repairPercent ?? repairPercent(p.repairCategory))}% = <b>INR {money(p.repairEstimate)}</b><small> · fetched after Product Name + Model match; the repair margin recalculates automatically</small></div>}
            </div>
          </div>)}
        </div>
        <div className="totalsBox">
          <div><span>Current Product Value</span><b>{totals.productValue > 0 ? `INR ${money(totals.productValue)}` : ''}</b></div>
          <div><span>Repair Estimate</span><b>{totals.repairEstimate > 0 ? `INR ${money(totals.repairEstimate)}` : ''}</b></div>
          <div className="discount"><span>Discount</span><input type="number" min="0" step="0.01" value={job.totals.discount} onChange={e => setJob(p=>({...p,totals:{...p.totals,discount:Number(e.target.value)}}))}/></div>
          <div className="grand totalEditable"><span>Total Estimate</span><div className="editableMoney"><span>INR</span><input type="text" inputMode="decimal" value={totals.totalEstimate > 0 ? String(totals.totalEstimate) : ''} placeholder="" onChange={e => { const raw=e.target.value.replace(/[^0-9.]/g,''); setJob(p=>({...p,totals:{...p.totals,totalEstimate:raw === '' ? 0 : Number(raw),totalEstimateManual:true}})); }}/></div></div>
        </div>
      </section>}

      {currentStep === 3 && <section className="panel proofPanel workflowPanel">
        <div className="sectionHead"><div><span className="step">04</span><div><h2>Service Proof</h2><p>Attach photos and videos for receipt, inspection, before/after repair, approval or dispatch.</p></div></div></div>
        <div className="proofControls">
          <Field label="Proof Type"><select value={proofCategory} onChange={e => setProofCategory(e.target.value as ProofCategory)}>{proofCategories.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
          <div className="uploadDrop" onClick={() => fileInput.current?.click()}>
            <Upload size={24}/><div><b>Add images / videos</b><span>Click to choose one or many files. Max 150 MB per file.</span></div>
            <input ref={fileInput} hidden type="file" multiple accept="image/*,video/*,.pdf" onChange={e => setPendingFiles(Array.from(e.target.files || []))}/>
          </div>
        </div>
        {pendingFiles.length > 0 && <div className="pendingProof"><b>Ready to upload when you save:</b>{pendingFiles.map((f,i)=><span key={`${f.name}-${i}`}>{f.type.startsWith('video/')?<Film size={15}/>:<Camera size={15}/>} {f.name}<button onClick={()=>setPendingFiles(p=>p.filter((_,idx)=>idx!==i))}><X size={14}/></button></span>)}</div>}
        <div className="proofGrid">
          {(job.attachments || []).map(a => <div className="proofCard" key={a.id}>
            <div className="proofPreview">{a.kind === 'IMAGE' ? <img src={`/api/jobs/${job.id}/attachments/${a.id}/file`} alt={a.fileName}/> : a.kind === 'VIDEO' ? <video src={`/api/jobs/${job.id}/attachments/${a.id}/file`} controls preload="metadata"/> : <FileText size={34}/>}</div>
            <div className="proofMeta"><b>{a.fileName}</b><span>{label(a.category)} · {(a.size/1024/1024).toFixed(2)} MB</span></div>
            <button type="button" className="iconButton danger" onClick={() => void removeAttachment(a)}><Trash2 size={16}/></button>
          </div>)}
          {!job.attachments?.length && !pendingFiles.length && <div className="proofEmpty"><FileImage size={30}/><span>No proof attached yet.</span></div>}
        </div>
      </section>}

      {currentStep === 4 && <section className="twoPanels workflowPanelGroup">
        <div className="panel">
          <div className="sectionHead"><div><span className="step">05</span><div><h2>Dispatch</h2><p>Complete when the instrument is ready.</p></div></div></div>
          <div className="formGrid two">
            <Field label="Tested By"><input list="sf-people" autoComplete="off" value={job.dispatch.testedBy} onChange={e=>dispatch('testedBy',e.target.value)}/></Field>
            <Field label="DC No"><input value={job.dispatch.dcNo} onChange={e=>dispatch('dcNo',e.target.value)}/></Field>
            <Field label="DC Date"><input type="date" value={job.dispatch.dcDate} onChange={e=>dispatch('dcDate',e.target.value)}/></Field>
            <Field label="Mode of Dispatch"><input list="sf-dispatch-modes" autoComplete="off" value={job.dispatch.mode} onChange={e=>dispatch('mode',e.target.value)} placeholder="Type or choose a previous mode"/></Field>
            <Field label="Dispatch Reference" span="full"><input value={job.dispatch.reference} onChange={e=>dispatch('reference',e.target.value)} placeholder="AWB / tracking / acknowledgement"/></Field>
          </div>
        </div>
        <div className="panel">
          <div className="sectionHead"><div><span className="step">06</span><div><h2>Payment</h2><p>Invoice and payment tracking.</p></div></div></div>
          <div className="formGrid two">
            <Field label="Invoice No"><input value={job.payment.invoiceNo} onChange={e=>payment('invoiceNo',e.target.value)}/></Field>
            <Field label="Invoice Date"><input type="date" value={job.payment.invoiceDate} onChange={e=>payment('invoiceDate',e.target.value)}/></Field>
            <Field label="Payment Mode"><select value={job.payment.mode} onChange={e=>payment('mode',e.target.value)}><option value="">Select payment mode</option><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Bank Transfer / NEFT / RTGS">Bank Transfer / NEFT / RTGS</option><option value="Card">Card</option><option value="Cheque">Cheque</option><option value="Credit / Pay Later">Credit / Pay Later</option><option value="Other">Other</option></select></Field>
            <Field label="Payment Reference"><input value={job.payment.reference} onChange={e=>payment('reference',e.target.value)}/></Field>
            <Field label="Payment Received By" span="full"><input list="sf-people" autoComplete="off" value={job.payment.receivedBy} onChange={e=>payment('receivedBy',e.target.value)}/></Field>
          </div>
        </div>
      </section>}

      {currentStep === 5 && <section className="panel workflowPanel">
        <div className="sectionHead"><div><span className="step">06</span><div><h2>Responsibility & Sign-off</h2><p>Know exactly who handled each service stage.</p></div></div></div>
        <div className="formGrid four">
          <Field label="Received By"><input list="sf-people" autoComplete="off" value={job.signoff.receivedBy} onChange={e=>signoff('receivedBy',e.target.value)}/></Field>
          <Field label="Inspected By"><input list="sf-people" autoComplete="off" value={job.signoff.inspectedBy} onChange={e=>signoff('inspectedBy',e.target.value)}/></Field>
          <Field label="Estimate Confirmed By"><input list="sf-people" autoComplete="off" value={job.signoff.estimateConfirmedBy} onChange={e=>signoff('estimateConfirmedBy',e.target.value)}/></Field>
          <Field label="Repaired By"><input list="sf-people" autoComplete="off" value={job.signoff.repairedBy} onChange={e=>signoff('repairedBy',e.target.value)}/></Field>
          <Field label="Internal / Service Notes" span="full"><textarea rows={3} value={job.notes} onChange={e=>setJob(p=>({...p,notes:e.target.value}))} placeholder="Any detail that should stay with this service record"/></Field>
        </div>
      </section>}

      {currentStep === 5 && job.id && <section className="panel exportPanel">
        <div><h2>Files & Export</h2><p>PDF for printing/sharing, Excel for records, JSON for local backup, or one ZIP containing everything including service proof.</p></div>
        <div className="exportButtons">
          <a className="button" href={`/api/jobs/${job.id}/export/pdf`}><FileText size={17}/> PDF</a>
          <a className="button" href={`/api/jobs/${job.id}/export/xlsx`}><FileSpreadsheet size={17}/> Excel</a>
          <a className="button" href={`/api/jobs/${job.id}/export/json`}><Download size={17}/> JSON</a>
          <a className="button primary" href={`/api/jobs/${job.id}/export/zip`}><PackageOpen size={17}/> Full ZIP + Proof</a>
        </div>
      </section>}

      <div className="workflowNav">
        <div className="workflowNavSummary"><b>{job.jobNo || 'New service job'}</b><span>Step {currentStep + 1} of 6 · {job.customer.name || 'Customer not entered'}</span></div>
        <div className="workflowNavActions">
          {currentStep > 0 && <button className="button" type="button" onClick={() => setCurrentStep(s => Math.max(0, s - 1))}><ArrowLeft size={16}/> Back</button>}
          {currentStep < 5 ? <button className="button primary large" type="button" onClick={() => setCurrentStep(s => Math.min(5, s + 1))}>Next Step <Check size={16}/></button> : <>
            <button className="button" type="button" onClick={() => setPreviewOpen(true)}><Eye size={16}/> Preview</button>
            {job.id && <button className="button dangerText" onClick={() => void deleteJob()}><Trash2 size={16}/> Delete</button>}
            <button className="button primary large" disabled={saving} onClick={() => void save()}><Save size={18}/>{saving?'Saving & Sending…':'Save & Preview'}</button>
          </>}
        </div>
      </div>
      {handwrittenImportOpen && <HandwrittenFormImport open={true} onClose={() => setHandwrittenImportOpen(false)} onApplyDraft={(draft:DraftJob) => {
        setJob(hydrateJob(draft));
        setCurrentStep(0);
        setSavedMessage('Scanned service form loaded. Review the details and continue.');
      }}/>}
      {previewOpen && <PaperJobCardPreview job={job} onClose={() => {
        setPreviewOpen(false);
        if (returnToDashboardAfterPreview) { router.replace('/'); router.refresh(); }
      }} />}
      {whatsappLoginOpen && <div className="modalBackdrop whatsappLoginModal" role="dialog" aria-modal="true">
        <div className="modalCard whatsappLoginPrompt">
          <div className="modalHead"><div><p className="eyebrow">WHATSAPP CONNECTION REQUIRED</p><h2>Connect WhatsApp to send the saved estimate</h2><p className="muted">Email can send independently. Open the official WhatsApp Web login on the main-server PC and link it once. The pending WhatsApp message will send automatically when the saved session becomes ready.</p></div><button className="iconButton" type="button" onClick={()=>setWhatsappLoginOpen(false)}><X size={18}/></button></div>
          <div className="whatsappQrCard large">
            {whatsappStatus?.ready ? <div className="whatsappReady"><Check size={44}/><b>{whatsappRetrying ? 'Connected — sending message…' : 'WhatsApp connected'}</b><span>The saved owner/server session is ready.</span></div> : <div className="whatsappReady"><Sparkles size={36}/><b>{whatsappStatus?.loginBrowserOpen ? 'Complete login in WhatsApp Web' : 'WhatsApp Web needs one-time linking'}</b><span>Use Open WhatsApp Web Login. In WhatsApp's official page you can scan its normal QR or choose “Link with phone number”.</span></div>}
          </div>
          {whatsappStatus?.lastError && <div className="notice error">{whatsappStatus.lastError}</div>}
          <div className="modalActions"><Link href="/settings" className="button">Open Connection Settings</Link>{!whatsappStatus?.ready && <button className="button" type="button" onClick={()=>void openWhatsAppWebLogin()} disabled={whatsappRetrying}>Open WhatsApp Web Login</button>}<button className="button primary" type="button" onClick={()=>void refreshWhatsAppLogin()} disabled={whatsappRetrying}>Refresh Status</button></div>
        </div>
      </div>}
    </div>
  );
}

function Field({ label: text, children, required, span }: { label: string; children: React.ReactNode; required?: boolean; span?: 'full'|'half' }) {
  return <div className={`field ${span ? `span-${span}` : ''}`}><label>{text}{required && <em>*</em>}</label>{children}</div>;
}
