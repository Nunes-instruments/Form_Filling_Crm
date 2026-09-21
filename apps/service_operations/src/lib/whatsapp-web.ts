import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export type WhatsAppWebState = 'NOT_STARTED' | 'STARTING' | 'LOGIN_REQUIRED' | 'LOGIN_BROWSER_OPEN' | 'AUTHENTICATED' | 'READY' | 'DISCONNECTED' | 'ERROR';

type SidecarStatus = {
  state: WhatsAppWebState;
  ready: boolean;
  loginRequired: boolean;
  qrDataUrl?: string;
  qrGeneratedAt?: string;
  qrAttempts?: number;
  loginMode?: string;
  loginUrl?: string;
  loginBrowserOpen?: boolean;
  connectedNumber?: string;
  linked?: boolean;
  sendReady?: boolean;
  lastError?: string;
  lastStateAt?: string;
  runtimeInstalling?: boolean;
};

const SIDECAR_URL = process.env.WHATSAPP_SIDECAR_URL || 'http://127.0.0.1:5056';
let lastStartAttempt = 0;

// NUNES_V2_8_9_0_PERSISTENT_WHATSAPP_SESSION
// Reuse the main-server WhatsApp link across forms and resident restarts.
const SAVED_LINK_MARKER = path.join(
  process.env.LOCALAPPDATA || '',
  'ServiceFlow',
  'whatsapp-web-link',
  'linked.json'
);
function hasSavedWhatsAppSession() {
  try { return Boolean(process.env.LOCALAPPDATA) && fs.existsSync(SAVED_LINK_MARKER); }
  catch { return false; }
}
async function waitForSidecar(maxMs = 5000) {
  const deadline = Date.now() + Math.max(500, maxMs);
  while (Date.now() < deadline) {
    try {
      const response = await sidecarFetch('/health', undefined, 280);
      if (response.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  return false;
}

async function sidecarFetch(pathname: string, init?: RequestInit, timeoutMs = 350) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${SIDECAR_URL}${pathname}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) }
    });
  } finally { clearTimeout(timer); }
}

function startSidecarOnDemand() {
  if (process.platform !== 'win32') return false;
  const now = Date.now();
  if (now - lastStartAttempt < 15000) return true;
  lastStartAttempt = now;
  // Primary path: ask Windows to start the already-prepared hidden resident. This
  // is much faster than launching npm/Chromium setup from the Settings request and
  // it cannot flash a CMD/PowerShell window in front of staff.
  try {
    const task = spawn('schtasks.exe', ['/Run', '/TN', 'NUNES WhatsApp Resident'], {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    task.on('error', () => { lastStartAttempt = 0; });
    task.unref();
    return true;
  } catch {}
  // Compatibility fallback for PCs that have not re-run the owner setup yet.
  try {
    const bat = path.join(process.cwd(), 'RUN_WHATSAPP_HIDDEN.bat');
    const child = spawn('cmd.exe', ['/d', '/c', bat], {
      cwd: process.cwd(), detached: true, windowsHide: true, stdio: 'ignore'
    });
    child.on('error', () => { lastStartAttempt = 0; });
    child.unref();
    return true;
  } catch { return false; }
}

function unavailable(error: unknown): SidecarStatus {
  const detail = error instanceof Error ? error.message : String(error || '');
  return {
    state: 'NOT_STARTED', ready: false, loginRequired: true, qrDataUrl: '', connectedNumber: '',
    lastError: detail ? `WhatsApp is not running yet. Open Connections when you need it. ${detail}` : 'WhatsApp starts only when needed.',
    lastStateAt: new Date().toISOString(), runtimeInstalling: false
  };
}

function starting(): SidecarStatus {
  const linked=hasSavedWhatsAppSession();
  return {
    state:'STARTING', ready:false, loginRequired:!linked, linked, qrDataUrl:'', connectedNumber:'',
    lastError:linked ? 'Restoring the saved WhatsApp connection in the background.' : 'WhatsApp is starting. Link once if this PC has never been connected.',
    lastStateAt:new Date().toISOString(), runtimeInstalling:true
  };
}

export async function getWhatsAppWebStatus(initialize = true): Promise<SidecarStatus> {
  // V21: kick the prepared hidden resident first. A previously linked WhatsApp
  // Web profile reconnects silently; first-time login is opened only by /prepare.

  try {
    const response = await sidecarFetch(`/status?init=${initialize ? '1' : '0'}`, undefined, initialize ? 220 : 120);
    if (!response.ok) throw new Error(`runtime HTTP ${response.status}`);
    return await response.json() as SidecarStatus;
  } catch (error) {
    if (initialize || hasSavedWhatsAppSession()) {
      startSidecarOnDemand();
      return { ...starting(), loginRequired: false };
    }
    return unavailable(error);
  }
}

async function replayPrepareInBackground() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await sidecarFetch('/prepare', { method: 'POST', body: '{}' }, 400);
      if (response.ok) return;
    } catch { /* resident is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 90));
  }
}

export async function prepareWhatsAppWeb(): Promise<SidecarStatus> {
  // V6.6.7 EASY CONNECT: never keep the button waiting for a slow hidden restore or Chromium page load.
  // If the resident is warm this returns in a few milliseconds. If Windows has to
  // start the resident, return STARTING immediately and replay /prepare in the
  // background until the resident accepts it. The UI polls local status separately.
  try {
    const response = await sidecarFetch('/prepare', { method: 'POST', body: '{}' }, 400);
    if (!response.ok) throw new Error(`runtime HTTP ${response.status}`);
    return await response.json() as SidecarStatus;
  } catch {
    startSidecarOnDemand();
    void replayPrepareInBackground();
    return { ...starting(), loginBrowserOpen: true, lastError: '', runtimeInstalling: false };
  }
}

export async function sendWhatsAppWebMessage(phoneDigits: string, message: string, branded = false) {
  const digits = String(phoneDigits || '').replace(/\D/g, '');
  if (!digits) return { status: 'SKIPPED' as const, detail: 'Customer WhatsApp number missing' };

  const sendOnce = async () => {
    const response = await sidecarFetch('/send', {
      method: 'POST', body: JSON.stringify({ phoneDigits: digits, message, branded })
    }, 30000);
    const payload = await response.json().catch(() => ({} as any));
    if (!response.ok) throw new Error(payload?.detail || `runtime HTTP ${response.status}`);
    return payload;
  };

  try {
    return await sendOnce();
  } catch (firstError) {
    if (hasSavedWhatsAppSession()) {
      startSidecarOnDemand();
      if (await waitForSidecar(5000)) {
        try { return await sendOnce(); }
        catch (retryError) {
          return { status:'LOGIN_REQUIRED' as const, detail: retryError instanceof Error ? retryError.message : 'Saved WhatsApp session could not be restored' };
        }
      }
    } else {
      startSidecarOnDemand();
    }
    return { status:'LOGIN_REQUIRED' as const, detail:firstError instanceof Error ? firstError.message : 'WhatsApp runtime is starting' };
  }
}

export async function logoutWhatsAppWeb() {
  try {
    const response = await sidecarFetch('/logout', { method: 'POST', body: '{}' }, 1200);
    if (!response.ok) throw new Error(`runtime HTTP ${response.status}`);
    return await response.json() as SidecarStatus;
  } catch (error) {
    if (startSidecarOnDemand()) return starting();
    return unavailable(error);
  }
}
