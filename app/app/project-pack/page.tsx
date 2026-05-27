"use client";

import { useAuth } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useState } from "react";
import { fetchProjectCerts, type ProjectCert } from "@/lib/projectCerts";

export default function ProjectPack() {
  const { user } = useAuth();
  const [project, setProject] = useState("");
  const [certs, setCerts] = useState<ProjectCert[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function preview() {
    const p = project.trim();
    if (!p) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      setCerts(await fetchProjectCerts(p));
    } catch (e) {
      setError((e as Error).message);
      setCerts([]);
    }
    setLoading(false);
  }

  async function download() {
    const p = project.trim();
    if (!p) return;
    setDownloading(true);
    setError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const resp = await fetch(
        `/matl-cert/api/project-pack/?project=${encodeURIComponent(p)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        const msg = await resp.json().catch(() => ({}));
        throw new Error(msg.error || `Download failed (HTTP ${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `material-certs-project-${p}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
    setDownloading(false);
  }

  if (!user) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Project Certificate Pack" />

      <p className="text-sm text-gray-500">
        Download a ZIP of every confirmed material certificate filed against a
        project, matched via the assigned purchase order.
      </p>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project number
          </label>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && preview()}
            placeholder="e.g. 10305"
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <button onClick={preview} disabled={loading} className="pss-btn">
          {loading ? "Loading..." : "Preview"}
        </button>
        <button
          onClick={download}
          disabled={downloading || certs.length === 0}
          className="px-4 py-2 text-sm border rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {downloading ? "Building ZIP..." : "Download ZIP"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg">
          {error}
        </div>
      )}

      {searched && !loading && (
        <div className="overflow-x-auto">
          <p className="text-sm text-gray-500 mb-3">
            {certs.length} certificate(s) for project{" "}
            <span className="font-mono">{project.trim()}</span>
          </p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">PO</th>
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-4">Document</th>
              </tr>
            </thead>
            <tbody>
              {certs.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() =>
                    (window.location.href = `/matl-cert/cert/${c.id}/`)
                  }
                >
                  <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                  <td className="py-3 px-4 font-mono">{c.po_number || "—"}</td>
                  <td className="py-3 px-4 font-mono">{c.item_seq || "—"}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {c.filed_path?.split("/").pop()?.replace(".pdf", "") || (
                      <span className="text-red-500">no PDF</span>
                    )}
                  </td>
                </tr>
              ))}
              {certs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">
                    No confirmed certificates found for this project
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
