-- ============================================================
-- 1. Rename legacy import tables
-- ============================================================

ALTER TABLE document_matl_cert RENAME TO herokuleg_matl_cert;
ALTER TABLE document_matl_cert_tracking RENAME TO herokuleg_matl_cert_tracking;

-- ============================================================
-- 2. New schema: document_matl_cert + items + tracking
-- ============================================================

-- The certificate document — links a filed PDF to a purchase order
create table if not exists document_matl_cert (
  id              uuid        primary key default gen_random_uuid(),
  scan_id         uuid        references document_incoming_scan(id),
  po_id           uuid        references purchase_orders(id),
  status          text        not null default 'pending'
                  check (status in ('pending','confirmed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Each material section/size covered by the cert
create table if not exists document_matl_cert_item (
  id                uuid        primary key default gen_random_uuid(),
  matl_cert_id      uuid        not null references document_matl_cert(id) on delete cascade,
  po_line_item_id   uuid        references po_line_items(id),
  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Usage tracking: which job card used which material item
create table if not exists document_matl_cert_tracking (
  id                  uuid        primary key default gen_random_uuid(),
  matl_cert_item_id   uuid        not null references document_matl_cert_item(id) on delete cascade,
  jobcard_number      int         check (jobcard_number between 1000 and 9999),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_document_matl_cert_po
  on document_matl_cert(po_id);

create index if not exists idx_document_matl_cert_status
  on document_matl_cert(status);

create index if not exists idx_document_matl_cert_item_cert
  on document_matl_cert_item(matl_cert_id);

create index if not exists idx_document_matl_cert_item_po_line
  on document_matl_cert_item(po_line_item_id);

create index if not exists idx_document_matl_cert_tracking_item
  on document_matl_cert_tracking(matl_cert_item_id);

create index if not exists idx_document_matl_cert_tracking_jobcard
  on document_matl_cert_tracking(jobcard_number);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table document_matl_cert enable row level security;
alter table document_matl_cert_item enable row level security;
alter table document_matl_cert_tracking enable row level security;

create policy "Authenticated users can read document_matl_cert"
  on document_matl_cert for select to authenticated using (true);
create policy "Authenticated users can insert document_matl_cert"
  on document_matl_cert for insert to authenticated with check (true);
create policy "Authenticated users can update document_matl_cert"
  on document_matl_cert for update to authenticated using (true);
create policy "Authenticated users can delete document_matl_cert"
  on document_matl_cert for delete to authenticated using (true);

create policy "Authenticated users can read document_matl_cert_item"
  on document_matl_cert_item for select to authenticated using (true);
create policy "Authenticated users can insert document_matl_cert_item"
  on document_matl_cert_item for insert to authenticated with check (true);
create policy "Authenticated users can update document_matl_cert_item"
  on document_matl_cert_item for update to authenticated using (true);
create policy "Authenticated users can delete document_matl_cert_item"
  on document_matl_cert_item for delete to authenticated using (true);

create policy "Authenticated users can read document_matl_cert_tracking"
  on document_matl_cert_tracking for select to authenticated using (true);
create policy "Authenticated users can insert document_matl_cert_tracking"
  on document_matl_cert_tracking for insert to authenticated with check (true);
create policy "Authenticated users can update document_matl_cert_tracking"
  on document_matl_cert_tracking for update to authenticated using (true);
create policy "Authenticated users can delete document_matl_cert_tracking"
  on document_matl_cert_tracking for delete to authenticated using (true);

-- ============================================================
-- Updated_at triggers
-- ============================================================

drop trigger if exists trg_document_matl_cert_updated_at on document_matl_cert;
create trigger trg_document_matl_cert_updated_at
  before update on document_matl_cert
  for each row execute function set_updated_at();

drop trigger if exists trg_document_matl_cert_item_updated_at on document_matl_cert_item;
create trigger trg_document_matl_cert_item_updated_at
  before update on document_matl_cert_item
  for each row execute function set_updated_at();

drop trigger if exists trg_document_matl_cert_tracking_updated_at on document_matl_cert_tracking;
create trigger trg_document_matl_cert_tracking_updated_at
  before update on document_matl_cert_tracking
  for each row execute function set_updated_at();
