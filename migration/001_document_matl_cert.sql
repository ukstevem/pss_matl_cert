-- ============================================================
-- Material Certification: document_matl_cert + tracking
-- Run this in your Supabase SQL editor
-- ============================================================

-- Material certification records (merged document + cert metadata)
create table if not exists document_matl_cert (
  id                uuid        primary key default gen_random_uuid(),
  legacy_id         int,                                        -- old Django PK, drop after migration verified
  file_path         text        not null,                       -- PDF path on NAS
  thumbnail_path    text,                                       -- thumbnail image path
  document_number   text,                                       -- was rootdocumentnumber
  title             text,
  page_count        int,
  mill_name         text        not null,                       -- material producer
  po_ref            text,                                       -- PO reference
  comment           text,
  status            text        not null default 'pending'
                    check (status in ('pending','confirmed')),
  uploaded_by       uuid        references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Usage tracking: links certs to job cards and projects
create table if not exists document_matl_cert_tracking (
  id                uuid        primary key default gen_random_uuid(),
  matl_cert_id      uuid        not null references document_matl_cert(id) on delete cascade,
  jobcard_number    int         check (jobcard_number between 1000 and 9999),
  project_number    text,                                       -- references project_register by number
  demand            boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Indexes
create index if not exists idx_document_matl_cert_status
  on document_matl_cert(status);

create index if not exists idx_document_matl_cert_po_ref
  on document_matl_cert(po_ref);

create index if not exists idx_document_matl_cert_tracking_cert
  on document_matl_cert_tracking(matl_cert_id);

create index if not exists idx_document_matl_cert_tracking_jobcard
  on document_matl_cert_tracking(jobcard_number);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table document_matl_cert enable row level security;
alter table document_matl_cert_tracking enable row level security;

create policy "Authenticated users can read document_matl_cert"
  on document_matl_cert for select to authenticated using (true);

create policy "Authenticated users can insert document_matl_cert"
  on document_matl_cert for insert to authenticated with check (true);

create policy "Authenticated users can update document_matl_cert"
  on document_matl_cert for update to authenticated using (true);

create policy "Authenticated users can delete document_matl_cert"
  on document_matl_cert for delete to authenticated using (true);

create policy "Authenticated users can read document_matl_cert_tracking"
  on document_matl_cert_tracking for select to authenticated using (true);

create policy "Authenticated users can insert document_matl_cert_tracking"
  on document_matl_cert_tracking for insert to authenticated with check (true);

create policy "Authenticated users can update document_matl_cert_tracking"
  on document_matl_cert_tracking for update to authenticated using (true);

create policy "Authenticated users can delete document_matl_cert_tracking"
  on document_matl_cert_tracking for delete to authenticated using (true);

-- ============================================================
-- Updated_at triggers (reuses existing set_updated_at function)
-- ============================================================

drop trigger if exists trg_document_matl_cert_updated_at on document_matl_cert;
create trigger trg_document_matl_cert_updated_at
  before update on document_matl_cert
  for each row execute function set_updated_at();

drop trigger if exists trg_document_matl_cert_tracking_updated_at on document_matl_cert_tracking;
create trigger trg_document_matl_cert_tracking_updated_at
  before update on document_matl_cert_tracking
  for each row execute function set_updated_at();
