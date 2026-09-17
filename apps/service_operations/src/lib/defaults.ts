import type { AppSettings, ServiceJob, ServiceProduct } from '@/types/service-job';

// LAN-safe UUID generation. crypto.randomUUID() is restricted to secure browser
// contexts on some Chrome/Edge versions, so staff opening ServiceFlow over plain
// office LAN HTTP (for example http://192.168.x.x:5055) could crash before the
// first form rendered. getRandomValues() remains available for this use case.
export function createServiceId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* fall through for insecure LAN contexts */ }
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
  }
  // Extremely old browser fallback. IDs still remain unique enough for temporary
  // client-side product rows; the server assigns the persistent job identity.
  return `sf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'Nunes Instrumentation Service',
  branchNames: ['Head Office', 'Gandhipuram', 'Gopalapuram'],
  defaultBranch: 'Head Office',
  autoLookupProductDetails: true,
  autoSendOnSave: true,
  autoSendEmail: true,
  autoSendWhatsApp: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: 'nunuescbe@gmail.com',
  smtpPassword: '',
  senderName: 'Nunes Instrumentation Service',
  googleOAuthClientId: '',
  googleOAuthClientSecret: '',
  googleOAuthRefreshToken: '',
  googleOAuthEmail: '',
  formVisionEnabled: true,
  formVisionModel: 'gemini-2.5-flash',
  geminiApiKey: ''
};

export function newProduct(): ServiceProduct {
  return {
    id: createServiceId(),
    productName: '',
    makeModel: '',
    serialNo: '',
    qty: 1,
    status: 'RECEIVED',
    complaint: '',
    repairWork: '',
    productValue: 0,
    repairEstimate: 0,
    repairCategory: 'MINIMUM_30',
    repairPercent: 30,
    onlinePrice: 0,
    onlinePriceSource: '',
    onlinePriceConfirmed: false,
    onlinePriceCheckedAt: '',
    estimateStatus: 'PENDING_PRICE',
    productImageUrl: '',
    productSpecifications: '',
    onlineProductUrl: '',
    onlineDetailsTitle: '',
    onlineDetailsFetchedAt: '',
    onlineLookupQuery: '',
    productImageUrls: [],
    marketPriceMin: 0,
    marketPriceMax: 0,
    marketPriceMedian: 0,
    marketPriceSampleCount: 0
  };
}

export function blankJob(): Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    legacySerialNo: '',
    jobDate: today,
    status: 'RECEIVED',
    marketType: 'INDIA',
    officeType: 'HEAD_OFFICE',
    branchName: 'Head Office',
    customer: {
      name: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      country: 'India',
      gstin: '',
      currency: 'INR',
      contactPerson: ''
    },
    receipt: { mrNo: '', mrDate: today, mode: 'DIRECT', reference: '' },
    products: [newProduct()],
    totals: { productValue: 0, repairEstimate: 0, discount: 0, totalEstimate: 0, totalEstimateManual: false },
    dispatch: { testedBy: '', dcNo: '', dcDate: '', mode: '', reference: '' },
    payment: { invoiceNo: '', invoiceDate: '', mode: '', reference: '', receivedBy: '' },
    signoff: { receivedBy: '', inspectedBy: '', estimateConfirmedBy: '', repairedBy: '' },
    notes: '',
    attachments: []
  };
}
