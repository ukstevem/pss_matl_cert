"use client";

import { useAuth } from "@platform/auth";
import { AuthButton } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useRef, useCallback } from "react";

const DOC_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOC_SERVICE_URL || "http://10.0.0.74:3000";

interface CertRow {
  id: string;
  status: string;
  created_at: string;
  legacy_ref: string | null;
  legacy_project: string | null;
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

function CertTable({
  certs,
  emptyMessage,
}: {
  certs: CertRow[];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-200 text-left">
            <th className="py-3 px-4 font-semibold">Date</th>
            <th className="py-3 px-4 font-semibold">PO</th>
            <th className="py-3 px-4 font-semibold">Project</th>
            <th className="py-3 px-4 font-semibold">Items</th>
            <th className="py-3 px-4 font-semibold">Document</th>
          </tr>
        </thead>
        <tbody>
          {certs.map((cert) => (
            <tr
              key={cert.id}
              className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
              onClick={() =>
                (window.location.href = `/matl-cert/cert/${cert.id}/`)
              }
            >
              <td className="py-3 px-4 text-gray-600">
                {new Date(cert.created_at).toLocaleDateString("en-GB")}
              </td>
              <td className="py-3 px-4 font-mono">
                {cert.purchase_orders?.po_number || (
                  cert.legacy_ref ? (
                    <span className="text-gray-400" title="Legacy PO ref">
                      {cert.legacy_ref}
                    </span>
                  ) : (
                    "—"
                  )
                )}
              </td>
              <td className="py-3 px-4">
                {cert.purchase_orders?.project_register_items
                  ? `${cert.purchase_orders.project_register_items.projectnumber}-${cert.purchase_orders.project_register_items.item_seq}`
                  : cert.legacy_project
                    ? (
                        <span className="text-gray-400" title="Legacy project">
                          {cert.legacy_project}
                        </span>
                      )
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
              <td className="py-3 px-4 text-gray-500 text-xs truncate max-w-[200px]">
                {cert.document_incoming_scan?.filed_path?.split("/").pop() ||
                  cert.document_incoming_scan?.file_name ||
                  "—"}
              </td>
            </tr>
          ))}
          {certs.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-gray-400">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function CertLibrary() {
  const { user, loading: authLoading } = useAuth();
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    loadCerts();
  }, [user]);

  async function loadCerts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("document_matl_cert")
      .select(
        `
        id, status, created_at, legacy_ref, legacy_project,
        purchase_orders ( po_number, project_register_items ( projectnumber, item_seq ) ),
        document_incoming_scan ( file_name, filed_path ),
        document_matl_cert_item ( id, description )
      `
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (!error && data) setCerts(data as unknown as CertRow[]);
    setLoading(false);
  }

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const pdfs = Array.from(files).filter(
        (f) =>
          f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfs.length === 0) return;

      setUploading(true);
      setUploadMessage("");
      let success = 0;
      let failed = 0;

      for (const file of pdfs) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const uploadResp = await fetch(`${DOC_SERVICE_URL}/api/scan/upload`, {
            method: "POST",
            body: formData,
          });
          if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
          const uploadData = await uploadResp.json();
          const filePath = uploadData.path || uploadData.filePath || file.name;

          const override = {
            type_code: "X-MC",
            doc_code: "MAT-CER",
            asset_code: "RP-MAT-CER-001",
            skip_duplicate_check: false,
          };

          const { error: scanError } = await supabase
            .from("document_incoming_scan")
            .insert({
              file_name: file.name,
              file_path: filePath,
              status: "queued",
              override_metadata: override,
              uploaded_by: user?.id,
            });

          if (scanError) throw new Error(scanError.message);
          success++;
        } catch {
          failed++;
        }
      }

      setUploadMessage(
        `${success} uploaded${failed > 0 ? `, ${failed} failed` : ""}. Certificates will appear in Pending once filed.`
      );
      setUploading(false);

      // Reload after a delay to pick up new certs
      setTimeout(() => loadCerts(), 10000);
    },
    [user]
  );

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
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--pss-navy)" }}
        >
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
    const legacyProj = c.legacy_project?.toLowerCase() || "";
    const desc =
      c.document_matl_cert_item?.[0]?.description?.toLowerCase() || "";
    const file =
      c.document_incoming_scan?.filed_path?.split("/").pop()?.toLowerCase() ||
      "";
    return (
      po.includes(s) ||
      legacyPo.includes(s) ||
      legacyProj.includes(s) ||
      desc.includes(s) ||
      file.includes(s)
    );
  });

  const pending = filtered.filter((c) => c.status === "pending");
  const filed = filtered.filter((c) => c.status === "confirmed");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <PageHeader title="Material Certificate Library" />

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <p className="text-blue-600">Uploading...</p>
        ) : (
          <>
            <p className="text-gray-500">
              Drop material certificate PDFs here or click to browse
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Files are filed automatically via the document service
            </p>
          </>
        )}
      </div>

      {uploadMessage && (
        <p className="text-sm text-green-700 bg-green-50 p-3 rounded-lg">
          {uploadMessage}
        </p>
      )}

      {/* Search */}
      <div className="flex gap-4 items-center">
        <input
          type="text"
          placeholder="Search by PO, project, description, or file name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-500">
          {pending.length} pending, {filed.length} filed
        </span>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading certificates...</p>
      ) : (
        <>
          {/* Pending section */}
          {pending.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-amber-400"></span>
                Pending — needs PO assignment
                <span className="text-sm font-normal text-gray-400">
                  ({pending.length})
                </span>
              </h2>
              <CertTable
                certs={pending}
                emptyMessage="No pending certificates"
              />
            </div>
          )}

          {/* Filed section */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-green-500"></span>
              Filed
              <span className="text-sm font-normal text-gray-400">
                ({filed.length})
              </span>
            </h2>
            <CertTable certs={filed} emptyMessage="No filed certificates" />
          </div>
        </>
      )}
    </div>
  );
}
