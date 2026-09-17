import JSZip from 'jszip';
import type { ServiceJob } from '@/types/service-job';
import { getSettings } from './db';
import { createJobPdf } from './pdf';
import { createJobExcel } from './excel';
import { readAttachmentFile } from './attachments';
import { buildJobFileBase } from './naming';

export async function createFullZip(job: ServiceJob) {
  const settings = await getSettings();
  const zip = new JSZip();
  const base = buildJobFileBase(job);
  zip.file(`${base}.pdf`, await createJobPdf(job, settings.companyName));
  zip.file(`${base}.xlsx`, await createJobExcel(job));
  zip.file(`${base}.json`, JSON.stringify(job, null, 2));
  const proof = zip.folder('proof');
  for (const a of job.attachments) {
    try {
      proof?.file(a.fileName, await readAttachmentFile(job.id, a.storedName));
    } catch {
      // Keep ZIP generation resilient if a local proof file was manually deleted.
    }
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}
