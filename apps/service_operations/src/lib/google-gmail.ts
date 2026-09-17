import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppSettings, ServiceJob } from '@/types/service-job';
import { DATA_DIR } from './paths';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const OAUTH_SCOPE = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send'
].join(' ');
const PENDING_FILE = path.join(DATA_DIR, 'google-oauth-pending.json');

function money(n: number) { return Number(n || 0).toFixed(2); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c)); }
function formatJobDate(value: string) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value || '');
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${match[3]} ${monthNames[Math.max(0, Math.min(11, Number(match[2]) - 1))]} ${match[1]}`;
}
function emailProductValue(product: ServiceJob['products'][number]) {
  const handwrittenOrSaved = Number(product.productValue || 0);
  if (handwrittenOrSaved > 0) return handwrittenOrSaved;
  return Number(product.onlinePrice || 0);
}
function customerDisplayName(job: ServiceJob) {
  return String(job.customer.name || job.customer.contactPerson || 'Customer').trim() || 'Customer';
}
function estimateText(job: ServiceJob) {
  const lines = [
    `Dear ${customerDisplayName(job)},`,
    '',
    'Thank you for choosing Nunes Instrumentation Service.',
    'Your repair process is completed. Please find the details below:',
    ''
  ];
  job.products.forEach((p, i) => {
    const qty = Math.max(1, Number(p.qty || 1));
    const repairUnit = Number(p.repairEstimate || 0);
    const repairTotal = repairUnit * qty;
    lines.push(
      `${job.products.length > 1 ? `${i + 1}. ` : ''}Product Name: ${p.productName || 'Instrument'}`,
      `Qty: ${qty}`,
      `Repair / Problem: ${p.complaint || p.repairWork || '-'}`,
      `Product Value: INR ${money(emailProductValue(p))}`,
      `Repair Cost: INR ${money(repairUnit)}`,
      `Total: INR ${money(repairTotal)}`,
      ''
    );
  });
  lines.push(`Grand Total: INR ${money(job.totals.totalEstimate)}`);
  return lines.join('\n').trim();
}
function estimateHtml(job: ServiceJob) {
  const rows = job.products.map((p, i) => {
    const qty = Math.max(1, Number(p.qty || 1));
    const repairUnit = Number(p.repairEstimate || 0);
    const repairTotal = repairUnit * qty;
    const productValue = emailProductValue(p);
    const productName = p.productName || 'Instrument';
    const problem = p.complaint || p.repairWork || '-';
    return `
      <tr>
        <td style="padding:12px 8px;border:1px solid #a9cbed;text-align:center;vertical-align:top;font-size:13px;color:#12345a;">${i + 1}</td>
        <td style="padding:12px 10px;border:1px solid #a9cbed;vertical-align:top;font-size:13px;font-weight:700;color:#12345a;">${escapeHtml(productName)}</td>
        <td style="padding:12px 8px;border:1px solid #a9cbed;text-align:center;vertical-align:top;font-size:13px;color:#12345a;">${qty}</td>
        <td style="padding:12px 10px;border:1px solid #a9cbed;vertical-align:top;font-size:13px;line-height:1.45;color:#12345a;">${escapeHtml(problem)}</td>
        <td style="padding:12px 10px;border:1px solid #a9cbed;text-align:right;vertical-align:top;font-size:13px;color:#12345a;white-space:nowrap;">INR ${money(productValue)}</td>
        <td style="padding:12px 10px;border:1px solid #a9cbed;text-align:right;vertical-align:top;font-size:13px;color:#12345a;white-space:nowrap;">INR ${money(repairUnit)}</td>
        <td style="padding:12px 10px;border:1px solid #a9cbed;text-align:right;vertical-align:top;font-size:13px;font-weight:700;color:#12345a;white-space:nowrap;">INR ${money(repairTotal)}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#12345a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef3f8;margin:0;padding:18px 8px;">
      <tr>
        <td align="center">
          <table role="presentation" width="780" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:780px;background:#ffffff;border:1px solid #d8e3ef;">
            <tr>
              <td style="padding:0;background:#ffffff;">
                <img src="cid:nunes-header" width="780" alt="Nunes Instrumentation" style="display:block;width:100%;max-width:780px;height:auto;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 8px 28px;background:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-size:15px;line-height:1.6;color:#17385f;vertical-align:top;">
                      Dear <strong>${escapeHtml(customerDisplayName(job))}</strong>,
                    </td>
                    <td align="right" style="font-size:12px;line-height:1.55;color:#17385f;vertical-align:top;white-space:nowrap;">
                      <strong>Date:</strong> ${escapeHtml(formatJobDate(job.jobDate))}<br/>
                      <strong>Service No:</strong> ${escapeHtml(job.jobNo || job.legacySerialNo || job.id)}
                    </td>
                  </tr>
                </table>
                <div style="margin-top:12px;font-size:15px;line-height:1.55;color:#17385f;">
                  Thank you for choosing Nunes Instrumentation Service.<br/>
                  Your repair process is completed. Please find the details below:
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 20px 28px;background:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">
                  <tr style="background:#dff0ff;">
                    <th style="width:5%;padding:10px 6px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:center;">#</th>
                    <th style="width:18%;padding:10px 8px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:left;">Product Name</th>
                    <th style="width:7%;padding:10px 6px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:center;">Qty</th>
                    <th style="width:22%;padding:10px 8px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:left;">Repair / Problem</th>
                    <th style="width:16%;padding:10px 8px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:right;">Product Value<br/>(INR)</th>
                    <th style="width:15%;padding:10px 8px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:right;">Repair Cost<br/>(INR)</th>
                    <th style="width:17%;padding:10px 8px;border:1px solid #8bbce8;font-size:12px;color:#12345a;text-align:right;">Total<br/>(INR)</th>
                  </tr>
                  ${rows}
                  <tr>
                    <td colspan="6" style="padding:12px 10px;border:1px solid #8bbce8;background:#e8f5ff;text-align:right;font-size:15px;font-weight:800;color:#12345a;">Grand Total</td>
                    <td style="padding:12px 10px;border:1px solid #8bbce8;background:#e8f5ff;text-align:right;font-size:15px;font-weight:800;color:#12345a;white-space:nowrap;">INR ${money(job.totals.totalEstimate)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 22px 28px;background:#ffffff;font-size:13px;line-height:1.55;color:#17385f;">
                If you have any questions or need further assistance, feel free to contact us.<br/>
                We look forward to serving you again.
                <div style="margin-top:14px;">
                  Best regards,<br/>
                  <strong>Nunes Instrumentation Service</strong><br/>
                  <span style="font-style:italic;">Sales | Service | Repairs | AMC | Rental | Calibration</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0;background:#ffffff;">
                <img src="cid:nunes-footer" width="780" alt="Nunes Instrumentation office and service details" style="display:block;width:100%;max-width:780px;height:auto;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const GOOGLE_OAUTH_REDIRECT_URI = process.env.SERVICEFLOW_GOOGLE_OAUTH_REDIRECT_URI || 'http://127.0.0.1:5055';

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function mimeWord(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
function escapeHeader(value: string) { return String(value || '').replace(/[\r\n<>]/g, ' ').trim(); }

export function googleOAuthConfigured(settings: AppSettings) {
  return Boolean(settings.googleOAuthClientId && settings.googleOAuthClientSecret);
}
export function googleOAuthConnected(settings: AppSettings) {
  return Boolean(googleOAuthConfigured(settings) && settings.googleOAuthRefreshToken && settings.googleOAuthEmail);
}

async function writePending(value: { state: string; codeVerifier: string; createdAt: number }) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PENDING_FILE, JSON.stringify(value), 'utf8');
}
async function readPending() {
  try { return JSON.parse(await fs.readFile(PENDING_FILE, 'utf8')) as { state: string; codeVerifier: string; createdAt: number }; }
  catch { return null; }
}
async function clearPending() { try { await fs.unlink(PENDING_FILE); } catch {} }

