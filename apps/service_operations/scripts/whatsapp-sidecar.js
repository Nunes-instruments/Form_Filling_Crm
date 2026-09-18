'use strict';

// NUNES V21 WhatsApp runtime
// Link-once method: open the official WhatsApp Web page in a dedicated browser
// profile, let the owner link normally once, then reuse that persisted profile
// silently for automatic ServiceFlow sending on future starts.

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const VERSION = '3.4.0';
const ENGINE = 'WhatsAppWebLink';
const PORT = Number(process.env.WHATSAPP_SIDECAR_PORT || 5056);
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(process.cwd(), 'data');
const ROOT = path.join(LOCALAPPDATA, 'ServiceFlow', 'whatsapp-web-link');
const AUTH_ROOT = path.join(ROOT, 'auth');
const LINKED_MARKER = path.join(ROOT, 'linked.json');
const CLIENT_ID = 'nunes';
const LOGIN_URL = 'https://web.whatsapp.com/';

let wweb = null;
let runtimeError = '';
let client = null;
let starting = null;
let restartTimer = null;
let state = 'NOT_STARTED';
let connectedNumber = '';
let lastError = '';
let lastStateAt = new Date().toISOString();
let sessionStartedAt = '';
let loadingMessage = 'Waiting to start';
let loginBrowserOpen = false;
let manualShutdown = false;
let generation = 0;
let visibleClientStarting = false;

function mark(next, error = '') {
  state = next;
  lastError = error;
  lastStateAt = new Date().toISOString();
}

