import { NextResponse } from 'next/server';
import { getJob, getSettings, updateJob } from '@/lib/db';
import { estimateFingerprint, estimateReady, sendEstimateEmail, sendEstimateWhatsApp } from '@/lib/communications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

type Channel = 'email' | 'whatsapp';

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (!estimateReady(job)) return NextResponse.json({ skipped: true, reason: 'Estimate is not ready to send', job });
  const settings = await getSettings();
  const body = await request.json().catch(() => ({}));
  const force = Boolean(body.force);
  const requested: Channel[] = Array.isArray(body.channels)
    ? body.channels.filter((v: unknown): v is Channel => v === 'email' || v === 'whatsapp')
    : ['email','whatsapp'];
  const fingerprint = estimateFingerprint(job);
  const whatsappFingerprint = `${fingerprint}:simple-wa-v1.1.26`;

  const results: Record<string, any> = {};
  let hadSuccess = false;
  let hadFailure = false;
  let needsWhatsAppLogin = false;
  const now = new Date().toISOString();

  if (requested.includes('email')) {
    if (!force && job.communication?.lastEmailFingerprint === fingerprint) {
      results.email = { status:'ALREADY_SENT', detail:'Email already sent for this unchanged estimate' };
    } else if (job.customer.email) {
      try { results.email = await sendEstimateEmail(job, settings); hadSuccess ||= results.email.status === 'SENT'; }
      catch (e) { hadFailure = true; results.email = { status:'ERROR', detail:e instanceof Error ? e.message : String(e) }; }
    } else {
      results.email = { status:'SKIPPED', detail:'Customer email missing' };
    }
  }

  if (requested.includes('whatsapp')) {
    if (!force && job.communication?.lastWhatsappFingerprint === whatsappFingerprint) {
      results.whatsapp = { status:'ALREADY_SENT', detail:'WhatsApp already sent for this unchanged estimate' };
    } else if (job.customer.phone) {
      try {
        results.whatsapp = await sendEstimateWhatsApp(job, settings);
        hadSuccess ||= results.whatsapp.status === 'SENT';
        needsWhatsAppLogin = results.whatsapp.status === 'LOGIN_REQUIRED';
        if (results.whatsapp.status === 'ERROR') hadFailure = true;
      } catch (e) {
        hadFailure = true;
        results.whatsapp = { status:'ERROR', detail:e instanceof Error ? e.message : String(e) };
      }
    } else {
      results.whatsapp = { status:'SKIPPED', detail:'Customer WhatsApp number missing' };
    }
  }

  const oldComm = job.communication || {};
  const emailSent = results.email?.status === 'SENT';
  const whatsappSent = results.whatsapp?.status === 'SENT';
  const emailSatisfied = !requested.includes('email') || !job.customer.email || emailSent || results.email?.status === 'ALREADY_SENT';
  const whatsappSatisfied = !requested.includes('whatsapp') || !job.customer.phone || whatsappSent || results.whatsapp?.status === 'ALREADY_SENT';
  const allRequestedSatisfied = emailSatisfied && whatsappSatisfied;

  const updated = await updateJob(id, {
    status: hadSuccess && job.status !== 'CLOSED' && job.status !== 'DISPATCHED' ? 'APPROVAL_PENDING' : job.status,
    products: hadSuccess ? job.products.map(p => ({ ...p, estimateStatus: p.estimateStatus === 'APPROVED' ? 'APPROVED' : 'SENT_TO_CUSTOMER' })) : job.products,
    communication: {
      ...oldComm,
      lastEmailFingerprint: emailSent ? fingerprint : oldComm.lastEmailFingerprint || '',
      lastWhatsappFingerprint: whatsappSent ? whatsappFingerprint : oldComm.lastWhatsappFingerprint || '',
      lastAutoSendFingerprint: allRequestedSatisfied ? fingerprint : oldComm.lastAutoSendFingerprint || '',
      lastAutoSentAt: hadSuccess ? now : oldComm.lastAutoSentAt || '',
      emailStatus: requested.includes('email') ? (results.email?.status || 'SKIPPED') : oldComm.emailStatus,
      emailDetail: requested.includes('email') ? (results.email?.detail || '') : oldComm.emailDetail,
      emailSentAt: emailSent ? now : oldComm.emailSentAt,
      whatsappStatus: requested.includes('whatsapp') ? (results.whatsapp?.status || 'SKIPPED') : oldComm.whatsappStatus,
      whatsappDetail: requested.includes('whatsapp') ? (results.whatsapp?.detail || '') : oldComm.whatsappDetail,
      whatsappSentAt: whatsappSent ? now : oldComm.whatsappSentAt,
      lastError: hadFailure
        ? Object.values(results).filter((r:any)=>r.status==='ERROR').map((r:any)=>r.detail).join(' | ')
        : needsWhatsAppLogin
          ? 'WhatsApp login required'
          : ''
    }
  });
  return NextResponse.json({ sent: hadSuccess, results, needsWhatsAppLogin, job: updated });
}
