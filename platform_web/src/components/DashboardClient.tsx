"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Eye,
  FileText,
  RefreshCw,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import {
  companyFetch,
  connectLocalDataBridge,
  dateText,
  getDashboardBootstrap,
  getRevision,
  readDashboardSnapshot,
  writeDashboardSnapshot,
} from "@/lib/data";
import type { Overview } from "@/lib/types";
import ReportModal from "./ReportModal";

function DailyBars({ rows, type }: { rows: Array<{ key: string; label: string; purchasing: number; servicing: number }>; type: "purchasing" | "servicing" }) {
  const service = type === "servicing";
  const values = rows.map((r) => Number(service ? r.servicing : r.purchasing));
  const max = Math.max(1, ...values);
  return (
    <div className={`simple-daily-bars ${type}`}>
      {rows.map((r, index) => {
        const value = values[index] || 0;
        const height = value > 0 ? Math.max(16, Math.round((value / max) * 112)) : 4;
        return (
          <div className="simple-bar-day" key={`${type}-${r.key}`}>
            <div className="simple-bar-value">{value > 0 ? value : ""}</div>
            <div className="simple-bar-track"><span style={{ height: `${height}px` }} /></div>
            <small>{String(r.label || "").split(" ")[0]}</small>
          </div>
        );
      })}
    </div>
  );
}

type PeriodMetric = {
  label: string;
  total: number;
  purchasing: number;
  servicing: number;
};

function PeriodCard({ metric }: { metric: PeriodMetric }) {
  return (
    <article className="simple-period-card">
      <span>{metric.label}</span>
      <strong>{metric.total}</strong>
      <div className="simple-period-split">
        <b><i className="purchase-dot" />{metric.purchasing} Purchasing</b>
        <b><i className="service-dot" />{metric.servicing} Servicing</b>
      </div>
    </article>
  );
}