function findBrowserExecutable() {
  const explicit = String(process.env.WHATSAPP_BROWSER_PATH || '').trim();
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    explicit,
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    local ? path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : ''
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function hasLinkedSession() {
  try { return fs.existsSync(LINKED_MARKER); } catch (_) { return false; }
}

async function writeLinkedMarker() {
  await fsp.mkdir(ROOT, { recursive: true });
  await fsp.writeFile(LINKED_MARKER, JSON.stringify({ linkedAt: new Date().toISOString(), connectedNumber }, null, 2), 'utf8');
}

async function removeLinkedSession() {
  await fsp.rm(AUTH_ROOT, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(LINKED_MARKER, { force: true }).catch(() => {});
  await fsp.mkdir(AUTH_ROOT, { recursive: true }).catch(() => {});
}

function loadRuntime() {
  if (wweb) return wweb;
  try {
    const paths = String(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
    const entry = require.resolve('whatsapp-web.js', { paths: [...paths, process.cwd(), __dirname] });
    wweb = require(entry);
    if (!wweb?.Client || !wweb?.LocalAuth) throw new Error('whatsapp-web.js Client/LocalAuth is unavailable.');
    runtimeError = '';
    return wweb;
  } catch (error) {
    runtimeError = error && error.message ? error.message : String(error);
    mark('ERROR', `WhatsApp Web runtime failed to load: ${runtimeError}`);
    throw error;
  }
}

async function destroyClient() {
  const current = client;
  client = null;
  visibleClientStarting = false;
  if (!current) return;
  try { await current.destroy(); } catch (_) {}
}

// V6.6.7: an explicit owner click must not sit behind a slow hidden restore.
// Stop the existing Chromium immediately, release the WhatsApp profile lock,
// and let the visible login window start without waiting several seconds.
async function destroyClientFast() {
  const current = client;
  client = null;
  visibleClientStarting = false;
  if (!current) return;
  try {
    const proc = current?.pupBrowser?.process?.();
    if (proc?.pid) {
      try { proc.kill('SIGKILL'); } catch (_) {
        if (process.platform === 'win32') {
          try {
            const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
              windowsHide: true, detached: true, stdio: 'ignore'
            });
            killer.unref();
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  try {
    const closing = current.destroy();
    if (closing && typeof closing.catch === 'function') closing.catch(() => {});
  } catch (_) {}
  await new Promise(resolve => setTimeout(resolve, 90));
}

function scheduleHiddenRestart(delayMs = 1200) {
  if (restartTimer || manualShutdown || !hasLinkedSession()) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void ensureClient(false, true);
  }, Math.max(500, delayMs));
}

async function ensureClient(visibleLogin = false, force = false) {
  if (runtimeError) {
    mark('ERROR', `WhatsApp Web runtime failed to load: ${runtimeError}`);
    return;
  }
  if (client && !force && ['READY', 'STARTING', 'AUTHENTICATED', 'LOGIN_BROWSER_OPEN'].includes(state)) return;
  if (!visibleLogin && !hasLinkedSession()) {
    loadingMessage = 'Link WhatsApp Web once on the main-server PC';
    mark('LOGIN_REQUIRED');
    return;
  }
  if (starting) {
    if (visibleLogin) {
      // Do not let an explicit owner click wait for the hidden restore launch gate.
      // Bump the generation so the older initializer exits at its next checkpoint.
      generation += 1;
      starting = null;
      await destroyClientFast();
    } else {
      await starting;
      return;
    }
  }

  starting = (async () => {
    const { Client, LocalAuth } = loadRuntime();
    const browserPath = findBrowserExecutable();
    if (!browserPath) throw new Error('Google Chrome or Microsoft Edge was not found on the main-server PC.');

    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    const currentGeneration = ++generation;
    if (visibleLogin) await destroyClientFast();
    else await destroyClient();
    if (currentGeneration !== generation) return;
    await fsp.mkdir(AUTH_ROOT, { recursive: true });
    if (currentGeneration !== generation) return;

    manualShutdown = false;
    // FAST OPEN: mark the explicit login request as opening immediately, instead of
    // waiting for WhatsApp's QR event. The previous build made the UI appear frozen
    // for several seconds even though Chrome had already been requested.
    loginBrowserOpen = Boolean(visibleLogin);
    sessionStartedAt = new Date().toISOString();
    connectedNumber = '';
    loadingMessage = visibleLogin
      ? 'Opening official WhatsApp Web now on the main-server PC'
      : 'Restoring the saved WhatsApp Web login';
    mark(visibleLogin ? 'LOGIN_BROWSER_OPEN' : 'STARTING');

    const nextClient = new Client({
      authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: AUTH_ROOT, rmMaxRetries: 8 }),
      puppeteer: {
        headless: visibleLogin ? false : true,
        executablePath: browserPath,
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-sync',
          '--no-service-autorun',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
          '--window-size=1280,900'
        ]
      },
      authTimeoutMs: visibleLogin ? 0 : 9000,
      qrMaxRetries: 0,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0
    });
    client = nextClient;
    visibleClientStarting = Boolean(visibleLogin);

    nextClient.on('qr', () => {
      if (currentGeneration !== generation) return;
      // Do not generate/render an application QR. The official WhatsApp Web window
      // is the only login surface in V21. The user can scan its QR or choose
      // "Link with phone number" directly on WhatsApp's own page.
      if (visibleLogin) {
        loginBrowserOpen = true;
        loadingMessage = 'Complete the one-time login in the WhatsApp Web window';
        mark('LOGIN_BROWSER_OPEN');
      } else {
        loadingMessage = 'Saved WhatsApp login needs to be linked again';
        mark('LOGIN_REQUIRED', 'Saved WhatsApp Web login is no longer valid. Open WhatsApp Web Login once again.');
        setTimeout(() => { if (currentGeneration === generation) void destroyClient(); }, 50);
      }
    });

    nextClient.on('authenticated', () => {
      if (currentGeneration !== generation) return;
      loadingMessage = 'WhatsApp authenticated';
      mark('AUTHENTICATED');
    });

    nextClient.on('ready', async () => {
      if (currentGeneration !== generation) return;
      connectedNumber = String(nextClient.info?.wid?.user || '').replace(/\D/g, '');
      loadingMessage = 'WhatsApp connected';
      mark('READY');
      await writeLinkedMarker().catch(() => {});

      // Keep the authenticated browser alive. Minimizing preserves the live sender
      // without another Chrome launch or a second WhatsApp synchronization.
      if (visibleLogin) {
        loginBrowserOpen = false;
        try {
          const cdp = await nextClient.pupPage.target().createCDPSession();
          try {
            const { windowId } = await cdp.send('Browser.getWindowForTarget');
            await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
          } finally { await cdp.detach(); }
        } catch (_) { /* Keep the working connection even if minimizing is unsupported. */ }
      }
    });

    nextClient.on('auth_failure', async (message) => {
      if (currentGeneration !== generation) return;
      loginBrowserOpen = false;
      connectedNumber = '';
      await fsp.rm(LINKED_MARKER, { force: true }).catch(() => {});
      loadingMessage = 'WhatsApp login must be linked again';
      mark('LOGIN_REQUIRED', String(message || 'WhatsApp Web authentication failed.'));
      await destroyClient();
    });

    nextClient.on('disconnected', async (reason) => {
      if (currentGeneration !== generation || manualShutdown) return;
      loginBrowserOpen = false;
      connectedNumber = '';
      const text = String(reason || 'WhatsApp disconnected');
      if (/LOGOUT|UNPAIRED|UNPAIRED_IDLE/i.test(text)) {
        await fsp.rm(LINKED_MARKER, { force: true }).catch(() => {});
        loadingMessage = 'WhatsApp login was disconnected';
        mark('LOGIN_REQUIRED', 'WhatsApp was unlinked. Open WhatsApp Web Login to link it once again.');
      } else {
        loadingMessage = 'Reconnecting WhatsApp in the background';
        mark('STARTING', text);
        scheduleHiddenRestart(1200);
      }
    });

    // initialize waits for authentication. A stale saved session is allowed only a
    // short restore window; after that we stop it so the Connect button can open the
    // visible login immediately instead of waiting behind a hidden Chromium process.
    void (async () => {
      let restoreTimer = null;
      if (!visibleLogin) {
        restoreTimer = setTimeout(() => {
          if (currentGeneration !== generation || state === 'READY') return;
          loadingMessage = 'Saved login restore took too long. Click Connect WhatsApp Now.';
          mark('LOGIN_REQUIRED', 'Saved WhatsApp login could not be restored quickly. Open WhatsApp Web Login once.');
          void destroyClientFast();
        }, 9000);
      }
      try {
        await nextClient.initialize();
      } catch (error) {
        if (currentGeneration !== generation) return;
        const text = error && error.message ? error.message : String(error);
        loginBrowserOpen = false;
        if (visibleLogin || !hasLinkedSession()) {
          loadingMessage = 'WhatsApp Web login could not open';
          mark('LOGIN_REQUIRED', text);
        } else {
          loadingMessage = 'Saved WhatsApp login could not be restored';
          mark('LOGIN_REQUIRED', text);
        }
        await destroyClientFast();
      } finally {
        if (restoreTimer) clearTimeout(restoreTimer);
      }
    })();
  })().finally(() => { starting = null; });

  return starting;
}

function statusPayload() {
  return {
    service: 'ServiceFlow WhatsApp Runtime',
    engine: ENGINE,
    version: VERSION,
    state,
    ready: state === 'READY',
    loginRequired: ['NOT_STARTED','LOGIN_REQUIRED','DISCONNECTED','ERROR'].includes(state),
    loginMode: 'browser_link',
    loginUrl: LOGIN_URL,
    loginBrowserOpen,
    qrDataUrl: '',
    qrGeneratedAt: '',
    qrAttempts: 0,
    sessionStartedAt,
    loadingPercent: state === 'READY' ? 100 : state === 'AUTHENTICATED' ? 80 : state === 'STARTING' ? 55 : state === 'LOGIN_BROWSER_OPEN' ? 35 : 0,
    loadingMessage,
    connectedNumber,
    lastError,
    lastStateAt,
    runtimeInstalling: false
  };
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'pragma': 'no-cache'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

async function sendCustomerMessage(body) {
  const digits = String(body.phoneDigits || '').replace(/\D/g, '');
  const message = String(body.message || '');
  if (!digits) return { status: 'SKIPPED', detail: 'Customer WhatsApp number missing' };

  await ensureClient(false);
  if (!client || state !== 'READY') {
    return { status: 'LOGIN_REQUIRED', detail: lastError || 'WhatsApp Web is not linked. Open Settings → WhatsApp Web Login once on the main-server PC.' };
  }

  const numberId = await client.getNumberId(digits);
  if (!numberId) return { status: 'NOT_ON_WHATSAPP', detail: 'This customer number is not registered on WhatsApp' };
  const chatId = String(numberId._serialized || `${digits}@c.us`);
  const branded = Boolean(body.branded);
  const headerPath = path.join(__dirname, '..', 'assets', 'email', 'nunes-header.png');
  const footerPath = path.join(__dirname, '..', 'assets', 'email', 'nunes-footer.png');

  if (branded && fs.existsSync(headerPath)) {
    try {
      const media = wweb.MessageMedia.fromFilePath(headerPath);
      await client.sendMessage(chatId, media, { caption: message });
    } catch (_) {
      await client.sendMessage(chatId, message);
    }
  } else {
    await client.sendMessage(chatId, message);
  }

  if (branded && fs.existsSync(footerPath)) {
    try {
      const media = wweb.MessageMedia.fromFilePath(footerPath);
      await client.sendMessage(chatId, media, { caption: 'Nunes Instrumentation — Service Repairs • Any Brand / Any Make' });
    } catch (_) {}
  }
  return { status: 'SENT', detail: 'WhatsApp message sent' };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        service: 'ServiceFlow WhatsApp Runtime', engine: ENGINE, version: VERSION,
        ok: !runtimeError, state, ready: state === 'READY', loginRequired: ['NOT_STARTED','LOGIN_REQUIRED','DISCONNECTED','ERROR'].includes(state), runtimeError
      });
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      // Status reads must never launch or restart a browser.
      return sendJson(res, 200, statusPayload());
    }
    if (req.method === 'POST' && url.pathname === '/prepare') {
      if (state !== 'READY' && !loginBrowserOpen && !(client && visibleClientStarting)) {
        // Acknowledge the click immediately. Browser/WhatsApp initialization continues
        // asynchronously so Settings and the Service form never wait on page load.
        loginBrowserOpen = true;
        visibleClientStarting = true;
        loadingMessage = 'Opening official WhatsApp Web now on the main-server PC';
        mark('LOGIN_BROWSER_OPEN');
        void ensureClient(true, true);
      }
      return sendJson(res, 200, statusPayload());
    }
    if (req.method === 'POST' && url.pathname === '/logout') {
      manualShutdown = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      const current = client;
      try { if (current) await current.logout(); } catch (_) {}
      await destroyClient();
      await removeLinkedSession();
      manualShutdown = false;
      loginBrowserOpen = false;
      connectedNumber = '';
      loadingMessage = 'WhatsApp Web is not linked';
      mark('LOGIN_REQUIRED');
      return sendJson(res, 200, statusPayload());
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      const body = await readJson(req);
      try {
        return sendJson(res, 200, await sendCustomerMessage(body));
      } catch (error) {
        const text = error && error.message ? error.message : String(error);
        return sendJson(res, 500, { status: 'FAILED', detail: text });
      }
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error && error.message ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ServiceFlow WhatsApp] ${ENGINE} runtime ${VERSION} listening on http://127.0.0.1:${PORT}`);
  if (hasLinkedSession()) setImmediate(() => { void ensureClient(false); });
  else {
    loadingMessage = 'Link WhatsApp Web once on the main-server PC';
    mark('LOGIN_REQUIRED');
  }
});

process.on('uncaughtException', (error) => {
  mark('ERROR', error && error.stack ? error.stack : String(error));
  console.error(error);
});
process.on('unhandledRejection', (error) => {
  mark('ERROR', error && error.stack ? error.stack : String(error));
  console.error(error);
});
