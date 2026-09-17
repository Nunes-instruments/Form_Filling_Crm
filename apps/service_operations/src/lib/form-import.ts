import { blankJob, newProduct } from './defaults';
import type { RepairCategory, ServiceJob, ServiceProduct } from '@/types/service-job';

export type ParsedFormResult = {
  draft: Omit<ServiceJob, 'id' | 'jobNo' | 'createdAt' | 'updatedAt'>;
  detected: string[];
  warnings: string[];
  confidence: number;
};

export type StructuredFormVision = {
  fields?: Record<string,string>;
  checkboxes?: { courierScore?:number; directScore?:number; headScore?:number; branchScore?:number };
  normalized?: boolean;
  method?: 'GEMINI';
  model?: string;
  visionConfidence?: number;
  visionWarnings?: string[];
};

function tidy(value: string) {
  return String(value || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[•·]{2,}/g, ' ')
    .replace(/\.{3,}/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\|\s*/g, ' ')
    .trim();
}

function linesOf(text: string) {
  return String(text || '').replace(/\r/g, '\n').split(/\n+/).map(tidy).filter(Boolean);
}

function norm(value: string) {
  return tidy(value).toLowerCase().replace(/[^a-z0-9@.+/%-]+/g, ' ');
}

function stripFieldNoise(value:string) {
  return tidy(String(value||'')
    .replace(/\bFIELD\s*[0-9O]{1,2}\b/ig,' ')
    .replace(/^(?:name|phone|city|address|email|date|mr\.?\s*no|mr\.?\s*date|receipt\s*reference|product\s*value|repair\s*cost|estimate|total|discount)\s*[:.-]*/i,''));
}

function labelValue(lines: string[], labels: RegExp[]) {
  for (const line of lines) {
    for (const label of labels) {
      const m = line.match(label);
      if (!m) continue;
      const tail = tidy(line.slice((m.index || 0) + m[0].length).replace(/^\s*[:\-–|]+\s*/, ''));
      if (tail && !/^(details?|no\.?|date)$/i.test(tail)) return tail;
    }
  }
  return '';
}

