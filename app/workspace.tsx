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
  Mail,
  MoreHorizontal,
  Pause,
  Phone,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { datasetToLeads, parseDataset } from "@/lib/import-dataset";
import { sampleLeads } from "@/lib/sample-data";
import { getSupabaseClient, loadPropertyLeads, persistDataset } from "@/lib/supabase";
import type { LeadStatus, ParsedDataset, PropertyLead } from "@/lib/types";

const nav = [
  { label: "Overview", icon: Gauge, active: true },
  { label: "Enrichment", icon: WandSparkles, count: 18 },
  { label: "Datasets", icon: Database },
  { label: "Exports", icon: ArrowDownToLine },
];

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
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
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
        <span>{value ? `${value}` : "—"}</span>
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
      <MoreHorizontal className="metric-more" size={18} />
    </article>
  );
}

export function Workspace() {
  const [leads, setLeads] = useState(sampleLeads);
  const [selected, setSelected] = useState<PropertyLead | null>(sampleLeads[0]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [parsed, setParsed] = useState<ParsedDataset | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importState, setImportState] = useState<"idle" | "parsing" | "saving">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const hydrate = async (activeEmail?: string | null) => {
      setUserEmail(activeEmail ?? null);
      if (!activeEmail) return;
      try {
        const savedLeads = await loadPropertyLeads();
        if (savedLeads.length) {
          setLeads(savedLeads);
          setSelected(savedLeads[0]);
        }
      } catch {
        setToast("Your saved records could not be refreshed. The preview remains available.");
      }
    };
    supabase.auth.getUser().then(({ data }) => void hydrate(data.user?.email));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => void hydrate(session?.user.email));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!userEmail) return;
    const timer = window.setInterval(() => {
      void loadPropertyLeads().then((savedLeads) => {
        if (savedLeads.length) {
          setLeads(savedLeads);
          setSelected((current) => savedLeads.find((lead) => lead.id === current?.id) ?? current);
        }
      }).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [userEmail]);

  const visibleLeads = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return leads.filter((lead) => {
      const matchesFilter = filter === "all" || lead.status === filter;
      const haystack = `${lead.owner} ${lead.address} ${lead.city} ${lead.email ?? ""} ${lead.phone ?? ""}`.toLowerCase();
      return matchesFilter && (!needle || haystack.includes(needle));
    });
  }, [filter, leads, search]);

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
    const imported = datasetToLeads(parsed);
    setImportState("saving");
    try {
      const result = await persistDataset(parsed, imported);
      setLeads((current) => [...imported, ...current]);
      setSelected(imported[0] ?? null);
      setUploadOpen(false);
      setParsed(null);
      setToast(result.mode === "saved"
        ? `${imported.length.toLocaleString()} records saved and queued for enrichment.`
        : `${imported.length.toLocaleString()} records loaded in preview mode. Sign in to save them.`);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "The dataset could not be saved.");
    } finally {
      setImportState("idle");
    }
  }

  function exportCsv() {
    const headers = ["Owner", "Property address", "City", "Province", "Postal code", "Email", "Phone", "Property type", "Confidence", "Status", "Source URLs"];
    const body = visibleLeads.map((lead) => [
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
    setToast(`Exported ${visibleLeads.length} source-backed records.`);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Layers3 size={19} strokeWidth={2.4} /></div><span>Acreline</span></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {nav.map(({ label, icon: Icon, active, count }) => (
            <button key={label} className={`nav-item ${active ? "nav-active" : ""}`} type="button">
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>{count ? <b>{count}</b> : null}
            </button>
          ))}
          <p className="nav-label nav-section">Manage</p>
          <button className="nav-item" type="button"><UsersRound size={18} /><span>Team</span></button>
          <button className="nav-item" type="button"><Settings2 size={18} /><span>Settings</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <ShieldCheck size={18} />
          <div><strong>Public-web only</strong><span>Every finding includes its source and capture time.</span></div>
        </div>
        <button className="profile" type="button" onClick={() => setAuthOpen(true)}>
          <span className="profile-avatar">AM</span>
          <span><strong>{userEmail ? userEmail.split("@")[0] : "Avery Morgan"}</strong><small>{userEmail ?? "Demo workspace"}</small></span>
          <ChevronDown size={15} />
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p>Property Partners</p><span>/</span><strong>Owner intelligence</strong></div>
          <div className="top-actions">
            <button className="command-search" type="button" onClick={() => document.getElementById("record-search")?.focus()}>
              <Search size={15} /><span>Search workspace</span><kbd><Command size={11} /> K</kbd>
            </button>
            <button className="icon-button" type="button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <button className="avatar-button" type="button" onClick={() => setAuthOpen(true)} aria-label="Open account">AM</button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div><div className="eyebrow"><span className="live-dot" />Live workspace</div><h1>Property intelligence,<br /><em>with receipts.</em></h1><p>Turn raw owner records into verified contacts with confidence scores and a source trail your team can trust.</p></div>
            <div className="heading-actions">
              <button className="button secondary" type="button" onClick={exportCsv}><ArrowDownToLine size={17} />Export</button>
              <button className="button primary" type="button" onClick={() => setUploadOpen(true)}><Plus size={18} />New enrichment</button>
            </div>
          </section>

          <section className="metrics" aria-label="Workspace metrics">
            <MetricCard label="Records processed" value="12,842" detail="+2,406 this week" icon={FileCheck2} tone="violet" />
            <MetricCard label="Verified contacts" value="8,974" detail="69.9% match rate" icon={BadgeCheck} tone="green" />
            <MetricCard label="Avg. confidence" value="87.4%" detail="+4.2 points" icon={Activity} tone="blue" />
            <MetricCard label="Est. cost / record" value="$0.014" detail="31% under target" icon={Sparkles} tone="amber" />
          </section>

          <section className="run-card">
            <div className="run-main">
              <div className="run-title">
                <span className="run-icon"><Globe2 size={20} /></span>
                <div><span className="section-kicker">Active enrichment</span><h2>Toronto owner portfolio — July</h2></div>
              </div>
              <div className="run-stats"><strong>{running ? "64%" : "Paused"}</strong><span>8,216 of 12,842 records</span></div>
              <div className="progress"><span style={{ width: running ? "64%" : "64%" }} /></div>
              <div className="run-foot"><span><span className={`pulse ${running ? "" : "pulse-paused"}`} />{running ? "12 workers researching public sources" : "Workers safely paused"}</span><span>~38 min remaining</span></div>
            </div>
            <button className="pause-button" type="button" onClick={() => setRunning((value) => !value)} aria-label={running ? "Pause enrichment" : "Resume enrichment"}>
              {running ? <Pause size={17} /> : <Play size={17} />}
            </button>
          </section>

          <section className="records-card">
            <div className="records-head">
              <div><h2>Owner records</h2><span>{leads.length.toLocaleString()} in this view</span></div>
              <div className="records-tools">
                <label className="table-search"><Search size={15} /><input id="record-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search owners, addresses, contacts…" /></label>
                <div className="filter-wrap"><ListFilter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter records"><option value="all">All records</option><option value="verified">Verified</option><option value="reviewing">Researching</option><option value="queued">Queued</option><option value="attention">Needs review</option></select></div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th><span className="fake-check" /></th><th>Owner & property</th><th>Contact found</th><th>Confidence</th><th>Status</th><th>Sources</th><th /></tr></thead>
                <tbody>
                  {visibleLeads.map((lead) => (
                    <tr key={lead.id} onClick={() => setSelected(lead)} className={selected?.id === lead.id ? "row-selected" : ""}>
                      <td><span className="fake-check" /></td>
                      <td><div className="owner-cell"><span className="owner-avatar">{initials(lead.owner)}</span><div><strong>{lead.owner}</strong><span>{lead.address}{lead.city ? ` · ${lead.city}` : ""}</span></div></div></td>
                      <td><div className="contact-cell">{lead.email ? <span><Mail size={13} />{lead.email}</span> : null}{lead.phone ? <span><Phone size={13} />{lead.phone}</span> : null}{!lead.email && !lead.phone ? <span className="muted-contact">Not found yet</span> : null}</div></td>
                      <td><Confidence value={lead.confidence} /></td>
                      <td><StatusBadge status={lead.status} /></td>
                      <td><div className="source-stack">{lead.sources.slice(0, 3).map((source) => <span key={source.label} title={source.label}>{source.label[0]}</span>)}{lead.sources.length ? <small>{lead.sources.length}</small> : <small>—</small>}</div></td>
                      <td><button className="row-action" type="button" aria-label={`Open ${lead.owner}`}><ArrowRight size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleLeads.length ? <div className="empty-table"><Inbox size={26} /><strong>No matching records</strong><span>Try a different search or filter.</span></div> : null}
            </div>
            <div className="table-foot"><span>Showing {visibleLeads.length} of {leads.length}</span><div><button type="button" disabled>Previous</button><button type="button">Next</button></div></div>
          </section>

          <section className="principles">
            <ShieldCheck size={18} /><p><strong>Built for responsible research.</strong> Acreline blocks private-network targets, honors workspace allowlists, keeps source URLs, and routes uncertain identity matches to a human.</p><a href="https://github.com/D4Vinci/Scrapling" target="_blank" rel="noreferrer">Scraping engine <ArrowRight size={13} /></a>
          </section>
        </div>
      </main>

      {selected ? (
        <aside className="detail-panel" aria-label="Record detail">
          <div className="detail-top"><span>Record intelligence</span><button type="button" onClick={() => setSelected(null)} aria-label="Close detail"><X size={18} /></button></div>
          <div className="detail-identity"><span className="detail-avatar">{initials(selected.owner)}</span><div><h2>{selected.owner}</h2><p>{selected.address}<br />{[selected.city, selected.province, selected.postalCode].filter(Boolean).join(", ")}</p></div></div>
          <div className="detail-score"><div><span>Identity confidence</span><strong>{selected.confidence || "—"}<small>{selected.confidence ? "%" : ""}</small></strong></div><div className="score-track"><span style={{ width: `${selected.confidence}%` }} /></div><p>{selected.confidence >= 85 ? "Strong agreement across independent public sources." : selected.confidence >= 60 ? "Useful signals found; review before outreach." : "Not enough evidence to confirm this identity."}</p></div>
          <div className="detail-section"><div className="detail-label"><span>Contact points</span><StatusBadge status={selected.status} /></div><div className="contact-box"><Mail size={16} /><div><span>Best email</span><strong>{selected.email ?? "Still researching"}</strong></div>{selected.email ? <BadgeCheck size={16} className="verified-icon" /> : <Clock3 size={16} />}</div><div className="contact-box"><Phone size={16} /><div><span>Phone</span><strong>{selected.phone ?? "Not found"}</strong></div></div></div>
          <div className="detail-section evidence-section"><div className="detail-label"><span>Evidence trail</span><small>{selected.sources.length} sources</small></div>{selected.sources.length ? selected.sources.map((source, index) => <a className="evidence" href={source.url} target="_blank" rel="noreferrer" key={`${source.label}-${index}`}><span className="evidence-icon"><Link2 size={15} /></span><div><strong>{source.label}</strong><p>{source.detail}</p><small>{source.capturedAt}</small></div><ArrowRight size={14} /></a>) : <div className="evidence-empty"><LoaderCircle size={18} /><span>Research begins when this record reaches a worker.</span></div>}</div>
          <div className="detail-note"><CircleAlert size={16} /><p>Confirm high-impact outreach decisions against the linked source. Public contact data may become stale.</p></div>
          <button className="button primary detail-action" type="button"><Check size={17} />Approve record</button>
        </aside>
      ) : null}

      {uploadOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setUploadOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
            <div className="modal-head"><div><span className="modal-icon"><UploadCloud size={20} /></span><div><p>New enrichment</p><h2 id="upload-title">Bring your owner data</h2></div></div><button type="button" onClick={() => setUploadOpen(false)}><X size={19} /></button></div>
            {!parsed ? <>
              <button className="dropzone" type="button" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleFile(event.dataTransfer.files[0]); }}>
                <span className="drop-icon"><FileSpreadsheet size={25} /></span><strong>{importState === "parsing" ? "Reading your dataset…" : "Drop a spreadsheet here"}</strong><span>or choose a file from your computer</span><small>CSV, TSV or XLSX · up to 25,000 rows</small>
                <input ref={fileInput} type="file" accept=".csv,.tsv,.xlsx" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
              </button>
              <div className="import-features"><span><ShieldCheck size={15} />Private by default</span><span><Sparkles size={15} />Smart column mapping</span><span><FileCheck2 size={15} />Duplicate-aware</span></div>
            </> : <>
              <div className="file-summary"><span className="file-icon"><FileSpreadsheet size={21} /></span><div><strong>{parsed.fileName}</strong><span>{parsed.rows.length.toLocaleString()} records · {parsed.headers.length} columns</span></div><button type="button" onClick={() => setParsed(null)}>Replace</button></div>
              <div className="mapping-head"><div><h3>Column mapping</h3><span>We matched the fields needed for research.</span></div><span className="mapping-score"><BadgeCheck size={14} />{Object.values(parsed.mapping).filter(Boolean).length} matched</span></div>
              <div className="mapping-grid">{Object.entries(parsed.mapping).map(([field, header]) => <label key={field}><span>{field.replace(/([A-Z])/g, " $1")}</span><select value={header ?? ""} onChange={(event) => setParsed((current) => current ? { ...current, mapping: { ...current.mapping, [field]: event.target.value || null } } : current)}><option value="">Not mapped</option>{parsed.headers.map((item) => <option key={item}>{item}</option>)}</select></label>)}</div>
              <div className="preview-table"><div className="preview-row preview-header"><span>Owner</span><span>Property address</span><span>City</span></div>{datasetToLeads({ ...parsed, rows: parsed.rows.slice(0, 3) }).map((lead) => <div className="preview-row" key={lead.id}><span>{lead.owner}</span><span>{lead.address}</span><span>{lead.city || "—"}</span></div>)}</div>
            </>}
            {parseError ? <div className="form-error"><CircleAlert size={15} />{parseError}</div> : null}
            <div className="modal-foot"><p><ShieldCheck size={14} />Only public sources will be queried.</p><div><button className="button secondary" type="button" onClick={() => setUploadOpen(false)}>Cancel</button><button className="button primary" type="button" disabled={!parsed || importState === "saving"} onClick={() => void startImport()}>{importState === "saving" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}Start enrichment</button></div></div>
          </section>
        </div>
      ) : null}

      {authOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAuthOpen(false); }}>
          <section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="modal-close" type="button" onClick={() => setAuthOpen(false)}><X size={19} /></button>
            <span className="auth-icon"><UserRound size={22} /></span><p className="modal-kicker">Acreline workspace</p><h2 id="auth-title">Keep every dataset private.</h2><p className="auth-copy">Sign in with a secure email link. Your records are isolated by workspace-level database policies.</p>
            {userEmail ? <div className="signed-in"><BadgeCheck size={18} /><div><span>Signed in as</span><strong>{userEmail}</strong></div></div> : <form onSubmit={sendMagicLink}><label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label><button className="button primary auth-submit" type="submit" disabled={authState === "sending"}>{authState === "sending" ? <LoaderCircle className="spin" size={17} /> : <Mail size={17} />}{authState === "sent" ? "Check your inbox" : "Send secure sign-in link"}</button>{authState === "sent" ? <p className="auth-success"><Check size={14} />Magic link sent. You can close this window.</p> : null}{authState === "error" ? <p className="form-error"><CircleAlert size={14} />Sign-in is unavailable until the app environment is configured.</p> : null}</form>}
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast"><BadgeCheck size={17} /><span>{toast}</span><button type="button" onClick={() => setToast(null)}><X size={15} /></button></div> : null}
    </div>
  );
}
