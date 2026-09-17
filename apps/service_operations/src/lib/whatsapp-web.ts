import { spawn } from 'child_process';
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
  lastError?: string;
  lastStateAt?: string;
  runtimeInstalling?: boolean;
};

const SIDECAR_URL = process.env.WHATSAPP_SIDECAR_URL || 'http://127.0.0.1:5056';
let lastStartAttempt = 0;

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
  return {
    state: 'STARTING', ready: false, loginRequired: true, qrDataUrl: '', connectedNumber: '',
    lastError: 'WhatsApp is reconnecting in the background. If this PC has not been linked yet, open WhatsApp Web Login once.',
    lastStateAt: new Date().toISOString(), runtimeInstalling: true
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
    if (initialize) { startSidecarOnDemand(); return starting(); }
    return unavailable(error);
  }
}

export async function prepareWhatsAppWeb(): Promise<SidecarStatus> {
  // A cold resident may not yet be listening. Replay the explicit login request
  // until it reaches the resident, then wait briefly for the visible official
  // WhatsApp Web window to actually open on the main-server PC.
  const deadline = Date.now() + 10000;
  let kicked = false;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await sidecarFetch('/prepare', { method: 'POST', body: '{}' }, 1200);
      if (!response.ok) throw new Error(`runtime HTTP ${response.status}`);
      let status = await response.json() as SidecarStatus;
      if (status.ready || status.loginBrowserOpen || status.state === 'AUTHENTICATED' || status.state === 'ERROR') return status;

      const progressDeadline = Math.min(deadline, Date.now() + 5000);
      while (Date.now() < progressDeadline) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const poll = await sidecarFetch('/status', undefined, 700);
        if (!poll.ok) break;
        status = await poll.json() as SidecarStatus;
        if (status.ready || status.loginBrowserOpen || status.state === 'AUTHENTICATED' || status.state === 'ERROR') return status;
      }
      return status;
    } catch (error) {
      lastError = error;
      if (!kicked) { startSidecarOnDemand(); kicked = true; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return { ...unavailable(lastError), state: 'ERROR', lastError: 'WhatsApp resident did not respond within 10 seconds. Run CHECK_WHATSAPP_STATUS.bat on the main-server PC and retry login.' };
}

export async function sendWhatsAppWebMessage(phoneDigits: string, message: string, branded = false) {
  const digits = String(phoneDigits || '').replace(/\D/g, '');
  if (!digits) return { status: 'SKIPPED' as const, detail: 'Customer WhatsApp number missing' };
  try {
    const response = await sidecarFetch('/send', {
      method: 'POST', body: JSON.stringify({ phoneDigits: digits, message, branded })
    }, 30000);
    const payload = await response.json().catch(() => ({} as any));
    if (!response.ok) throw new Error(payload?.detail || `runtime HTTP ${response.status}`);
    return payload;
  } catch (error) {
    startSidecarOnDemand();
    return { status: 'LOGIN_REQUIRED' as const, detail: error instanceof Error ? error.message : 'WhatsApp runtime is starting' };
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
