"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Command,
  Database,
  FileCheck2,
  FileSpreadsheet,
  Gauge,
  Globe2,
  Inbox,
  Layers3,
  Link2,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Pause,
  Phone,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { datasetToLeads, parseDataset } from "@/lib/import-dataset";
import {
  deleteLead,
  deleteDataset,
  getSupabaseClient,
  loadDatasets,
  loadEnrichmentJobs,
  loadPropertyLeads,
  persistDataset,
  updateEnrichmentJob,
  updateLeadReview,
} from "@/lib/supabase";
import type { DatasetSummary, EnrichmentJob, LeadStatus, ParsedDataset, PropertyLead } from "@/lib/types";

type View = "overview" | "enrichment" | "datasets" | "exports" | "team" | "settings";
type AuthState = "idle" | "sending" | "oauth" | "sent" | "error";

const nav: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "enrichment", label: "Enrichment", icon: WandSparkles },
  { id: "datasets", label: "Datasets", icon: Database },
  { id: "exports", label: "Exports", icon: ArrowDownToLine },
];

const viewCopy: Record<View, { eyebrow: string; title: string; accent: string; copy: string }> = {
  overview: { eyebrow: "Live workspace", title: "Property intelligence,", accent: "with receipts.", copy: "Turn raw owner records into verified contacts with confidence scores and a source trail your team can trust." },
  enrichment: { eyebrow: "Research operations", title: "Enrichment jobs,", accent: "under control.", copy: "Monitor active research, inspect uncertain matches, and keep every result tied to public evidence." },
  datasets: { eyebrow: "Source library", title: "Every import,", accent: "right where you left it.", copy: "Your private spreadsheets and their processing history stay attached to your account." },
  exports: { eyebrow: "Export centre", title: "Clean results,", accent: "ready to move.", copy: "Filter, select, and export only the records you need—with evidence URLs included." },
  team: { eyebrow: "Access control", title: "Your workspace,", accent: "yours alone.", copy: "This release uses personal workspaces. Every database row and uploaded file is scoped to the signed-in user." },
  settings: { eyebrow: "Account settings", title: "Simple controls,", accent: "serious privacy.", copy: "Review your active identity, data boundary, and session controls." },
};

const statusMeta: Record<LeadStatus, { label: string; tone: string }> = {
  verified: { label: "Verified", tone: "green" },
  reviewing: { label: "Researching", tone: "blue" },
  queued: { label: "Queued", tone: "gray" },
  attention: { label: "Needs review", tone: "amber" },
};

