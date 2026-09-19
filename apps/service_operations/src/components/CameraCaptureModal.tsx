'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, RefreshCw, Smartphone, X } from 'lucide-react';

const CAMERA_KEY = 'serviceflow:preferred-camera:v1';

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

  async function startCamera(deviceId='',allowAutoSwitch=true){
    setStarting(true);setReady(false);setError('');
    stopStream(streamRef.current);streamRef.current=null;
    try{
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Live camera is not available in this browser. Use "Phone Camera / Choose Photo" below.');
      const video:MediaTrackConstraints=deviceId
        ? {deviceId:{exact:deviceId},width:{ideal:1920},height:{ideal:1080}}
        : {facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}};
      const stream=await navigator.mediaDevices.getUserMedia({video,audio:false});
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play().catch(()=>undefined);}
      const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      setDevices(list);
      const current=stream.getVideoTracks()[0]?.getSettings().deviceId||deviceId;
      let preferred='';try{preferred=localStorage.getItem(CAMERA_KEY)||'';}catch{}
      if(!preferred){
        const phone=list.find(d=>/android|phone|pixel|samsung|oneplus|vivo|oppo|redmi|realme|motorola|usb/i.test(d.label));
        preferred=phone?.deviceId||'';
      }
      if(allowAutoSwitch&&!deviceId&&preferred&&preferred!==current){await startCamera(preferred,false);return;}
      const finalId=current||preferred||list[0]?.deviceId||'';
      setSelectedId(finalId);if(finalId)try{localStorage.setItem(CAMERA_KEY,finalId);}catch{}
      setReady(true);
    }catch(e){
      const secureHint=typeof window!=='undefined'&&!window.isSecureContext?' Camera access from a PC browser normally needs localhost or HTTPS.':'';
      setError(`${e instanceof Error?e.message:String(e)}${secureHint}`);
    }finally{setStarting(false);}
  }

  useEffect(()=>{
    if(!open){stopStream(streamRef.current);streamRef.current=null;return;}
    void startCamera();
    return()=>{stopStream(streamRef.current);streamRef.current=null;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open]);

  async function switchCamera(id:string){
    setSelectedId(id);if(id)try{localStorage.setItem(CAMERA_KEY,id);}catch{}
    await startCamera(id,false);
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
      <div className="modalHead"><div><p className="eyebrow">PHONE / USB CAMERA</p><h2>{title}</h2><p className="muted">{subtitle||'Connect an Android phone by USB and select Webcam mode, then choose it below. You can also use this page directly on the phone.'}</p></div><button className="iconButton" type="button" onClick={onClose} disabled={capturing}><X size={19}/></button></div>
      <div className="cameraUsbNote"><Smartphone size={19}/><div><b>USB phone camera</b><span>On supported Android phones: connect USB → USB preferences → Webcam. Windows/Chrome will list the phone as a camera. Keep the phone unlocked while taking the photo.</span></div></div>
      <div className="cameraViewport"><video ref={videoRef} autoPlay playsInline muted/>{!ready&&<div className="cameraWaiting"><Camera size={34}/><b>{starting?'Starting camera…':'Camera preview unavailable'}</b></div>}</div>
      <div className="cameraControls">
        <label className="cameraSelect"><span>Camera</span><select value={selectedId} onChange={e=>void switchCamera(e.target.value)} disabled={starting||capturing}>
          {!devices.length&&<option value="">Default camera</option>}
          {devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}
        </select></label>
        <button className="button" type="button" onClick={()=>void startCamera(selectedId,false)} disabled={starting||capturing}><RefreshCw size={16}/> Refresh</button>
      </div>
      {error&&<div className="notice error">{error}</div>}
      <div className="cameraFallback">
        <input ref={nativeInputRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>void nativePhoto(e.target.files?.[0]||null)}/>
        <button className="button" type="button" onClick={()=>nativeInputRef.current?.click()} disabled={capturing}><Smartphone size={17}/> Phone Camera / Choose Photo</button>
        <span>When this page is opened on a phone, this button opens the native rear camera.</span>
      </div>
      <div className="modalActions"><button className="button" type="button" onClick={onClose} disabled={capturing}>Cancel</button><button className="button primary large" type="button" onClick={()=>void captureFrame()} disabled={!ready||starting||capturing}><Check size={17}/>{capturing?'Using Photo…':captureLabel}</button></div>
    </div>
  </div>;
}
