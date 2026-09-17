'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function die(message, extra = '') {
  try {
    const stateDir = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'NUNES Operations')
      : path.join(process.cwd(), '.nunes-state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(path.join(stateDir, 'dashboard-launcher.log'), `[${new Date().toISOString()}] ERROR: ${message}${extra ? `\n${extra}` : ''}\n`);
  } catch (_) {}
  console.error(`ERROR: ${message}`);
  if (extra) console.error(extra);
  process.exit(1);
}

const root = path.resolve(process.argv[2] || '');
const port = String(process.argv[3] || '8785');
const listenHost = String(process.argv[4] || '0.0.0.0');
const apiUrl = String(process.argv[5] || process.env.NUNES_API_INTERNAL_URL || '');
const explicitNode = String(process.argv[6] || process.execPath || 'node');

if (!root || !fs.existsSync(root)) die(`Workspace root does not exist: ${root}`);
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) die(`Invalid dashboard port: ${port}`);

const web = path.join(root, 'platform_web');
const buildId = path.join(web, '.next', 'BUILD_ID');
if (!fs.existsSync(buildId)) die(`Production build is missing: ${buildId}`);

const stateDir = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'NUNES Operations')
  : path.join(root, '.nunes-state');
fs.mkdirSync(stateDir, { recursive: true });
const launcherLog = path.join(stateDir, 'dashboard-launcher.log');
const stdoutLog = path.join(stateDir, 'dashboard-stdout.log');
const stderrLog = path.join(stateDir, 'dashboard-stderr.log');
const pidFile = path.join(stateDir, 'dashboard.pid');

function log(line) {
  fs.appendFileSync(launcherLog, `[${new Date().toISOString()}] ${line}\n`);
}

let cwd = web;
let args = [];
let mode = '';
const standalone = path.join(web, '.next', 'standalone');
const standaloneServer = path.join(standalone, 'server.js');
const nextCli = path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next');

if (fs.existsSync(standaloneServer)) {
  mode = 'standalone';
  cwd = standalone;

  // Next.js standalone intentionally omits .next/static. Attach it without
  // copying so the reusable build remains fast and disk usage stays low.
  const staticSource = path.join(web, '.next', 'static');
  const staticTargetParent = path.join(standalone, '.next');
  const staticTarget = path.join(staticTargetParent, 'static');
  if (fs.existsSync(staticSource) && !fs.existsSync(staticTarget)) {
    try {
      fs.mkdirSync(staticTargetParent, { recursive: true });
      fs.symlinkSync(staticSource, staticTarget, process.platform === 'win32' ? 'junction' : 'dir');
      log(`Attached static assets: ${staticTarget} -> ${staticSource}`);
    } catch (e) {
      log(`Static asset link warning: ${e.message}`);
    }
  }
  args = [standaloneServer];
} else if (fs.existsSync(nextCli)) {
  // Safe fallback for a normal Next.js production build.
  mode = 'next-start';
  cwd = web;
  args = [nextCli, 'start', '-H', listenHost, '-p', port];
} else {
  die('Neither standalone server.js nor the normal Next.js runtime was found.');
}

const env = {
  ...process.env,
  PORT: port,
  HOSTNAME: listenHost,
  NUNES_PORT: port,
  NUNES_HOST: listenHost,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
};
if (apiUrl) env.NUNES_API_INTERNAL_URL = apiUrl;
try {
  const updateId = fs.readFileSync(path.join(root, 'UPDATE_ID.txt'), 'utf8').trim();
  if (updateId) env.NUNES_UPDATE_ID = updateId;
} catch (_) {
  env.NUNES_UPDATE_ID = env.NUNES_UPDATE_ID || 'baseline';
}

// Start with fresh per-run output logs so Step 5 always shows the current error.
try { fs.writeFileSync(stdoutLog, ''); } catch (_) {}
try { fs.writeFileSync(stderrLog, ''); } catch (_) {}

let outFd, errFd, child;
try {
  outFd = fs.openSync(stdoutLog, 'a');
  errFd = fs.openSync(stderrLog, 'a');
  log(`Launching dashboard mode=${mode} node=${explicitNode} cwd=${cwd} host=${listenHost} port=${port}`);
  child = spawn(explicitNode, args, {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outFd, errFd],
  });
  fs.closeSync(outFd); outFd = undefined;
  fs.closeSync(errFd); errFd = undefined;
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
} catch (e) {
  try { if (outFd !== undefined) fs.closeSync(outFd); } catch (_) {}
  try { if (errFd !== undefined) fs.closeSync(errFd); } catch (_) {}
  die(`Could not launch dashboard process: ${e.message}`);
}

setTimeout(() => {
  let alive = true;
  try { process.kill(child.pid, 0); } catch (_) { alive = false; }
  if (!alive) {
    let err = '';
    let out = '';
    try { err = fs.readFileSync(stderrLog, 'utf8').trim(); } catch (_) {}
    try { out = fs.readFileSync(stdoutLog, 'utf8').trim(); } catch (_) {}
    const detail = [err, out].filter(Boolean).join('\n').slice(-5000);
    die(`Dashboard process exited immediately (mode=${mode}, pid=${child.pid}).`, detail);
  }
  log(`STARTED mode=${mode} pid=${child.pid}`);
  console.log(`STARTED ${mode} PID ${child.pid}`);
  process.exit(0);
}, 1200);
