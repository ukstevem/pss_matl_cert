import { supabase } from "@platform/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProjectCert {
  id: string;
  created_at: string;
  legacy_ref: string | null;
  // po_number is stored as an integer in purchase_orders.
  po_number: string | number | null;
  project_id: string | null;
  item_seq: string | null;
  file_name: string | null;
  filed_path: string | null;
}

interface RawRow {
  id: string;
  created_at: string;
  legacy_ref: string | null;
  purchase_orders: {
    po_number: string | number | null;
    project_id: string | null;
    item_seq: string | null;
  } | null;
  document_incoming_scan: {
    file_name: string | null;
    filed_path: string | null;
  } | null;
}

/**
 * Confirmed material certs belonging to a project, matched via the assigned
 * purchase order. `purchase_orders.project_id` is the project number string
 * itself (FK fk_po_project_item → project_register_items.projectnumber), so we
 * filter the embedded PO directly with an inner join.
 *
 * `document_matl_cert` is RLS-protected (authenticated role only), so a client
 * carrying the user's session must be supplied. Defaults to the shared browser
 * client; the API route passes a client built from the forwarded user token.
 */
export async function fetchProjectCerts(
  project: string,
  client: SupabaseClient = supabase
): Promise<ProjectCert[]> {
  const trimmed = project.trim();
  if (!trimmed) return [];

  const { data, error } = await client
    .from("document_matl_cert")
    .select(
      `id, created_at, legacy_ref,
       purchase_orders!inner ( po_number, project_id, item_seq ),
       document_incoming_scan ( file_name, filed_path )`
    )
    .eq("status", "confirmed")
    .eq("purchase_orders.project_id", trimmed)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawRow[];
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    legacy_ref: r.legacy_ref,
    po_number: r.purchase_orders?.po_number ?? null,
    project_id: r.purchase_orders?.project_id ?? null,
    item_seq: r.purchase_orders?.item_seq ?? null,
    file_name: r.document_incoming_scan?.file_name ?? null,
    filed_path: r.document_incoming_scan?.filed_path ?? null,
  }));
}

/**
 * Stable, human-readable, collision-free filename for a cert PDF inside the
 * pack. Prefixed with a 1-based index so order is preserved and duplicates
 * (same PO + date) can't clash.
 */
export function packEntryName(cert: ProjectCert, index: number): string {
  const seq = String(index + 1).padStart(3, "0");
  const ref = String(cert.po_number ?? cert.legacy_ref ?? "cert").replace(
    /[^A-Za-z0-9_-]+/g,
    "-"
  );
  const date = cert.created_at ? cert.created_at.slice(0, 10) : "nodate";
  return `${seq}_${ref}_${date}.pdf`;
}