function explicitLabelValue(lines: string[], labels: RegExp[]) {
  for (const line of lines) {
    for (const label of labels) {
      const m = line.match(label);
      if (!m) continue;
      const after = line.slice((m.index || 0) + m[0].length);
      if (!/^\s*[:#-]/.test(after)) continue;
      const tail = tidy(after.replace(/^\s*[:#-]+\s*/, ''));
      if (tail) return tail;
    }
  }
  return '';
}

function normalizeDigitLike(value:string) {
  return String(value||'')
    .replace(/[OoQq]/g,'0')
    .replace(/[Il|!]/g,'1')
    .replace(/[Ss]/g,'5')
    .replace(/[Bb]/g,'8');
}

function parsePhone(value:string) {
  const mapped=normalizeDigitLike(value).replace(/[^0-9+]/g,'');
  const digits=mapped.replace(/\D/g,'');
  const variants:string[]=[];
  if(digits.length>=10) variants.push(digits.slice(-10));
  if(digits.length===12 && digits.startsWith('91')) variants.unshift(digits.slice(2));
  for(const v of variants) if(/^[6-9]\d{9}$/.test(v)) return v;
  return '';
}

function parseEmail(value:string) {
  const m=String(value||'').replace(/\s+/g,'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m?.[0] || '';
}

function parseDate(value: string) {
  const raw = normalizeDigitLike(String(value || '')).replace(/\s+/g,'').trim();
  if (!raw) return '';
  const ymd = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2,'0')}-${String(Number(ymd[3])).padStart(2,'0')}`;
  const dmy = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|19\d{2}|\d{2})\b/);
  if (dmy) {
    const day=Number(dmy[1]), month=Number(dmy[2]);
    if(day<1||day>31||month<1||month>12) return '';
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return '';
}

function amountCandidates(value:string) {
  let s=normalizeDigitLike(value).replace(/₹|INR|Rs\.?/gi,' ');
  // Keep decimal dots only when clearly used as a decimal separator; handwriting often inserts dots between digits.
  s=s.replace(/(?<=\d)[.](?=\d{3}(?:\D|$))/g,'');
  const out:number[]=[];
  const re=/\d[\d, .]{1,14}/g;
  for(const m of s.match(re)||[]){
    const raw=m.trim();
    const after=s.slice((s.indexOf(m)+m.length),s.indexOf(m)+m.length+2);
    if(/^\s*%/.test(after)) continue;
    const cleaned=raw.replace(/[ ,]/g,'').replace(/\.(?=.*\.)/g,'');
    const n=Number(cleaned);
    if(Number.isFinite(n) && n>=10 && n<=100000000) out.push(n);
  }
  return out;
}

function parseMoney(value: string, preferLast=true) {
  const nums=amountCandidates(value);
  if(!nums.length) return 0;
  return preferLast?nums[nums.length-1]:nums[0];
}

function valueNearLabel(lines: string[], label: RegExp) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const tail = tidy(lines[i].slice((m.index || 0) + m[0].length).replace(/^\s*[:\-–|]+\s*/, ''));
    const same = parseMoney(tail);
    if (same > 0) return same;
    const next = parseMoney(lines[i + 1] || '');
    if (next > 0) return next;
  }
  return 0;
}

function parseQty(value: string) {
  const mapped=normalizeDigitLike(value);
  const n = Number((mapped.match(/\b\d{1,3}\b/) || ['1'])[0]);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 1;
}

function guessRepairPlan(text: string): { category: RepairCategory; percent: number } {
  const n = norm(text);
  if (/maximum|\bmax\b|50\s*%/.test(n)) return { category:'MAXIMUM_50', percent:50 };
  if (/minimum|\bmin\b|30\s*%/.test(n)) return { category:'MINIMUM_30', percent:30 };
  return { category:'MINIMUM_30', percent:30 };
}

function cleanPerson(value:string) {
  const v=stripFieldNoise(value).replace(/[^A-Za-z .'-]/g,' ').replace(/\s+/g,' ').trim();
  return /[A-Za-z]{2}/.test(v)?v:'';
}

function cleanText(value:string) {
  const v=stripFieldNoise(value).replace(/[~_^=`]+/g,' ').replace(/\s+/g,' ').trim();
  return v.length>=2?v:'';
}

function productSection(lines: string[]) {
  const start = lines.findIndex(l => /product\s*details?/i.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /(dispatch\s*details?|payment\s*details?|tested\s*by)/i.test(l));
  if (end < 0) end = Math.min(lines.length, start + 25);
  return lines.slice(start + 1, end);
}

function stripHeader(line: string) {
  return /(product\s*name|make\/?\s*model|sl\.?\s*no|qty|product\s*value|repair\s*cost|estimate)/i.test(line) && !/\d/.test(line);
}

function splitProductIdentity(raw:string) {
  let text=cleanText(raw).replace(/\b(?:qty|repair|product|value|estimate)\b/ig,' ').replace(/\s+/g,' ').trim();
  if(!text) return {name:'',model:'',serial:''};
  let serial=''; let model='';
  const serialM=text.match(/(?:s\/?n|sl\.?\s*no|serial)\s*[:#-]?\s*([A-Z0-9\/-]{2,})/i);
  if(serialM){serial=serialM[1];text=tidy(text.replace(serialM[0],' '));}
  // Prefer a trailing alphanumeric model. Do not treat UV/VIS itself as a model.
  const terminal=text.match(/(?:^|\s|-)\b([A-Z]{1,8}[-/]?\d{1,8}[A-Z0-9\/-]*)\b\s*$/i);
  if(terminal && !/^UV\/?VIS$/i.test(terminal[1])){model=terminal[1];text=tidy(text.slice(0,terminal.index));}
  return {name:text,model,serial};
}

function parseProductRowFallback(lines: string[], fullText: string): ServiceProduct {
  const base = newProduct();
  const section = productSection(lines).filter(l => !stripHeader(l));
  const explicitName = explicitLabelValue(lines, [/product\s*name\s*(?:&\s*make)?/i, /instrument\s*name/i]);
  const explicitModel = explicitLabelValue(lines, [/make\s*\/?\s*model/i, /model\s*(?:no\.?|number)?/i]);
  const explicitSerial = explicitLabelValue(lines, [/serial\s*(?:no\.?|number)/i, /sl\.?\s*no/i]);
  const explicitQty = explicitLabelValue(lines, [/\bqty\b/i, /quantity/i]);
  const explicitRepair = explicitLabelValue(lines, [/repair\s*(?:work|required|details?)/i, /problem|complaint/i]);

  let rowLine = '';
  for (const line of section) {
    const nums = line.match(/\d[\d,]*(?:\.\d+)?/g) || [];
    if (nums.length >= 2 && /[A-Za-z]/.test(line)) { rowLine = line; break; }
  }
  if (!rowLine) rowLine = section.find(l => /[A-Za-z]{3}/.test(l) && !/total|discount/i.test(l)) || '';

  const globalProductValue = valueNearLabel(lines, /product\s*value(?:\s*\(.*?\))?/i);
  const globalRepairCost = valueNearLabel(lines, /repair\s*cost(?:\s*estimate)?/i) || valueNearLabel(lines, /repairing\s*cost/i);
  const identity=splitProductIdentity(explicitName||rowLine);
  const plan = guessRepairPlan(fullText);
  let percent = plan.percent;
  if (globalProductValue > 0 && globalRepairCost > 0) {
    const ratio = globalRepairCost / globalProductValue * 100;
    if (ratio >= 1 && ratio <= 100) percent = Number(ratio.toFixed(2));
  }
  return {
    ...base,
    productName: tidy(explicitName||identity.name), makeModel:tidy(explicitModel||identity.model), serialNo:tidy(explicitSerial||identity.serial),
    qty:parseQty(explicitQty), repairWork:tidy(explicitRepair), productValue:globalProductValue, onlinePrice:globalProductValue,
    onlinePriceSource:globalProductValue>0?'Imported handwritten service form':'', onlinePriceConfirmed:globalProductValue>0,
    onlinePriceCheckedAt:globalProductValue>0?new Date().toISOString():'', repairCategory:plan.category, repairPercent:percent,
    repairEstimate:globalRepairCost, estimateStatus:globalProductValue>0&&globalRepairCost>0?'ESTIMATE_READY':'PENDING_PRICE'
  };
}

function structuredProduct(fields:Record<string,string>, fallback:ServiceProduct) {
  const desc=splitProductIdentity(fields.productDescription||'');
  const directName=cleanText(fields.productName||'');
  const directModel=cleanText(fields.makeModel||'');
  const directSerial=cleanText(fields.serialNo||'');
  const productValue=parseMoney(fields.productValue||'');
  const repairEstimate=parseMoney(fields.repairCost||'');
  const plan=guessRepairPlan(fields.repairPlan||'');
  let percent=plan.percent;
  if(productValue>0&&repairEstimate>0){const ratio=repairEstimate/productValue*100;if(ratio>=5&&ratio<=80)percent=Number(ratio.toFixed(2));}
  const hasIdentity=directName.length>=3 || desc.name.length>=3;
  return {
    ...fallback,
    productName:directName||(hasIdentity?desc.name:fallback.productName),
    makeModel:directModel||desc.model||fallback.makeModel,
    serialNo:directSerial||desc.serial||fallback.serialNo,
    qty:parseQty(fields.qty)||fallback.qty,
    repairWork:cleanText(fields.repairWork)||fallback.repairWork,
    productValue:productValue||fallback.productValue,
    onlinePrice:productValue||fallback.onlinePrice,
    onlinePriceSource:(productValue||fallback.productValue)>0?'Imported handwritten service form':'',
    onlinePriceConfirmed:(productValue||fallback.productValue)>0,
    onlinePriceCheckedAt:(productValue||fallback.productValue)>0?new Date().toISOString():'',
    repairCategory:plan.category,
    repairPercent:percent,
    repairEstimate:repairEstimate||fallback.repairEstimate,
    estimateStatus:(productValue||fallback.productValue)>0&&(repairEstimate||fallback.repairEstimate)>0?'ESTIMATE_READY':'PENDING_PRICE'
  } satisfies ServiceProduct;
}

function chooseCheckboxMode(structured?:StructuredFormVision) {
  const c=Number(structured?.checkboxes?.courierScore||0), d=Number(structured?.checkboxes?.directScore||0);
  if(d>c+.025 && d>.06) return 'DIRECT' as const;
  if(c>d+.025 && c>.06) return 'COURIER' as const;
  return null;
}

function chooseOffice(structured?:StructuredFormVision) {
  const h=Number(structured?.checkboxes?.headScore||0), b=Number(structured?.checkboxes?.branchScore||0);
  if(b>h+.025 && b>.06) return 'BRANCH_OFFICE' as const;
  if(h>b+.025 && h>.06) return 'HEAD_OFFICE' as const;
  return null;
}

export function parseHandwrittenServiceForm(text: string, structured:StructuredFormVision={}): ParsedFormResult {
  const lines = linesOf(text);
  const raw = lines.join('\n');
  const fields=structured.fields||{};
  const draft = blankJob();
  const detected: string[] = [];
  const warnings: string[] = [];

  const fallbackCustomerName = labelValue(lines, [/^name\b/i, /customer\s*(?:name)?/i]);
  const fallbackPhone = labelValue(lines, [/phone/i, /mobile/i, /whatsapp/i]);
  const fallbackCity = labelValue(lines, [/^city\b/i]);
  const fallbackAddress = labelValue(lines, [/^address\b/i]);
  const fallbackEmail = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'';

  const serial=normalizeDigitLike(fields.paperSerial||labelValue(lines,[/s\.?\s*no\.?/i])).replace(/[^A-Z0-9\/-]/gi,'').slice(0,30);
  const jobDate=parseDate(fields.jobDate||labelValue(lines,[/^date\b/i]));
  const customerName=cleanPerson(fields.customerName)||cleanPerson(fallbackCustomerName);
  const phone=parsePhone(fields.phone||fallbackPhone||raw);
  const email=parseEmail(fields.email||fallbackEmail);
  const city=cleanText(fields.city)||cleanText(fallbackCity);
  const address=cleanText(fields.address)||cleanText(fallbackAddress);

  if(serial){draft.legacySerialNo=serial;detected.push('paper serial number');}
  if(jobDate){draft.jobDate=jobDate;detected.push('job date');}
  if(customerName){draft.customer.name=customerName;detected.push('customer name');}
  if(phone){draft.customer.phone=phone;detected.push('customer phone');}
  if(email){draft.customer.email=email;detected.push('customer email');}
  if(city){draft.customer.city=city;detected.push('city');}
  if(address){draft.customer.address=address;detected.push('address');}

  const mrNo=cleanText(fields.mrNo)||cleanText(labelValue(lines,[/mr\.?\s*no\.?/i]));
  const mrDate=parseDate(fields.mrDate||labelValue(lines,[/mr\.?\s*date/i]));
  const receiptRef=cleanText(fields.receiptReference)||cleanText(labelValue(lines,[/receipt\s*reference/i]));
  if(mrNo){draft.receipt.mrNo=mrNo;detected.push('MR number');}
  if(mrDate)draft.receipt.mrDate=mrDate;
  const directReceipt=String(fields.receiptMode||'').toUpperCase();
  const mode=directReceipt.includes('DIRECT') ? 'DIRECT' as const : directReceipt.includes('COURIER') ? 'COURIER' as const : chooseCheckboxMode(structured);
  if(mode) draft.receipt.mode=mode;
  else {
    const courierMarked=/(?:\[?x\]?|✓|✔)\s*courier|courier\s*(?:\[?x\]?|✓|✔)/i.test(raw);
    const directMarked=/(?:\[?x\]?|✓|✔)\s*direct|direct\s*(?:\[?x\]?|✓|✔)/i.test(raw);
    if(courierMarked&&!directMarked)draft.receipt.mode='COURIER';
    if(directMarked)draft.receipt.mode='DIRECT';
  }
  draft.receipt.reference=draft.receipt.mode==='DIRECT'?'':receiptRef;
  const directOffice=String(fields.officeType||'').toUpperCase();
  const office=directOffice.includes('BRANCH') ? 'BRANCH_OFFICE' as const : directOffice.includes('HEAD') ? 'HEAD_OFFICE' as const : chooseOffice(structured);
  if(office)draft.officeType=office;

  const fallbackProduct=parseProductRowFallback(lines,raw);
  const product=structuredProduct(fields,fallbackProduct);
  draft.products=[product];
  if(product.productName)detected.push('product');
  if(product.makeModel)detected.push('model');
  if(product.repairWork)detected.push('repair problem');
  if(product.productValue>0)detected.push('product/current price');
  if(product.repairEstimate>0)detected.push('repair cost');

  const total=parseMoney(fields.total||'')||valueNearLabel(lines,/^total\b/i);
  const discount=parseMoney(fields.discount||'')||valueNearLabel(lines,/discount/i);
  const totalEstimate=parseMoney(fields.totalEstimate||'')||valueNearLabel(lines,/total\s*estimate/i)||valueNearLabel(lines,/final\s*total/i);
  draft.totals.productValue=product.productValue*product.qty;
  draft.totals.repairEstimate=product.repairEstimate*product.qty||total;
  draft.totals.discount=discount;
  draft.totals.totalEstimate=totalEstimate||total||Math.max(0,draft.totals.repairEstimate-discount);
  draft.totals.totalEstimateManual=Boolean(totalEstimate||total);
  if(discount>0)detected.push('discount');
  if(draft.totals.totalEstimate>0)detected.push('total estimate');

  draft.dispatch.testedBy=cleanPerson(fields.testedBy)||cleanText(labelValue(lines,[/tested\s*by/i]));
  draft.dispatch.dcNo=cleanText(fields.dcNo)||cleanText(labelValue(lines,[/dc\.?\s*no\.?/i]));
  draft.dispatch.dcDate=parseDate(fields.dcDate||labelValue(lines,[/dc\.?\s*date/i]));
  draft.dispatch.mode=cleanText(fields.dispatchMode)||cleanText(labelValue(lines,[/mode\s*of\s*dispatch/i]));
  draft.dispatch.reference=cleanText(fields.dispatchReference)||cleanText(labelValue(lines,[/dispatch\s*reference/i]));
  draft.payment.invoiceNo=cleanText(fields.invoiceNo)||cleanText(labelValue(lines,[/invoice\s*no\.?/i]));
  draft.payment.invoiceDate=parseDate(fields.invoiceDate||labelValue(lines,[/invoice\s*date/i]));
  draft.payment.mode=cleanText(fields.paymentMode)||cleanText(labelValue(lines,[/payment\s*mode/i]));
  draft.payment.reference=cleanText(fields.paymentReference)||cleanText(labelValue(lines,[/payment\s*reference/i]));
  draft.payment.receivedBy=cleanPerson(fields.paymentReceivedBy)||cleanText(labelValue(lines,[/payment\s*received\s*by/i]));

  draft.signoff.receivedBy=cleanPerson(fields.receivedBy)||cleanPerson(labelValue(lines,[/received\s*by/i]));
  draft.signoff.inspectedBy=cleanPerson(fields.inspectedBy)||cleanPerson(labelValue(lines,[/inspected\s*by/i]));
  draft.signoff.estimateConfirmedBy=cleanPerson(fields.estimateConfirmedBy)||cleanPerson(labelValue(lines,[/estimate\s*confirmed\s*by/i]));
  draft.signoff.repairedBy=cleanPerson(fields.repairedBy)||cleanPerson(labelValue(lines,[/repaired\s*by/i]));

  if(!draft.customer.name)warnings.push('Customer name was not read confidently. Please review it.');
  if(!draft.customer.phone&&fields.phone)warnings.push('The phone handwriting was detected but did not validate as a 10-digit Indian mobile number. Please review it.');
  if(!product.productName)warnings.push('Product name was not read confidently. Please review the Product step.');
  if(!product.makeModel)warnings.push('Model was not separated confidently from the combined Product/Make/Model/SI.No box. Enter it if required for online matching.');
  if(!draft.customer.phone&&!draft.customer.email)warnings.push('No valid customer phone/email was detected. Saving still works; customer messaging will be skipped until a channel is entered.');
  if(!product.productValue&&!product.repairEstimate)warnings.push('No reliable handwritten product/repair price was detected. Enter the price or run online product search.');
  if(Array.isArray(structured.visionWarnings)) warnings.push(...structured.visionWarnings.filter(Boolean));

  const targetFields=14;
  const validationConfidence=Math.min(100,Math.round((new Set(detected).size/targetFields)*100));
  const modelConfidence=Number(structured.visionConfidence||0);
  const confidence=structured.method==='GEMINI' && modelConfidence>0
    ? Math.max(0,Math.min(100,Math.round(validationConfidence*.50 + modelConfidence*.50)))
    : validationConfidence;
  const methodNote=`Imported from handwritten service form using Gemini Vision (${structured.model||'Gemini'}) plus local field validation. Review parsed values before Save & Preview.`;
  draft.notes=tidy([draft.notes,methodNote].filter(Boolean).join(' '));
  return { draft, detected:[...new Set(detected)], warnings:[...new Set(warnings)], confidence };
}
