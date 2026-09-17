'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Building2, Calculator, CalendarDays, FilePlus2, FileSpreadsheet, FileText, Mail, MessageCircle, RefreshCw, ScanText, Search, Settings as SettingsIcon, Wrench } from 'lucide-react';
import type { AppSettings, ServiceJob } from '@/types/service-job';
const HandwrittenFormImport = dynamic(() => import('@/components/HandwrittenFormImport'), { ssr:false });
const DASHBOARD_SNAPSHOT_KEY = 'serviceflow:dashboard:last-good:v1';

const statusLabel: Record<string, string> = {
  DRAFT: 'Draft', RECEIVED: 'Received', ESTIMATE_PENDING: 'Estimate pending', APPROVAL_PENDING: 'Approval pending',
  REPAIRING: 'Repairing', READY: 'Ready', DISPATCHED: 'Dispatched', CLOSED: 'Closed'
};

function label(value: string) { return String(value || '').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase()); }
function money(value: number) { return Number(value || 0).toFixed(2); }
function productStatusSummary(job: ServiceJob) {
  const values = Array.from(new Set(job.products.map((p) => p.status || job.status)));
  if (!values.length) return statusLabel[job.status] || job.status;
  const first = statusLabel[values[0]] || values[0];
  return values.length === 1 ? first : `${first} +${values.length - 1}`;
}
function repairSummary(job: ServiceJob) {
  const cats = Array.from(new Set(job.products.map(p => `${Number(p.repairPercent || (p.repairCategory === 'MAXIMUM_50' ? 50 : 30))}%`)));
  return cats.length === 1 ? cats[0] : cats.join(' / ');
}
function estimateStatusSummary(job: ServiceJob) {
  const vals = Array.from(new Set(job.products.map(p => p.estimateStatus || 'PENDING_PRICE')));
  return vals.length === 1 ? label(vals[0]) : `${label(vals[0])} +${vals.length - 1}`;
}
function deliveryClass(status?: string) {
  if (status === 'SENT' || status === 'ALREADY_SENT') return 'sent';
  if (status === 'LOGIN_REQUIRED' || status === 'NOT_CONFIGURED' || status === 'ERROR') return 'warning';
  return 'neutral';
}
function deliveryText(channel:string, status?:string) {
  if (status === 'SENT' || status === 'ALREADY_SENT') return `${channel} sent`;
  if (status === 'LOGIN_REQUIRED') return `${channel} login`;
  if (status === 'ERROR') return `${channel} error`;
  if (status === 'SKIPPED') return `${channel} skipped`;
  return `${channel} pending`;
}

type DashboardClientProps = {
  initialJobs: ServiceJob[];
  initialSettings: AppSettings | null;
  initialComm: any;
};