export async function createGoogleOAuthUrl(settings: AppSettings) {
  if (!googleOAuthConfigured(settings)) throw new Error('Google OAuth client is not configured. Upload the Desktop OAuth client JSON first.');
  const state = base64Url(crypto.randomBytes(24));
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  await writePending({ state, codeVerifier, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: settings.googleOAuthClientId,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

async function postToken(params: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(12000),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(data.error_description || data.error || `Google token request failed (${response.status})`);
  return data;
}

export async function finishGoogleOAuth(settings: AppSettings, code: string, state: string) {
  const pending = await readPending();
  await clearPending();
  if (!pending || pending.state !== state || Date.now() - pending.createdAt > 10 * 60_000) {
    throw new Error('Google sign-in session expired or is invalid. Start Sign in with Google again.');
  }
  const token = await postToken(new URLSearchParams({
    code,
    client_id: settings.googleOAuthClientId,
    client_secret: settings.googleOAuthClientSecret,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: pending.codeVerifier
  }));
  if (!token.refresh_token) throw new Error('Google did not return a refresh token. Revoke the app grant and sign in again.');
  if (token.scope && !String(token.scope).split(/\s+/).includes('https://www.googleapis.com/auth/gmail.send')) {
    throw new Error('The Gmail send permission was not granted. Sign in again and approve permission to send email.');
  }
  const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(12000),
    cache: 'no-store'
  });
  const userInfo = await userInfoResponse.json().catch(() => ({})) as any;
  if (!userInfoResponse.ok || !userInfo.email) throw new Error('Google sign-in succeeded, but the account email could not be read.');
  return { refreshToken: String(token.refresh_token), email: String(userInfo.email) };
}

export async function getGoogleAccessToken(settings: AppSettings) {
  if (!googleOAuthConnected(settings)) throw new Error('Gmail is not connected with Google. Open Settings and click Sign in with Google.');
  const token = await postToken(new URLSearchParams({
    client_id: settings.googleOAuthClientId,
    client_secret: settings.googleOAuthClientSecret,
    refresh_token: settings.googleOAuthRefreshToken,
    grant_type: 'refresh_token'
  }));
  if (!token.access_token) throw new Error('Google did not return an access token. Sign in with Google again.');
  return String(token.access_token);
}

export async function checkGoogleGmailConnection(settings: AppSettings) {
  if (!googleOAuthConfigured(settings)) return { status:'NOT_CONFIGURED' as const, configured:false, connected:false, sender:'', detail:'Upload a Google Desktop OAuth client JSON first.' };
  if (!settings.googleOAuthRefreshToken) return { status:'LOGIN_REQUIRED' as const, configured:true, connected:false, sender:'', detail:'OAuth setup is ready. Click Sign in with Google.' };
  try {
    const accessToken = await getGoogleAccessToken(settings);
    const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, { headers:{ Authorization:`Bearer ${accessToken}` }, signal: AbortSignal.timeout(12000), cache:'no-store' });
    const userInfo = await userInfoResponse.json().catch(() => ({})) as any;
    const email = String(userInfo.email || settings.googleOAuthEmail || '');
    if (!userInfoResponse.ok || !email) throw new Error('Connected Google account could not be verified.');
    return { status:'READY' as const, configured:true, connected:true, sender:email, detail:`Google connected — ${email}` };
  } catch (error) {
    return { status:'ERROR' as const, configured:true, connected:false, sender:settings.googleOAuthEmail || '', detail:error instanceof Error ? error.message : String(error) };
  }
}

