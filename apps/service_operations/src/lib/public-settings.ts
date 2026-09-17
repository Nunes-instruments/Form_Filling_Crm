import type { AppSettings } from '@/types/service-job';
export function publicSettings(settings: AppSettings) {
  return {
    ...settings,
    smtpPassword: '',
    googleOAuthClientSecret: '',
    googleOAuthRefreshToken: '',
    googleOAuthClientConfigured: Boolean(settings.googleOAuthClientId && settings.googleOAuthClientSecret),
    googleOAuthConnected: Boolean(settings.googleOAuthRefreshToken && settings.googleOAuthEmail),
    geminiApiKey: '',
    geminiApiKeyConfigured: Boolean(settings.geminiApiKey || process.env.GEMINI_API_KEY)
  };
}

