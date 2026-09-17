import SettingsClient from '@/components/SettingsClient';
import { getSettings } from '@/lib/db';
import { publicSettings } from '@/lib/public-settings';

export const dynamic = 'force-dynamic';
export default async function SettingsPage() {
  try { return <SettingsClient initialSettings={publicSettings(await getSettings())} />; }
  catch { return <SettingsClient />; }
}