function initials(value: string) {
  return value.split(/\s|&/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function safeCsvCell(value: unknown) {
  let valueText = String(value ?? "");
  if (/^[=+\-@]/.test(valueText)) valueText = `'${valueText}`;
  return `"${valueText.replaceAll('"', '""')}"`;
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const meta = statusMeta[status];
  return <span className={`status status-${meta.tone}`}><span className="status-dot" />{meta.label}</span>;
}

function Confidence({ value }: { value: number }) {
  const tone = value >= 85 ? "high" : value >= 60 ? "medium" : value > 0 ? "low" : "empty";
  return (
    <div className="confidence" aria-label={`${value}% confidence`}>
      <div className={`confidence-ring confidence-${tone}`} style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties}>
        <span>{value || "—"}</span>
      </div>
      <div><strong>{value ? `${value}%` : "Pending"}</strong><small>confidence</small></div>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Activity; tone: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-${tone}`}><Icon size={18} strokeWidth={1.9} /></div>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.59-5.04-3.72H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.16.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.03l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59A8.68 8.68 0 0 0 9 0 9 9 0 0 0 .96 4.97l3 2.33C4.67 5.17 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function WelcomeScreen({ loading, authState, onGoogle }: { loading: boolean; authState: AuthState; onGoogle: () => void }) {
  const openingGoogle = authState === "oauth";
  return (
    <main className="welcome-shell">
      <div className="welcome-glow welcome-glow-one" />
      <div className="welcome-glow welcome-glow-two" />
      <header className="welcome-header">
        <div className="welcome-brand"><span className="welcome-brand-mark"><Layers3 size={19} strokeWidth={2.4} /></span><span>Acreline</span></div>
        <span className="welcome-security"><ShieldCheck size={15} />Private by default</span>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy-block">
          <div className="welcome-eyebrow"><span />Property owner intelligence</div>
          <h1>Turn raw records into<br /><em>contacts you can trust.</em></h1>
          <p>Upload a spreadsheet. Acreline researches each owner across public sources, verifies every useful contact, and keeps the evidence attached.</p>

          <div className="welcome-action-card">
            <span className="welcome-action-label">Open your private workspace</span>
            <button className="welcome-google-button" type="button" onClick={onGoogle} disabled={loading || openingGoogle}>
              {loading || openingGoogle ? <LoaderCircle className="spin" size={18} /> : <GoogleMark />}
              <span>{loading ? "Restoring your workspace…" : openingGoogle ? "Opening Google…" : "Continue with Google"}</span>
              {!loading && !openingGoogle ? <ArrowRight size={17} /> : null}
            </button>
            {authState === "error" ? <p className="welcome-auth-error" role="alert"><CircleAlert size={15} />Google sign-in could not start. Please try again.</p> : null}
            <div className="welcome-trust-row"><span><LockKeyhole size={13} />Your data stays in your account</span><span><BadgeCheck size={13} />Source-backed results</span></div>
          </div>
        </div>

        <div className="welcome-product-wrap" aria-label="How Acreline works">
          <div className="welcome-product">
            <div className="welcome-product-head"><div><span className="welcome-mini-logo"><Layers3 size={14} /></span><span>Research pipeline</span></div><span className="welcome-public-pill"><Globe2 size={12} />Public web only</span></div>
            <div className="welcome-flow">
              <article><span className="welcome-step-icon welcome-step-violet"><FileSpreadsheet size={19} /></span><div><small>01 · Import</small><strong>Bring the records</strong><p>CSV, TSV, or Excel—mapped and stored privately.</p></div><Check size={16} /></article>
              <span className="welcome-flow-line" />
              <article><span className="welcome-step-icon welcome-step-lime"><Search size={19} /></span><div><small>02 · Discover</small><strong>Research the public web</strong><p>Official sites, registries, directories, and public social profiles.</p></div><Sparkles size={16} /></article>
              <span className="welcome-flow-line" />
              <article><span className="welcome-step-icon welcome-step-blue"><BadgeCheck size={19} /></span><div><small>03 · Verify</small><strong>Keep the receipts</strong><p>Confidence, contact points, and evidence URLs in one view.</p></div><Check size={16} /></article>
            </div>
            <div className="welcome-evidence-card"><span><ShieldCheck size={17} /></span><div><small>Evidence before confidence</small><strong>Every useful result stays tied to its public source.</strong></div></div>
          </div>
          <div className="welcome-private-card"><LockKeyhole size={16} /><div><strong>Isolated workspace</strong><span>RLS-enforced account boundary</span></div><BadgeCheck size={16} /></div>
        </div>
      </section>

      <footer className="welcome-footer"><span>Responsible public-web research</span><span>Acreline · Property intelligence, with receipts.</span></footer>
    </main>
  );
}

export function Workspace() {
  const [view, setView] = useState<View>("overview");
  const [user, setUser] = useState<User | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [leads, setLeads] = useState<PropertyLead[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [jobs, setJobs] = useState<EnrichmentJob[]>([]);
  const [selected, setSelected] = useState<PropertyLead | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [approvedLeadIds, setApprovedLeadIds] = useState<Set<string>>(new Set());
  const [datasetFilter, setDatasetFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [parsed, setParsed] = useState<ParsedDataset | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importState, setImportState] = useState<"idle" | "parsing" | "saving">("idle");
  const [costLimitUsd, setCostLimitUsd] = useState(2);
  const [toast, setToast] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshWorkspace = useCallback(async (activeUser: User) => {
    const [savedLeads, savedDatasets, savedJobs] = await Promise.all([
      loadPropertyLeads(),
      loadDatasets(),
      loadEnrichmentJobs(),
    ]);
    setUser(activeUser);
    setLeads(savedLeads);
    setDatasets(savedDatasets);
    setJobs(savedJobs);
    setSelected((current) => savedLeads.find((lead) => lead.id === current?.id) ?? savedLeads[0] ?? null);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      window.setTimeout(() => setAccountLoading(false), 0);
      return;
    }
    const hydrate = async (activeUser: User | null) => {
      setAccountLoading(true);
      if (!activeUser) {
        setUser(null);
        setLeads([]);
        setDatasets([]);
        setJobs([]);
        setSelected(null);
        setSelectedLeadIds(new Set());
        setDatasetFilter(null);
        setAccountLoading(false);
        return;
      }
      try {
        await refreshWorkspace(activeUser);
      } catch {
        setLeads([]);
        setDatasets([]);
        setJobs([]);
        setSelected(null);
        setToast("We could not refresh your workspace. Your data remains safely stored.");
      } finally {
        setAccountLoading(false);
      }
    };
    void supabase.auth.getUser().then(({ data }) => hydrate(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void hydrate(session?.user ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    const hasActiveWork = jobs.some((job) => job.status === "running" || job.status === "queued");
    const timer = window.setInterval(() => void refreshWorkspace(user).catch(() => undefined), hasActiveWork ? 4_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [jobs, refreshWorkspace, user]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("record-search")?.focus();
      }
      if (event.key === "Escape") {
        setUploadOpen(false);
        setAuthOpen(false);
        setNotificationsOpen(false);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Acreline user";
  const avatarText = initials(displayName) || "AM";
  const pendingCount = leads.filter((lead) => lead.status === "queued" || lead.status === "reviewing" || lead.status === "attention").length;
  const verifiedCount = leads.filter((lead) => lead.status === "verified").length;
  const avgConfidence = leads.length ? leads.reduce((sum, lead) => sum + lead.confidence, 0) / leads.length : 0;
  const activeJob = jobs.find((job) => ["running", "paused", "queued"].includes(job.status)) ?? jobs[0] ?? null;
  const activeDataset = activeJob ? datasets.find((dataset) => dataset.id === activeJob.datasetId) : null;
  const runTotal = activeJob?.rowsTotal ?? 0;
  const runCompleted = activeJob?.rowsCompleted ?? 0;
  const runFailed = activeJob?.rowsFailed ?? 0;
  const runProcessed = runCompleted + runFailed;
  const runProgress = runTotal ? Math.min(100, Math.round((runProcessed / runTotal) * 100)) : 0;
  const isRunning = activeJob?.status === "running";
  const legacyCostLocked = Boolean(activeJob && !activeJob.costEstimateComplete);
  const needsRetry = Boolean(activeJob && activeJob.rowsFailed > 0 && (activeJob.status === "failed" || activeJob.status === "completed"));
  const jobStatusLabel = legacyCostLocked ? "Locked for safety"
    : activeJob?.status === "running" ? `${runProgress}%`
    : activeJob?.status === "queued" ? "Starting"
    : needsRetry ? "Needs retry"
    : activeJob?.status === "completed" ? "Done"
    : activeJob?.status === "failed" ? "Failed"
    : activeJob?.status === "cancelled" ? "Cancelled"
    : "Paused";
  const jobStatusDetail = legacyCostLocked ? "Legacy search fees were not tracked; this run cannot resume"
    : activeJob?.status === "running" ? "Workers researching public sources"
    : activeJob?.status === "queued" ? "Waiting for a worker to claim this job"
    : needsRetry ? `${runFailed.toLocaleString()} records failed and can be retried`
    : activeJob?.status === "failed" ? "The worker stopped before completing this job"
    : activeJob?.status === "completed" ? "Research completed"
    : activeJob?.status === "cancelled" ? "Enrichment cancelled"
    : "Workers safely paused";

  const filteredLeads = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return leads.filter((lead) => {
      const matchesDataset = !datasetFilter || lead.datasetId === datasetFilter;
      const matchesView = view !== "enrichment" || lead.status !== "verified";
      const matchesFilter = filter === "all" || lead.status === filter;
      const haystack = `${lead.owner} ${lead.address} ${lead.city} ${lead.email ?? ""} ${lead.phone ?? ""}`.toLowerCase();
      return matchesDataset && matchesView && matchesFilter && (!needle || haystack.includes(needle));
    });
  }, [datasetFilter, filter, leads, search, view]);

  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageLeads = filteredLeads.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    setImportState("parsing");
    setParseError(null);
    try {
      setParsed(await parseDataset(file));
    } catch (error) {
      setParsed(null);
      setParseError(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      setImportState("idle");
    }
  }, []);

  async function startImport() {
    if (!parsed) return;
    if (!user) {
      setUploadOpen(false);
      setAuthOpen(true);
      setToast("Sign in first so this dataset is saved to your private workspace.");
      return;
    }
    setImportState("saving");
    setParseError(null);
    try {
      const imported = datasetToLeads(parsed);
      const result = await persistDataset(parsed, imported, costLimitUsd);
      await refreshWorkspace(user);
      setUploadOpen(false);
      setParsed(null);
      setView("enrichment");
      setToast(result.mode === "saved" && result.workerStarted
        ? `${imported.length.toLocaleString()} records saved. The worker is running.`
        : `${imported.length.toLocaleString()} records saved, but the worker did not start. Press Retry on the job card.`);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "The dataset could not be saved.");
    } finally {
      setImportState("idle");
    }
  }

  function exportCsv(scope: PropertyLead[] = filteredLeads, selectionMode: "selected-or-scope" | "scope" = "selected-or-scope") {
    const chosen = selectionMode === "selected-or-scope" && selectedLeadIds.size ? scope.filter((lead) => selectedLeadIds.has(lead.id)) : scope;
    if (!chosen.length) {
      setToast("There are no records to export in this view.");
      return;
    }
    const headers = ["Owner", "Property address", "City", "Province", "Postal code", "Email", "Phone", "Property type", "Confidence", "Status", "Source URLs"];
    const body = chosen.map((lead) => [
      lead.owner, lead.address, lead.city, lead.province, lead.postalCode, lead.email, lead.phone,
      lead.propertyType, lead.confidence, statusMeta[lead.status].label, lead.sources.map((source) => source.url).join(" | "),
    ].map(safeCsvCell).join(","));
    const blob = new Blob([[headers.map(safeCsvCell).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `acreline-enrichment-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(`Exported ${chosen.length.toLocaleString()} source-backed records.`);
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthState("error");
      return;
    }
    setAuthState("sending");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setAuthState(error ? "error" : "sent");
  }

  async function signInWithGoogle() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthState("error");
      return;
    }
    setAuthState("oauth");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setAuthState("error");
      setToast(error.message);
    }
  }

  async function signOut() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthOpen(false);
    setToast("Signed out. Your private workspace is still safely stored.");
  }

  async function toggleActiveJob() {
    if (!user || !activeJob) {
      setToast("There is no active enrichment job yet.");
      return;
    }
    if (legacyCostLocked) {
      setToast("This legacy run is locked because it did not track paid search fees. Start a new cost-capped enrichment.");
      return;
    }
    setJobBusy(true);
    try {
      if (activeJob.status === "running") {
        await updateEnrichmentJob(activeJob.id, "paused");
        setJobs((current) => current.map((job) => job.id === activeJob.id ? { ...job, status: "paused" } : job));
        setToast("Enrichment paused after the current record.");
      } else {
        const supabase = getSupabaseClient();
        const { data } = await supabase!.auth.getSession();
        const response = await fetch(`/api/jobs/${activeJob.id}/run`, {
          method: "POST",
          headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? "The enrichment worker could not be resumed.");
        }
        setJobs((current) => current.map((job) => job.id === activeJob.id ? { ...job, status: "running" } : job));
        setToast("Worker claimed the job. Enrichment is running.");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The job could not be updated.");
    } finally {
      setJobBusy(false);
    }
  }

  async function approveSelectedRecord() {
    if (!selected) return;
    try {
      if (user) await updateLeadReview(selected.id, "approved");
      setApprovedLeadIds((current) => new Set(current).add(selected.id));
      setToast(`${selected.owner} approved.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The review could not be saved.");
    }
  }

  async function removeDataset(dataset: DatasetSummary) {
    if (!window.confirm(`Delete "${dataset.name}" and every related record? This cannot be undone.`)) return;
    try {
      await deleteDataset(dataset.id);
      if (user) await refreshWorkspace(user);
      setDatasetFilter(null);
      setToast(`${dataset.name} deleted.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The dataset could not be deleted.");
    }
  }

  async function removeLead(lead: PropertyLead) {
    if (!window.confirm(`Delete ${lead.owner} from this dataset? This cannot be undone.`)) return;
    setDeletingLeadId(lead.id);
    try {
      await deleteLead(lead.id);
      setSelectedLeadIds((current) => { const next = new Set(current); next.delete(lead.id); return next; });
      setSelected((current) => current?.id === lead.id ? null : current);
      if (user) await refreshWorkspace(user);
      setToast(`${lead.owner} deleted.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The record could not be deleted.");
    } finally {
      setDeletingLeadId(null);
    }
  }

  function switchView(nextView: View) {
    setView(nextView);
    setPage(0);
    setNotificationsOpen(false);
    if (nextView !== "overview" && nextView !== "exports") setDatasetFilter(null);
  }

  const copy = viewCopy[view];
  const showRecords = view === "overview" || view === "enrichment" || view === "exports";
  const totalTrackedCost = jobs.reduce((sum, job) => sum + job.estimatedCostUsd, 0);
  const hasPartialCostHistory = jobs.some((job) => !job.costEstimateComplete && job.estimatedCostUsd > 0);

  if (accountLoading || !user) {
    return <WelcomeScreen loading={accountLoading} authState={authState} onGoogle={() => void signInWithGoogle()} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Layers3 size={19} strokeWidth={2.4} /></div><span>Acreline</span></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? "nav-active" : ""}`} type="button" onClick={() => switchView(id)}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>{id === "enrichment" && pendingCount ? <b>{pendingCount}</b> : null}
            </button>
          ))}
          <p className="nav-label nav-section">Manage</p>
          <button className={`nav-item ${view === "team" ? "nav-active" : ""}`} type="button" onClick={() => switchView("team")}><UsersRound size={18} /><span>Team</span></button>
          <button className={`nav-item ${view === "settings" ? "nav-active" : ""}`} type="button" onClick={() => switchView("settings")}><Settings2 size={18} /><span>Settings</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <ShieldCheck size={18} />
          <div><strong>Private by default</strong><span>RLS isolates every record and source by user ID.</span></div>
        </div>
        <button className="profile" type="button" onClick={() => setAuthOpen(true)}>
          <span className="profile-avatar">{avatarText}</span>
          <span><strong>{displayName}</strong><small>{user.email ?? "Private workspace"}</small></span>
          <ChevronDown size={15} />
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p>Property Partners</p><span>/</span><strong>{nav.find((item) => item.id === view)?.label ?? viewCopy[view].eyebrow}</strong></div>
          <div className="top-actions">
            <button className="command-search" type="button" onClick={() => { if (!showRecords) setView("overview"); window.setTimeout(() => document.getElementById("record-search")?.focus(), 0); }}>
              <Search size={15} /><span>Search workspace</span><kbd><Command size={11} /> K</kbd>
            </button>
            <div className="notification-wrap">
              <button className="icon-button" type="button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} />{pendingCount ? <i /> : null}</button>
              {notificationsOpen ? <div className="notifications-panel"><div><strong>Workspace activity</strong><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={15} /></button></div>{user ? jobs.slice(0, 3).map((job) => <button type="button" key={job.id} onClick={() => { setView("enrichment"); setNotificationsOpen(false); }}><span className={`activity-dot activity-${job.status}`} /><span><strong>{job.rowsFailed ? "Enrichment needs retry" : job.status === "completed" ? "Enrichment completed" : `Job ${job.status}`}</strong><small>{(job.rowsCompleted + job.rowsFailed).toLocaleString()} of {job.rowsTotal.toLocaleString()} processed · {job.createdAt}</small></span></button>) : <p>Sign in to see private job activity.</p>}{user && !jobs.length ? <p>No job activity yet.</p> : null}</div> : null}
            </div>
            <button className="avatar-button" type="button" onClick={() => setAuthOpen(true)} aria-label="Open account">{avatarText}</button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div><div className="eyebrow"><span className="live-dot" />{copy.eyebrow}</div><h1>{copy.title}<br /><em>{copy.accent}</em></h1><p>{copy.copy}</p></div>
            <div className="heading-actions">
              {showRecords ? <button className="button secondary" type="button" onClick={() => exportCsv()}><ArrowDownToLine size={17} />{selectedLeadIds.size ? `Export ${selectedLeadIds.size}` : "Export"}</button> : null}
              {view !== "team" && view !== "settings" ? <button className="button primary" type="button" onClick={() => setUploadOpen(true)}><Plus size={18} />New enrichment</button> : null}
            </div>
          </section>

          {view === "overview" ? <section className="metrics" aria-label="Workspace metrics">
            <MetricCard label="Records processed" value={leads.length.toLocaleString()} detail={`${datasets.length} private datasets`} icon={FileCheck2} tone="violet" />
            <MetricCard label="Verified contacts" value={verifiedCount.toLocaleString()} detail={leads.length ? `${Math.round((verifiedCount / leads.length) * 100)}% match rate` : "No records yet"} icon={BadgeCheck} tone="green" />
            <MetricCard label="Avg. confidence" value={leads.length ? `${avgConfidence.toFixed(1)}%` : "—"} detail="Across visible account data" icon={Activity} tone="blue" />
            <MetricCard label="Tracked API cost" value={jobs.length ? `${hasPartialCostHistory ? "≥" : ""}$${totalTrackedCost.toFixed(2)}` : "$0.00"} detail={hasPartialCostHistory ? "Partial history—OpenAI billing is final" : "Includes model tokens and web-search fees"} icon={Sparkles} tone="amber" />
          </section> : null}

          {(view === "overview" || view === "enrichment") && activeJob ? <section className="run-card">
            <div className="run-main">
              <div className="run-title"><span className="run-icon"><Globe2 size={20} /></span><div><span className="section-kicker">Active enrichment</span><h2>{activeDataset?.name ?? "Latest account job"}</h2></div></div>
              <div className="run-stats"><strong>{jobStatusLabel}</strong><span>{runProcessed.toLocaleString()} of {runTotal.toLocaleString()} processed</span><small>{activeJob.costEstimateComplete ? `$${activeJob.estimatedCostUsd.toFixed(2)}${activeJob.costLimitUsd ? ` / $${activeJob.costLimitUsd.toFixed(2)} cap` : ""}` : `Partial cost ≥$${activeJob.estimatedCostUsd.toFixed(2)}`}</small></div>
              <div className="progress"><span style={{ width: `${runProgress}%` }} /></div>
              <div className="run-foot"><span><span className={`pulse ${isRunning ? "" : "pulse-paused"}`} />{jobStatusDetail}</span><span>{activeJob?.rowsFailed ? `${activeJob.rowsFailed} need attention` : "Evidence retained automatically"}</span></div>
            </div>
            <button className="pause-button" type="button" disabled={jobBusy || legacyCostLocked || activeJob.status === "completed" && !needsRetry} onClick={() => void toggleActiveJob()} aria-label={isRunning ? "Pause enrichment" : needsRetry ? "Retry failed records" : "Resume enrichment"}>{jobBusy ? <LoaderCircle className="spin" size={17} /> : legacyCostLocked ? <LockKeyhole size={17} /> : isRunning ? <Pause size={17} /> : <Play size={17} />}</button>
          </section> : null}

          {view === "exports" ? <section className="bulk-export-card">
            <div><span>Bulk export</span><h2>Move the complete workspace or a precise selection.</h2><p>Every export includes contact details, confidence, status, and evidence URLs.</p></div>
            <div className="bulk-export-actions">
              <button className="button primary" type="button" onClick={() => exportCsv(leads, "scope")}><ArrowDownToLine size={17} />Export all {leads.length.toLocaleString()}</button>
              <button className="button secondary" type="button" onClick={() => exportCsv(filteredLeads, "scope")}><ListFilter size={16} />Export filtered {filteredLeads.length.toLocaleString()}</button>
              <button className="button secondary" type="button" disabled={!selectedLeadIds.size} onClick={() => exportCsv(leads)}><Check size={16} />Export selected {selectedLeadIds.size || ""}</button>
            </div>
          </section> : null}

          {view === "datasets" ? <section className="workspace-panel">
            <div className="panel-title"><div><span>Private source library</span><h2>{datasets.length ? `${datasets.length} saved dataset${datasets.length === 1 ? "" : "s"}` : "No datasets yet"}</h2></div><Database size={22} /></div>
            {!user ? <div className="panel-empty"><LockKeyhole size={25} /><strong>Sign in to open your private dataset library.</strong><span>Demo records never mix with account data.</span><button className="button primary" type="button" onClick={() => setAuthOpen(true)}>Sign in</button></div> : datasets.length ? <div className="dataset-list">{datasets.map((dataset) => <article key={dataset.id}><div className="dataset-icon"><FileSpreadsheet size={20} /></div><div><strong>{dataset.name}</strong><span>{dataset.rowCount.toLocaleString()} rows · {dataset.status} · {dataset.createdAt}</span><div className="dataset-progress"><span style={{ width: `${dataset.rowCount ? Math.round((dataset.processedCount / dataset.rowCount) * 100) : 0}%` }} /></div></div><div className="dataset-actions"><button type="button" onClick={() => { setDatasetFilter(dataset.id); setView("overview"); setToast(`Showing records from ${dataset.name}.`); }}>View records</button><button className="danger-button" type="button" onClick={() => void removeDataset(dataset)} aria-label={`Delete ${dataset.name}`}><Trash2 size={15} /></button></div></article>)}</div> : <div className="panel-empty"><FileSpreadsheet size={25} /><strong>Your first dataset starts here.</strong><span>Upload CSV, TSV, or XLSX. It will remain available whenever you return.</span><button className="button primary" type="button" onClick={() => setUploadOpen(true)}>Import spreadsheet</button></div>}
          </section> : null}

          {view === "team" ? <section className="workspace-panel">
            <div className="panel-title"><div><span>Personal workspace</span><h2>One identity. One private data boundary.</h2></div><UsersRound size={22} /></div>
            <div className="privacy-grid"><article><ShieldCheck size={22} /><strong>Row-level isolation</strong><span>Every query is constrained by the authenticated Supabase user ID, with RLS enforcing the same rule in the database.</span></article><article><LockKeyhole size={22} /><strong>Private file storage</strong><span>Imported files live in a private bucket under your account ID. Other users cannot list, read, update, or delete them.</span></article><article><BadgeCheck size={22} /><strong>Persistent sessions</strong><span>Google or email sign-in restores your datasets, leads, sources, reviews, jobs, and exports when you come back.</span></article></div>
          </section> : null}

          {view === "settings" ? <section className="workspace-panel">
            <div className="panel-title"><div><span>Account</span><h2>{user ? displayName : "Demo workspace"}</h2></div><Settings2 size={22} /></div>
            <div className="settings-list"><div><span className="settings-avatar">{avatarText}</span><div><strong>{user?.email ?? "Not signed in"}</strong><span>{user ? "Authenticated private workspace" : "Preview records are not saved"}</span></div></div><div><ShieldCheck size={19} /><div><strong>Data isolation</strong><span>{user ? "RLS and private Storage policies are active for this account." : "Sign in before importing real client information."}</span></div></div></div>
            <div className="settings-actions">{user ? <><button className="button secondary" type="button" onClick={() => exportCsv(leads, "scope")}><ArrowDownToLine size={17} />Export all my data</button><button className="button danger" type="button" onClick={() => void signOut()}><LogOut size={17} />Sign out</button></> : <button className="button primary" type="button" onClick={() => setAuthOpen(true)}>Sign in to Acreline</button>}</div>
          </section> : null}

          {showRecords ? <section className="records-card">
            <div className="records-head">
              <div><h2>{datasetFilter ? datasets.find((dataset) => dataset.id === datasetFilter)?.name ?? "Dataset records" : view === "exports" ? "Exportable records" : "Owner records"}</h2><span>{filteredLeads.length.toLocaleString()} in this view{datasetFilter ? <button type="button" className="clear-filter" onClick={() => setDatasetFilter(null)}>Clear dataset</button> : null}</span></div>
              <div className="records-tools"><label className="table-search"><Search size={15} /><input id="record-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search owners, addresses, contacts…" /></label><div className="filter-wrap"><ListFilter size={15} /><select value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(0); }} aria-label="Filter records"><option value="all">All records</option><option value="verified">Verified</option><option value="reviewing">Researching</option><option value="queued">Queued</option><option value="attention">Needs review</option></select></div></div>
            </div>
            <div className="bulk-selection-bar">
              <span>{selectedLeadIds.size ? `${selectedLeadIds.size.toLocaleString()} selected` : "Select records for a custom export"}</span>
              <div><button type="button" onClick={() => setSelectedLeadIds(new Set(filteredLeads.map((lead) => lead.id)))}>Select all {filteredLeads.length.toLocaleString()}</button>{selectedLeadIds.size ? <button type="button" onClick={() => setSelectedLeadIds(new Set())}>Clear</button> : null}{selectedLeadIds.size ? <button type="button" onClick={() => exportCsv(leads)}><ArrowDownToLine size={14} />Export selected</button> : null}</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th><input type="checkbox" aria-label="Select this page" checked={pageLeads.length > 0 && pageLeads.every((lead) => selectedLeadIds.has(lead.id))} onChange={(event) => setSelectedLeadIds((current) => { const next = new Set(current); pageLeads.forEach((lead) => { if (event.target.checked) next.add(lead.id); else next.delete(lead.id); }); return next; })} /></th><th>Owner & property</th><th>Contact found</th><th>Confidence</th><th>Status</th><th>Sources</th><th /></tr></thead>
                <tbody>{pageLeads.map((lead) => <tr key={lead.id} onClick={() => setSelected(lead)} className={selected?.id === lead.id ? "row-selected" : ""}><td><input type="checkbox" aria-label={`Select ${lead.owner}`} checked={selectedLeadIds.has(lead.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedLeadIds((current) => { const next = new Set(current); if (event.target.checked) next.add(lead.id); else next.delete(lead.id); return next; })} /></td><td><div className="owner-cell"><span className="owner-avatar">{initials(lead.owner)}</span><div><strong>{lead.owner}</strong><span>{lead.address}{lead.city ? ` · ${lead.city}` : ""}</span></div></div></td><td><div className="contact-cell">{lead.email ? <span><Mail size={13} />{lead.email}</span> : null}{lead.phone ? <span><Phone size={13} />{lead.phone}</span> : null}{!lead.email && !lead.phone ? <span className="muted-contact">Not found yet</span> : null}</div></td><td><Confidence value={lead.confidence} /></td><td><StatusBadge status={lead.status} /></td><td><div className="source-stack">{lead.sources.slice(0, 3).map((source) => <span key={source.url} title={source.label}>{source.label[0]}</span>)}{lead.sources.length ? <small>{lead.sources.length}</small> : <small>—</small>}</div></td><td><div className="row-actions"><button className="row-action row-delete" type="button" disabled={deletingLeadId === lead.id} aria-label={`Delete ${lead.owner}`} onClick={(event) => { event.stopPropagation(); void removeLead(lead); }}>{deletingLeadId === lead.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button><button className="row-action" type="button" aria-label={`Open ${lead.owner}`} onClick={(event) => { event.stopPropagation(); setSelected(lead); }}><ArrowRight size={16} /></button></div></td></tr>)}</tbody>
              </table>
              {!pageLeads.length ? <div className="empty-table"><Inbox size={26} /><strong>{accountLoading ? "Loading your workspace…" : user ? "No matching records" : "No matching preview records"}</strong><span>{user && !leads.length ? "Import a spreadsheet to begin." : "Try a different search or filter."}</span></div> : null}
            </div>
            <div className="table-foot"><span>Showing {pageLeads.length ? safePage * pageSize + 1 : 0}–{Math.min((safePage + 1) * pageSize, filteredLeads.length)} of {filteredLeads.length}</span><div><button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button></div></div>
          </section> : null}

          <section className="principles"><ShieldCheck size={18} /><p><strong>Built for responsible research.</strong> Acreline blocks private-network targets, retains source URLs, and routes uncertain identity matches to a human.</p><a href="https://github.com/D4Vinci/Scrapling" target="_blank" rel="noreferrer">Scraping engine <ArrowRight size={13} /></a></section>
        </div>
      </main>

      {selected ? <aside className="detail-panel" aria-label="Record detail"><div className="detail-top"><span>Record intelligence</span><button type="button" onClick={() => setSelected(null)} aria-label="Close detail"><X size={18} /></button></div><div className="detail-identity"><span className="detail-avatar">{initials(selected.owner)}</span><div><h2>{selected.owner}</h2><p>{selected.address}<br />{[selected.city, selected.province, selected.postalCode].filter(Boolean).join(", ")}</p></div></div><div className="detail-score"><div><span>Evidence confidence</span><strong>{selected.confidence || "—"}<small>{selected.confidence ? "%" : ""}</small></strong></div><div className="score-track"><span style={{ width: `${selected.confidence}%` }} /></div><p>{selected.status === "verified" ? "The same contact was corroborated on at least two independent domains." : selected.email || selected.phone ? "Single-source candidate—confirm it against the linked page before outreach." : "No contact has been corroborated for this record."}</p></div><div className="detail-section"><div className="detail-label"><span>Contact points</span><StatusBadge status={selected.status} /></div><div className="contact-box"><Mail size={16} /><div><span>{selected.status === "verified" ? "Verified email" : "Candidate email"}</span><strong>{selected.email ?? "Not found"}</strong></div>{selected.email ? selected.status === "verified" ? <BadgeCheck size={16} className="verified-icon" /> : <CircleAlert size={16} /> : <Clock3 size={16} />}</div><div className="contact-box"><Phone size={16} /><div><span>{selected.status === "verified" ? "Verified phone" : "Candidate phone"}</span><strong>{selected.phone ?? "Not found"}</strong></div>{selected.phone ? selected.status === "verified" ? <BadgeCheck size={16} className="verified-icon" /> : <CircleAlert size={16} /> : null}</div></div><div className="detail-section evidence-section"><div className="detail-label"><span>Evidence trail</span><small>{selected.sources.length} sources</small></div>{selected.sources.length ? selected.sources.map((source, index) => <a className="evidence" href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${index}`}><span className="evidence-icon"><Link2 size={15} /></span><div><strong>{source.label}</strong><p>{source.detail}</p><small>{source.capturedAt}</small></div><ArrowRight size={14} /></a>) : <div className="evidence-empty"><LoaderCircle size={18} /><span>No retained evidence for this record.</span></div>}</div><div className="detail-note"><CircleAlert size={16} /><p>Confirm outreach decisions against the linked source. Public contact data may become stale.</p></div><div className="detail-actions"><button className="button primary detail-action" type="button" onClick={() => void approveSelectedRecord()} disabled={approvedLeadIds.has(selected.id)}><Check size={17} />{approvedLeadIds.has(selected.id) ? "Approved" : "Approve record"}</button><button className="button danger detail-delete" type="button" disabled={deletingLeadId === selected.id} onClick={() => void removeLead(selected)}>{deletingLeadId === selected.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}Delete record</button></div></aside> : null}

      {uploadOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setUploadOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div className="modal-head"><div><span className="modal-icon"><UploadCloud size={20} /></span><div><p>New enrichment</p><h2 id="upload-title">Bring your owner data</h2></div></div><button type="button" onClick={() => setUploadOpen(false)} aria-label="Close import"><X size={19} /></button></div>{!parsed ? <><button className="dropzone" type="button" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFile(event.dataTransfer.files[0]); }}><span className="drop-icon"><FileSpreadsheet size={25} /></span><strong>{importState === "parsing" ? "Reading your dataset…" : "Drop a spreadsheet here"}</strong><span>or choose a file from your computer</span><small>CSV, TSV or XLSX · up to 25,000 rows</small><input ref={fileInput} type="file" accept=".csv,.tsv,.xlsx" hidden onChange={(event) => void handleFile(event.target.files?.[0])} /></button><div className="import-features"><span><ShieldCheck size={15} />Private by default</span><span><Sparkles size={15} />Smart column mapping</span><span><FileCheck2 size={15} />Duplicate-aware</span></div></> : <><div className="file-summary"><span className="file-icon"><FileSpreadsheet size={21} /></span><div><strong>{parsed.fileName}</strong><span>{parsed.rows.length.toLocaleString()} records · {parsed.headers.length} columns</span></div><button type="button" onClick={() => setParsed(null)}>Replace</button></div><div className="mapping-head"><div><h3>Column mapping</h3><span>We matched the fields needed for research.</span></div><span className="mapping-score"><BadgeCheck size={14} />{Object.values(parsed.mapping).filter(Boolean).length} matched</span></div><div className="mapping-grid">{Object.entries(parsed.mapping).map(([field, header]) => <label key={field}><span>{field.replace(/([A-Z])/g, " $1")}</span><select value={header ?? ""} onChange={(event) => setParsed((current) => current ? { ...current, mapping: { ...current.mapping, [field]: event.target.value || null } } : current)}><option value="">Not mapped</option>{parsed.headers.map((item) => <option key={item}>{item}</option>)}</select></label>)}</div><div className="preview-table"><div className="preview-row preview-header"><span>Owner</span><span>Property address</span><span>City</span></div>{datasetToLeads({ ...parsed, rows: parsed.rows.slice(0, 3) }).map((lead) => <div className="preview-row" key={lead.id}><span>{lead.owner}</span><span>{lead.address}</span><span>{lead.city || "—"}</span></div>)}</div><label className="budget-control"><span><strong>Maximum API spend</strong><small>The worker pauses before the next record when its tracked cost reaches this guardrail.</small></span><span className="budget-input"><b>$</b><input type="number" min="0.25" max="25" step="0.25" value={costLimitUsd} onChange={(event) => setCostLimitUsd(Math.min(25, Math.max(0.25, Number(event.target.value) || 0.25)))} /></span></label></>}{parseError ? <div className="form-error"><CircleAlert size={15} />{parseError}</div> : null}<div className="modal-foot"><p><ShieldCheck size={14} />{user ? "Private import · exact token and web-search fees tracked." : "Sign in is required before anything is saved."}</p><div><button className="button secondary" type="button" onClick={() => setUploadOpen(false)}>Cancel</button><button className="button primary" type="button" disabled={!parsed || importState === "saving"} onClick={() => void startImport()}>{importState === "saving" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}Start enrichment</button></div></div></section></div> : null}

      {authOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAuthOpen(false); }}><section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label="Close account"><X size={19} /></button><span className="auth-icon"><UserRound size={22} /></span><p className="modal-kicker">Acreline workspace</p><h2 id="auth-title">{user ? "Your private workspace." : "Come back to everything."}</h2><p className="auth-copy">{user ? "Your datasets, records, sources, reviews, and job history are isolated to this account." : "Sign in with Google or a secure email link. Every account gets a completely separate data boundary."}</p>{user ? <><div className="signed-in"><BadgeCheck size={18} /><div><span>Signed in as</span><strong>{user.email}</strong></div></div><button className="button secondary auth-submit" type="button" onClick={() => void signOut()}><LogOut size={17} />Sign out</button></> : <><button className="google-button" type="button" onClick={() => void signInWithGoogle()} disabled={authState === "oauth"}><span className="google-mark">G</span>{authState === "oauth" ? "Opening Google…" : "Continue with Google"}</button><div className="auth-divider"><span>or use email</span></div><form onSubmit={sendMagicLink}><label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label><button className="button primary auth-submit" type="submit" disabled={authState === "sending"}>{authState === "sending" ? <LoaderCircle className="spin" size={17} /> : <Mail size={17} />}{authState === "sent" ? "Check your inbox" : "Send secure sign-in link"}</button>{authState === "sent" ? <p className="auth-success"><Check size={14} />Magic link sent. You can close this window.</p> : null}{authState === "error" ? <p className="form-error"><CircleAlert size={14} />Sign-in could not start. Check the allowed redirect URLs and try again.</p> : null}</form></>}</section></div> : null}

      {toast ? <div className="toast"><BadgeCheck size={17} /><span>{toast}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss message"><X size={15} /></button></div> : null}
    </div>
  );
}
