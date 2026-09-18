export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

const LEGACY_MODEL_MAP: Record<string,string> = {
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite'
};

export function normalizeGeminiModel(value: unknown): string {
  const model = String(value || '').trim();
  if (!model) return DEFAULT_GEMINI_MODEL;
  return LEGACY_MODEL_MAP[model] || model;
}
