import fs from 'fs/promises';
import path from 'path';

type GoogleInstalled = {
  client_id?: string;
  client_secret?: string;
  project_id?: string;
};

async function readCandidate(filePath: string): Promise<GoogleInstalled | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const document = JSON.parse(text);
    const cfg = document?.installed || document?.web || null;
    if (!cfg?.client_id || !cfg?.client_secret) return null;
    return {
      client_id: String(cfg.client_id),
      client_secret: String(cfg.client_secret),
      project_id: String(cfg.project_id || ''),
    };
  } catch {
    return null;
  }
}

export async function getDefaultGoogleOAuthClient(): Promise<GoogleInstalled | null> {
  const candidates: string[] = [];
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  if (localAppData) {
    candidates.push(path.join(localAppData, 'NUNES Operations', 'Secrets', 'google_oauth_client.json'));
  }

  // Backward-compatible fallback for older installations. This path is ignored by Git.
  candidates.push(path.join(process.cwd(), 'config', 'google_oauth_client.json'));

  for (const candidate of candidates) {
    const cfg = await readCandidate(candidate);
    if (cfg) return cfg;
  }
  return null;
}
