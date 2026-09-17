export type MarketType = 'INDIA' | 'EXPORT'; // Legacy field retained for old saved records. V1.0.7 always uses INDIA.
export type OfficeType = 'HEAD_OFFICE' | 'BRANCH_OFFICE';
export type JobStatus =
  | 'DRAFT'
  | 'RECEIVED'
  | 'ESTIMATE_PENDING'
  | 'APPROVAL_PENDING'
  | 'REPAIRING'
  | 'READY'
  | 'DISPATCHED'
  | 'CLOSED';
export type ProductStatus = JobStatus;
export type RepairCategory = 'MINIMUM_30' | 'MAXIMUM_50';
export type EstimateStatus = 'PENDING_PRICE' | 'PRICE_CONFIRMED' | 'ESTIMATE_READY' | 'SENT_TO_CUSTOMER' | 'APPROVED';

export type ProofCategory =
  | 'RECEIPT'
  | 'INSPECTION'
  | 'BEFORE_REPAIR'
  | 'AFTER_REPAIR'
  | 'CUSTOMER_APPROVAL'
  | 'DISPATCH'
  | 'OTHER';

export interface ServiceProduct {
  id: string;
  productName: string;
  makeModel: string;
  serialNo: string;
  qty: number;
  status: ProductStatus;
  complaint: string;
  repairWork: string;
  productValue: number;
  repairEstimate: number;
  repairCategory: RepairCategory;
  repairPercent: number;
  onlinePrice: number;
  onlinePriceSource: string;
  onlinePriceConfirmed: boolean;
  onlinePriceCheckedAt: string;
  estimateStatus: EstimateStatus;
  productImageUrl: string;
  productSpecifications: string;
  onlineProductUrl: string;
  onlineDetailsTitle: string;
  onlineDetailsFetchedAt: string;
  onlineLookupQuery: string;
  productImageUrls: string[];
  marketPriceMin: number;
  marketPriceMax: number;
  marketPriceMedian: number;
  marketPriceSampleCount: number;
}

export interface ServiceAttachment {
  id: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  size: number;
  kind: 'IMAGE' | 'VIDEO' | 'OTHER';
  category: ProofCategory;
  uploadedAt: string;
}

export interface ServiceJob {
  id: string;
  jobNo: string;
  legacySerialNo: string;
  jobDate: string;
  status: JobStatus;
  marketType: MarketType;
  officeType: OfficeType;
  branchName: string;
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    state: string;
    country: string;
    gstin: string;
    currency: string;
    contactPerson: string;
  };
  receipt: {
    mrNo: string;
    mrDate: string;
    mode: 'COURIER' | 'DIRECT' | 'OTHER';
    reference: string;
  };
  products: ServiceProduct[];
  totals: {
    productValue: number;
    repairEstimate: number;
    discount: number;
    totalEstimate: number;
    totalEstimateManual?: boolean;
  };
  dispatch: {
    testedBy: string;
    dcNo: string;
    dcDate: string;
    mode: string;
    reference: string;
  };
  payment: {
    invoiceNo: string;
    invoiceDate: string;
    mode: string;
    reference: string;
    receivedBy: string;
  };
  signoff: {
    receivedBy: string;
    inspectedBy: string;
    estimateConfirmedBy: string;
    repairedBy: string;
  };
  notes: string;
  attachments: ServiceAttachment[];
  communication?: {
    lastAutoSendFingerprint?: string;
    lastEmailFingerprint?: string;
    lastWhatsappFingerprint?: string;
    lastAutoSentAt?: string;
    emailStatus?: string;
    emailDetail?: string;
    emailSentAt?: string;
    whatsappStatus?: string;
    whatsappDetail?: string;
    whatsappSentAt?: string;
    lastError?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  companyName: string;
  branchNames: string[];
  defaultBranch: string;
  autoLookupProductDetails: boolean;
  autoSendOnSave: boolean;
  autoSendEmail: boolean;
  autoSendWhatsApp: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  senderName: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googleOAuthRefreshToken: string;
  googleOAuthEmail: string;
  formVisionEnabled: boolean;
  formVisionModel: string;
  geminiApiKey: string;
}

export interface JobsDatabase {
  version: 1;
  nextSerial: number;
  jobs: ServiceJob[];
}
