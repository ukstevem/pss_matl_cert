ALTER TABLE document_matl_cert ADD COLUMN legacy_project text;

CREATE INDEX IF NOT EXISTS idx_document_matl_cert_legacy_project
  ON document_matl_cert(legacy_project);
