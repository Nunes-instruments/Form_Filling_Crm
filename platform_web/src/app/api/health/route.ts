import { NextResponse } from "next/server";
import { NUNES_ROLLOUT_ID } from "@/lib/rollout-id";

export const dynamic = "force-dynamic";

export async function GET() {
  const dataBackendConfigured = Boolean(
    (process.env.NUNES_API_INTERNAL_URL || process.env.NUNES_API_URL || "").trim()
  ) || !process.env.VERCEL;

  return NextResponse.json(
    {
      ok: true,
      product: "NUNES Company Platform",
      version: "6.6.6",
      update_id: NUNES_ROLLOUT_ID,
      architecture: "Next.js",
      deployment: process.env.VERCEL ? "vercel" : "local-or-cloud-vm",
      data_backend_configured: dataBackendConfigured,
      data_api_token_configured: Boolean((process.env.NUNES_DATA_API_TOKEN || "").trim()) || !process.env.VERCEL,
      data_persistence: process.env.VERCEL ? "external-required" : "local-persistent-service",
      git_commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
