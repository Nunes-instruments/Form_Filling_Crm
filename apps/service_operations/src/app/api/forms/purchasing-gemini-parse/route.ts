import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { normalizeGeminiModel } from '@/lib/gemini-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESPONSE_SCHEMA:any = {
  type:'OBJECT',
  properties:{
    quoteNo:{type:'STRING'}, quoteDate:{type:'STRING'}, customerName:{type:'STRING'},
    place:{type:'STRING'}, terms:{type:'STRING'}, marketType:{type:'STRING',enum:['IND','EXPORT','UNKNOWN']},
    marketingPerson:{type:'STRING'}, deliveryPeriod:{type:'STRING'},
    servicePerson:{type:'STRING'}, serviceDate:{type:'STRING'}, serviceAmount:{type:'STRING'},
    items:{type:'ARRAY',items:{type:'OBJECT',properties:{
      itemName:{type:'STRING'}, model:{type:'STRING'}, qty:{type:'STRING'},
      itemValue:{type:'STRING'}, addCharge:{type:'STRING'}
    },required:['itemName','model','qty','itemValue','addCharge']}},
    overallConfidence:{type:'NUMBER'},
    needsReview:{type:'ARRAY',items:{type:'STRING'}}
  },
  required:['quoteNo','quoteDate','customerName','place','terms','marketType','marketingPerson','deliveryPeriod','servicePerson','serviceDate','serviceAmount','items','overallConfidence','needsReview']
};

function parseDataUrl(value:unknown) {
  if (typeof value !== 'string' || value.length > 18_000_000) return null;
  const match=value.match(/^data:(image\/jpeg|image\/jpg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i);
  if(!match)return null;
  return {mimeType:match[1].toLowerCase()==='image/jpg'?'image/jpeg':match[1].toLowerCase(),data:match[2]};
}
function responseText(payload:any){
  const parts=payload?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)?parts.map((p:any)=>typeof p?.text==='string'?p.text:'').join('').trim():'';
}
function stripFence(value:string){return value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();}

const PROMPT=`Read the attached NUNES PURCHASING / ORDER FORM image, scan, or PDF and extract only values that are visibly present.

Return the response schema exactly.

Rules:
- Never invent or calculate missing values.
- quoteNo, quoteDate, customerName, place, terms, marketingPerson and deliveryPeriod come from the Marketing / Order header.
- marketType: return IND or EXPORT only when visibly selected/written; otherwise UNKNOWN.
- servicePerson, serviceDate and serviceAmount come from the Demo / Installation / Calibration service line when present.
- items must contain each visible product/order row, in visible order.
- itemName = product/item name only.
- model = model number/name only.
- qty = visible quantity.
- itemValue = visible item value/price.
- addCharge = visible additional charge.
- Preserve readable dates as DD/MM/YYYY, DD/MM/YY or YYYY-MM-DD according to what is visible.
- Numeric values should contain only the visible numeric expression, without currency words.
- If a field is blank or uncertain, return an empty string and add its name to needsReview.
- overallConfidence is 0-100 for the complete transcription.
- Return JSON only.`;

export async function POST(request:Request){
  try{
    const settings=await getSettings();
    if(!settings.formVisionEnabled)return NextResponse.json({error:'Gemini form reader is disabled in Servicing Settings.',code:'GEMINI_DISABLED'},{status:428});
    const apiKey=String(settings.geminiApiKey||process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey)return NextResponse.json({error:'Gemini API key is not configured.',code:'GEMINI_NOT_CONFIGURED'},{status:428});
    const body=await request.json();
    const file=parseDataUrl(body?.fileDataUrl);
    if(!file)return NextResponse.json({error:'Purchasing form image/PDF is missing, unsupported, or too large.'},{status:400});
    const model=normalizeGeminiModel(settings.formVisionModel||process.env.GEMINI_MODEL);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
    let response:Response;
    try{
      response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        body:JSON.stringify({contents:[{role:'user',parts:[{inlineData:{mimeType:file.mimeType,data:file.data}},{text:PROMPT}]}],generationConfig:{maxOutputTokens:3500,responseMimeType:'application/json',responseSchema:RESPONSE_SCHEMA}}),
        signal:controller.signal
      });
    }finally{clearTimeout(timer);}
    const raw=await response.json().catch(()=>({}));
    if(!response.ok)return NextResponse.json({error:raw?.error?.message||`Gemini Vision request failed with HTTP ${response.status}.`,code:'GEMINI_REQUEST_FAILED'},{status:502});
    const text=stripFence(responseText(raw));
    if(!text)return NextResponse.json({error:'Gemini Vision returned no purchasing data.',code:'GEMINI_EMPTY'},{status:502});
    let parsed:any;try{parsed=JSON.parse(text)}catch{return NextResponse.json({error:'Gemini Vision returned unreadable purchasing data.',code:'GEMINI_BAD_JSON'},{status:502})}
    const items=Array.isArray(parsed.items)?parsed.items.slice(0,25).map((x:any)=>({
      itemName:String(x?.itemName||'').trim(),model:String(x?.model||'').trim(),qty:String(x?.qty||'').trim(),
      itemValue:String(x?.itemValue||'').trim(),addCharge:String(x?.addCharge||'').trim()
    })):[];
    return NextResponse.json({
      quoteNo:String(parsed.quoteNo||'').trim(),quoteDate:String(parsed.quoteDate||'').trim(),
      customerName:String(parsed.customerName||'').trim(),place:String(parsed.place||'').trim(),
      terms:String(parsed.terms||'').trim(),marketType:parsed.marketType==='IND'||parsed.marketType==='EXPORT'?parsed.marketType:'',
      marketingPerson:String(parsed.marketingPerson||'').trim(),deliveryPeriod:String(parsed.deliveryPeriod||'').trim(),
      servicePerson:String(parsed.servicePerson||'').trim(),serviceDate:String(parsed.serviceDate||'').trim(),
      serviceAmount:String(parsed.serviceAmount||'').trim(),items,
      overallConfidence:Number(parsed.overallConfidence||0),
      needsReview:Array.isArray(parsed.needsReview)?parsed.needsReview.map(String):[],
      provider:'gemini',model
    });
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const timeout=/aborted|abort/i.test(message);
    return NextResponse.json({error:timeout?'Gemini Vision timed out. Retry with a clear full-page photo.':message,code:timeout?'GEMINI_TIMEOUT':'GEMINI_ERROR'},{status:502});
  }
}
