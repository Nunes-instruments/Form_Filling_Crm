'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, RefreshCw, Smartphone, Usb, X } from 'lucide-react';

const CAMERA_KEY = 'serviceflow:preferred-camera:v2';

type Props = {
  open:boolean;
  title:string;
  subtitle?:string;
  captureLabel?:string;
  filePrefix?:string;
  onClose:()=>void;
  onCapture:(file:File)=>void|Promise<void>;
};

function stopStream(stream:MediaStream|null){
  if(stream) for(const track of stream.getTracks()) track.stop();
}
function stamp(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}
function wait(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
function friendlyCameraError(error:unknown,count:number){
  const name=error instanceof DOMException?error.name:'';
  const raw=error instanceof Error?error.message:String(error||'');
  if(name==='NotFoundError'||/requested device not found|not found/i.test(raw)){
    return count===0
      ? 'Windows / Chrome detects 0 webcam devices. File Transfer (MTP) is not a webcam. You can now use "USB Phone Camera (Developer Mode)" below instead; it works through USB debugging and does not require Webcam mode.'
      : 'The previously selected webcam is no longer available. Press Detect USB Camera or use USB Phone Camera (Developer Mode).';
  }
  if(name==='NotAllowedError'||/permission/i.test(raw)){
    return 'PC camera permission is blocked. Allow Camera permission, or use USB Phone Camera (Developer Mode).';
  }
  return raw||'Camera could not be started.';
}

export default function CameraCaptureModal({
  open,title,subtitle,captureLabel='Capture Photo',filePrefix='service-photo',onClose,onCapture
}:Props){
  const videoRef=useRef<HTMLVideoElement>(null);
  const nativeInputRef=useRef<HTMLInputElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const usbRunRef=useRef(0);
  const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [ready,setReady]=useState(false);
  const [starting,setStarting]=useState(false);
  const [capturing,setCapturing]=useState(false);
  const [usbBusy,setUsbBusy]=useState(false);
  const [usbMessage,setUsbMessage]=useState('');
  const [error,setError]=useState('');
  const [deviceMessage,setDeviceMessage]=useState('Checking Windows camera devices...');

  async function listVideoDevices(){
    if(!navigator.mediaDevices?.enumerateDevices){setDevices([]);setDeviceMessage('Camera device listing is unavailable in this browser.');return [] as MediaDeviceInfo[];}
    const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    setDevices(list);
    setDeviceMessage(list.length
      ? `${list.length} webcam device${list.length===1?'':'s'} detected by Windows / Chrome.`
      : '0 webcam devices detected by Windows / Chrome.');
    let stored='';try{stored=localStorage.getItem(CAMERA_KEY)||'';}catch{}
    if(stored&&!list.some(d=>d.deviceId===stored)){
      try{localStorage.removeItem(CAMERA_KEY);}catch{}
      if(selectedId===stored)setSelectedId('');
    }
    return list;
  }

  async function startCamera(deviceId='',allowAutoSwitch=true){
    setStarting(true);setReady(false);setError('');
    stopStream(streamRef.current);streamRef.current=null;
    let before:MediaDeviceInfo[]=[];
    try{
      before=await listVideoDevices().catch(()=>[]);
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Live PC camera is unavailable.');
      let requested=deviceId;
      if(requested&&!before.some(d=>d.deviceId===requested))requested='';
      if(!requested){
        let stored='';try{stored=localStorage.getItem(CAMERA_KEY)||'';}catch{}
        if(stored&&before.some(d=>d.deviceId===stored))requested=stored;
      }
      const video:MediaTrackConstraints=requested
        ? {deviceId:{exact:requested},width:{ideal:1920},height:{ideal:1080}}
        : {facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}};
      const stream=await navigator.mediaDevices.getUserMedia({video,audio:false});
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play().catch(()=>undefined);}
      const list=await listVideoDevices();
      const current=stream.getVideoTracks()[0]?.getSettings().deviceId||requested;
      let preferred=current||'';
      if(!preferred&&allowAutoSwitch){
        const phone=list.find(d=>/android|phone|pixel|samsung|oneplus|vivo|oppo|redmi|realme|motorola|usb|webcam/i.test(d.label));
        preferred=phone?.deviceId||list[0]?.deviceId||'';
      }
      setSelectedId(preferred);
      if(preferred)try{localStorage.setItem(CAMERA_KEY,preferred);}catch{}
      setReady(true);setError('');
    }catch(e){
      const list=await listVideoDevices().catch(()=>before);
      const name=e instanceof DOMException?e.name:'';
      const raw=e instanceof Error?e.message:String(e||'');
      if(!list.length&&(name==='NotFoundError'||/requested device not found|not found/i.test(raw))){
        setError('');
        setUsbMessage('No Windows webcam is detected. That is normal in File Transfer/MTP mode. Use USB Phone Camera (Developer Mode) below; it works through USB debugging and does not require Webcam mode.');
      }else{
        setError(friendlyCameraError(e,list.length));
      }
    }finally{setStarting(false);}
  }

  useEffect(()=>{
    if(!open){
      usbRunRef.current++;
      setUsbBusy(false);setUsbMessage('');
      stopStream(streamRef.current);streamRef.current=null;
      return;
    }
    void startCamera('',true);
    const changed=()=>{void listVideoDevices().then(list=>{if(list.length&&!streamRef.current)void startCamera('',true);});};
    navigator.mediaDevices?.addEventListener?.('devicechange',changed);
    return()=>{
      usbRunRef.current++;
      navigator.mediaDevices?.removeEventListener?.('devicechange',changed);
      stopStream(streamRef.current);streamRef.current=null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open]);

  async function switchCamera(id:string){
    setSelectedId(id);if(id)try{localStorage.setItem(CAMERA_KEY,id);}catch{}
    await startCamera(id,false);
  }
  async function detectUsbCamera(){
    const list=await listVideoDevices();
    if(!list.length){
      setError('');
      setUsbMessage('No Windows webcam is visible. File Transfer/MTP will not appear in this list. Use USB Phone Camera (Developer Mode) below for the cable connection you already have.');
      return;
    }
    let preferred=selectedId;
    const phone=list.find(d=>/android|phone|pixel|samsung|oneplus|vivo|oppo|redmi|realme|motorola|usb|webcam/i.test(d.label));
    if(phone)preferred=phone.deviceId;
    if(!preferred||!list.some(d=>d.deviceId===preferred))preferred=list[0].deviceId;
    await startCamera(preferred,false);
  }
  async function deliver(file:File){
    setCapturing(true);setError('');
    try{await onCapture(file);onClose();}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setCapturing(false);}
  }
  async function captureFrame(){
    const video=videoRef.current;
    if(!video||!video.videoWidth||!video.videoHeight){setError('Camera is not ready yet.');return;}
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d');if(!ctx){setError('Unable to capture the camera image.');return;}
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
    if(!blob){setError('Unable to create the captured photo.');return;}
    await deliver(new File([blob],`${filePrefix}-${stamp()}.jpg`,{type:'image/jpeg',lastModified:Date.now()}));
  }
  async function nativePhoto(file:File|null){
    if(!file)return;
    await deliver(file);
    if(nativeInputRef.current)nativeInputRef.current.value='';
  }

  async function startUsbPhoneBridge(){
    const run=++usbRunRef.current;
    setUsbBusy(true);setUsbMessage('Checking Android USB debugging connection...');setError('');
    try{
      const res=await fetch('/api/phone-usb/start',{method:'POST',cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok){
        const code=String(data.code||'');
        if(code==='USB_DEBUGGING_UNAUTHORIZED'){
          throw new Error('Phone is detected but not authorized. Unlock the phone, tap "Allow USB debugging", tick "Always allow from this computer", then press USB Phone Camera again.');
        }
        if(code==='NO_ADB_DEVICE'){
          throw new Error('No USB-debugging phone is connected. On Android: Developer options -> USB debugging ON. Reconnect the data cable, unlock the phone, and allow this computer. File Transfer can stay enabled.');
        }
        if(code==='ADB_NOT_INSTALLED'){
          throw new Error('NUNES USB Phone Bridge is not installed yet. Run the V2.8.6.5 one-time setup on the Main Server.');
        }
        throw new Error(data.error||`USB phone bridge failed (${res.status}).`);
      }
      const sid=String(data.session?.id||'');
      if(!sid)throw new Error('USB phone session was not created.');
      setUsbMessage('Phone detected. NUNES opened the camera page on the phone through USB. On first use allow Camera permission, then tap Capture & Send.');
      for(let i=0;i<240;i++){
        if(run!==usbRunRef.current)return;
        await wait(500);
        const sr=await fetch(`/api/phone-usb/session/${encodeURIComponent(sid)}`,{cache:'no-store'});
        if(sr.status===404)continue;
        const session=await sr.json().catch(()=>({}));
        if(session.status==='error')throw new Error(session.error||'Phone capture failed.');
        if(session.ready||session.status==='ready'){
          const fr=await fetch(`/api/phone-usb/session/${encodeURIComponent(sid)}/file`,{cache:'no-store'});
          if(!fr.ok)throw new Error(`Captured phone image could not be fetched (${fr.status}).`);
          const blob=await fr.blob();
          setUsbMessage('Phone photo received. Sending it into the current NUNES form...');
          await deliver(new File([blob],`${filePrefix}-usb-phone-${stamp()}.jpg`,{type:blob.type||'image/jpeg',lastModified:Date.now()}));
          return;
        }
      }
      throw new Error('Timed out waiting for the phone photo. Keep the phone unlocked and tap Capture & Send on the phone.');
    }catch(e){
      if(run===usbRunRef.current)setError(e instanceof Error?e.message:String(e));
    }finally{
      if(run===usbRunRef.current)setUsbBusy(false);
    }
  }

  if(!open)return null;
  return <div className="modalBackdrop cameraCaptureBackdrop" role="dialog" aria-modal="true">
    <div className="modalCard cameraCaptureCard">
      <div className="modalHead"><div><p className="eyebrow">PHONE / USB CAMERA</p><h2>{title}</h2><p className="muted">{subtitle||'Use a normal Windows webcam, Android USB Webcam mode, or the NUNES USB Phone Camera bridge through USB debugging.'}</p></div><button className="iconButton" type="button" onClick={onClose} disabled={capturing||usbBusy}><X size={19}/></button></div>
      <div className="cameraUsbNote"><Usb size={19}/><div><b>Two USB methods</b><span><b>Webcam mode:</b> phone appears in the Windows camera list. <b>Developer mode bridge:</b> USB debugging opens the phone camera directly even when File Transfer/MTP is selected.</span></div></div>
      <div className="cameraDeviceState"><b>{deviceMessage}</b><span>{devices.length?'Select the Windows webcam below.':'No Windows webcam detected; the Developer Mode bridge can still work.'}</span></div>
      <div className="cameraViewport"><video ref={videoRef} autoPlay playsInline muted/>{!ready&&<div className="cameraWaiting"><Camera size={34}/><b>{starting?'Starting camera...':'Camera preview unavailable'}</b></div>}</div>
      <div className="cameraControls">
        <label className="cameraSelect"><span>Camera detected by Windows / Chrome</span><select value={selectedId} onChange={e=>void switchCamera(e.target.value)} disabled={starting||capturing||usbBusy}>
          {!devices.length&&<option value="">No camera detected</option>}
          {devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}
        </select></label>
        <button className="button" type="button" onClick={()=>void detectUsbCamera()} disabled={starting||capturing||usbBusy}><RefreshCw size={16}/> Detect USB Webcam</button>
      </div>
      {error&&<div className="notice error">{error}</div>}
      {usbMessage&&<div className="notice success"><Smartphone size={17}/>{usbMessage}</div>}
      <div className="cameraFallback">
        <button className="button primary" type="button" onClick={()=>void startUsbPhoneBridge()} disabled={capturing||usbBusy}><Usb size={17}/>{usbBusy?'Waiting for Phone Photo...':'USB Phone Camera (Developer Mode)'}</button>
        <span>Requires Developer options + USB debugging. First connection only: tap Allow USB debugging and choose Always allow. File Transfer may stay ON; Webcam mode is not required.</span>
      </div>
      <div className="cameraFallback">
        <input ref={nativeInputRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>void nativePhoto(e.target.files?.[0]||null)}/>
        <button className="button" type="button" onClick={()=>nativeInputRef.current?.click()} disabled={capturing||usbBusy}><Smartphone size={17}/> Choose Photo / Phone Storage</button>
        <span>Fallback: choose an existing image from this PC or from phone storage exposed through File Transfer.</span>
      </div>
      <div className="modalActions"><button className="button" type="button" onClick={onClose} disabled={capturing||usbBusy}>Cancel</button><button className="button primary large" type="button" onClick={()=>void captureFrame()} disabled={!ready||starting||capturing||usbBusy}><Check size={17}/>{capturing?'Using Photo...':captureLabel}</button></div>
    </div>
  </div>;
}
