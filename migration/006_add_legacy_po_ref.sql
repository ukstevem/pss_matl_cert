-- Add legacy_po_ref column for migrated certs
ALTER TABLE document_matl_cert ADD COLUMN legacy_po_ref text;

-- Index for searching by old PO reference
CREATE INDEX IF NOT EXISTS idx_document_matl_cert_legacy_po_ref
  ON document_matl_cert(legacy_po_ref);
