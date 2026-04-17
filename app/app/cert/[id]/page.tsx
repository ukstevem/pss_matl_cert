"use client";

import { useAuth } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const DOC_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOC_SERVICE_URL || "http://10.0.0.74:3000";

interface Cert {
  id: string;
  status: string;
  po_id: string | null;
  scan_id: string | null;
  legacy_ref: string | null;
  legacy_project: string | null;
  created_at: string;
  purchase_orders: { po_number: string } | null;
  document_incoming_scan: {
    file_name: string;
    filed_path: string;
  } | null;
}

interface CertItem {
  id: string;
  description: string | null;
  created_at: string;
}

interface CandidatePO {
  id: string;
  po_number: string;
  current_revision: string | null;
  created_at: string;
  project_id: string | null;
  item_seq: string | null;
  suppliers: { name: string } | null;
  po_metadata: { test_certificates_required: boolean } | null;
}

export default function CertDetail() {
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const certId = params.id as string;

  const [cert, setCert] = useState<Cert | null>(null);
  const [items, setItems] = useState<CertItem[]>([]);
  const [candidates, setCandidates] = useState<CandidatePO[]>([]);
  const [allPOs, setAllPOs] = useState<{ id: string; po_number: string; supplier_name: string }[]>([]);
  const [showAllPOs, setShowAllPOs] = useState(false);
  const [selectedPo, setSelectedPo] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !certId) return;
    loadCert();
  }, [user, certId]);

  async function loadCert() {
    setLoading(true);

    const [certRes, itemsRes] = await Promise.all([
      supabase
        .from("document_matl_cert")
        .select(
          "*, purchase_orders ( po_number ), document_incoming_scan ( file_name, filed_path )"
        )
        .eq("id", certId)
        .single(),
      supabase
        .from("document_matl_cert_item")
        .select("*")
        .eq("matl_cert_id", certId)
        .order("created_at"),
    ]);

    if (certRes.data) {
      setCert(certRes.data as unknown as Cert);
      if (certRes.data.status === "pending") {
        loadCandidates();
      }
    }
    if (itemsRes.data) setItems(itemsRes.data);
    setLoading(false);
  }

  async function loadCandidates() {
    // Get recent POs, then check which have test_certificates_required
    const { data } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, po_number, current_revision, created_at, project_id, item_seq,
        suppliers ( name ),
        po_metadata ( test_certificates_required )
      `
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (data) {
      const typed = data as unknown as CandidatePO[];

      // Keep only latest revision per po_number
      const latestByPo = new Map<string, CandidatePO>();
      for (const po of typed) {
        const existing = latestByPo.get(String(po.po_number));
        if (
          !existing ||
          (po.current_revision || "") > (existing.current_revision || "")
        ) {
          latestByPo.set(String(po.po_number), po);
        }
      }

      // Filter to those with test_certificates_required
      // po_metadata is an object (1:1), not an array
      const filtered = Array.from(latestByPo.values()).filter((po) => {
        const meta = po.po_metadata as any;
        if (Array.isArray(meta)) return meta.some((m: any) => m.test_certificates_required);
        return meta?.test_certificates_required === true;
      });

      setCandidates(filtered);
    }
  }

  async function loadAllPOs() {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, po_number, current_revision, suppliers ( name )")
      .order("po_number", { ascending: false })
      .limit(2000);
    if (data) {
      // Keep only latest revision per po_number
      const latestByPo = new Map<string, any>();
      for (const po of data) {
        const existing = latestByPo.get(String(po.po_number));
        if (!existing || (po.current_revision || "") > (existing.current_revision || "")) {
          latestByPo.set(String(po.po_number), po);
        }
      }
      setAllPOs(
        Array.from(latestByPo.values()).map((po: any) => ({
          id: po.id,
          po_number: po.po_number,
          supplier_name: po.suppliers?.name?.trim() || "",
        }))
      );
    }
    setShowAllPOs(true);
  }

  async function assignPo(poId: string) {
    await supabase
      .from("document_matl_cert")
      .update({ po_id: poId, status: "confirmed" })
      .eq("id", certId);
    window.location.href = "/matl-cert/";
  }

  async function assignFromDropdown() {
    if (!selectedPo) return;
    await assignPo(selectedPo);
  }

  const pdfBase = cert?.document_incoming_scan?.filed_path
    ? `${DOC_SERVICE_URL}${cert.document_incoming_scan.filed_path}`
    : null;
  const pdfUrl = pdfBase ? `${pdfBase}#navpanes=0&scrollbar=1` : null;
  const pdfDownload = pdfBase;

  if (loading || !cert) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading certificate...</p>
      </div>
    );
  }

  async function unassignPo() {
    await supabase
      .from("document_matl_cert")
      .update({ po_id: null, status: "pending" })
      .eq("id", certId);
    loadCert();
  }

  // CONFIRMED VIEW — full PDF + metadata
  if (cert.status === "confirmed" && !showAllPOs) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <PageHeader title="Material Certificate" />
            <div className="text-sm">
              <span className="text-gray-500">PO:</span>{" "}
              <span className="font-mono font-medium">
                {cert.purchase_orders?.po_number || cert.legacy_ref || "—"}
              </span>
              <span className="text-gray-300 mx-2">|</span>
              <span className="text-gray-500">Date:</span>{" "}
              <span>{new Date(cert.created_at).toLocaleDateString("en-GB")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/matl-cert/"
              className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Back to Library
            </a>
            <button
              onClick={unassignPo}
              className="px-3 py-1.5 text-sm border rounded-lg hover:bg-amber-50 hover:border-amber-300 transition-colors"
            >
              Reassign PO
            </button>
            {pdfDownload && (
              <a
                href={pdfDownload}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm border rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Download PDF
              </a>
            )}
          </div>
        </div>

        {/* PDF viewer */}
        {pdfUrl ? (
          <div>
            <iframe
              src={pdfUrl}
              className="w-full border rounded-lg"
              style={{ height: "80vh" }}
              title="Material Certificate PDF"
            />
          </div>
        ) : (
          <p className="text-gray-400">No document available</p>
        )}
      </div>
    );
  }

  // PENDING VIEW — thumbnail + PO assignment
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="File Material Certificate" />
        <a
          href="/matl-cert/"
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ height: "70vh" }}>
        {/* Left: PDF viewer */}
        <div className="flex flex-col h-full">
          {pdfUrl ? (
            <>
              <iframe
                src={pdfUrl}
                className="w-full border rounded-lg flex-1"
                title="Material Certificate PDF"
              />
              <div className="flex items-center gap-4 mt-2">
                <a
                  href={pdfDownload || ""}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 underline"
                >
                  Open full size
                </a>
                {cert.legacy_ref && (
                  <span className="text-xs text-gray-400">
                    Legacy ref: <span className="font-mono">{cert.legacy_ref}</span>
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="border rounded-lg p-12 text-center text-gray-400 flex-1 flex items-center justify-center">
              No document available
            </div>
          )}
        </div>

        {/* Right: PO assignment */}
        <div className="flex flex-col h-full">
          <h2 className="text-lg font-semibold mb-2">Assign Purchase Order</h2>

          {/* Likely candidates — scrollable */}
          <div className="overflow-hidden flex flex-col">
            {candidates.length > 0 ? (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  Recent POs requiring material certificates ({candidates.length}):
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-auto" style={{ maxHeight: "380px" }}>
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="py-2 px-3 font-medium">PO</th>
                          <th className="py-2 px-3 font-medium">Supplier</th>
                          <th className="py-2 px-3 font-medium">Project</th>
                          <th className="py-2 px-3 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {candidates.map((po) => (
                          <tr
                            key={po.id}
                            className="hover:bg-blue-50 cursor-pointer transition-colors"
                            onClick={() => assignPo(po.id)}
                          >
                            <td className="py-2 px-3 font-mono text-blue-700">{po.po_number}</td>
                            <td className="py-2 px-3 text-gray-600 truncate max-w-[150px]">
                              {(po.suppliers as any)?.name?.trim() || "—"}
                            </td>
                            <td className="py-2 px-3">
                              {po.project_id
                                ? `${po.project_id}${po.item_seq ? `-${po.item_seq}` : ""}`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-gray-500 whitespace-nowrap">
                              {new Date(po.created_at).toLocaleDateString("en-GB")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center text-gray-400 text-sm border rounded-lg p-6">
                No recent POs with material certificates required
              </div>
            )}
          </div>

          {/* Dropdown fallback */}
          <div className="pt-2">
            {!showAllPOs ? (
              <button
                onClick={loadAllPOs}
                className="text-sm text-blue-600 underline"
              >
                PO not listed? Choose from all purchase orders...
              </button>
            ) : (
              <div className="flex gap-3">
                <select
                  value={selectedPo}
                  onChange={(e) => setSelectedPo(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">Select PO...</option>
                  {allPOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.po_number}{po.supplier_name ? ` — ${po.supplier_name}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={assignFromDropdown}
                  disabled={!selectedPo}
                  className="pss-btn text-sm"
                >
                  Assign
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
