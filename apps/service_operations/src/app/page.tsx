import DashboardClient from '@/components/DashboardClient';
import { getSettings, saveSettings } from '@/lib/db';
import { finishGoogleOAuth } from '@/lib/google-gmail';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] || '' : value || ''; }

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const oauthCode = first(params.code);
  const oauthState = first(params.state);
  const oauthError = first(params.error);

  if (oauthError) redirect(`/settings?gmail_error=${encodeURIComponent(oauthError)}`);
  if (oauthCode && oauthState) {
    let connectedEmail = '';
    try {
      const current = await getSettings();
      const connected = await finishGoogleOAuth(current, oauthCode, oauthState);
      await saveSettings({ ...current, googleOAuthRefreshToken: connected.refreshToken, googleOAuthEmail: connected.email, smtpPassword:'' });
      connectedEmail = connected.email;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      redirect(`/settings?gmail_error=${encodeURIComponent(detail)}`);
    }
    redirect(`/settings?gmail_connected=${encodeURIComponent(connectedEmail)}`);
  }

  // ULTRA-FAST: do not read jobs/settings and do not touch WhatsApp before sending HTML.
  // DashboardClient restores the last view immediately and refreshes live data after paint.
  return <DashboardClient initialJobs={[]} initialSettings={null} initialComm={{
    email: { configured:false, connected:false, sender:'', status:'NOT_CHECKED' },
    whatsapp: { state:'NOT_STARTED', ready:false, loginRequired:false, status:'NOT_CHECKED' }
  }} />;
}
