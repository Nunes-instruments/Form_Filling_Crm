import { z } from 'zod';

const statusSchema = z.enum(['DRAFT','RECEIVED','ESTIMATE_PENDING','APPROVAL_PENDING','REPAIRING','READY','DISPATCHED','CLOSED']);
const repairCategorySchema = z.enum(['MINIMUM_30','MAXIMUM_50']);
const estimateStatusSchema = z.enum(['PENDING_PRICE','PRICE_CONFIRMED','ESTIMATE_READY','SENT_TO_CUSTOMER','APPROVED']);

const productSchema = z.object({
  id: z.string().optional(),
  productName: z.string().default(''),
  makeModel: z.string().default(''),
  serialNo: z.string().default(''),
  qty: z.coerce.number().min(0).default(1),
  status: statusSchema.default('RECEIVED'),
  complaint: z.string().default(''),
  repairWork: z.string().default(''),
  productValue: z.coerce.number().min(0).default(0),
  repairEstimate: z.coerce.number().min(0).default(0),
  repairCategory: repairCategorySchema.default('MINIMUM_30'),
  repairPercent: z.coerce.number().min(0).max(100).default(30),
  onlinePrice: z.coerce.number().min(0).default(0),
  onlinePriceSource: z.string().default(''),
  onlinePriceConfirmed: z.coerce.boolean().default(false),
  onlinePriceCheckedAt: z.string().default(''),
  estimateStatus: estimateStatusSchema.default('PENDING_PRICE'),
  productImageUrl: z.string().default(''),
  productSpecifications: z.string().default(''),
  onlineProductUrl: z.string().default(''),
  onlineDetailsTitle: z.string().default(''),
  onlineDetailsFetchedAt: z.string().default(''),
  onlineLookupQuery: z.string().default(''),
  productImageUrls: z.array(z.string()).default([]),
  marketPriceMin: z.coerce.number().min(0).default(0),
  marketPriceMax: z.coerce.number().min(0).default(0),
  marketPriceMedian: z.coerce.number().min(0).default(0),
  marketPriceSampleCount: z.coerce.number().int().min(0).default(0)
});

export const jobInputSchema = z.object({
  legacySerialNo: z.string().default(''),
  jobDate: z.string().min(1),
  status: statusSchema,
  marketType: z.enum(['INDIA', 'EXPORT']).default('INDIA'),
  officeType: z.enum(['HEAD_OFFICE', 'BRANCH_OFFICE']),
  branchName: z.string().default(''),
  customer: z.object({
    name: z.string().min(1, 'Customer name is required'),
    phone: z.string().default(''),
    email: z.string().default(''),
    address: z.string().default(''),
    city: z.string().default(''),
    state: z.string().default(''),
    country: z.string().default('India'),
    gstin: z.string().default(''),
    currency: z.string().default('INR'),
    contactPerson: z.string().default('')
  }),
  receipt: z.object({
    mrNo: z.string().default(''),
    mrDate: z.string().default(''),
    mode: z.enum(['COURIER', 'DIRECT', 'OTHER']),
    reference: z.string().default('')
  }),
  products: z.array(productSchema).min(1),
  totals: z.object({
    productValue: z.coerce.number().default(0),
    repairEstimate: z.coerce.number().default(0),
    discount: z.coerce.number().min(0).default(0),
    totalEstimate: z.coerce.number().default(0),
    totalEstimateManual: z.coerce.boolean().default(false)
  }),
  dispatch: z.object({
    testedBy: z.string().default(''),
    dcNo: z.string().default(''),
    dcDate: z.string().default(''),
    mode: z.string().default(''),
    reference: z.string().default('')
  }),
  payment: z.object({
    invoiceNo: z.string().default(''),
    invoiceDate: z.string().default(''),
    mode: z.string().default(''),
    reference: z.string().default(''),
    receivedBy: z.string().default('')
  }),
  signoff: z.object({
    receivedBy: z.string().default(''),
    inspectedBy: z.string().default(''),
    estimateConfirmedBy: z.string().default(''),
    repairedBy: z.string().default('')
  }),
  notes: z.string().default(''),
  attachments: z.array(z.any()).default([])
});
