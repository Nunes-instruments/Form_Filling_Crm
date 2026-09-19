export type GeminiResilientResult = {
  ok:boolean;
  status:number;
  raw:any;
  model:string;
  attempts:number;
  fallbackUsed:boolean;
  transient:boolean;
  lastError:string;
};

type Options = {
  apiKey:string;
  primaryModel:string;
  requestBody:unknown;
  attemptTimeoutMs?:number;
  maxTotalMs?:number;
};

const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash'
] as const;

const RETRYABLE = new Set([408,429,500,502,503,504]);

function sleep(ms:number){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function modelsFor(primary:string){
  const envModels=String(process.env.GEMINI_FALLBACK_MODELS||'')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);
  return [...new Set([primary,...envModels,...DEFAULT_FALLBACK_MODELS])];
}

function errorMessage(raw:any,status:number){
  return String(raw?.error?.message||raw?.message||`Gemini request failed with HTTP ${status}.`).trim();
}

function errorCode(raw:any){
  return String(raw?.error?.status||raw?.error?.code||raw?.code||'').toUpperCase();
}

function modelUnavailable(status:number,raw:any){
  if(status!==404)return false;
  const code=errorCode(raw);
  const message=errorMessage(raw,status);
  return code.includes('NOT_FOUND')||/model.*not found|not found.*model|unsupported model/i.test(message);
}

function retryable(status:number,raw:any){
  if(RETRYABLE.has(status))return true;
  return modelUnavailable(status,raw);
}

function friendlyBusy(status:number,raw:any){
  const code=errorCode(raw);
  const message=errorMessage(raw,status);
  return status===429||status===503||status===504||code.includes('RESOURCE_EXHAUSTED')||
    /high demand|overload|temporar|rate limit|too many requests|resource exhausted/i.test(message);
}

function retryAfterMs(response:Response){
  const header=response.headers.get('retry-after');
  if(!header)return 0;
  const seconds=Number(header);
  if(Number.isFinite(seconds)&&seconds>=0)return Math.min(4000,Math.round(seconds*1000));
  const when=Date.parse(header);
  if(Number.isFinite(when))return Math.min(4000,Math.max(0,when-Date.now()));
  return 0;
}

function delayMs(attempt:number,response?:Response){
  const fromHeader=response?retryAfterMs(response):0;
  if(fromHeader>0)return fromHeader;
  const base=Math.min(3200,800*Math.pow(2,Math.max(0,attempt-1)));
  const jitter=Math.floor(Math.random()*350);
  return base+jitter;
}

async function oneAttempt(apiKey:string,model:string,body:unknown,timeoutMs:number){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify(body),
      signal:controller.signal,
      cache:'no-store'
    });
    const raw=await response.json().catch(()=>({}));
    return {response,raw,aborted:false,error:''};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return {response:null as Response|null,raw:{},aborted:/aborted|abort/i.test(message),error:message};
  }finally{
    clearTimeout(timer);
  }
}

export async function generateContentResilient(options:Options):Promise<GeminiResilientResult>{
  const apiKey=String(options.apiKey||'').trim();
  const primary=String(options.primaryModel||'').trim();
  if(!apiKey)throw new Error('Gemini API key is missing.');
  if(!primary)throw new Error('Gemini model is missing.');

  const timeoutMs=Math.max(8000,Math.min(25000,Number(options.attemptTimeoutMs||18000)));
  const maxTotalMs=Math.max(timeoutMs,Math.min(60000,Number(options.maxTotalMs||45000)));
  const deadline=Date.now()+maxTotalMs;
  const models=modelsFor(primary);

  let attempts=0;
  let lastStatus=502;
  let lastRaw:any={};
  let lastModel=primary;
  let lastError='Gemini request failed.';
  let lastTransient=true;

  // Primary model gets one immediate retry for transient load spikes.
  // Fallback models get one attempt each. This keeps total latency bounded.
  const plan=[primary,primary,...models.filter(model=>model!==primary)];

  for(let index=0;index<plan.length;index++){
    if(Date.now()>=deadline)break;
    const model=plan[index];
    attempts++;
    lastModel=model;

    const remaining=Math.max(1000,deadline-Date.now());
    const result=await oneAttempt(apiKey,model,options.requestBody,Math.min(timeoutMs,remaining));

    if(!result.response){
      lastStatus=result.aborted?504:502;
      lastRaw={error:{message:result.aborted?'Gemini request timed out.':result.error}};
      lastError=errorMessage(lastRaw,lastStatus);
      lastTransient=true;
    }else{
      lastStatus=result.response.status;
      lastRaw=result.raw;
      lastError=errorMessage(lastRaw,lastStatus);
      lastTransient=retryable(lastStatus,lastRaw);

      if(result.response.ok){
        return {
          ok:true,status:result.response.status,raw:result.raw,model,attempts,
          fallbackUsed:model!==primary,transient:false,lastError:''
        };
      }

      // Invalid request, invalid/blocked key, permissions, etc. should not be retried.
      if(!lastTransient){
        return {
          ok:false,status:lastStatus,raw:lastRaw,model,attempts,
          fallbackUsed:model!==primary,transient:false,lastError
        };
      }
    }

    if(index>=plan.length-1)break;
    const nextModel=plan[index+1];
    const changingModel=nextModel!==model;
    const wait=changingModel&&modelUnavailable(lastStatus,lastRaw)
      ? 150
      : delayMs(attempts,result.response||undefined);
    if(Date.now()+wait>=deadline)break;
    await sleep(wait);
  }

  const busy=friendlyBusy(lastStatus,lastRaw);
  return {
    ok:false,
    status:lastStatus,
    raw:{
      ...lastRaw,
      nunesFriendlyError:busy
        ? 'Google Gemini is temporarily busy. NUNES already retried automatically and tried alternate stable Flash models. Please press Read & Fill Form again in a moment.'
        : lastError
    },
    model:lastModel,
    attempts,
    fallbackUsed:lastModel!==primary,
    transient:lastTransient,
    lastError:busy
      ? 'Google Gemini is temporarily busy after automatic retries.'
      : lastError
  };
}
