'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, CloudUpload, LogIn, LogOut, Mail, MessageCircle, RefreshCw, Save, ScanText, ShieldCheck } from 'lucide-react';
import type { AppSettings } from '@/types/service-job';

type WhatsAppStatus = {
  state: string;
  ready: boolean;
  loginRequired: boolean;
  qrDataUrl?: string;
  qrGeneratedAt?: string;
  qrAttempts?: number;
  loginMode?: string;
  loginUrl?: string;
  loginBrowserOpen?: boolean;
  connectedNumber?: string;
  lastError?: string;
};

type EmailStatus = { configured?: boolean; connected?: boolean; sender?: string; status?: string; detail?: string };
type CommStatus = { email?: EmailStatus; whatsapp?: WhatsAppStatus };
type PublicSettings = AppSettings & {
  googleOAuthClientConfigured?: boolean;
  googleOAuthConnected?: boolean;
  geminiApiKeyConfigured?: boolean;
};

async function fetchJson(url: string, init: RequestInit = {}) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
      const raw = await response.text();
      if (!raw.trim()) {
        lastError = new Error(`Service returned an empty response (${response.status}).`);
        if (attempt === 0) { await new Promise(resolve => setTimeout(resolve, 180)); continue; }
        throw lastError;
      }
      let data: any;
      try { data = JSON.parse(raw); }
      catch {
        lastError = new Error('Service returned incomplete data. The local data file is being repaired; click Retry once.');
        if (attempt === 0) { await new Promise(resolve => setTimeout(resolve, 180)); continue; }
        throw lastError;
      }
      if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 0 && lastError.name !== 'AbortError') { await new Promise(resolve => setTimeout(resolve, 180)); continue; }
      throw lastError;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error('Service connection failed.');
}