// NUNES_V2_8_10_0_TOTAL_VALUES
function inr(value: number) {
  return `INR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SourceSummary({
  type,
  total,
  value,
  today,
  month,
  year,
}: {
  type: "purchasing" | "servicing";
  total: number;
  value: number;
  today: number;
  month: number;
  year: number;
}) {
  const service = type === "servicing";
  return (
    <article className={`simple-source-card ${type}`}>
      <div className="simple-source-head">
        <span className="simple-source-icon">{service ? <Wrench /> : <ShoppingCart />}</span>
        <div>
          <span>{service ? "SERVICING FORMS" : "PURCHASING FORMS"}</span>
          <h2>{service ? "Servicing" : "Purchasing"}</h2>
        </div>
        <Link href={`/forms/${type}`} className="simple-open-link">
          Open <ArrowRight />
        </Link>
      </div>
      <div className="simple-source-total">
        <div>
          <span>Total forms</span>
          <strong style={{ display: "block", marginTop: 4 }}>{total}</strong>
        </div>
        <div style={{ textAlign: "right" }}>
          <span>Total value of all forms</span>
          <strong style={{ display: "block", marginTop: 7, fontSize: 22 }}>{inr(value)}</strong>
        </div>
      </div>
      <div className="simple-source-periods">
        <div><span>Today</span><b>{today}</b></div>
        <div><span>This month</span><b>{month}</b></div>
        <div><span>This year</span><b>{year}</b></div>
      </div>
    </article>
  );
}

function RecentSourceList({
  type,
  rows,
  openReport,
  detailLoading,
}: {
  type: "purchasing" | "servicing";
  rows: any[];
  openReport: (source: "purchasing" | "servicing", id: any) => Promise<void>;
  detailLoading: string;
}) {
  const service = type === "servicing";
  return (
    <article className={`simple-recent-card ${type}`}>
      <div className="simple-recent-head">
        <div>
          <span>{service ? "SERVICING" : "PURCHASING"}</span>
          <h2>{service ? "Latest servicing forms" : "Latest purchasing forms"}</h2>
          <p>Saved records from this form only.</p>
        </div>
        <Link href={`/reports?type=${type}`}>All reports <ArrowRight /></Link>
      </div>
      <div className="simple-recent-list">
        {rows.length ? rows.slice(0, 6).map((r: any) => {
          const id = r.id;
          const reference = service ? r.job_no : r.order_id;
          const detail = service ? (r.product || r.problem || "Service job") : (r.products || `${r.item_count || 0} item(s)`);
          const key = `${type}-${id}`;
          return (
            <div className="simple-recent-row" key={key}>
              <div className="simple-recent-main">
                <b>{reference || "—"}</b>
                <span>{r.customer || "—"}</span>
                <small>{detail || "—"}</small>
              </div>
              <div className="simple-recent-meta">
                <span>{String(r.status || "—").replaceAll("_", " ")}</span>
                <small>{dateText(r.updated_at)}</small>
              </div>
              <button
                className="simple-view-button"
                onClick={() => void openReport(type, id)}
                disabled={detailLoading === key}
              >
                <Eye /> {detailLoading === key ? "Loading..." : service ? "Filled Form" : "View"}
              </button>
            </div>
          );
        }) : (
          <div className="simple-empty-records">No saved {service ? "servicing" : "purchasing"} forms yet.</div>
        )}
      </div>
    </article>
  );
}

export default function DashboardClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [connecting, setConnecting] = useState(false);
  const loadingRef = useRef(false);
  const revisionRef = useRef("");
  const lastLoadRef = useRef(0);

  const load = async (force = false) => {
    if (loadingRef.current) return;
    if (!force && Date.now() - lastLoadRef.current < 2500) return;
    loadingRef.current = true;
    try {
      setError("");
      const data = await getDashboardBootstrap(force);
      setOverview(data.overview);
      if (data.revision) revisionRef.current = data.revision;
      if (data.offline) {
        setWarning(
          data.data_mode === "saved-view"
            ? "Live data is not connected. Showing the last saved dashboard from this browser."
            : "Live company data is not connected yet.",
        );
      } else {
        setWarning("");
        writeDashboardSnapshot(data.overview, data.tasks, data.revision);
      }
      lastLoadRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      loadingRef.current = false;
    }
  };

  const openReport = async (source: "purchasing" | "servicing", id: any) => {
    const key = `${source}-${id}`;
    try {
      setDetailLoading(key);
      const r = await companyFetch(`/api/data/reports/${source}/${encodeURIComponent(String(id))}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok || !d.available) throw new Error(d.error || "Report output could not be loaded");
      setDetail(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setDetailLoading("");
    }
  };

  const connectThisPc = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const result = await connectLocalDataBridge();
      if (result.ok) {
        setWarning("");
        await load(true);
      } else {
        setWarning("Could not connect to the local company data service on this PC.");
      }
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    const snap = readDashboardSnapshot();
    if (snap) {
      setOverview(snap.overview);
      if (snap.revision) revisionRef.current = snap.revision;
    }
    void load(true);

    const watch = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await getRevision();
        if (stopped) return;
        if (!revisionRef.current) {
          revisionRef.current = r.revision;
          return;
        }
        if (r.revision !== revisionRef.current) {
          revisionRef.current = r.revision;
          await load(true);
        }
      } catch {}
    };

    const timer = window.setInterval(watch, 6000);
    const focus = () => { if (Date.now() - lastLoadRef.current > 8000) void load(true); };
    const visibility = () => { if (document.visibilityState === "visible" && Date.now() - lastLoadRef.current > 8000) void load(true); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  if (error && !overview) {
    return (
      <main className="page simple-forms-dashboard">
        <div className="error-state"><AlertTriangle /><div><b>Dashboard could not load live form counts.</b><span>{error}</span><button className="btn primary" onClick={() => void load(true)}>Retry</button></div></div>
      </main>
    );
  }
  if (!overview) {
    return <main className="page simple-forms-dashboard"><div className="center"><div><div className="spinner"/><b>Opening forms dashboard...</b></div></div></main>;
  }

  const f = overview.forms || {};
  const s = overview.service || {};
  const purchaseTotal = Number(f.total_orders || 0);
  const serviceTotal = Number(s.total_jobs || 0);
  const purchaseValue = Number(f.order_value || 0);
  const serviceValue = Number(s.total_estimate || 0);
  const totalForms = purchaseTotal + serviceTotal;
  const purchaseToday = Number(f.today_forms || 0);
  const serviceToday = Number(s.today_forms || 0);
  const purchaseMonth = Number(f.this_month_forms || 0);
  const serviceMonth = Number(s.this_month_forms || 0);
  const purchaseYear = Number(f.this_year_forms || 0);
  const serviceYear = Number(s.this_year_forms || 0);

  const periods: PeriodMetric[] = [
    { label: "Today", total: purchaseToday + serviceToday, purchasing: purchaseToday, servicing: serviceToday },
    { label: "This Month", total: purchaseMonth + serviceMonth, purchasing: purchaseMonth, servicing: serviceMonth },
    { label: "This Year", total: purchaseYear + serviceYear, purchasing: purchaseYear, servicing: serviceYear },
  ];

  const dayMap = new Map<string, { key: string; label: string; purchasing: number; servicing: number; total: number }>();
  for (const x of (f.daily || [])) {
    const key = String(x.key || x.label || "");
    if (key) dayMap.set(key, { key, label: String(x.label || key), purchasing: Number(x.forms || 0), servicing: 0, total: Number(x.forms || 0) });
  }
  for (const x of (s.daily || [])) {
    const key = String(x.key || x.label || "");
    if (!key) continue;
    const row = dayMap.get(key) || { key, label: String(x.label || key), purchasing: 0, servicing: 0, total: 0 };
    row.servicing = Number(x.forms || 0);
    row.total = row.purchasing + row.servicing;
    dayMap.set(key, row);
  }
  const chartRows = Array.from(dayMap.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-14);
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="page simple-forms-dashboard">
      {warning && <div className="output-error connection-warning"><AlertTriangle/><div><b>Live data connection needs attention</b><span>{warning}</span></div><div className="connection-actions"><button className="btn primary" onClick={() => void connectThisPc()} disabled={connecting}>{connecting ? "Connecting..." : "Connect this PC"}</button><button className="btn" onClick={() => void load(true)}><RefreshCw/>Retry</button></div></div>}
      {error && <div className="output-error"><AlertTriangle/><div><b>Live data is temporarily unavailable</b><span>{error}</span></div><button className="btn" onClick={() => void load(true)}>Retry</button></div>}

      <section className="simple-dashboard-head">
        <div>
          <span>FORMS DASHBOARD</span>
          <h1>Form Filling Summary</h1>
          <p>{todayLabel} - Purchasing and Servicing shown separately.</p>
        </div>
        <div className="simple-dashboard-actions">
          <Link href="/forms" className="btn primary"><FileText/>Open Forms</Link>
          <button className="btn" onClick={() => void load(true)}><RefreshCw/>Refresh</button>
        </div>
      </section>

      <section className="simple-total-row">
        <article className="simple-total-card">
          <div><span>ALL SAVED FORMS</span><h2>Total Forms</h2><p>Purchasing + Servicing</p></div>
          <strong>{totalForms}</strong>
          <div className="simple-total-breakdown"><b><i className="purchase-dot"/>{purchaseTotal} Purchasing</b><b><i className="service-dot"/>{serviceTotal} Servicing</b></div>
        </article>
        {periods.map((metric) => <PeriodCard key={metric.label} metric={metric} />)}
      </section>

      <section className="simple-source-grid">
        <SourceSummary type="purchasing" total={purchaseTotal} value={purchaseValue} today={purchaseToday} month={purchaseMonth} year={purchaseYear} />
        <SourceSummary type="servicing" total={serviceTotal} value={serviceValue} today={serviceToday} month={serviceMonth} year={serviceYear} />
      </section>

      <section className="simple-chart-grid">
        <article className="simple-chart-card purchasing">
          <div className="simple-section-head"><div><span>PURCHASING - DAILY</span><h2>Purchasing Form Filling</h2><p>Last 14 days. Purchasing only.</p></div><b className="simple-chart-total">Total {purchaseTotal}</b></div>
          <div className="simple-chart-area">
            {chartRows.some((x) => x.purchasing > 0) ? <DailyBars rows={chartRows} type="purchasing"/> : <div className="simple-empty-chart"><CalendarDays/><b>No purchasing forms in this period</b><span>Saved Purchasing forms will appear here.</span></div>}
          </div>
        </article>
        <article className="simple-chart-card servicing">
          <div className="simple-section-head"><div><span>SERVICING - DAILY</span><h2>Servicing Form Filling</h2><p>Last 14 days. Servicing only.</p></div><b className="simple-chart-total">Total {serviceTotal}</b></div>
          <div className="simple-chart-area">
            {chartRows.some((x) => x.servicing > 0) ? <DailyBars rows={chartRows} type="servicing"/> : <div className="simple-empty-chart"><CalendarDays/><b>No servicing forms in this period</b><span>Saved Servicing forms will appear here.</span></div>}
          </div>
        </article>
      </section>

      <section className="simple-recent-grid">
        <RecentSourceList type="purchasing" rows={f.recent || []} openReport={openReport} detailLoading={detailLoading}/>
        <RecentSourceList type="servicing" rows={s.recent || []} openReport={openReport} detailLoading={detailLoading}/>
      </section>

      {detail && <ReportModal data={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}
