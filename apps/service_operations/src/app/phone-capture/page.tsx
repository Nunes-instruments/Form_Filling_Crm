'use client';

import { useEffect,useRef,useState } from 'react';

export default function PhoneCapturePage(){
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const [session,setSession]=useState('');
  const [ready,setReady]=useState(false);
  const [sending,setSending]=useState(false);
  const [sent,setSent]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('Opening rear camera...');

  function stop(){
    if(streamRef.current)for(const track of streamRef.current.getTracks())track.stop();
    streamRef.current=null;
  }

  async function startCamera(){
    setError('');setMessage('Opening rear camera...');
    stop();
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('This phone browser does not provide camera access.');
      const stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},
        audio:false
      });
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();}
      setReady(true);setMessage('Rear camera ready. Frame the form/proof and tap Capture & Send.');
    }catch(e){
      setReady(false);
      setError(e instanceof Error?e.message:String(e));
      setMessage('Camera permission is required. In Chrome on this phone, allow Camera for this page, then tap Retry Camera.');
    }
  }

  useEffect(()=>{
    const sid=new URLSearchParams(window.location.search).get('session')||'';
    setSession(sid);
    void startCamera();
    return()=>stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function capture(){
    if(!session){setError('USB session is missing. Start again from NUNES on the PC.');return;}
    const video=videoRef.current;
    if(!video||!video.videoWidth||!video.videoHeight){setError('Camera is not ready.');return;}
    setSending(true);setError('');
    try{
      const canvas=document.createElement('canvas');
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Could not prepare phone camera capture.');
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
      if(!blob)throw new Error('Could not create the phone photo.');
      const form=new FormData();
      form.append('session',session);
      form.append('file',new File([blob],`nunes-usb-phone-${Date.now()}.jpg`,{type:'image/jpeg'}));
      const res=await fetch('/api/phone-usb/upload',{method:'POST',body:form});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error||`Upload failed (${res.status}).`);
      setSent(true);setMessage('Photo sent to NUNES successfully. Return to the PC.');
      stop();setReady(false);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{setSending(false);}
  }

  return <main style={{minHeight:'100vh',background:'#0f1720',color:'#fff',padding:'16px',fontFamily:'Arial,sans-serif'}}>
    <div style={{maxWidth:760,margin:'0 auto'}}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:800,letterSpacing:1,color:'#83d7ca'}}>NUNES USB PHONE CAMERA</div>
        <h1 style={{fontSize:28,margin:'6px 0'}}>Capture for NUNES Operations</h1>
        <p style={{color:'#c7d0dc',lineHeight:1.5,margin:0}}>{message}</p>
      </div>
      <div style={{background:'#05090f',borderRadius:16,overflow:'hidden',minHeight:420,display:'grid',placeItems:'center'}}>
        <video ref={videoRef} autoPlay playsInline muted style={{width:'100%',maxHeight:'72vh',objectFit:'contain'}}/>
        {!ready&&!sent&&<div style={{position:'absolute',textAlign:'center',padding:20,color:'#dbe5ef'}}>Camera waiting...</div>}
      </div>
      {error&&<div style={{marginTop:12,padding:12,borderRadius:10,background:'#4b1f24',color:'#ffd6d9'}}>{error}</div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1.5fr',gap:10,marginTop:14}}>
        <button onClick={()=>void startCamera()} disabled={sending||sent} style={{minHeight:52,borderRadius:12,border:'1px solid #617287',background:'#1b2633',color:'#fff',fontWeight:700,fontSize:16}}>Retry Camera</button>
        <button onClick={()=>void capture()} disabled={!ready||sending||sent} style={{minHeight:52,borderRadius:12,border:0,background:sent?'#276749':'#0f8c79',color:'#fff',fontWeight:800,fontSize:18}}>{sent?'Sent to NUNES':sending?'Sending...':'Capture & Send'}</button>
      </div>
      <p style={{fontSize:12,color:'#91a1b3',marginTop:14,lineHeight:1.5}}>This page is opened through the USB debugging bridge. File Transfer may stay enabled. The first time only, Android/Chrome may ask for USB debugging and camera permission.</p>
    </div>
  </main>;
}