export default function SettingsClient({ initialSettings = null }: { initialSettings?: PublicSettings | null }) {
  const [settings, setSettings] = useState<PublicSettings | null>(initialSettings);
  const [comm, setComm] = useState<CommStatus>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  async function loadSettings() {
    try {
      const data = await fetchJson('/api/settings');
      if (!data.settings) throw new Error('Settings response is missing.');
      setSettings(data.settings);
    } catch (e) { setError(e instanceof Error ? e.message : 'Settings could not load.'); }
  }

  async function loadEmail() {
    try {
      const email = await fetchJson('/api/email/status');
      setComm(prev => ({ ...prev, email }));
      setSettings(prev => prev ? { ...prev, googleOAuthConnected: Boolean(email.connected), googleOAuthEmail: email.sender || '', googleOAuthClientConfigured: Boolean(email.configured) } : prev);
    } catch { /* Keep the last connection result during a temporary network failure. */ }
  }

  async function loadComm() {
    try {
      const base = await fetchJson('/api/communication/status');
      setComm(prev=>({
        ...prev,
        ...base,
        // WhatsApp is intentionally NOT taken from this slower combined status call.
        // WhatsApp status is refreshed independently below so Gmail/network checks can
        // never delay the saved-session reconnect or one-time link status.
        whatsapp: prev.whatsapp,
        email: prev.email?.status === 'READY' && base.email?.status === 'CONFIGURED' ? prev.email : base.email
      }));
    } catch { /* best effort */ }
  }

  async function loadWhatsApp(initialize = true) {
    try {
      const data = await fetchJson(`/api/whatsapp/status?ts=${Date.now()}&init=${initialize ? '1' : '0'}`);
      setComm(prev=>({...prev, whatsapp:data}));
      return data as WhatsAppStatus;
    } catch { return null; }
  }

  async function openWhatsAppWebLogin() {
    setError(''); setMessage('Opening WhatsApp Web now…');
    try {
      const data = await fetchJson(`/api/whatsapp/prepare?ts=${Date.now()}`, { method:'POST' });
      setComm(prev=>({...prev, whatsapp:data}));
      if (data.state === 'ERROR' || data.state === 'NOT_STARTED') throw new Error(data.lastError || 'WhatsApp login could not start.');
      setMessage(data.ready ? 'WhatsApp connected.' : data.loginBrowserOpen ? 'WhatsApp Web login window is open on the main-server PC. Complete the link there.' : 'Opening WhatsApp Web on the main-server PC. Waiting for the login window…');
      return data as WhatsAppStatus;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WhatsApp Web login could not be opened.');
      return null;
    }
  }

  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('gmail_connected');
    const gmailError = params.get('gmail_error');
    const gmailLoginOpened = params.get('gmail_login_opened');
    if (connected) setMessage(`Google connected — ${connected} is ready for automatic customer email.`);
    else if (gmailLoginOpened) setMessage('Google sign-in opened on this main-server PC. Complete the login in the Google window; this page will refresh the Gmail status automatically.');
    if (gmailError) setError(gmailError);
    if (connected || gmailError || gmailLoginOpened) window.history.replaceState({}, '', '/settings');
    if (!initialSettings) void loadSettings();
    void loadEmail();
    // V21: restore an already-linked WhatsApp Web session silently. First-time
    // login is opened only when the owner presses Open WhatsApp Web Login.
    void loadWhatsApp(true);
  },[]);

  useEffect(()=>{
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) return;
      const latest = await loadWhatsApp(true);
      if (cancelled) return;
      // V21 no longer waits for an app-generated QR. Poll modestly while the
      // official login window/authentication is active, then back off when stable.
      const activeLogin = latest?.state === 'LOGIN_BROWSER_OPEN' || latest?.state === 'AUTHENTICATED' || latest?.state === 'STARTING';
      timer = setTimeout(poll, latest?.ready ? 5000 : activeLogin ? 350 : 1200);
    };
    timer = setTimeout(poll, 60);
    return ()=>{ cancelled = true; if (timer) clearTimeout(timer); };
  },[]);

  useEffect(() => {
    const refresh = () => { void loadEmail(); void loadWhatsApp(false); };
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadEmail(); }, 3000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    if (comm.whatsapp?.ready) setMessage('WhatsApp connected. Automatic sending is ready.');
  }, [comm.whatsapp?.ready]);

  async function save() {
    if (!settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await fetchJson('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
      setSettings(data.settings);
      setMessage('Settings saved');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function uploadOAuthJson(file: File) {
    if (!settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const parsed = JSON.parse(await file.text());
      const cfg = parsed.installed;
      if (!cfg?.client_id || !cfg?.client_secret) throw new Error('This is not a Google Desktop OAuth client JSON. In Google Cloud create OAuth Client ID with application type Desktop app, then download that JSON.');
      const next = { ...settings, googleOAuthClientId:String(cfg.client_id), googleOAuthClientSecret:String(cfg.client_secret) };
      const data = await fetchJson('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
      setSettings(data.settings);
      setMessage('Google OAuth setup saved. Click Sign in with Google and choose the Gmail account that should send customer mail.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function useDefaultOAuthJson() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await fetchJson('/api/google/oauth/default',{method:'POST'});
      setSettings(data.settings);
      setComm(prev=>({...prev,email:{configured:true,connected:Boolean(data.settings?.googleOAuthConnected),sender:data.settings?.googleOAuthEmail || '',status:data.settings?.googleOAuthConnected?'READY':'LOGIN_REQUIRED'}}));
      setMessage(data.changed
        ? 'Default NUNES Google JSON selected. Click Sign in with Google once to connect the sender account.'
        : 'Default NUNES Google JSON is already selected.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function checkConnections() {
    setChecking(true); setError(''); setMessage('');
    try {
      const data = await fetchJson('/api/communication/status',{method:'POST'});
      setComm(prev=>({...prev, ...data, whatsapp:prev.whatsapp}));
      void loadWhatsApp(true);
      if (data.email?.status === 'READY') setMessage(`Google Gmail connected — ${data.email.sender}. WhatsApp status refreshed.`);
      else setError(data.email?.detail || 'Google Gmail is not connected.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setChecking(false); }
  }

  async function disconnectGoogle() {
    setChecking(true); setError(''); setMessage('');
    try {
      await fetch('/api/google/oauth/disconnect',{method:'POST'});
      await loadSettings();
      setComm(prev=>({...prev,email:{configured:true,connected:false,status:'LOGIN_REQUIRED',detail:'Google account disconnected. Sign in again when needed.'}}));
      setMessage('Google Gmail disconnected. OAuth client setup is kept so you can sign in again quickly.');
    } finally { setChecking(false); }
  }

  async function logoutWhatsApp() {
    setChecking(true); setError(''); setMessage('');
    try {
      const data = await fetchJson('/api/whatsapp/logout',{method:'POST'});
      setComm(prev=>({...prev,whatsapp:data}));
      setMessage('WhatsApp Web link removed. Click Open WhatsApp Web Login to link the main-server PC again.');
    } finally { setChecking(false); }
  }

  if (!settings) return <div className="panel empty">{error || 'Loading settings…'}{error && <button className="button" onClick={() => { setError(''); void loadSettings(); }}>Retry</button>}</div>;
  const wa = comm.whatsapp;
  const emailReady = comm.email ? Boolean(comm.email.connected) : Boolean(settings.googleOAuthConnected && settings.googleOAuthEmail);
  const oauthConfigured = Boolean(settings.googleOAuthClientConfigured || (settings.googleOAuthClientId && settings.googleOAuthClientSecret));
  const visionConfigured = Boolean(settings.geminiApiKeyConfigured || settings.geminiApiKey);

  return <div className="stack20 settingsPage">
    <section className="editorHeader"><div className="editorTitle"><Link href="/" className="iconButton"><ArrowLeft size={20}/></Link><div><p className="eyebrow">SYSTEM SETTINGS</p><h1>Service App Settings</h1><p className="muted">Company, Gemini form reader, Google Gmail and WhatsApp Web connection.</p></div></div><button className="button primary large" onClick={()=>void save()} disabled={busy}><Save size={18}/> Save Settings</button></section>
    {(message||error)&&<div className={`notice ${error?'error':'success'}`}>{error||<><Check size={17}/>{message}</>}</div>}

    <section className="panel">
      <div className="sectionHead"><div><span className="step">01</span><div><h2>Company & Branches</h2><p>These values are available in every job form and master report.</p></div></div></div>
      <div className="formGrid two">
        <div className="field"><label>Company Name</label><input value={settings.companyName} onChange={e=>setSettings({...settings,companyName:e.target.value})}/></div>
        <div className="field"><label>Default Branch</label><select value={settings.defaultBranch} onChange={e=>setSettings({...settings,defaultBranch:e.target.value})}>{settings.branchNames.map(b=><option key={b}>{b}</option>)}</select></div>
        <div className="field span-full"><label>Branches — one per line</label><textarea rows={5} value={settings.branchNames.join('\n')} onChange={e=>setSettings({...settings,branchNames:e.target.value.split('\n').map(x=>x.trim()).filter(Boolean)})}/></div>
      </div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><span className="step">02</span><div><h2>Automatic Product Lookup & Sending</h2><p>Save & Preview automatically sends the finalized repair-cost message. Product lookup runs IndiaMART first and falls back to the wider web only when needed.</p></div></div></div>
      <div className="driveSetup">
        <div className="setupStep"><span>1</span><div><b>Accurate automatic product lookup</b><p>Uses Product Name + Make/Model with strict model matching. If the exact product cannot be verified, the app prefers no image over a wrong product image.</p></div><label className="toggle"><input type="checkbox" checked={settings.autoLookupProductDetails} onChange={e=>setSettings({...settings,autoLookupProductDetails:e.target.checked})}/><i></i></label></div>
        <div className="setupStep"><span>2</span><div><b>Automatic customer delivery</b><p>Always ON after Save & Preview. Email and WhatsApp are tracked separately to prevent duplicate sends.</p></div><strong>Always ON</strong></div>
      </div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><span className="step">03</span><div><h2>AI Handwritten Form Reader</h2><p>Gemini Vision reads the complete photographed or PDF Service Job Card and returns structured fields for local validation.</p></div></div><span className={`connectionBadge ${visionConfigured && settings.formVisionEnabled ? 'connected':''}`}><ScanText size={16}/>{visionConfigured && settings.formVisionEnabled ? 'Gemini ready' : 'Needs API key'}</span></div>
      <div className="formGrid two commSettingsGrid">
        <div className="commSettingsCard">
          <div className="commSettingsTitle"><b>Gemini Vision form parsing</b><label className="toggle"><input type="checkbox" checked={settings.formVisionEnabled} onChange={e=>setSettings({...settings,formVisionEnabled:e.target.checked})}/><i></i></label></div>
          <div className="field"><label>Gemini API Key {settings.geminiApiKeyConfigured ? '· configured' : ''}</label><input type="password" value={settings.geminiApiKey} onChange={e=>setSettings({...settings,geminiApiKey:e.target.value})} placeholder={settings.geminiApiKeyConfigured?'Gemini key is already configured · leave blank to keep it':'Paste Gemini API key for form reading'}/></div>
          <div className="field"><label>Gemini Model</label><select value={settings.formVisionModel} onChange={e=>setSettings({...settings,formVisionModel:e.target.value})}><option value="gemini-3.6-flash">Gemini 3.6 Flash · recommended</option><option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite · fastest / lower cost</option></select></div>
          <p className="privacyNote"><ShieldCheck size={16}/> Only Upload Service Form sends the selected service-card image/PDF to Gemini. The API key stays on the server and is never returned to the browser.</p>
        </div>
        <div className="commSettingsCard connectionTestCard"><b>Single-reader method</b><p><strong>1.</strong> Upload image/PDF → <strong>2.</strong> Gemini Vision reads the complete card → <strong>3.</strong> structured JSON → <strong>4.</strong> local validation → <strong>5.</strong> fill the Service form.</p><div className="settingsActions"><button className="button primary" type="button" onClick={()=>void save()} disabled={busy}><Save size={16}/>{busy?'Saving…':'Save Gemini Settings'}</button><button className="button" type="button" onClick={async()=>{setChecking(true);setError('');setMessage('');try{const saved=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});const savedData=await saved.json();if(!saved.ok)throw new Error(savedData.error||'Gemini settings could not be saved');setSettings(savedData.settings);const r=await fetch('/api/forms/gemini-test',{method:'POST'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Gemini test failed');setMessage(`Gemini connection ready · ${d.model}`);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setChecking(false);}}} disabled={checking}><RefreshCw size={16}/>{checking?'Testing…':'Save & Test Gemini'}</button></div></div>
      </div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><span className="step">04</span><div><h2>Google Gmail Connection</h2><p>SMTP and Gmail App Passwords are removed. ServiceFlow sends customer mail through the Gmail API after you sign in with Google.</p></div></div><span className={`connectionBadge ${emailReady ? 'connected':''}`}><Mail size={16}/>{emailReady ? 'Connected' : oauthConfigured ? 'Sign-in required' : 'OAuth setup needed'}</span></div>
      <div className="formGrid two commSettingsGrid">
        <div className="commSettingsCard">
          <div className="commSettingsTitle"><b>Google OAuth · Gmail API</b><strong>{emailReady ? 'CONNECTED' : 'READY TO SET UP'}</strong></div>
          {emailReady ? <>
            <div className="googleConnectedAccount"><Check size={20}/><div><b>{comm.email?.sender || settings.googleOAuthEmail}</b><span>Authorized to send ServiceFlow customer emails through Gmail API.</span></div></div>
            <div className="settingsActions"><button className="button" type="button" onClick={()=>void checkConnections()} disabled={checking}><RefreshCw size={16}/> Check Google & WhatsApp</button><button className="button dangerText" type="button" onClick={()=>void disconnectGoogle()} disabled={checking}><LogOut size={16}/> Disconnect Google</button></div>
          </> : <>
            <p className="privacyNote"><ShieldCheck size={16}/> The NUNES Google OAuth JSON is already included as the default. Normally you only need to click <b>Sign in with Google</b>.</p>
            <div className="field"><label>OAuth setup</label><input readOnly value={oauthConfigured ? 'Default / saved Desktop OAuth client ready' : 'Not configured yet'}/></div>
            {oauthConfigured ? <a className="button primary" href="/api/google/oauth/start"><LogIn size={17}/> Sign in with Google</a> : <button className="button primary" type="button" disabled><LogIn size={17}/> Sign in with Google</button>}
          </>}
          <div className="settingsActions">
            <button className="button" type="button" onClick={()=>void useDefaultOAuthJson()} disabled={busy}><RefreshCw size={16}/> Use Default Google JSON</button>
            <label className="button oauthUploadButton"><CloudUpload size={17}/> Add / Change Other Google JSON<input type="file" accept="application/json,.json" hidden onChange={e=>{const f=e.target.files?.[0]; if(f) void uploadOAuthJson(f); e.currentTarget.value='';}}/></label>
          </div>
          <p className="privacyNote"><ShieldCheck size={16}/> If you choose another Desktop OAuth JSON, the old Gmail authorization is cleared automatically and you sign in once with the new Google client. Other ServiceFlow settings and data are not changed.</p>
        </div>
        <div className="commSettingsCard connectionTestCard">
          <b>How it works</b>
          <p>Choose the Google account once. Google returns an OAuth refresh token to the ServiceFlow server. ServiceFlow uses only the <b>gmail.send</b> permission for customer email and refreshes access automatically.</p>
          <p className="privacyNote">Google sign-in opens in a normal browser tab because Google blocks OAuth inside embedded app frames. Complete this one-time Gmail connection on the main-server PC. OAuth callback is configured automatically.</p>
          <button className="button" type="button" onClick={()=>void checkConnections()} disabled={checking}><RefreshCw size={16}/>{checking?'Checking…':'Check Google & WhatsApp'}</button>
        </div>
      </div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><span className="step">05</span><div><h2>WhatsApp Web Login</h2><p>Link the main-server PC once using the official WhatsApp Web page. The saved browser session is then reused automatically after Save & Preview.</p></div></div><span className={`connectionBadge ${wa?.ready?'connected':''}`}><MessageCircle size={16}/>{wa?.ready ? 'Connected' : wa?.loginBrowserOpen ? 'Login window open' : 'Login required'}</span></div>
      <div className="whatsappLoginGrid">
        <div className="commSettingsCard"><b>Status</b><p>{wa?.ready ? `Connected${wa.connectedNumber ? ` as +${wa.connectedNumber}` : ''}.` : wa?.state === 'LOGIN_BROWSER_OPEN' ? 'Official WhatsApp Web is open on the main-server PC. Complete the one-time link there.' : wa?.state === 'AUTHENTICATED' ? 'WhatsApp authenticated. Preparing the connection…' : wa?.state === 'STARTING' ? 'Restoring the saved WhatsApp Web login…' : (wa?.lastError || 'Not linked yet. Open WhatsApp Web Login once on the main-server PC.')}</p><div className="settingsActions"><button className="button" type="button" onClick={()=>void loadWhatsApp(true)}><RefreshCw size={16}/> Refresh</button><button className={wa?.ready ? 'button dangerText' : 'button primary'} type="button" onClick={()=>void (wa?.ready ? logoutWhatsApp() : openWhatsAppWebLogin())} disabled={checking}><LogIn size={16}/>{wa?.ready ? 'Disconnect / Relink' : 'Open WhatsApp Web Login'}</button></div></div>
        <div className="whatsappQrCard">{wa?.ready ? <div className="whatsappReady"><Check size={42}/><b>WhatsApp ready</b><span>Save & Preview can send automatically using this saved session.</span></div> : <div className="whatsappReady"><LogIn size={34}/><b>{wa?.loginBrowserOpen ? 'Complete login in WhatsApp Web' : 'Link WhatsApp Web once'}</b><span>Click Open WhatsApp Web Login. In the official WhatsApp page use its normal QR or “Link with phone number”. After linking, the window minimizes and stays connected. Leave it running.</span></div>}</div>
      </div>
      <div className="settingsActions"><span className="privacyNote"><ShieldCheck size={16}/> WhatsApp login is stored only on the main-server PC. Company records and Service history are not part of the browser login profile.</span></div>
    </section>
  </div>;
}
