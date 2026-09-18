'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArchiveRestore, CheckCircle2, FileText, FolderOpen,
  LoaderCircle, ShieldCheck, UploadCloud, XCircle
} from 'lucide-react';
import type { DraftJob } from '@/components/HandwrittenFormImport';
import type { ServiceJob } from '@/types/service-job';

type RowState = 'READY' | 'READING' | 'IMPORTING' | 'IMPORTED' | 'DUPLICATE' | 'REVIEW' | 'ERROR';
type ImportGroup = {
  key: string;
  label: string;
  files: File[];
  formIndex: number;
  state: RowState;
  message: string;
  draft?: DraftJob;
};

type DuplicateResult = {
  kind: 'NONE' | 'DUPLICATE' | 'REVIEW';
  reason: string;
  job?: ServiceJob;
};

const MAX_FORM_BYTES = 12 * 1024 * 1024;

function tidy(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function ident(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, '');
}
function prefixFromFlatFile(name: string) {
  const stem = fileStem(name);
  const cleaned = stem
    .replace(/(?:[_\-\s]+)(?:service[_\-\s]*form|job[_\-\s]*card|form|proof|photo|image|whatsapp|email|mail|before|after|receipt|dispatch|approval)(?:[_\-\s].*)?$/i, '')
    .trim();
  if (cleaned && cleaned !== stem) return cleaned;
  const numeric = stem.match(/^([a-z]*\d{2,})[_\-\s]/i);
  if (numeric) return numeric[1];
  const token = stem.split(/[_\-\s]+/)[0];
  return token || stem;
}
function groupKey(file: File) {
  const rel = String((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
  const parts = rel.split('/').filter(Boolean);
  if (parts.length >= 3) return parts[1];
  return prefixFromFlatFile(file.name);
}
function formScore(file: File) {
  const n = file.name.toLowerCase();
  let score = 0;
  if (/service[_\-\s]*form|job[_\-\s]*card|\bform\b/.test(n)) score += 9;
  if (/front|page[_\-\s]*1|scan/.test(n)) score += 3;
  if (/\.pdf$/i.test(n)) score += 2;
  if (/proof|whatsapp|email|mail|after|before|dispatch|approval|payment/.test(n)) score -= 7;
  return score;
}
function chooseFormIndex(files: File[]) {
  let best = 0;
  let bestScore = -999;
  files.forEach((file, index) => {
    const score = formScore(file);
    if (score > bestScore) { bestScore = score; best = index; }
  });
  return best;
}
function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected legacy form.'));
    reader.readAsDataURL(file);
  });
}
async function parseLegacyForm(file: File): Promise<DraftJob> {
  if (file.size > MAX_FORM_BYTES) throw new Error(`${file.name} is larger than 12 MB. Compress this form image/PDF first.`);
  const dataUrl = await readAsDataUrl(file);
  const res = await fetch('/api/forms/gemini-parse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileDataUrl: dataUrl, fileName: file.name })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gemini could not read ${file.name}.`);
  if (!data?.draft) throw new Error(`No structured Service Form data was returned for ${file.name}.`);
  return data.draft as DraftJob;
}
function duplicateAgainst(draft: DraftJob, jobs: ServiceJob[]): DuplicateResult {
  const paper = ident(draft.legacySerialNo);
  const mr = ident(draft.receipt?.mrNo);
  const customer = tidy(draft.customer?.name);
  const date = String(draft.jobDate || '').slice(0, 10);
  const product = draft.products?.[0];
  const productName = tidy(product?.productName);
  const model = tidy(product?.makeModel);
  const serial = ident(product?.serialNo);

  for (const job of jobs) {
    const jobPaper = ident(job.legacySerialNo);
    const jobMr = ident(job.receipt?.mrNo);
    if (paper && jobPaper && paper === jobPaper) {
      return { kind: 'DUPLICATE', reason: `Same paper/service serial already exists as ${job.jobNo}.`, job };
    }
    if (mr && jobMr && mr === jobMr) {
      return { kind: 'DUPLICATE', reason: `Same MR number already exists as ${job.jobNo}.`, job };
    }
  }

  if (!customer || !productName) return { kind: 'REVIEW', reason: 'Customer or Product Name was not read confidently. Review before importing.' };

  for (const job of jobs) {
    const jobProduct = job.products?.[0];
    if (tidy(job.customer?.name) !== customer || tidy(jobProduct?.productName) !== productName) continue;

    const jobPaper = ident(job.legacySerialNo);
    const jobMr = ident(job.receipt?.mrNo);
    // Different known paper/MR numbers mean this is a separate visit even for the same customer + product.
    if (paper && jobPaper && paper !== jobPaper) continue;
    if (mr && jobMr && mr !== jobMr) continue;

    const jobSerial = ident(jobProduct?.serialNo);
    const jobModel = tidy(jobProduct?.makeModel);
    const jobDate = String(job.jobDate || '').slice(0, 10);
    if (serial && jobSerial && serial === jobSerial) {
      return { kind: 'DUPLICATE', reason: `Same customer + product + product serial already exists as ${job.jobNo}.`, job };
    }
    if (model && jobModel && model === jobModel && date && jobDate === date) {
      return { kind: 'DUPLICATE', reason: `Same customer + product + model + date already exists as ${job.jobNo}.`, job };
    }
    return {
      kind: 'REVIEW',
      reason: `Same customer + product exists (${job.jobNo}), but the paper/MR/model/serial does not prove it is the same job. Review before importing.`,
      job
    };
  }
  return { kind: 'NONE', reason: 'No duplicate match found.' };
}
async function uploadFiles(jobId: string, files: File[], category: 'RECEIPT' | 'OTHER') {
  if (!files.length) return;
  const form = new FormData();
  form.set('category', category);
  files.forEach(file => form.append('files', file));
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/attachments`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Proof upload failed.');
}

export default function LegacyBulkImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<ImportGroup[]>([]);
  const jobsRef = useRef<ServiceJob[]>([]);
  const [rows, setRows] = useState<ImportGroup[]>([]);
  const [running, setRunning] = useState(false);
  const [headline, setHeadline] = useState('');

  const summary = useMemo(() => ({
    total: rows.length,
    imported: rows.filter(r => r.state === 'IMPORTED').length,
    duplicate: rows.filter(r => r.state === 'DUPLICATE').length,
    review: rows.filter(r => r.state === 'REVIEW').length,
    error: rows.filter(r => r.state === 'ERROR').length,
  }), [rows]);

  function replaceRows(next: ImportGroup[]) {
    rowsRef.current = next;
    setRows(next);
  }
  function patchRow(index: number, patch: Partial<ImportGroup>) {
    setRows(prev => {
      const next = prev.slice();
      next[index] = { ...next[index], ...patch };
      rowsRef.current = next;
      return next;
    });
  }
  async function refreshJobs() {
    const res = await fetch('/api/jobs', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not read existing Service jobs.');
    jobsRef.current = Array.isArray(data.jobs) ? data.jobs : [];
  }
  function chooseFolder(files: File[]) {
    const groups = new Map<string, File[]>();
    for (const file of files) {
      if (!/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) continue;
      const key = groupKey(file);
      groups.set(key, [...(groups.get(key) || []), file]);
    }
    const next = Array.from(groups.entries()).map(([key, filesInGroup]) => ({
      key, label: key, files: filesInGroup, formIndex: chooseFormIndex(filesInGroup), state: 'READY' as RowState, message: ''
    })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    replaceRows(next);
    setHeadline(next.length ? `${next.length} legacy form groups found. Review the detected Form File, then run the import.` : 'No JPG/PNG/WEBP/PDF legacy forms were found in that folder.');
  }

  async function processOne(index: number, force = false) {
    const group = rowsRef.current[index];
    if (!group || ['IMPORTED', 'DUPLICATE'].includes(group.state)) return;
    const formFile = group.files[group.formIndex];
    if (!formFile) { patchRow(index, { state: 'ERROR', message: 'Choose the Service Form file for this group.' }); return; }
    try {
      let draft = group.draft;
      if (!draft) {
        patchRow(index, { state: 'READING', message: 'Gemini is reading the Service Form…' });
        draft = await parseLegacyForm(formFile);
        patchRow(index, { draft });
      }
      const dupe = duplicateAgainst(draft, jobsRef.current);
      if (dupe.kind === 'DUPLICATE') {
        patchRow(index, { state: 'DUPLICATE', message: dupe.reason });
        return;
      }
      if (dupe.kind === 'REVIEW' && !force) {
        patchRow(index, { state: 'REVIEW', message: dupe.reason });
        return;
      }
      if (!draft.customer?.name?.trim()) {
        patchRow(index, { state: 'REVIEW', message: 'Customer name is missing. Use the normal single-form reader for this row and review it manually.' });
        return;
      }

      patchRow(index, { state: 'IMPORTING', message: 'Saving form and proof files…' });
      const payload: DraftJob = JSON.parse(JSON.stringify(draft));
      const migrationNote = `Legacy bulk import (${new Date().toLocaleDateString('en-IN')}). Original Service Form and proof files attached. No new customer Email or WhatsApp message was sent during migration.`;
      payload.notes = [payload.notes, migrationNote].filter(Boolean).join(' ');
      const create = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const created = await create.json().catch(() => ({}));
      if (!create.ok || !created?.job?.id) throw new Error(created.error || 'Service job could not be created.');
      const job = created.job as ServiceJob;

      const proofFiles = group.files.filter((_, fileIndex) => fileIndex !== group.formIndex);
      let proofWarning = '';
      try {
        await uploadFiles(job.id, [formFile], 'RECEIPT');
        await uploadFiles(job.id, proofFiles, 'OTHER');
      } catch (error) {
        proofWarning = ` Job saved, but one or more proof files need retry: ${error instanceof Error ? error.message : String(error)}`;
      }
      jobsRef.current = [job, ...jobsRef.current];
      patchRow(index, { state: 'IMPORTED', message: `${job.jobNo} saved.${proofWarning}` });
    } catch (error) {
      patchRow(index, { state: 'ERROR', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function runAll() {
    if (!rowsRef.current.length || running) return;
    setRunning(true);
    setHeadline('Reading and importing legacy forms one by one. Keep this tab open.');
    try {
      await refreshJobs();
      for (let index = 0; index < rowsRef.current.length; index += 1) {
        const state = rowsRef.current[index]?.state;
        if (state === 'IMPORTED' || state === 'DUPLICATE') continue;
        await processOne(index, false);
      }
      setHeadline('Bulk pass finished. Imported rows are saved; duplicates were skipped; REVIEW rows need your decision.');
    } catch (error) {
      setHeadline(error instanceof Error ? error.message : String(error));
    } finally { setRunning(false); }
  }

  async function importReviewed(index: number) {
    if (running) return;
    setRunning(true);
    try {
      if (!jobsRef.current.length) await refreshJobs();
      await processOne(index, true);
    } finally { setRunning(false); }
  }

  return <div className="legacyBulk stack24">
    <section className="heroRow">
      <div><p className="eyebrow">ONE-TIME OLD DATA MIGRATION</p><h1>Bulk Old Service Forms</h1><p className="muted">Choose one folder containing your old Service Forms and their proof images/PDFs. Each job is read, duplicate-checked and saved into the same live Servicing database used by the dashboard.</p></div>
      <div className="heroActions"><Link href="/" className="button">Back to Service Jobs</Link><button type="button" className="button primary large" onClick={() => inputRef.current?.click()} disabled={running}><FolderOpen size={18}/> Choose Folder</button></div>
    </section>

    <section className="panel legacySafety">
      <div><ShieldCheck/><span><b>Safe migration rules</b><small>Same customer is allowed again. Duplicate is decided first by Paper/Service Serial or MR No, then by customer + product + product serial/model/date. Ambiguous same-customer + same-product rows are held for REVIEW instead of being silently deleted.</small></span></div>
      <div><ArchiveRestore/><span><b>Historical communication stays historical</b><small>WhatsApp/email screenshots are stored as proof files. This importer does not send a new Email or WhatsApp message to the customer.</small></span></div>
      <input ref={inputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={e => chooseFolder(Array.from(e.target.files || []))}/>
    </section>

    <section className="legacySummary">
      <div><span>Groups</span><b>{summary.total}</b></div><div><span>Imported</span><b>{summary.imported}</b></div><div><span>Duplicates skipped</span><b>{summary.duplicate}</b></div><div><span>Review</span><b>{summary.review}</b></div><div><span>Errors</span><b>{summary.error}</b></div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><span className="step">OLD</span><div><h2>Folder Review</h2><p>Best format: one subfolder per old job, containing the Service Form plus its proof files. Flat folders are also grouped by filename prefix.</p></div></div><button className="button primary" disabled={!rows.length || running} onClick={() => void runAll()}>{running ? <LoaderCircle className="spin" size={17}/> : <UploadCloud size={17}/>} {running ? 'Importing…' : 'Start Safe Bulk Import'}</button></div>
      {headline && <div className="legacyHeadline">{headline}</div>}
      {!rows.length ? <div className="empty"><FolderOpen size={38}/><h3>No folder selected</h3><p>Choose the old Servicing folder. Nothing is saved until you press Start Safe Bulk Import.</p></div> :
      <div className="legacyTableWrap"><table className="legacyTable"><thead><tr><th>Old Job / Folder</th><th>Detected Form File</th><th>Proof</th><th>Read Result</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row, index) => {
        const p = row.draft?.products?.[0];
        return <tr key={row.key}>
          <td><b>{row.label}</b><small>{row.files.length} file(s)</small></td>
          <td><select value={row.formIndex} disabled={running || row.state === 'IMPORTED'} onChange={e => patchRow(index, { formIndex: Number(e.target.value), state: 'READY', message: '', draft: undefined })}>{row.files.map((file, fileIndex) => <option key={`${file.name}-${fileIndex}`} value={fileIndex}>{file.name}</option>)}</select></td>
          <td><b>{Math.max(0, row.files.length - 1)}</b><small>photo/PDF proof</small></td>
          <td>{row.draft ? <><b>{row.draft.customer.name || 'Customer needs review'}</b><small>{p?.productName || 'Product needs review'}{p?.makeModel ? ` · ${p.makeModel}` : ''}{row.draft.legacySerialNo ? ` · Paper ${row.draft.legacySerialNo}` : ''}</small></> : <span className="muted">Not read yet</span>}</td>
          <td><span className={`legacyState ${row.state.toLowerCase()}`}>{row.state === 'READING' || row.state === 'IMPORTING' ? <LoaderCircle className="spin" size={14}/> : row.state === 'IMPORTED' ? <CheckCircle2 size={14}/> : row.state === 'DUPLICATE' ? <ShieldCheck size={14}/> : row.state === 'ERROR' ? <XCircle size={14}/> : row.state === 'REVIEW' ? <AlertTriangle size={14}/> : <FileText size={14}/>} {row.state}</span><small>{row.message}</small></td>
          <td>{row.state === 'REVIEW' ? <button className="button compact" disabled={running} onClick={() => void importReviewed(index)}>Import anyway</button> : row.state === 'ERROR' ? <button className="button compact" disabled={running} onClick={() => void processOne(index, false)}>Retry</button> : row.state === 'IMPORTED' ? <span className="legacyDone">Saved</span> : '—'}</td>
        </tr>;
      })}</tbody></table></div>}
    </section>
  </div>;
}
