"use client";

import { useAuth } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState } from "react";

interface PendingCert {
  id: string;
  created_at: string;
  document_incoming_scan: {
    file_name: string;
    filed_path: string;
  } | null;
}

export default function PendingCerts() {
  const { user } = useAuth();
  const [certs, setCerts] = useState<PendingCert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadPending();
  }, [user]);

  async function loadPending() {
    setLoading(true);
    const { data } = await supabase
      .from("document_matl_cert")
      .select(`
        id, created_at,
        document_incoming_scan ( file_name, filed_path, type_code )
      `)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (data) setCerts(data as unknown as PendingCert[]);
    setLoading(false);
  }

  if (!user) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Pending Certificates" />
      <p className="text-sm text-gray-500">
        These certificates have been scanned but need a purchase order assigned.
      </p>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : certs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">No pending certificates</p>
          <p className="text-sm mt-1">Certificates appear here after scanning via the document service</p>
        </div>
      ) : (
        <div className="space-y-3">
          {certs.map((cert) => (
            <div
              key={cert.id}
              className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer flex justify-between items-center"
              onClick={() => (window.location.href = `/matl-cert/cert/${cert.id}/`)}
            >
              <div>
                <p className="font-medium">
                  {cert.document_incoming_scan?.filed_path?.split("/").pop() || cert.document_incoming_scan?.file_name || "Untitled certificate"}
                </p>
                <p className="text-sm text-gray-500">
                  Scanned {new Date(cert.created_at).toLocaleDateString("en-GB")}
                </p>
              </div>
              <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800">
                pending
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
