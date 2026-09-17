import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { parseHandwrittenServiceForm } from '@/lib/form-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELDS = [
  'paperSerial','jobDate','customerName','phone','city','address','email','mrNo','mrDate','receiptReference',
  'repairPlan','productName','makeModel','serialNo','qty','repairWork','productValue','repairCost','total','discount',
  'totalEstimate','testedBy','dcNo','dcDate','dispatchMode','dispatchReference','invoiceNo','invoiceDate','paymentMode',
  'paymentReference','paymentReceivedBy','receivedBy','inspectedBy','estimateConfirmedBy','repairedBy'
] as const;

type GeminiExtraction = {
  fields: Record<(typeof FIELDS)[number], string>;
  receiptMode: 'DIRECT' | 'COURIER' | 'OTHER' | 'UNKNOWN';
  officeType: 'HEAD_OFFICE' | 'BRANCH_OFFICE' | 'UNKNOWN';
  overallConfidence: number;
  needsReview: string[];
};

const FIELD_SCHEMA:Record<string,unknown> = Object.fromEntries(FIELDS.map((key) => [key, { type:'STRING' }]));
const RESPONSE_SCHEMA = {
  type:'OBJECT',
  properties:{
    fields:{ type:'OBJECT', properties:FIELD_SCHEMA, required:[...FIELDS] },
    receiptMode:{ type:'STRING', enum:['DIRECT','COURIER','OTHER','UNKNOWN'] },
    officeType:{ type:'STRING', enum:['HEAD_OFFICE','BRANCH_OFFICE','UNKNOWN'] },
    overallConfidence:{ type:'NUMBER' },
    needsReview:{ type:'ARRAY', items:{ type:'STRING' } }
  },
  required:['fields','receiptMode','officeType','overallConfidence','needsReview']
};

function parseDataUrl(value:unknown) {
  if (typeof value !== 'string' || value.length > 18_000_000) return null;
  const match = value.match(/^data:(image\/jpeg|image\/jpg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return { mimeType:match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase(), data:match[2] };
}

function responseText(payload:any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part:any) => typeof part?.text === 'string' ? part.text : '').join('').trim();
}

function stripJsonFence(text:string) {
  return text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
}

const PROMPT = `Read the attached photographed, scanned, or PDF SERVICE JOB CARD used by Nunes Instrumentation.

Your job is data extraction, not summarization. Read the handwriting and printed selections directly from the document and return the structured JSON required by the response schema.

Rules:
- Never invent a value. If a handwritten value is blank or genuinely uncertain, return an empty string and add that field name to needsReview.
- Ignore printed labels except to understand where handwritten values belong.
- paperSerial: service-card serial number only.
- jobDate, mrDate, dcDate, invoiceDate: preserve the visible date as DD/MM/YYYY or DD/MM/YY when readable.
- phone: return only confidently readable phone digits. Do not guess missing digits.
- customerName, city, address, email: use the Customer Details area.
- receiptMode: inspect Courier / Direct checkboxes or marks.
- officeType: inspect Head Office / Branch Office checkboxes or marks.
- mrNo, mrDate, receiptReference: use Receipt Details only.
- repairPlan: if the card contains MIN/MAX, Minimum/Maximum, 30%/50%, return the visible choice; otherwise blank.
- Product Details: separate productName, makeModel and serialNo only when visually defensible. qty comes from Qty. repairWork comes from Repair.
- productValue comes only from Product Value (incl. GST). repairCost comes only from Repair Cost Estimate.
- total, discount and totalEstimate come from their own rows. Never copy a neighboring amount into a blank row and never calculate a missing handwritten value.
- testedBy, dcNo, dcDate, dispatchMode and dispatchReference come only from Dispatch Details.
- invoiceNo, invoiceDate, paymentMode, paymentReference and paymentReceivedBy come only from Payment Details.
- receivedBy, inspectedBy, estimateConfirmedBy and repairedBy come from the four sign-off boxes at the bottom.
- Monetary values should contain the handwritten numeric expression/result only, without currency words.
- overallConfidence must be 0-100 and reflect confidence in the complete transcription.
- Return JSON only.`;

export async function POST(request:Request) {
  try {
    const settings = await getSettings();
    if (!settings.formVisionEnabled) {
      return NextResponse.json({ error:'Gemini form reader is disabled in Settings.', code:'GEMINI_DISABLED' }, { status:428 });
    }
    const apiKey = String(settings.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      return NextResponse.json({ error:'Gemini API key is not configured. Add it in Settings → AI Handwritten Form Reader.', code:'GEMINI_NOT_CONFIGURED' }, { status:428 });
    }

    const body = await request.json();
    const file = parseDataUrl(body?.fileDataUrl);
    if (!file) return NextResponse.json({ error:'Service-form image/PDF is missing, unsupported, or too large. Use JPG, PNG, WEBP or PDF under about 12 MB.' }, { status:400 });

    const model = String(settings.formVisionModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response:Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-goog-api-key':apiKey },
        body:JSON.stringify({
          contents:[{ role:'user', parts:[
            { inlineData:{ mimeType:file.mimeType, data:file.data } },
            { text:PROMPT }
          ] }],
          generationConfig:{
            temperature:0.05,
            topP:0.8,
            maxOutputTokens:3500,
            responseMimeType:'application/json',
            responseSchema:RESPONSE_SCHEMA
          }
        }),
        signal:controller.signal
      });
    } finally { clearTimeout(timer); }

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error:raw?.error?.message || `Gemini Vision request failed with HTTP ${response.status}.`, code:'GEMINI_REQUEST_FAILED' }, { status:502 });
    }
    const text = stripJsonFence(responseText(raw));
    if (!text) return NextResponse.json({ error:'Gemini Vision returned no structured form data.', code:'GEMINI_EMPTY' }, { status:502 });

    let parsed:GeminiExtraction;
    try { parsed = JSON.parse(text) as GeminiExtraction; }
    catch { return NextResponse.json({ error:'Gemini Vision returned unreadable structured data.', code:'GEMINI_BAD_JSON' }, { status:502 }); }

    const fields:Record<string,string> = {};
    for (const key of FIELDS) fields[key] = String(parsed.fields?.[key] || '').trim();
    fields.receiptMode = parsed.receiptMode === 'UNKNOWN' ? '' : parsed.receiptMode;
    fields.officeType = parsed.officeType === 'UNKNOWN' ? '' : parsed.officeType;
    fields.productDescription = [fields.productName, fields.makeModel, fields.serialNo ? `S/N ${fields.serialNo}` : ''].filter(Boolean).join(' ');

    const result = parseHandwrittenServiceForm('', {
      fields,
      method:'GEMINI',
      model,
      visionConfidence:Number(parsed.overallConfidence || 0),
      visionWarnings:Array.isArray(parsed.needsReview) ? parsed.needsReview.map((x) => `Gemini marked ${String(x)} for review.`) : []
    });
    return NextResponse.json({ ...result, method:'GEMINI', provider:'gemini', model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = /aborted|abort/i.test(message);
    return NextResponse.json({ error:timeout ? 'Gemini Vision timed out. Please retry with a clear image of the complete form.' : message, code:timeout ? 'GEMINI_TIMEOUT' : 'GEMINI_ERROR' }, { status:502 });
  }
}
