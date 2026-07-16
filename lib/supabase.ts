import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DatasetSummary, EnrichmentJob, ParsedDataset, PropertyLead } from "./types";

let client: SupabaseClient | null | undefined;

type LeadRow = {
  id: string;
  dataset_id: string;
  owner_name: string;
  property_address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  property_type: string | null;
  email: string | null;
  phone: string | null;
  confidence: number | string | null;
  status: string;
  enriched_at: string | null;
  sources: Array<{
    source_url: string;
    source_domain: string;
    title: string | null;
    snippet: string | null;
    captured_at: string | null;
  }>;
};

export function getSupabaseClient() {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

export async function loadPropertyLeads(): Promise<PropertyLead[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const rows: LeadRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 25_000; from += pageSize) {
    const { data, error } = await supabase
      .from("leads")
      .select("*,sources(source_url,source_domain,title,snippet,captured_at)")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as LeadRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows.map((row) => ({
    id: row.id,
    datasetId: row.dataset_id,
    owner: row.owner_name,
    address: row.property_address ?? "Address not provided",
    city: row.city ?? "",
    province: row.province ?? "",
    postalCode: row.postal_code ?? "",
    email: row.email,
    phone: row.phone,
    propertyType: row.property_type ?? "Unknown",
    confidence: Number(row.confidence ?? 0),
    status: row.status === "verified" ? "verified" : row.status === "researching" ? "reviewing" : row.status === "queued" ? "queued" : "attention",
    updatedAt: row.enriched_at ? new Date(row.enriched_at).toLocaleString() : "Queued",
    sources: (row.sources ?? []).map((source) => ({
      label: source.title || source.source_domain || "Public source",
      url: source.source_url,
      detail: source.snippet || "Source evidence captured",
      capturedAt: source.captured_at ? new Date(source.captured_at).toLocaleString() : "Captured",
    })),
  }));
}

export async function loadDatasets(): Promise<DatasetSummary[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("datasets")
    .select("id,name,row_count,processed_count,matched_count,status,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    rowCount: row.row_count,
    processedCount: row.processed_count,
    matchedCount: row.matched_count,
    status: row.status,
    createdAt: new Date(row.created_at).toLocaleString(),
  }));
}

export async function loadEnrichmentJobs(): Promise<EnrichmentJob[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("enrichment_jobs")
    .select("id,dataset_id,status,rows_total,rows_completed,rows_failed,estimated_cost_usd,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    datasetId: row.dataset_id,
    status: row.status,
    rowsTotal: row.rows_total,
    rowsCompleted: row.rows_completed,
    rowsFailed: row.rows_failed,
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    createdAt: new Date(row.created_at).toLocaleString(),
  }));
}

export async function updateLeadReview(leadId: string, reviewState: "approved" | "rejected") {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sign in to review records.");
  const { error } = await supabase
    .from("leads")
    .update({ review_state: reviewState, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function updateEnrichmentJob(jobId: string, status: "running" | "paused" | "cancelled") {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sign in to manage enrichment jobs.");
  const { error } = await supabase
    .from("enrichment_jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function deleteDataset(datasetId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sign in to manage datasets.");
  const { data: dataset, error: readError } = await supabase
    .from("datasets")
    .select("storage_path")
    .eq("id", datasetId)
    .eq("user_id", auth.user.id)
    .single();
  if (readError) throw readError;
  if (dataset.storage_path) await supabase.storage.from("imports").remove([dataset.storage_path]);
  const { error } = await supabase.from("datasets").delete().eq("id", datasetId).eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function persistDataset(dataset: ParsedDataset, leads: PropertyLead[]) {
  const supabase = getSupabaseClient();
  if (!supabase) return { mode: "demo" as const };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { mode: "signed-out" as const };

  const { data: created, error } = await supabase.from("datasets").insert({
    user_id: auth.user.id,
    name: dataset.fileName,
    row_count: leads.length,
    mapped_columns: dataset.mapping,
    status: "queued",
  }).select("id").single();
  if (error) throw error;

  const safeFileName = dataset.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
  const storagePath = `${auth.user.id}/${created.id}/${safeFileName}`;
  const { error: uploadError } = await supabase.storage.from("imports").upload(storagePath, dataset.file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    await supabase.from("datasets").delete().eq("id", created.id);
    throw uploadError;
  }
  const { error: pathError } = await supabase.from("datasets").update({ storage_path: storagePath }).eq("id", created.id);
  if (pathError) throw pathError;

  const payload = leads.map((lead, index) => ({
    dataset_id: created.id,
    user_id: auth.user!.id,
    row_number: index + 2,
    owner_name: lead.owner,
    property_address: lead.address,
    city: lead.city,
    province: lead.province,
    postal_code: lead.postalCode,
    phone: lead.phone,
    email: lead.email,
    property_type: lead.propertyType,
    confidence: lead.confidence,
    status: lead.status,
    raw_data: dataset.rows[index],
  }));

  for (let start = 0; start < payload.length; start += 500) {
    const { error: insertError } = await supabase.from("leads").insert(payload.slice(start, start + 500));
    if (insertError) throw insertError;
  }
  const { data: job, error: jobError } = await supabase.from("enrichment_jobs").insert({
    dataset_id: created.id,
    user_id: auth.user.id,
    status: "queued",
    model: "gpt-5.6-luna",
    rows_total: leads.length,
    configuration: { max_records: leads.length, source_limit: 5, public_web_only: true },
  }).select("id").single();
  if (jobError) throw jobError;
  const { data: session } = await supabase.auth.getSession();
  let workerStarted = false;
  let workerError: string | null = null;
  if (session.session?.access_token) {
    try {
      const response = await fetch(`/api/jobs/${job.id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });
      workerStarted = response.ok;
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        workerError = body?.error ?? "The enrichment worker could not start.";
      }
    } catch {
      workerError = "The enrichment worker could not be reached.";
    }
  } else {
    workerError = "Your session expired before the worker could start.";
  }
  return { mode: "saved" as const, datasetId: created.id, workerStarted, workerError };
}
