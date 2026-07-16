import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!UUID.test(id) || !token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "Backend unavailable" }, { status: 503 });

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: job, error: jobError } = await supabase.from("enrichment_jobs").select("id,user_id,status").eq("id", id).single();
  if (jobError || !job || job.user_id !== auth.user.id) return Response.json({ error: "Job not found" }, { status: 404 });
  if (!['queued', 'paused', 'failed'].includes(job.status)) return Response.json({ error: "Job cannot be started" }, { status: 409 });

  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SHARED_SECRET;
  if (!workerUrl || !workerSecret) {
    return Response.json({ error: "Enrichment worker is not configured" }, { status: 503 });
  }

  try {
    const workerResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/jobs/${id}/run`, {
      method: "POST",
      headers: { "X-Worker-Secret": workerSecret },
      signal: AbortSignal.timeout(15_000),
    });
    if (!workerResponse.ok) {
      return Response.json({ error: "Worker could not claim the job" }, { status: 502 });
    }
    return Response.json({ status: "running" }, { status: 202 });
  } catch {
    return Response.json({ error: "Enrichment worker is unreachable" }, { status: 502 });
  }
}
