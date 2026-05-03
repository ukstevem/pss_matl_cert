"use client";

import { useAuth } from "@platform/auth";
import { AuthButton } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState, useRef, useCallback } from "react";

const DOC_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOC_SERVICE_URL || "http://10.0.0.74:3000";

const PAGE_SIZE = 20;

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
  maxHeight,
}: {
  certs: CertRow[];
  emptyMessage: string;
  maxHeight?: string;
}) {
  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
    >
      <div
        className="overflow-auto"
        style={{ maxHeight: maxHeight || "auto" }}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-3 px-4 font-medium">Date</th>
              <th className="py-3 px-4 font-medium">PO</th>
              <th className="py-3 px-4 font-medium">Document</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {certs.map((cert) => (
              <tr
                key={cert.id}
                className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                onClick={() =>
                  (window.location.href = `/matl-cert/cert/${cert.id}/`)
                }
              >
                <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                  {new Date(cert.created_at).toLocaleDateString("en-GB")}
                </td>
                <td className="py-3 px-4 font-mono whitespace-nowrap">
                  {cert.purchase_orders?.po_number ? (
                    <span className="text-blue-700 font-medium">
                      {cert.purchase_orders.po_number}
                    </span>
                  ) : cert.legacy_ref ? (
                    <span className="text-gray-400" title="Legacy PO ref">
                      {cert.legacy_ref}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="py-3 px-4 text-sm text-gray-600">
                  {cert.document_incoming_scan?.filed_path
                    ?.split("/")
                    .pop()
                    ?.replace(".pdf", "") || "—"}
                </td>
              </tr>
            ))}
            {certs.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="py-10 text-center text-gray-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-2">
      <p className="text-sm text-gray-500">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function CertLibrary() {
  const { user, loading: authLoading } = useAuth();
  const [pendingCerts, setPendingCerts] = useState<CertRow[]>([]);
  const [filedCerts, setFiledCerts] = useState<CertRow[]>([]);
  const [filedCount, setFiledCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filedPage, setFiledPage] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    loadPending();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadFiled();
  }, [user, filedPage, search]);

  async function loadPending() {
    const { data, count } = await supabase
      .from("document_matl_cert")
      .select(
        `id, status, created_at, legacy_ref, legacy_project,
        purchase_orders ( po_number, project_register_items ( projectnumber, item_seq ) ),
        document_incoming_scan ( file_name, filed_path ),
        document_matl_cert_item ( id, description )`,
        { count: "exact" }
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (data) setPendingCerts(data as unknown as CertRow[]);
    if (count !== null) setPendingCount(count);
  }

  async function loadFiled() {
    setLoading(true);
    const from = (filedPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("document_matl_cert")
      .select(
        `id, status, created_at, legacy_ref, legacy_project,
        purchase_orders ( po_number, project_register_items ( projectnumber, item_seq ) ),
        document_incoming_scan ( file_name, filed_path ),
        document_matl_cert_item ( id, description )`,
        { count: "exact" }
      )
      .eq("status", "confirmed")
      .order("created_at", { ascending: false });

    // Server-side search using ilike on legacy_ref
    if (search) {
      query = query.or(
        `legacy_ref.ilike.%${search}%,legacy_project.ilike.%${search}%`
      );
    }

    const { data, count } = await query.range(from, to);

    if (data) setFiledCerts(data as unknown as CertRow[]);
    if (count !== null) setFiledCount(count);
    setLoading(false);
  }

  // Reset page when search changes
  useEffect(() => {
    setFiledPage(1);
  }, [search]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const pdfs = Array.from(files).filter(
        (f) =>
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf")
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
          const uploadResp = await fetch(
            `${DOC_SERVICE_URL}/api/scan/upload`,
            { method: "POST", body: formData }
          );
          if (!uploadResp.ok)
            throw new Error(`Upload failed: ${uploadResp.status}`);
          const uploadData = await uploadResp.json();
          const filePath =
            uploadData.path || uploadData.filePath || file.name;

          const override = {
            type_code: "X-MC",
            doc_code: "MAT-CER",
            subject_code: "RP-MAT-CER-001",
            skip_duplicate_check: true,
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
      setTimeout(() => loadPending(), 10000);
    },
    [user]
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50">
        <h1 className="text-2xl font-semibold text-gray-800">
          Material Certificates
        </h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/matl-cert/" />
      </div>
    );
  }

  const filedTotalPages = Math.ceil(filedCount / PAGE_SIZE);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">
          Material Certificates
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            {pendingCount} pending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            {filedCount} filed
          </span>
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-blue-400 bg-blue-50 scale-[1.01]"
            : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/30"
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
          <p className="text-blue-600 font-medium">Uploading...</p>
        ) : (
          <>
            <p className="text-gray-600 font-medium">
              Drop material certificate PDFs here
            </p>
            <p className="text-xs text-gray-400 mt-1">
              or click to browse — files are filed automatically
            </p>
          </>
        )}
      </div>

      {uploadMessage && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg">
          {uploadMessage}
        </div>
      )}

      {/* Pending section */}
      {pendingCerts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 mb-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            Pending — needs PO assignment ({pendingCount})
          </h2>
          <CertTable
            certs={pendingCerts}
            emptyMessage="No pending certificates"
            maxHeight="300px"
          />
        </div>
      )}

      {/* Filed section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-600 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            Filed ({filedCount})
          </h2>
          <input
            type="text"
            placeholder="Search PO, project, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
          />
        </div>
        <CertTable
          certs={filedCerts}
          emptyMessage={
            search
              ? "No certificates match your search"
              : "No filed certificates"
          }
          maxHeight="60vh"
        />
        <Pagination
          page={filedPage}
          totalPages={filedTotalPages}
          onPageChange={setFiledPage}
        />
      </div>
    </div>
  );
}
