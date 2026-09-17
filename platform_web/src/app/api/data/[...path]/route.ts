import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_VERSION = "6.5.0";

function upstream(): string | null {
  const configured = (process.env.NUNES_API_INTERNAL_URL || process.env.NUNES_API_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  // Local/office mode keeps the existing private data service default.
  if (!process.env.VERCEL) return "http://127.0.0.1:8766";
  // Never silently point a Vercel function at its own localhost. That produces a
  // deployment that looks healthy while all company records are unavailable.
  return null;
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const base = upstream();
  if (!base) {
    return NextResponse.json(
      {
        error: "Persistent company data service is not configured",
        code: "DATA_BACKEND_NOT_CONFIGURED",
        help: "Set NUNES_API_INTERNAL_URL (or NUNES_API_URL) to the HTTPS URL of the persistent NUNES data service."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const { path } = await ctx.params;
  const safePath = path.map(encodeURIComponent).join("/");
  const url = `${base}/api/${safePath}${req.nextUrl.search}`;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const dataToken = (process.env.NUNES_DATA_API_TOKEN || "").trim();
  if (dataToken) headers.set("authorization", `Bearer ${dataToken}`);
  headers.set("x-nunes-platform-version", PLATFORM_VERSION);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2800);
  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
    signal: controller.signal,
  };
  if (!["GET", "HEAD"].includes(req.method)) init.body = await req.text();

  try {
    const res = await fetch(url, init);
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-nunes-data-backend": "persistent",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Company data service is unavailable", detail },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