export default function DashboardClient({ initialJobs, initialSettings, initialComm }: DashboardClientProps) {
  const [jobs, setJobs] = useState<ServiceJob[]>(initialJobs);
  const [settings, setSettings] = useState<AppSettings | null>(initialSettings);
  const [comm, setComm] = useState<any>(initialComm);
  const [loading, setLoading] = useState(initialJobs.length === 0);
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('ALL');
  const [company, setCompany] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [handwrittenImportOpen, setHandwrittenImportOpen] = useState(false);

  async function load(showLoading = true) {
    if (showLoading && jobs.length === 0) setLoading(true);
    try {
      // Jobs + settings are the only data needed to draw the dashboard. Communication
      // status is deliberately not part of this critical request.
      const [jobsRes, settingsRes] = await Promise.all([
        fetch('/api/jobs', { cache: 'no-store' }), fetch('/api/settings', { cache: 'no-store' })
      ]);
      const jobsData = await jobsRes.json();
      const settingsData = await settingsRes.json();
      const nextJobs = jobsData.jobs || [];
      const nextSettings = settingsData.settings || null;
      setJobs(nextJobs); setSettings(nextSettings);
      try { localStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify({ jobs:nextJobs, settings:nextSettings, at:Date.now() })); } catch {}
    } finally { setLoading(false); }
  }

  useEffect(() => {
    // Paint from the last successful dashboard immediately, then refresh live records.
    try {
      const raw = localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
      if (raw) {
        const snap = JSON.parse(raw);
        if (Array.isArray(snap?.jobs)) setJobs(snap.jobs);
        if (snap?.settings) setSettings(snap.settings);
        if (Array.isArray(snap?.jobs)) setLoading(false);
      }
    } catch {}
    void load(false);

    // Connection status is cosmetic for dashboard opening. Check it after first paint.
    const timer = window.setTimeout(() => {
      void fetch('/api/communication/status', { cache:'no-store' })
        .then(r => r.json()).then(setComm).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchNames = useMemo(() => Array.from(new Set([...(settings?.branchNames || []), ...jobs.map(j => j.branchName).filter(Boolean)])), [jobs, settings]);
  const companies = useMemo(() => Array.from(new Set(jobs.map(j=>j.customer.name).filter(Boolean))).sort((a,b)=>a.localeCompare(b)), [jobs]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter(job => {
      const hay = [job.jobNo, job.branchName, job.customer.name, job.customer.contactPerson, job.customer.phone, job.customer.email, job.customer.city,
        job.products.map(p => `${p.productName} ${p.makeModel} ${p.serialNo} ${statusLabel[p.status || job.status] || p.status} ${p.repairCategory} ${p.estimateStatus}`).join(' ')].join(' ').toLowerCase();
      return (!q || hay.includes(q))
        && (branch === 'ALL' || job.branchName === branch)
        && (company === 'ALL' || job.customer.name === company)
        && (status === 'ALL' || job.status === status)
        && (!dateFrom || job.jobDate >= dateFrom)
        && (!dateTo || job.jobDate <= dateTo);
    });
  }, [jobs, query, branch, company, status, dateFrom, dateTo]);

  const openJobs = jobs.filter(j => !['CLOSED','DISPATCHED'].includes(j.status)).length;
  const pendingPrice = jobs.filter(j => j.products.some(p => !p.onlinePriceConfirmed)).length;
  const estimateReady = jobs.filter(j => j.products.some(p => ['ESTIMATE_READY','SENT_TO_CUSTOMER'].includes(p.estimateStatus || ''))).length;
  const repairing = jobs.filter(j => j.status === 'REPAIRING' || j.products.some(p => p.status === 'REPAIRING')).length;

  function datePreset(kind:'ALL'|'TODAY'|'MONTH') {
    if (kind === 'ALL') { setDateFrom(''); setDateTo(''); return; }
    const now = new Date(); const today = now.toISOString().slice(0,10);
    if (kind === 'TODAY') { setDateFrom(today); setDateTo(today); return; }
    setDateFrom(`${today.slice(0,7)}-01`); setDateTo(today);
  }
  function reportUrl(format:'xlsx'|'pdf') {
    const params = new URLSearchParams();
    if (branch !== 'ALL') params.set('branch',branch);
    if (company !== 'ALL') params.set('company',company);
    if (status !== 'ALL') params.set('status',status);
    if (dateFrom) params.set('from',dateFrom);
    if (dateTo) params.set('to',dateTo);
    if (query.trim()) params.set('q',query.trim());
    return `/api/reports/export/${format}?${params.toString()}`;
  }

  return <div className="stack24">
    <section className="heroRow"><div><p className="eyebrow">SERVICE OPERATIONS</p><h1>Service Job Cards</h1><p className="muted">Track branch, product status, exact online market price, repair estimate and customer delivery status.</p></div><div className="heroActions"><button type="button" className="button importFormButton" onClick={()=>setHandwrittenImportOpen(true)}><ScanText size={17}/> Upload Service Form</button><Link href="/settings" className="button"><SettingsIcon size={17}/> Connections</Link><Link href="/jobs/new" className="button primary large"><FilePlus2 size={18}/> Create Service Job</Link></div></section>

    <section className="connectionStrip">
      <div className={`connectionMini ${(comm?.email?.connected || comm?.email?.status === 'READY')?'connected':''}`}><Mail size={17}/><div><b>{(comm?.email?.connected || comm?.email?.status === 'READY') ? 'Google Gmail connected' : 'Google Gmail login needed'}</b><span>Sender: {comm?.email?.sender || 'Sign in with Google'}</span></div></div>
      <div className={`connectionMini ${comm?.whatsapp?.ready?'connected':'warning'}`}><MessageCircle size={17}/><div><b>{comm?.whatsapp?.ready ? 'WhatsApp connected' : 'WhatsApp login required'}</b><span>{comm?.whatsapp?.ready ? 'Automatic WhatsApp ready' : 'Open Connections and link WhatsApp Web once'}</span></div></div>
    </section>

    <section className="statsGrid"><div className="stat"><Wrench/><div><strong>{openJobs}</strong><span>Open jobs</span></div></div><div className="stat"><Search/><div><strong>{pendingPrice}</strong><span>Price check pending</span></div></div><div className="stat"><Calculator/><div><strong>{estimateReady}</strong><span>Estimate ready</span></div></div><div className="stat"><Wrench/><div><strong>{repairing}</strong><span>Repairing</span></div></div></section>

    <section className="panel reportControlPanel">
      <div className="sectionHead"><div><span className="step">REPORT</span><div><h2>Master Data Filters</h2><p>Choose a branch/company/date or leave everything as All to export the complete master data.</p></div></div><div className="exportButtons"><a className="button" href={reportUrl('xlsx')}><FileSpreadsheet size={17}/> Excel Master</a><a className="button primary" href={reportUrl('pdf')}><FileText size={17}/> PDF Master</a></div></div>
      <div className="branchTabs" aria-label="Branch filter"><button type="button" className={branch === 'ALL' ? 'active' : ''} onClick={() => setBranch('ALL')}><Building2 size={15}/><span>All Branches</span><small>{jobs.length}</small></button>{branchNames.map(name => <button type="button" key={name} className={branch === name ? 'active' : ''} onClick={() => setBranch(name)}><span>{name}</span><small>{jobs.filter(j => j.branchName === name).length}</small></button>)}</div>
      <div className="reportFilters">
        <div className="searchBox"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search job, company, phone, product, model, serial no…"/></div>
        <select value={company} onChange={e=>setCompany(e.target.value)}><option value="ALL">All companies / customers</option>{companies.map(name=><option key={name} value={name}>{name}</option>)}</select>
        <select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All job statuses</option>{Object.entries(statusLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="dateFilterRow"><CalendarDays size={18}/><label>From <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>To <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label><button className="button compact" onClick={()=>datePreset('TODAY')}>Today</button><button className="button compact" onClick={()=>datePreset('MONTH')}>This Month</button><button className="button compact" onClick={()=>datePreset('ALL')}>All Dates</button><span className="filterCount">{filtered.length} jobs selected</span><button className="button ghost" onClick={() => void load(true)}><RefreshCw size={16}/> Refresh</button></div>
    </section>

    <section className="panel">
      {loading ? <div className="empty">Loading service jobs…</div> : filtered.length === 0 ? <div className="empty"><FilePlus2 size={36}/><h3>No matching jobs</h3><p>Create the first service job or change the company/date/filter.</p></div> : <div className="tableWrap"><table className="jobTable"><thead><tr><th>Job</th><th>Enquiry Branch</th><th>Company / Customer</th><th>Product</th><th>Product Status</th><th>Repair Plan</th><th>Market Price / Source</th><th>Estimate Status</th><th>Total Estimate</th><th>Email / WhatsApp</th><th></th></tr></thead><tbody>{filtered.map(job => <tr key={job.id}>
        <td><b>{job.jobNo}</b><small>{job.jobDate}</small></td><td><b>{job.branchName || '—'}</b><small>{job.officeType === 'HEAD_OFFICE' ? 'Head Office' : 'Branch Office'}</small></td><td><b>{job.customer.name}</b><small>{job.customer.contactPerson || job.customer.city}</small></td><td><span>{job.products[0]?.productName || '—'}</span><small>{job.products.length > 1 ? `+${job.products.length-1} more` : job.products[0]?.makeModel}</small></td><td><span className="pill productStatus">{productStatusSummary(job)}</span></td><td><b>{repairSummary(job)}</b><small>{job.products.every(p=>p.onlinePriceConfirmed) ? 'Price confirmed' : 'Price check pending'}</small></td><td><b>INR {money(job.products[0]?.onlinePrice || job.products[0]?.productValue || 0)}</b><small>{job.products[0]?.onlineProductUrl ? <a href={job.products[0].onlineProductUrl} target="_blank" rel="noreferrer">{job.products[0].onlinePriceSource || 'Open exact price source'}</a> : (job.products[0]?.onlinePriceSource || 'Source unavailable')}</small></td><td><span className="pill neutral">{estimateStatusSummary(job)}</span></td><td>INR {money(job.totals.totalEstimate)}</td><td><div className="deliveryBadges"><span className={`pill ${deliveryClass(job.communication?.emailStatus)}`}>{deliveryText('Email',job.communication?.emailStatus)}</span><span className={`pill ${deliveryClass(job.communication?.whatsappStatus)}`}>{deliveryText('WhatsApp',job.communication?.whatsappStatus)}</span></div><small>{job.communication?.lastAutoSentAt ? new Date(job.communication.lastAutoSentAt).toLocaleString() : 'Sends on Save & Preview'}</small></td><td><Link className="button compact" href={`/jobs/${job.id}`}>Open / Edit</Link></td>
      </tr>)}</tbody></table></div>}
    </section>
    {handwrittenImportOpen ? <HandwrittenFormImport open={true} onClose={()=>setHandwrittenImportOpen(false)}/> : null}
  </div>;
}
