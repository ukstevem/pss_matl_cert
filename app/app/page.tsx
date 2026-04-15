"use client";

import { useAuth } from "@platform/auth";
import { AuthButton } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState } from "react";

interface CertRow {
  id: string;
  status: string;
  created_at: string;
  legacy_ref: string | null;
  purchase_orders: {
    po_number: string;
    project_register_items: {
      projectnumber: string;
      item_seq: string;
    } | null;
  } | null;
  document_incoming_scan: {
    file_name: string;
    filed_path: string;
  } | null;
  document_matl_cert_item: {
    id: string;
    description: string;
  }[];
}

export default function CertLibrary() {
  const { user, loading: authLoading } = useAuth();
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    loadCerts();
  }, [user]);

  async function loadCerts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("document_matl_cert")
      .select(`
        id, status, created_at, legacy_ref,
        purchase_orders ( po_number, project_register_items ( projectnumber, item_seq ) ),
        document_incoming_scan ( file_name, filed_path, type_code, document_type ),
        document_matl_cert_item ( id, description )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) setCerts(data as unknown as CertRow[]);
    setLoading(false);
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--pss-navy)" }}>
          Material Certificates
        </h1>
        <p className="text-gray-600">Sign in to continue</p>
        <AuthButton redirectTo="/matl-cert/" />
      </div>
    );
  }

  const filtered = certs.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const po = c.purchase_orders?.po_number?.toLowerCase() || "";
    const legacyPo = c.legacy_ref?.toLowerCase() || "";
    const desc = c.document_matl_cert_item?.[0]?.description?.toLowerCase() || "";
    const file = c.document_incoming_scan?.filed_path?.split("/").pop()?.toLowerCase() || "";
    return po.includes(s) || legacyPo.includes(s) || desc.includes(s) || file.includes(s);
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Material Certificate Library" />

      <div className="flex gap-4 items-center">
        <input
          type="text"
          placeholder="Search by PO, description, or file name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-500">{filtered.length} certs</span>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading certificates...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left">
                <th className="py-3 px-4 font-semibold">Date</th>
                <th className="py-3 px-4 font-semibold">PO</th>
                <th className="py-3 px-4 font-semibold">Project</th>
                <th className="py-3 px-4 font-semibold">Items</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Document</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cert) => (
                <tr
                  key={cert.id}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => (window.location.href = `/matl-cert/cert/${cert.id}/`)}
                >
                  <td className="py-3 px-4 text-gray-600">
                    {new Date(cert.created_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="py-3 px-4 font-mono">
                    {cert.purchase_orders?.po_number || (
                      cert.legacy_ref ? (
                        <span className="text-gray-400" title="Legacy PO ref">{cert.legacy_ref}</span>
                      ) : "—"
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {cert.purchase_orders?.project_register_items
                      ? `${cert.purchase_orders.project_register_items.projectnumber}-${cert.purchase_orders.project_register_items.item_seq}`
                      : "—"}
                  </td>
                  <td className="py-3 px-4">
                    {cert.document_matl_cert_item?.length || 0} item(s)
                    {cert.document_matl_cert_item?.[0]?.description && (
                      <span className="text-gray-400 ml-2">
                        — {cert.document_matl_cert_item[0].description}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        cert.status === "confirmed"
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {cert.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs truncate max-w-[200px]">
                    {cert.document_incoming_scan?.filed_path?.split("/").pop() || cert.document_incoming_scan?.file_name || "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No certificates found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
