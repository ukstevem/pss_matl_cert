"use client";

import { useAuth } from "@platform/auth";
import { PageHeader } from "@platform/ui";
import { supabase } from "@platform/supabase";
import { useState, useRef, useCallback } from "react";

const DOC_SERVICE_URL =
  process.env.NEXT_PUBLIC_DOC_SERVICE_URL || "http://10.0.0.74:3000";

export default function UploadCerts() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<
    { name: string; status: "success" | "error"; message: string }[]
  >([]);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const pdfs = Array.from(newFiles).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    setFiles((prev) => [...prev, ...pdfs]);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadAll() {
    if (files.length === 0) return;
    setUploading(true);
    setResults([]);

    const newResults: typeof results = [];

    for (const file of files) {
      try {
        // Step 1: Upload PDF to document service
        const formData = new FormData();
        formData.append("file", file);

        const uploadResp = await fetch(`${DOC_SERVICE_URL}/api/scan/upload`, {
          method: "POST",
          body: formData,
        });

        if (!uploadResp.ok) {
          throw new Error(`Upload failed: ${uploadResp.status}`);
        }

        const uploadData = await uploadResp.json();
        const filePath = uploadData.path || uploadData.filePath || file.name;

        // Step 2: Create scan row with override (X-MC, skip QR)
        const override = {
          type_code: "X-MC",
          doc_code: "MAT-CER",
          asset_code: null,
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

        if (scanError) {
          throw new Error(`Scan row failed: ${scanError.message}`);
        }

        newResults.push({
          name: file.name,
          status: "success",
          message: "Uploaded and queued for filing",
        });
      } catch (err: any) {
        newResults.push({
          name: file.name,
          status: "error",
          message: err.message || "Unknown error",
        });
      }
    }

    setResults(newResults);
    setFiles([]);
    setUploading(false);
  }

  if (!user) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Upload Material Certificates" />

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-lg text-gray-500">
          Drop PDF files here or click to browse
        </p>
        <p className="text-sm text-gray-400 mt-2">
          Material certificate PDFs only
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">{files.length} file(s) ready</h3>
            <button
              onClick={uploadAll}
              disabled={uploading}
              className="pss-btn"
            >
              {uploading ? "Uploading..." : "Upload All"}
            </button>
          </div>
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center justify-between border rounded-lg p-3"
            >
              <div>
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs text-gray-400">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="text-red-400 hover:text-red-600 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Results</h3>
          {results.map((r, i) => (
            <div
              key={i}
              className={`flex items-center justify-between p-3 rounded-lg text-sm ${
                r.status === "success"
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              <span className="font-medium">{r.name}</span>
              <span>{r.message}</span>
            </div>
          ))}
          <p className="text-sm text-gray-500 mt-2">
            Uploaded certificates will appear on the{" "}
            <a href="/matl-cert/pending/" className="text-blue-600 underline">
              Pending
            </a>{" "}
            page once filed by the document service.
          </p>
        </div>
      )}
    </div>
  );
}
