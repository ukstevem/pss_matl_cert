"use client";

import { useAuth } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useState } from "react";

interface SearchResult {
  cert_id: string;
  cert_status: string;
  cert_created: string;
  po_number: string | null;
  project_number: string | null;
  item_description: string | null;
  jobcard_number: number | null;
}

export default function TraceabilitySearch() {
  const { user } = useAuth();
  const [searchType, setSearchType] = useState<"po" | "project" | "jobcard">("po");
  const [searchValue, setSearchValue] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function doSearch() {
    if (!searchValue.trim()) return;
    setLoading(true);
    setSearched(true);

    // Build query joining cert → items → tracking with PO info
    let query = supabase
      .from("document_matl_cert_tracking")
      .select(`
        id,
        jobcard_number,
        document_matl_cert_item!inner (
          id,
          description,
          document_matl_cert!inner (
            id,
            status,
            created_at,
            purchase_orders ( po_number )
          )
        )
      `)
      .limit(200);

    if (searchType === "jobcard") {
      const jc = parseInt(searchValue);
      if (!isNaN(jc)) {
        query = query.eq("jobcard_number", jc);
      }
    }

    const { data, error } = await query;

    if (data) {
      const mapped: SearchResult[] = data.map((row: any) => ({
        cert_id: row.document_matl_cert_item?.document_matl_cert?.id,
        cert_status: row.document_matl_cert_item?.document_matl_cert?.status,
        cert_created: row.document_matl_cert_item?.document_matl_cert?.created_at,
        po_number: row.document_matl_cert_item?.document_matl_cert?.purchase_orders?.po_number,
        project_number: null,
        item_description: row.document_matl_cert_item?.description,
        jobcard_number: row.jobcard_number,
      }));

      // Client-side filter for PO and project searches
      const filtered = mapped.filter((r) => {
        const s = searchValue.toLowerCase();
        if (searchType === "po") return r.po_number?.toLowerCase().includes(s);
        if (searchType === "project") return r.project_number?.toLowerCase().includes(s);
        return true;
      });

      setResults(filtered);
    }
    setLoading(false);
  }

  if (!user) return null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Traceability Search" />

      <div className="flex gap-3 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Search by</label>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as "po" | "project" | "jobcard")}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="po">PO Number</option>
            <option value="project">Project Number</option>
            <option value="jobcard">Job Card</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder={
              searchType === "po" ? "e.g. MT001753" :
              searchType === "project" ? "e.g. 10305" :
              "e.g. 3345"
            }
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <button onClick={doSearch} className="pss-btn">
          Search
        </button>
      </div>

      {loading && <p className="text-gray-500">Searching...</p>}

      {searched && !loading && (
        <div className="overflow-x-auto">
          <p className="text-sm text-gray-500 mb-3">{results.length} result(s)</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">PO</th>
                <th className="py-3 px-4">Material</th>
                <th className="py-3 px-4">Job Card</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => (window.location.href = `/matl-cert/cert/${r.cert_id}/`)}
                >
                  <td className="py-3 px-4 text-gray-600">
                    {r.cert_created ? new Date(r.cert_created).toLocaleDateString("en-GB") : "—"}
                  </td>
                  <td className="py-3 px-4 font-mono">{r.po_number || "—"}</td>
                  <td className="py-3 px-4">{r.item_description || "—"}</td>
                  <td className="py-3 px-4 font-mono">{r.jobcard_number || "—"}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        r.cert_status === "confirmed"
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {r.cert_status}
                    </span>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    No results found
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
