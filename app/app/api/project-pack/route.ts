import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { fetchProjectCerts, packEntryName } from "@/lib/projectCerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOC_SERVICE_URL || "http://10.0.0.74:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_KEY ??
  "";

// GET /matl-cert/api/project-pack/?project=10305
// Streams a ZIP of every confirmed material cert PDF for the project, fetched
// server-side from the document service (no CORS, reachable on platform_net).
// document_matl_cert is RLS-protected, so the caller must forward their bearer
// token; we run the query as that authenticated user.
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project")?.trim();
  if (!project) {
    return NextResponse.json(
      { error: "project query parameter is required" },
      { status: 400 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "authentication required" },
      { status: 401 }
    );
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let certs;
  try {
    certs = await fetchProjectCerts(project, sb);
  } catch (e) {
    return NextResponse.json(
      { error: `query failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const withPdf = certs.filter((c) => c.filed_path);
  if (withPdf.length === 0) {
    return NextResponse.json(
      { error: `no certificate PDFs found for project ${project}` },
      { status: 404 }
    );
  }

  const zip = new JSZip();
  const failures: string[] = [];
  let added = 0;

  for (let i = 0; i < withPdf.length; i++) {
    const cert = withPdf[i];
    const url = `${DOC_SERVICE_URL}${cert.filed_path}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        failures.push(`${cert.filed_path} (HTTP ${resp.status})`);
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      zip.file(packEntryName(cert, i), buf);
      added++;
    } catch (e) {
      failures.push(`${cert.filed_path} (${(e as Error).message})`);
    }
  }

  if (added === 0) {
    return NextResponse.json(
      { error: "all PDF fetches failed", failures },
      { status: 502 }
    );
  }

  if (failures.length > 0) {
    // Note partial failures inside the pack so the audit trail is honest.
    zip.file(
      "_MISSING.txt",
      `These certificate PDFs could not be retrieved from the document service:\n\n${failures.join(
        "\n"
      )}\n`
    );
  }

  const content = await zip.generateAsync({ type: "nodebuffer" });
  const body = new Uint8Array(content);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="material-certs-project-${project}.zip"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
