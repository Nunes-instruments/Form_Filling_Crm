import fs from 'fs/promises';
import path from 'path';
import { UPLOADS_DIR } from './paths';
import { safeSegment } from './naming';
import type { ProofCategory, ServiceAttachment } from '@/types/service-job';

export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024; // 150 MB per file

export function kindFromMime(mime: string): ServiceAttachment['kind'] {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  return 'OTHER';
}

export async function saveAttachment(jobId: string, file: File, category: ProofCategory) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const id = crypto.randomUUID();
  const ext = path.extname(file.name).slice(0, 12);
  const storedName = `${id}_${safeSegment(path.basename(file.name, ext), 'proof')}${ext}`;
  const dir = path.join(UPLOADS_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, storedName), bytes);
  const attachment: ServiceAttachment = {
    id,
    fileName: file.name,
    storedName,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: kindFromMime(file.type || ''),
    category,
    uploadedAt: new Date().toISOString()
  };
  return attachment;
}

export async function deleteAttachmentFile(jobId: string, storedName: string) {
  await fs.rm(path.join(UPLOADS_DIR, jobId, storedName), { force: true });
}

export async function readAttachmentFile(jobId: string, storedName: string) {
  return fs.readFile(path.join(UPLOADS_DIR, jobId, storedName));
}

export function attachmentPath(jobId: string, storedName: string) {
  return path.join(UPLOADS_DIR, jobId, storedName);
}
