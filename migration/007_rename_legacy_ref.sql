-- Rename to match document service hook field name
ALTER TABLE document_matl_cert RENAME COLUMN legacy_po_ref TO legacy_ref;