function wrapBase64(value: Buffer | string) {
  const encoded = Buffer.isBuffer(value) ? value.toString('base64') : Buffer.from(value, 'utf8').toString('base64');
  return encoded.match(/.{1,76}/g)?.join('\r\n') || encoded;
}
function readInlineEmailImage(fileName: string) {
  try {
    return readFileSync(path.join(process.cwd(), 'assets', 'email', fileName));
  } catch {
    return null;
  }
}
function buildRawEmail(job: ServiceJob, settings: AppSettings) {
  const to = escapeHeader(job.customer.email);
  const fromEmail = escapeHeader(settings.googleOAuthEmail);
  const senderName = escapeHeader(settings.senderName || settings.companyName || 'ServiceFlow');
  const subject = `Service Repair Completed${job.jobNo ? ` - ${job.jobNo}` : ''}`;
  const relatedBoundary = `serviceflow_related_${crypto.randomUUID().replace(/-/g,'')}`;
  const alternativeBoundary = `serviceflow_alt_${crypto.randomUUID().replace(/-/g,'')}`;
  const text = estimateText(job);
  const html = estimateHtml(job);
  const headerImage = readInlineEmailImage('nunes-header.png');
  const footerImage = readInlineEmailImage('nunes-footer.png');
  const parts: string[] = [
    `From: ${mimeWord(senderName)} <${fromEmail}>`,
    `To: <${to}>`,
    `Subject: ${mimeWord(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    '',
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(text),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(html),
    `--${alternativeBoundary}--`,
    ''
  ];

  if (headerImage) {
    parts.push(
      `--${relatedBoundary}`,
      'Content-Type: image/png; name="nunes-header.png"',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <nunes-header>',
      'Content-Disposition: inline; filename="nunes-header.png"',
      '',
      wrapBase64(headerImage),
      ''
    );
  }
  if (footerImage) {
    parts.push(
      `--${relatedBoundary}`,
      'Content-Type: image/png; name="nunes-footer.png"',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <nunes-footer>',
      'Content-Disposition: inline; filename="nunes-footer.png"',
      '',
      wrapBase64(footerImage),
      ''
    );
  }
  parts.push(`--${relatedBoundary}--`, '');
  return base64Url(parts.join('\r\n'));
}

export async function sendGmailEstimate(job: ServiceJob, settings: AppSettings) {
  if (!job.customer.email) return { status:'SKIPPED' as const, detail:'Customer email missing' };
  const accessToken = await getGoogleAccessToken(settings);
  const response = await fetch(GMAIL_SEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ raw: buildRawEmail(job, settings) }),
    signal: AbortSignal.timeout(12000),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const reason = data?.error?.message || data?.error_description || `Gmail API send failed (${response.status})`;
    throw new Error(reason);
  }
  return { status:'SENT' as const, detail:`Gmail API accepted message ${data.id || ''}`.trim() };
}
