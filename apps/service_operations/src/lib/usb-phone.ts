import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/paths';

export type UsbAdbDevice = {
  serial:string;
  state:string;
  details:string;
};

export type UsbPhoneSession = {
  id:string;
  status:'waiting'|'ready'|'error';
  createdAt:string;
  deviceSerial:string;
  deviceDetails:string;
  fileName?:string;
  mimeType?:string;
  error?:string;
};

const SESSION_DIR = path.join(DATA_DIR, 'usb-phone-capture');
const SAFE_ID = /^[A-Za-z0-9_-]{12,100}$/;

function localAppData(){
  return String(process.env.LOCALAPPDATA || '').trim();
}

function adbPathFile(){
  const root=localAppData();
  return root ? path.join(root,'NUNES Operations','Tools','adb-path.txt') : '';
}

function candidateAdbPaths(){
  const out:string[]=[];
  const marker=adbPathFile();
  try{
    if(marker && fs.existsSync(marker)){
      const saved=fs.readFileSync(marker,'utf8').trim();
      if(saved)out.push(saved);
    }
  }catch{}
  const local=localAppData();
  if(local){
    out.push(path.join(local,'NUNES Operations','Tools','platform-tools','adb.exe'));
    out.push(path.join(local,'Android','Sdk','platform-tools','adb.exe'));
  }
  const profile=String(process.env.USERPROFILE||'').trim();
  if(profile)out.push(path.join(profile,'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
  out.push('adb.exe');
  return [...new Set(out)];
}

function execText(file:string,args:string[],timeout=8000){
  return new Promise<string>((resolve,reject)=>{
    execFile(file,args,{windowsHide:true,timeout,encoding:'utf8'},(error,stdout,stderr)=>{
      if(error){
        const e=error as NodeJS.ErrnoException & {stdout?:string;stderr?:string};
        const detail=String(stderr||stdout||e.message||'').trim();
        reject(new Error(detail||e.message||'ADB command failed'));
        return;
      }
      resolve(String(stdout||''));
    });
  });
}

export async function resolveAdbPath(){
  let last='';
  for(const candidate of candidateAdbPaths()){
    try{
      if(candidate.includes('\\') || candidate.includes('/')){
        if(!fs.existsSync(candidate))continue;
      }
      await execText(candidate,['version'],5000);
      return candidate;
    }catch(e){last=e instanceof Error?e.message:String(e);}
  }
  throw new Error(last||'ADB is not installed. Run NUNES V2.8.6.5 one-time USB Phone Bridge setup.');
}

function parseDevices(text:string):UsbAdbDevice[]{
  return text.split(/\r?\n/)
    .map(v=>v.trim())
    .filter(v=>v && !/^List of devices attached/i.test(v) && !/^\*/.test(v))
    .map(line=>{
      const parts=line.split(/\s+/);
      const serial=parts.shift()||'';
      const state=parts.shift()||'unknown';
      return {serial,state,details:parts.join(' ')};
    })
    .filter(d=>Boolean(d.serial));
}

export async function getUsbPhoneStatus(){
  try{
    const adb=await resolveAdbPath();
    const out=await execText(adb,['devices','-l'],8000);
    const devices=parseDevices(out);
    return {
      adbInstalled:true,
      adbPath:adb,
      devices,
      authorized:devices.filter(d=>d.state==='device').length,
      unauthorized:devices.filter(d=>d.state==='unauthorized').length,
      offline:devices.filter(d=>d.state==='offline').length
    };
  }catch(e){
    return {
      adbInstalled:false,
      adbPath:'',
      devices:[] as UsbAdbDevice[],
      authorized:0,
      unauthorized:0,
      offline:0,
      error:e instanceof Error?e.message:String(e)
    };
  }
}

async function ensureSessionDir(){
  await fsp.mkdir(SESSION_DIR,{recursive:true});
}

function sessionJson(id:string){
  if(!SAFE_ID.test(id))throw new Error('Invalid USB phone session id.');
  return path.join(SESSION_DIR,`${id}.json`);
}

function sessionFile(id:string,ext='.jpg'){
  if(!SAFE_ID.test(id))throw new Error('Invalid USB phone session id.');
  return path.join(SESSION_DIR,`${id}${ext}`);
}

async function writeSession(session:UsbPhoneSession){
  await ensureSessionDir();
  await fsp.writeFile(sessionJson(session.id),JSON.stringify(session,null,2),'utf8');
}

export async function readUsbPhoneSession(id:string):Promise<UsbPhoneSession|null>{
  try{
    const raw=await fsp.readFile(sessionJson(id),'utf8');
    return JSON.parse(raw) as UsbPhoneSession;
  }catch{return null;}
}

async function cleanupOldSessions(){
  await ensureSessionDir();
  const now=Date.now();
  const items=await fsp.readdir(SESSION_DIR,{withFileTypes:true}).catch(()=>[]);
  for(const item of items){
    if(!item.isFile())continue;
    const p=path.join(SESSION_DIR,item.name);
    try{
      const st=await fsp.stat(p);
      if(now-st.mtimeMs>24*60*60*1000)await fsp.rm(p,{force:true});
    }catch{}
  }
}

export async function startUsbPhoneCapture(){
  await cleanupOldSessions();
  const status=await getUsbPhoneStatus();
  if(!status.adbInstalled){
    return {ok:false,code:'ADB_NOT_INSTALLED',error:status.error||'ADB is not installed.',...status};
  }
  const authorized=status.devices.filter(d=>d.state==='device');
  if(!authorized.length){
    if(status.devices.some(d=>d.state==='unauthorized')){
      return {
        ok:false,code:'USB_DEBUGGING_UNAUTHORIZED',
        error:'Phone detected, but USB debugging is not authorized. Unlock the phone, tap "Allow USB debugging", and choose "Always allow from this computer".',
        ...status
      };
    }
    return {
      ok:false,code:'NO_ADB_DEVICE',
      error:'No authorized Android USB debugging device was found. Developer options alone are not enough: turn ON USB debugging, reconnect the data cable, unlock the phone, and authorize this computer.',
      ...status
    };
  }

  const device=authorized[0];
  const adb=status.adbPath;
  await execText(adb,['-s',device.serial,'reverse','tcp:5055','tcp:5055'],8000);

  const id=crypto.randomUUID();
  const session:UsbPhoneSession={
    id,status:'waiting',createdAt:new Date().toISOString(),
    deviceSerial:device.serial,deviceDetails:device.details
  };
  await writeSession(session);

  const url=`http://127.0.0.1:5055/phone-capture?session=${encodeURIComponent(id)}`;
  await execText(adb,['-s',device.serial,'shell','am','start','-a','android.intent.action.VIEW','-d',url],10000);

  return {
    ok:true,
    session,
    device,
    message:'NUNES phone camera page opened over USB debugging. On first use, allow Camera permission on the phone, then tap Capture & Send.'
  };
}

function extForMime(mime:string){
  if(mime==='image/png')return '.png';
  if(mime==='image/webp')return '.webp';
  return '.jpg';
}

export async function completeUsbPhoneSession(id:string,file:File){
  const current=await readUsbPhoneSession(id);
  if(!current)throw new Error('USB phone capture session not found or expired.');
  if(!file.type.startsWith('image/'))throw new Error('USB phone capture accepts image files only.');
  if(file.size<=0)throw new Error('Captured phone image is empty.');
  if(file.size>20*1024*1024)throw new Error('Captured phone image is larger than 20 MB.');

  const ext=extForMime(file.type);
  const out=sessionFile(id,ext);
  await fsp.writeFile(out,Buffer.from(await file.arrayBuffer()));
  const updated:UsbPhoneSession={
    ...current,status:'ready',fileName:path.basename(out),mimeType:file.type||'image/jpeg'
  };
  await writeSession(updated);
  return updated;
}

export async function readUsbPhoneCaptureFile(id:string){
  const session=await readUsbPhoneSession(id);
  if(!session || session.status!=='ready' || !session.fileName)return null;
  const p=path.join(SESSION_DIR,path.basename(session.fileName));
  try{
    const bytes=await fsp.readFile(p);
    return {session,bytes};
  }catch{return null;}
}
