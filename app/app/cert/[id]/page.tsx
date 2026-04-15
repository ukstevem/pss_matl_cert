"use client";

import { useAuth } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface PurchaseOrder {
  id: string;
  po_number: string;
}

interface CertItem {
  id: string;
  description: string | null;
  po_line_item_id: string | null;
  created_at: string;
}

interface TrackingRow {
  id: string;
  jobcard_number: number | null;
  created_at: string;
  matl_cert_item_id: string;
}

interface Cert {
  id: string;
  status: string;
  po_id: string | null;
  scan_id: string | null;
  created_at: string;
  purchase_orders: { po_number: string } | null;
  document_incoming_scan: { file_name: string; filed_path: string } | null;
}

export default function CertDetail() {
  const { user } = useAuth();
  const params = useParams();
  const certId = params.id as string;

  const [cert, setCert] = useState<Cert | null>(null);
  const [items, setItems] = useState<CertItem[]>([]);
  const [tracking, setTracking] = useState<TrackingRow[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [selectedPo, setSelectedPo] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newJobcard, setNewJobcard] = useState("");
  const [selectedItemForTracking, setSelectedItemForTracking] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !certId) return;
    loadCert();
    loadPurchaseOrders();
  }, [user, certId]);

  async function loadCert() {
    setLoading(true);

    const [certRes, itemsRes, trackingRes] = await Promise.all([
      supabase
        .from("document_matl_cert")
        .select("*, purchase_orders ( po_number ), document_incoming_scan ( file_name, filed_path )")
        .eq("id", certId)
        .single(),
      supabase
        .from("document_matl_cert_item")
        .select("*")
        .eq("matl_cert_id", certId)
        .order("created_at"),
      supabase
        .from("document_matl_cert_tracking")
        .select("*")
        .in(
          "matl_cert_item_id",
          // We'll filter after loading items
          []
        ),
    ]);

    if (certRes.data) {
      setCert(certRes.data as unknown as Cert);
      setSelectedPo(certRes.data.po_id || "");
    }
    if (itemsRes.data) {
      setItems(itemsRes.data);
      // Now load tracking for these items
      const itemIds = itemsRes.data.map((i: CertItem) => i.id);
      if (itemIds.length > 0) {
        const { data: trackData } = await supabase
          .from("document_matl_cert_tracking")
          .select("*")
          .in("matl_cert_item_id", itemIds)
          .order("created_at");
        if (trackData) setTracking(trackData);
      }
    }
    setLoading(false);
  }

  async function loadPurchaseOrders() {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, po_number")
      .order("po_number", { ascending: false })
      .limit(500);
    if (data) setPurchaseOrders(data);
  }

  async function assignPo() {
    if (!selectedPo || !certId) return;
    await supabase
      .from("document_matl_cert")
      .update({ po_id: selectedPo })
      .eq("id", certId);
    loadCert();
  }

  async function confirmCert() {
    await supabase
      .from("document_matl_cert")
      .update({ status: "confirmed" })
      .eq("id", certId);
    loadCert();
  }

  async function addItem() {
    if (!newItemDesc.trim()) return;
    await supabase.from("document_matl_cert_item").insert({
      matl_cert_id: certId,
      description: newItemDesc.trim(),
    });
    setNewItemDesc("");
    loadCert();
  }

  async function addTracking() {
    if (!selectedItemForTracking || !newJobcard) return;
    const jc = parseInt(newJobcard);
    if (isNaN(jc) || jc < 1000 || jc > 9999) return;
    await supabase.from("document_matl_cert_tracking").insert({
      matl_cert_item_id: selectedItemForTracking,
      jobcard_number: jc,
    });
    setNewJobcard("");
    loadCert();
  }

  if (loading || !cert) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading certificate...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <PageHeader title="Certificate Detail" />

      {/* Cert info */}
      <div className="bg-white border rounded-lg p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-gray-500">Created {new Date(cert.created_at).toLocaleDateString("en-GB")}</p>
            <span
              className={`inline-block mt-1 px-2 py-1 rounded text-xs font-medium ${
                cert.status === "confirmed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
              }`}
            >
              {cert.status}
            </span>
          </div>
          {cert.document_incoming_scan?.file_name && (
            <p className="text-sm text-gray-500">{cert.document_incoming_scan.file_name}</p>
          )}
        </div>

        {/* PO Assignment */}
        <div className="border-t pt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Purchase Order</label>
          <div className="flex gap-3">
            <select
              value={selectedPo}
              onChange={(e) => setSelectedPo(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg"
            >
              <option value="">Select PO...</option>
              {purchaseOrders.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.po_number}
                </option>
              ))}
            </select>
            <button onClick={assignPo} className="pss-btn">
              Assign
            </button>
          </div>
          {cert.purchase_orders && (
            <p className="mt-2 text-sm text-green-700">
              Assigned to PO: <strong>{cert.purchase_orders.po_number}</strong>
            </p>
          )}
        </div>

        {/* Confirm */}
        {cert.status === "pending" && cert.po_id && (
          <div className="border-t pt-4">
            <button onClick={confirmCert} className="pss-btn">
              Confirm Certificate
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-white border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Material Items</h2>

        {items.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 px-3">Description</th>
                <th className="py-2 px-3">Job Cards</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const itemTracking = tracking.filter((t) => t.matl_cert_item_id === item.id);
                return (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="py-2 px-3">{item.description || "—"}</td>
                    <td className="py-2 px-3 text-gray-600">
                      {itemTracking.length > 0
                        ? itemTracking.map((t) => t.jobcard_number).join(", ")
                        : "None assigned"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-sm">No items added yet</p>
        )}

        <div className="flex gap-3 pt-2">
          <input
            type="text"
            placeholder="e.g. 150x75 PFC S355 J0"
            value={newItemDesc}
            onChange={(e) => setNewItemDesc(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg text-sm"
            onKeyDown={(e) => e.key === "Enter" && addItem()}
          />
          <button onClick={addItem} className="pss-btn text-sm">
            Add Item
          </button>
        </div>
      </div>

      {/* Tracking */}
      {items.length > 0 && (
        <div className="bg-white border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">Job Card Assignment</h2>
          <div className="flex gap-3">
            <select
              value={selectedItemForTracking}
              onChange={(e) => setSelectedItemForTracking(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">Select material item...</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description || item.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Job card (1000-9999)"
              value={newJobcard}
              onChange={(e) => setNewJobcard(e.target.value)}
              className="w-48 px-3 py-2 border rounded-lg text-sm"
              min={1000}
              max={9999}
            />
            <button onClick={addTracking} className="pss-btn text-sm">
              Assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
