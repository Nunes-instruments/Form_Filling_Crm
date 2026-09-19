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
function friendlyCameraError(error:unknown, count:number){
  const name=error instanceof DOMException?error.name:'';
  const raw=error instanceof Error?error.message:String(error||'');
  if(name==='NotFoundError'||/requested device not found|not found/i.test(raw)){
    return count===0
      ? 'Windows / Chrome currently detects 0 camera devices. A phone connected only as Charging / File Transfer (MTP) will NOT appear as a live camera. On the phone open USB Preferences and choose Webcam, keep the phone unlocked, wait 2 seconds, then press Detect USB Camera.'
      : 'The previously selected camera is no longer available. Press Detect USB Camera and select a camera that is currently connected.';
  }
  if(name==='NotAllowedError'||/permission/i.test(raw)){
    return 'Camera permission is blocked. Allow Camera permission for this page in Chrome/Edge, then press Detect USB Camera.';
  }
  return raw || 'Camera could not be started.';
}

export default function CameraCaptureModal({
  open,title,subtitle,captureLabel='Capture Photo',filePrefix='service-photo',onClose,onCapture
}:Props){
  const videoRef=useRef<HTMLVideoElement>(null);
  const nativeInputRef=useRef<HTMLInputElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [ready,setReady]=useState(false);
  const [starting,setStarting]=useState(false);
  const [capturing,setCapturing]=useState(false);
  const [error,setError]=useState('');
  const [deviceMessage,setDeviceMessage]=useState('Checking Windows camera devices…');

  async function listVideoDevices(){
    if(!navigator.mediaDevices?.enumerateDevices){setDevices([]);setDeviceMessage('Camera device listing is unavailable in this browser.');return [] as MediaDeviceInfo[];}
    const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    setDevices(list);
    setDeviceMessage(list.length
      ? `${list.length} camera device${list.length===1?'':'s'} detected by Windows / Chrome.`
      : '0 camera devices detected by Windows / Chrome.');
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
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Live camera is not available in this browser. Use "Phone Camera / Choose Photo" below.');
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
      setReady(true);
      setError('');
    }catch(e){
      const list=await listVideoDevices().catch(()=>before);
      const secureHint=typeof window!=='undefined'&&!window.isSecureContext?' Camera access from a PC browser normally needs localhost or HTTPS.':'';
      setError(friendlyCameraError(e,list.length)+secureHint);
    }finally{setStarting(false);}
  }

  useEffect(()=>{
    if(!open){stopStream(streamRef.current);streamRef.current=null;return;}
    void startCamera('',true);
    const changed=()=>{void listVideoDevices().then(list=>{if(list.length&&!streamRef.current)void startCamera('',true);});};
    navigator.mediaDevices?.addEventListener?.('devicechange',changed);
    return()=>{
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
      setError('No live camera is visible to Windows yet. On the phone choose USB Preferences → Webcam. Charging / File Transfer mode cannot be used as a live camera. If your phone has no Webcam option, use Phone Camera / Choose Photo.');
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

  if(!open)return null;
  return <div className="modalBackdrop cameraCaptureBackdrop" role="dialog" aria-modal="true">
    <div className="modalCard cameraCaptureCard">
      <div className="modalHead"><div><p className="eyebrow">PHONE / USB CAMERA</p><h2>{title}</h2><p className="muted">{subtitle||'For a live USB phone camera, Android must expose the phone as a Webcam. File Transfer / MTP does not create a camera device.'}</p></div><button className="iconButton" type="button" onClick={onClose} disabled={capturing}><X size={19}/></button></div>
      <div className="cameraUsbNote"><Usb size={19}/><div><b>USB cable check</b><span>Connect phone → unlock it → USB Preferences → Webcam. Then press Detect USB Camera. If your phone has no Webcam option, take the photo on the phone and use Phone Camera / Choose Photo.</span></div></div>
      <div className="cameraDeviceState"><b>{deviceMessage}</b><span>{devices.length?'Select the phone/webcam below.':'A normal USB file-transfer connection is not a webcam.'}</span></div>
      <div className="cameraViewport"><video ref={videoRef} autoPlay playsInline muted/>{!ready&&<div className="cameraWaiting"><Camera size={34}/><b>{starting?'Starting camera…':'Camera preview unavailable'}</b></div>}</div>
      <div className="cameraControls">
        <label className="cameraSelect"><span>Camera detected by Windows / Chrome</span><select value={selectedId} onChange={e=>void switchCamera(e.target.value)} disabled={starting||capturing}>
          {!devices.length&&<option value="">No camera detected</option>}
          {devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}
        </select></label>
        <button className="button" type="button" onClick={()=>void detectUsbCamera()} disabled={starting||capturing}><RefreshCw size={16}/> Detect USB Camera</button>
      </div>
      {error&&<div className="notice error">{error}</div>}
      <div className="cameraFallback">
        <input ref={nativeInputRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>void nativePhoto(e.target.files?.[0]||null)}/>
        <button className="button" type="button" onClick={()=>nativeInputRef.current?.click()} disabled={capturing}><Smartphone size={17}/> Phone Camera / Choose Photo</button>
        <span>On a phone this opens the rear camera. On this PC it opens the file picker, where a USB/MTP phone photo can also be selected if Windows exposes the phone storage.</span>
      </div>
      <div className="modalActions"><button className="button" type="button" onClick={onClose} disabled={capturing}>Cancel</button><button className="button primary large" type="button" onClick={()=>void captureFrame()} disabled={!ready||starting||capturing}><Check size={17}/>{capturing?'Using Photo…':captureLabel}</button></div>
    </div>
  </div>;
}
