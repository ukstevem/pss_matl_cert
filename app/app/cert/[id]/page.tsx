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
  created_at: string;
  project_id: string | null;
  item_seq: string | null;
  suppliers: { name: string } | null;
  po_metadata: { test_certificates_required: boolean }[];
}

export default function CertDetail() {
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const certId = params.id as string;

  const [cert, setCert] = useState<Cert | null>(null);
  const [items, setItems] = useState<CertItem[]>([]);
  const [candidates, setCandidates] = useState<CandidatePO[]>([]);
  const [allPOs, setAllPOs] = useState<{ id: string; po_number: string }[]>([]);
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
    // Get POs from last 2 weeks where test_certificates_required = true
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const { data } = await supabase
      .from("purchase_orders")
      .select(
        `
        id, po_number, created_at, project_id, item_seq,
        suppliers ( name ),
        po_metadata ( test_certificates_required )
      `
      )
      .gte("created_at", twoWeeksAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (data) {
      // Filter to only those with test_certificates_required
      const filtered = (data as unknown as CandidatePO[]).filter((po) =>
        po.po_metadata?.some((m) => m.test_certificates_required === true)
      );
      setCandidates(filtered);
    }
  }

  async function loadAllPOs() {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, po_number")
      .order("po_number", { ascending: false })
      .limit(500);
    if (data) setAllPOs(data);
    setShowAllPOs(true);
  }

  async function assignPo(poId: string) {
    await supabase
      .from("document_matl_cert")
      .update({ po_id: poId, status: "confirmed" })
      .eq("id", certId);
    loadCert();
  }

  async function assignFromDropdown() {
    if (!selectedPo) return;
    await assignPo(selectedPo);
  }

  const pdfUrl = cert?.document_incoming_scan?.filed_path
    ? `${DOC_SERVICE_URL}${cert.document_incoming_scan.filed_path}`
    : null;

  if (loading || !cert) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading certificate...</p>
      </div>
    );
  }

  // CONFIRMED VIEW — full PDF + metadata
  if (cert.status === "confirmed") {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <PageHeader title="Material Certificate" />

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">PO Number</span>
            <p className="font-mono font-medium">
              {cert.purchase_orders?.po_number || cert.legacy_ref || "—"}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Project</span>
            <p className="font-medium">{cert.legacy_project || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Date</span>
            <p>{new Date(cert.created_at).toLocaleDateString("en-GB")}</p>
          </div>
        </div>

        {items.length > 0 && (
          <div className="text-sm">
            <span className="text-gray-500">Material</span>
            <p>
              {items.map((i) => i.description).filter(Boolean).join(", ") || "—"}
            </p>
          </div>
        )}

        {/* PDF viewer */}
        {pdfUrl ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pss-btn text-sm"
              >
                Download PDF
              </a>
            </div>
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
      <PageHeader title="File Material Certificate" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: PDF thumbnail */}
        <div>
          {pdfUrl ? (
            <div className="space-y-2">
              <iframe
                src={pdfUrl}
                className="w-full border rounded-lg"
                style={{ height: "400px" }}
                title="Material Certificate PDF"
              />
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 underline"
              >
                Open full size
              </a>
            </div>
          ) : (
            <div className="border rounded-lg p-12 text-center text-gray-400">
              No document available
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-4 text-sm">
              <span className="text-gray-500">Material description</span>
              <p className="mt-1">
                {items.map((i) => i.description).filter(Boolean).join(", ") || "—"}
              </p>
            </div>
          )}

          {cert.legacy_ref && (
            <div className="mt-2 text-sm">
              <span className="text-gray-500">Legacy PO ref</span>
              <p className="font-mono mt-1">{cert.legacy_ref}</p>
            </div>
          )}
        </div>

        {/* Right: PO assignment */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Assign Purchase Order</h2>

          {/* Likely candidates */}
          {candidates.length > 0 ? (
            <div>
              <p className="text-sm text-gray-500 mb-2">
                Recent POs requiring material certificates:
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b text-left">
                      <th className="py-2 px-3">PO</th>
                      <th className="py-2 px-3">Supplier</th>
                      <th className="py-2 px-3">Project</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((po) => (
                      <tr
                        key={po.id}
                        className="border-b border-gray-50 hover:bg-blue-50"
                      >
                        <td className="py-2 px-3 font-mono">{po.po_number}</td>
                        <td className="py-2 px-3 text-gray-600">
                          {po.suppliers?.name || "—"}
                        </td>
                        <td className="py-2 px-3">
                          {po.project_id
                            ? `${po.project_id}${po.item_seq ? `-${po.item_seq}` : ""}`
                            : "—"}
                        </td>
                        <td className="py-2 px-3 text-gray-500">
                          {new Date(po.created_at).toLocaleDateString("en-GB")}
                        </td>
                        <td className="py-2 px-3">
                          <button
                            onClick={() => assignPo(po.id)}
                            className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              No recent POs with material certificates required
            </p>
          )}

          {/* Divider */}
          <div className="border-t pt-4">
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
                      {po.po_number}
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
