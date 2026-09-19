(function(){
  function n(v){const x=parseFloat(v);return Number.isFinite(x)?x:0}
  function money(v){return '₹ '+v.toFixed(2)}
  function updateRowNums(tbody){tbody.querySelectorAll('tr').forEach((r,i)=>{const c=r.querySelector('.rownum');if(c)c.textContent=i+1})}
  function recalc(){
    let mt=0;
    document.querySelectorAll('#marketingRows tr').forEach(r=>{mt+=n(r.querySelector('.qty')?.value)*n(r.querySelector('.itemv')?.value)+n(r.querySelector('.addc')?.value)});
    mt+=n(document.querySelector('.serviceamount')?.value); const m=document.querySelector('#marketingTotal');if(m)m.textContent=money(mt);
    let pt=0;document.querySelectorAll('.payamt').forEach(x=>pt+=n(x.value)); const p=document.querySelector('#paymentTotal');if(p)p.textContent=money(pt);
    const pb=document.querySelector('#paymentBalance');if(pb)pb.textContent=money(mt-pt);
    let bill=0;document.querySelectorAll('#accountRows tr').forEach(r=>{const t=n(r.querySelector('.aiv')?.value)+n(r.querySelector('.apf')?.value)+n(r.querySelector('.atax')?.value); const c=r.querySelector('.rowtotal');if(c)c.textContent=t.toFixed(2);bill+=t});
    const ba=document.querySelector('#billAmount');if(ba)ba.textContent=money(bill);
    let sp=0;document.querySelectorAll('.spamt').forEach(x=>sp+=n(x.value)); const sb=document.querySelector('#supplierBalance');if(sb)sb.textContent=money(bill-sp);
    const pc=n(document.querySelector('.pcost')?.value),sc=n(document.querySelector('.scost')?.value),pr=sc-pc,pct=pc?pr/pc*100:0;
    const prEl=document.querySelector('#profit'),pctEl=document.querySelector('#profitPct');if(prEl)prEl.value=pr.toFixed(2);if(pctEl)pctEl.value=pct.toFixed(2)+'%';
  }
  const templates={
    marketing:`<tr><td class="rownum"></td><td><input name="item_name[]"></td><td><input name="model[]"></td><td><input class="num qty" type="number" step="any" name="qty[]"></td><td><input class="num itemv" type="number" step="any" name="item_value[]"></td><td><input class="num addc" type="number" step="any" name="add_charge[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    payment:`<tr><td><input type="date" name="payment_date[]"></td><td><input name="bank_mode[]"></td><td><input class="num payamt" type="number" step="any" name="payment_amount[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    supplier:`<tr><td class="rownum"></td><td><input name="supplier[]"></td><td><input name="supplier_model[]"></td><td><input type="number" step="any" name="net_value[]"></td><td><input name="supplier_terms[]"></td><td><input name="supplier_delivery[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    accounts:`<tr><td class="rownum"></td><td><input name="particulars[]"></td><td><input class="num aiv" type="number" step="any" name="acc_item_value[]"></td><td><input class="num apf" type="number" step="any" name="pf_charges[]"></td><td><input class="num atax" type="number" step="any" name="tax[]"></td><td class="rowtotal">0.00</td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    supplierPayment:`<tr><td class="rownum"></td><td><input type="date" name="sp_date[]"></td><td><input name="bank_branch[]"></td><td><input name="sp_mode[]"></td><td><input class="num spamt" type="number" step="any" name="sp_amount[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`
  };
  document.addEventListener('click',e=>{
    const add=e.target.closest('.addrow');if(add){const tb=document.getElementById(add.dataset.target);if(tb){tb.insertAdjacentHTML('beforeend',templates[add.dataset.template]);updateRowNums(tb);recalc()}return}
    const del=e.target.closest('.delrow');if(del){const tb=del.closest('tbody');if(tb && tb.children.length>1){del.closest('tr').remove();updateRowNums(tb);recalc()}return}
  });
  document.addEventListener('input',e=>{if(e.target.matches('.num'))recalc()});
  recalc();
})();

/* NUNES V2.8.6.2 PURCHASING CAMERA + GEMINI - NO TEMPLATE ANCHOR */
(()=>{
  function findMarketingForm(){
    const direct=document.querySelector('form[data-calc="marketing"]');
    if(direct)return direct;
    const rows=document.querySelector('#marketingRows');
    if(rows?.closest('form'))return rows.closest('form');
    const quote=document.querySelector('input[name="quote_no"]');
    if(quote?.closest('form'))return quote.closest('form');
    return [...document.forms].find(f=>/section=['"]?marketing/i.test(f.getAttribute('action')||f.action||''))||null;
  }
  const form=findMarketingForm();
  if(!form)return;
  const match=location.pathname.match(/\/order\/(\d+)(?:\/|$)/);
  if(!match)return;
  const oid=match[1], scanUrl=`/order/${oid}/gemini-scan`, attachmentUrl=`/order/${oid}/attachments`;

  let panel=document.querySelector("[data-purchase-camera]");
  if(!panel){
    panel=document.createElement("div");
    panel.className="purchase-capture-panel";
    panel.setAttribute("data-purchase-camera","1");
    panel.innerHTML=`
      <div class="purchase-capture-title"><div><b>Purchasing Form Scan & Photos</b><br><span>Same camera flow as Servicing. Scan uses the existing Gemini reader; proof photos are stored with this order.</span></div></div>
      <div class="purchase-capture-actions">
        <button type="button" class="btn primary" data-purchase-scan-camera>Photo Scan & Fill</button>
        <button type="button" class="btn" data-purchase-scan-file>Choose Scan Image / PDF</button>
        <button type="button" class="btn" data-purchase-proof-camera>Take Proof Photo</button>
        <button type="button" class="btn" data-purchase-proof-file>Upload Proof File(s)</button>
      </div>
      <input id="purchaseScanFile" type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" capture="environment">
      <input id="purchaseProofFile" type="file" hidden multiple accept="image/*,.pdf" capture="environment">
      <div id="purchaseCameraStatus" class="purchase-camera-status">Ready. For live USB camera use phone USB mode: Webcam.</div>
      <div id="purchasePhotoGallery" class="purchase-photo-gallery"><span>Loading proof photos…</span></div>`;
    form.parentNode?.insertBefore(panel,form);
  }

  let stream=null, mode="scan", devices=[], selectedId="";
  const $=(s,r=document)=>r.querySelector(s);
  const scanInput=$("#purchaseScanFile",panel), proofInput=$("#purchaseProofFile",panel);
  const status=$("#purchaseCameraStatus",panel), gallery=$("#purchasePhotoGallery",panel);

  const modal=document.createElement("div");
  modal.className="purchase-camera-modal";
  modal.innerHTML=`<div class="purchase-camera-card">
    <div class="purchase-camera-head"><div><b id="purchaseCameraTitle">Purchasing Photo Scan</b><span>USB phone camera / webcam / choose photo</span></div><button type="button" class="mini" data-pc-close>×</button></div>
    <div class="purchase-camera-help"><b>USB cable:</b> phone must be in <b>USB Preferences → Webcam</b>. Charging / File Transfer (MTP) does not create a live camera device.</div>
    <div class="purchase-camera-device" data-pc-device>Checking camera devices…</div>
    <div class="purchase-camera-preview"><video autoplay playsinline muted></video><div class="purchase-camera-empty">Camera preview unavailable</div></div>
    <div class="purchase-camera-controls"><select data-pc-select><option value="">No camera detected</option></select><button type="button" class="btn" data-pc-detect>Detect USB Camera</button></div>
    <div class="purchase-camera-error" data-pc-error hidden></div>
    <div class="purchase-camera-actions"><button type="button" class="btn" data-pc-file>Phone Camera / Choose Photo</button><button type="button" class="btn" data-pc-close>Cancel</button><button type="button" class="btn primary" data-pc-capture disabled>Capture</button></div>
  </div>`;
  document.body.appendChild(modal);
  const video=$("video",modal),empty=$(".purchase-camera-empty",modal),sel=$("[data-pc-select]",modal),deviceMsg=$("[data-pc-device]",modal),err=$("[data-pc-error]",modal),captureBtn=$("[data-pc-capture]",modal),title=$("#purchaseCameraTitle",modal);

  function setError(msg=""){err.hidden=!msg;err.textContent=msg}
  function stop(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;empty.style.display="grid";captureBtn.disabled=true}
  async function listDevices(){
    if(!navigator.mediaDevices?.enumerateDevices){devices=[];deviceMsg.textContent="Camera listing unavailable in this browser.";return devices}
    devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput");
    deviceMsg.textContent=devices.length?`${devices.length} camera device${devices.length===1?"":"s"} detected by Windows / Chrome.`:"0 camera devices detected by Windows / Chrome.";
    sel.innerHTML=devices.length?devices.map((d,i)=>`<option value="${d.deviceId}">${(d.label||`Camera ${i+1}`).replace(/[<>&"]/g,"")}</option>`).join(""):`<option value="">No camera detected</option>`;
    if(selectedId&&devices.some(d=>d.deviceId===selectedId))sel.value=selectedId;
    return devices;
  }
  function friendly(e,count){
    const name=e?.name||"", raw=String(e?.message||e||"");
    if(name==="NotFoundError"||/requested device not found|not found/i.test(raw)) return count===0
      ?"Windows / Chrome detects 0 cameras. On the phone choose USB Preferences → Webcam, wait 2 seconds, then press Detect USB Camera. File Transfer / MTP is not a live camera."
      :"That camera is no longer connected. Press Detect USB Camera.";
    if(name==="NotAllowedError"||/permission/i.test(raw)) return "Camera permission is blocked. Allow Camera permission for this page, then try again.";
    if(!window.isSecureContext) return "This page is not a secure camera context. Use the Main Server localhost view, HTTPS, or Phone Camera / Choose Photo.";
    return raw||"Camera could not start.";
  }
  async function startCamera(id=""){
    stop();setError("");await listDevices();
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Live camera is unavailable in this browser.");
      let requested=id;if(requested&&!devices.some(d=>d.deviceId===requested))requested="";
      const constraints=requested?{deviceId:{exact:requested},width:{ideal:1920},height:{ideal:1080}}:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}};
      stream=await navigator.mediaDevices.getUserMedia({video:constraints,audio:false});
      video.srcObject=stream;await video.play().catch(()=>{});
      await listDevices();
      selectedId=stream.getVideoTracks()[0]?.getSettings()?.deviceId||requested||devices[0]?.deviceId||"";
      if(selectedId)sel.value=selectedId;
      empty.style.display="none";captureBtn.disabled=false;
    }catch(e){await listDevices().catch(()=>{});setError(friendly(e,devices.length))}
  }
  async function detect(){
    await listDevices();
    if(!devices.length){setError("No live camera is visible yet. Set the phone USB mode to Webcam. If the phone has no Webcam option, use Phone Camera / Choose Photo.");return}
    const phone=devices.find(d=>/android|phone|pixel|samsung|oneplus|vivo|oppo|redmi|realme|motorola|usb|webcam/i.test(d.label));
    await startCamera(phone?.deviceId||sel.value||devices[0].deviceId);
  }
  function open(m){mode=m;title.textContent=m==="scan"?"Purchasing Form Photo Scan":"Purchasing Proof Photo";captureBtn.textContent=m==="scan"?"Capture & Read with Gemini":"Capture & Upload Proof";modal.classList.add("open");void startCamera("")}
  function close(){stop();modal.classList.remove("open");setError("")}
  async function fileToDataUrl(file){if(file.size>12*1024*1024)throw new Error("Use an image/PDF smaller than 12 MB.");return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=()=>reject(new Error("Could not read the file."));r.readAsDataURL(file)})}
  function isoDate(value){const v=String(value||"").trim();if(!v)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const m=v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);if(!m)return v;let y=m[3];if(y.length===2)y=(Number(y)>=70?"19":"20")+y;return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`}
  function setVal(name,value){if(value===undefined||value===null||String(value).trim()==="")return;const el=form.querySelector(`[name="${name}"]`);if(!el)return;el.value=name.endsWith("_date")||name==="quote_date"?isoDate(value):String(value);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))}
  function ensureRows(n){const tbody=form.querySelector("#marketingRows");if(!tbody)return;while(tbody.querySelectorAll("tr").length<n){const add=form.querySelector('.addrow[data-target="marketingRows"]');if(!add)break;add.click()}}
  function fill(data){
    setVal("quote_no",data.quoteNo);setVal("quote_date",data.quoteDate);setVal("customer_name",data.customerName);setVal("place",data.place);setVal("terms",data.terms);setVal("market_type",data.marketType);setVal("marketing_person",data.marketingPerson);setVal("delivery_period",data.deliveryPeriod);setVal("service_person",data.servicePerson);setVal("service_date",data.serviceDate);setVal("service_amount",data.serviceAmount);
    const items=Array.isArray(data.items)?data.items:[];ensureRows(Math.max(3,items.length));const rows=[...form.querySelectorAll("#marketingRows tr")];
    items.forEach((x,i)=>{const row=rows[i];if(!row)return;[["item_name[]",x.itemName],["model[]",x.model],["qty[]",x.qty],["item_value[]",x.itemValue],["add_charge[]",x.addCharge]].forEach(([name,val])=>{if(String(val||"").trim()){const el=row.querySelector(`[name="${name}"]`);if(el){el.value=String(val);el.dispatchEvent(new Event("input",{bubbles:true}))}}})});
  }
  async function scan(file){
    status.textContent="Gemini is reading the purchasing form…";status.className="purchase-camera-status working";
    try{const dataUrl=await fileToDataUrl(file);const r=await fetch(scanUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileDataUrl:dataUrl,fileName:file.name})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Gemini scan failed (${r.status})`);fill(data);status.textContent=`Gemini filled the purchasing form. Confidence ${Math.round(Number(data.overallConfidence||0))}%. Review before Save.`;status.className="purchase-camera-status ok";close()}catch(e){status.textContent=e instanceof Error?e.message:String(e);status.className="purchase-camera-status error"}
  }
  async function uploadProof(file){
    status.textContent="Uploading purchasing proof photo…";status.className="purchase-camera-status working";
    try{const fd=new FormData();fd.append("file",file);const r=await fetch(attachmentUrl,{method:"POST",body:fd});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Upload failed (${r.status})`);status.textContent="Proof photo uploaded.";status.className="purchase-camera-status ok";close();await loadGallery()}catch(e){status.textContent=e instanceof Error?e.message:String(e);status.className="purchase-camera-status error"}
  }
  async function uploadProofBatch(files){
    const list=Array.from(files||[]);
    if(!list.length)return;
    let done=0;
    status.textContent=`Uploading ${list.length} purchasing proof file(s)...`;
    status.className="purchase-camera-status working";
    for(const file of list){
      try{
        const fd=new FormData();
        fd.append("file",file);
        const r=await fetch(attachmentUrl,{method:"POST",body:fd});
        const data=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(data.error||`Upload failed (${r.status})`);
        done++;
      }catch(e){
        status.textContent=`Uploaded ${done}/${list.length}. ${e instanceof Error?e.message:String(e)}`;
        status.className="purchase-camera-status error";
        await loadGallery();
        return;
      }
    }
    status.textContent=`${done} proof file(s) uploaded successfully.`;
    status.className="purchase-camera-status ok";
    close();
    await loadGallery();
  }
  async function useFile(file){if(!file)return;if(mode==="scan")await scan(file);else await uploadProof(file)}
  async function capture(){if(!video.videoWidth||!video.videoHeight){setError("Camera is not ready.");return}const c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight;c.getContext("2d").drawImage(video,0,0,c.width,c.height);const blob=await new Promise(resolve=>c.toBlob(resolve,"image/jpeg",.92));if(!blob){setError("Could not create photo.");return}await useFile(new File([blob],`${mode==="scan"?"purchase-scan":"purchase-proof"}-${Date.now()}.jpg`,{type:"image/jpeg"}))}
  async function loadGallery(){try{const r=await fetch(attachmentUrl,{cache:"no-store"});if(!r.ok)return;const d=await r.json();const files=Array.isArray(d.files)?d.files:[];gallery.innerHTML=files.length?files.map(f=>`<a href="${f.url}" target="_blank" rel="noreferrer">${String(f.name||"photo")}</a>`).join(""):`<span>No proof photos uploaded yet.</span>`}catch{}}

  panel.querySelector("[data-purchase-scan-camera]")?.addEventListener("click",()=>open("scan"));
  panel.querySelector("[data-purchase-proof-camera]")?.addEventListener("click",()=>open("proof"));
  panel.querySelector("[data-purchase-scan-file]")?.addEventListener("click",()=>scanInput?.click());
  panel.querySelector("[data-purchase-proof-file]")?.addEventListener("click",()=>proofInput?.click());
  scanInput?.addEventListener("change",e=>{const f=e.target.files?.[0];if(f)void scan(f);e.target.value=""});
  proofInput?.addEventListener("change",e=>{const files=Array.from(e.target.files||[]);if(files.length)void uploadProofBatch(files);e.target.value=""});
  modal.querySelectorAll("[data-pc-close]").forEach(b=>b.addEventListener("click",close));
  modal.querySelector("[data-pc-detect]")?.addEventListener("click",()=>void detect());
  modal.querySelector("[data-pc-capture]")?.addEventListener("click",()=>void capture());
  sel.addEventListener("change",()=>void startCamera(sel.value));
  modal.querySelector("[data-pc-file]")?.addEventListener("click",()=>mode==="scan"?scanInput?.click():proofInput?.click());
  navigator.mediaDevices?.addEventListener?.("devicechange",()=>{if(modal.classList.contains("open"))void detect()});
  void loadGallery();
})();
/* NUNES V2.8.6.4 MULTI PROOF */
