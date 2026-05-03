# PSS Material Certificate System

## Overview

Material certification traceability system for PSS (Precision Structural Steel). Tracks material certificates from purchase order through to job card usage, providing a legal audit trail of material provenance.

**This is a standalone app outside the platform-portal monorepo.** It integrates via the Nginx gateway at `/matl-cert/` and uses the same Supabase database and `@platform/*` shared packages.

## Architecture

```
PDF uploaded/scanned
    |
    v
Document Service (pss-document-service)
    - Files PDF with type_code X-MC, doc_code MAT-CER
    - Post-filing hook creates document_matl_cert row (status: pending)
    |
    v
Material Cert App (this repo)
    - User assigns Purchase Order
    - Adds material items
    - Tracks usage on job cards
```

## Repository Structure

```
pss-matl-cert/
├── app/                        # Next.js 16 frontend
│   ├── app/
│   │   ├── page.tsx            # Library: drop zone + pending + filed tables
│   │   ├── cert/[id]/page.tsx  # Detail: PDF viewer + PO assignment
│   │   ├── search/page.tsx     # Traceability search
│   │   ├── pending/page.tsx    # (Legacy, not in sidebar)
│   │   └── upload/page.tsx     # (Legacy, not in sidebar)
│   ├── components/
│   │   └── AppSidebar.tsx
│   ├── packages/               # Local copies of @platform/* packages
│   │   ├── auth/
│   │   ├── ui/
│   │   └── supabase/
│   ├── next.config.ts          # basePath: /matl-cert
│   ├── package.json
│   └── Dockerfile
├── migration/                  # Database migrations and data import
│   ├── 001_document_matl_cert.sql       # Legacy import schema (herokuleg_ tables)
│   ├── 004_rename_legacy_and_create_new_schema.sql  # Clean schema
│   ├── 006_add_legacy_po_ref.sql
│   ├── 007_rename_legacy_ref.sql
│   ├── 008_add_legacy_project.sql
│   ├── transform.py            # Heroku dump to Supabase INSERT converter
│   ├── migrate_certs.py        # Bulk migration via document service pipeline
│   ├── reimport_certs.py       # NAS-direct PDF re-file (bypass doc service upload/download)
│   ├── reimport_thumbnails.py  # Copy legacy thumbnails from //pss-dc02/Document Store$/Thumbs
│   └── fix_w02_collisions.py   # One-off: recover overwritten W02 certs (see Incident Log)
├── docker-compose.yml          # Standalone docker-compose
└── CLAUDE.md
```

## Supabase Tables

### `document_matl_cert` — certificate records
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| scan_id | uuid FK → document_incoming_scan | Filed PDF in document service |
| po_id | uuid FK → purchase_orders | Nullable — legacy certs may not match |
| status | text | `pending` or `confirmed` |
| legacy_ref | text | Old PO reference (MT001753, JC000715, 006044) |
| legacy_project | text | Old project number (9550, 0006, 10263) |
| created_at | timestamptz | Original date for migrated certs |
| updated_at | timestamptz | |

### `document_matl_cert_item` — material line items per cert
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| matl_cert_id | uuid FK → document_matl_cert | |
| po_line_item_id | uuid FK → po_line_items | For future use |
| description | text | Free text material description |

### `document_matl_cert_tracking` — job card usage log
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| matl_cert_item_id | uuid FK → document_matl_cert_item | |
| jobcard_number | int | 1000-9999 |

### Legacy tables (prefixed `herokuleg_`)
- `herokuleg_matl_cert` — original Django import (1,435 rows)
- `herokuleg_matl_cert_tracking` — original tracking (1,353 rows)

## Document Service Integration

- Filing rule: type_code `X-MC`, destination `X-MC-material-certs`, 25yr retention
- Document definition: doc_code `MAT-CER`, meta_required `false`
- Asset code: `RP-MAT-CER-001`
- Post-filing hook in `pss-document-service/src/scanner/post-filing-hooks.ts` creates `document_matl_cert` row
- Override metadata for uploads:
  ```json
  {
    "type_code": "X-MC",
    "doc_code": "MAT-CER",
    "subject_code": "RP-MAT-CER-001",
    "period": "2022-W05",
    "skip_duplicate_check": true
  }
  ```
- Filed path format: `filed/YYYY/MM/RP-MAT-CER-001_X-MC_MAT-CER_YYYY-Wnn.pdf`
- PDF serving: `DOC_SERVICE_URL + filed_path`

## Running Locally

### Via platform-portal docker-compose (recommended)
The app is added as a service in `platform-portal/docker-compose.yml`:
```yaml
matl-cert:
  image: node:20-alpine
  working_dir: /app
  env_file: .env
  command: ["sh", "-c", "npm install && npx next dev --hostname 0.0.0.0 --port 3010"]
  volumes:
    - ${MATL_CERT_APP}:/app
```

Set `MATL_CERT_APP=C:/Dev/PSS/pss-matl-cert/app` in the portal's `.env`.

Nginx route in `docker/nginx/default.conf`:
```nginx
location /matl-cert/ {
  set $matl_cert_backend http://matl-cert:3010;
  proxy_pass $matl_cert_backend;
}
```

Access at: `http://localhost:3000/matl-cert/`

### Standalone
```bash
cd app
npm install
npx next dev --port 3010
```
Access at: `http://localhost:3010/matl-cert/` (auth won't work without gateway)

## Migration Script

`migration/migrate_certs.py` pushes legacy PDFs through the document service:

```bash
cd migration
set SUPABASE_KEY=<service_role_key>
python migrate_certs.py --limit 4      # test
python migrate_certs.py --limit 0      # all
python migrate_certs.py --skip 500 --limit 500  # batch
```

Flow per cert:
1. Upload PDF from NAS to document service
2. Create `document_incoming_scan` row with override_metadata (X-MC, period from filename)
3. Worker files it (skips QR scan due to override)
4. Post-filing hook creates `document_matl_cert` (pending)
5. Script adds item, sets legacy_ref/legacy_project, tries PO match, confirms

Legacy filename format: `PSS2205&MQC-026.pdf` → year 2022, week 05, sequence 026

PO ref parsing:
- `MT001753-9550` → legacy_ref=`MT001753`, legacy_project=`9550`
- `JC000879-W006` → legacy_ref=`JC000879`, legacy_project=`0006` (W prefix stripped)
- `JC002883-STOCK` → legacy_ref=`JC002883`, legacy_project=`0006`
- `006044-10263` → legacy_ref=`006044`, legacy_project=`10263` (auto-links PO if match)

## Reimport & Recovery

After the initial `migrate_certs.py` run, the filed PDF names were only period-based
(`X-MC_MAT-CER_YYYY-Wnn.pdf`, no per-cert sequence), so certs sharing a period overwrote
each other on the NAS. `reimport_certs.py` was written to repair this by re-filing each
PDF directly on the NAS with a per-period sequence suffix (`_001`, `_002`, …) and
PATCHing `document_incoming_scan.filed_path`.

### Incident: batched reimport caused 6 collisions

`reimport_certs.py` originally reset its per-period sequence counter on every run. It
was invoked as `--limit 5` (test) then `--skip 5 --limit 0` (full), so both runs wrote
to `W02_001..005.pdf`. Last write wins, so certs `MQC-001..005` had their PDF content
overwritten by `MQC-006..010`, and two scans pointed at each of those 5 paths. A
separate modern upload (`Your Order 006820-10305...`) was also stranded on
`2026-W16_001.pdf` on top of a reimport-filed cert.

Resolved in this repo by:

1. **`fix_w02_collisions.py`** — relocated `MQC-001..005` to fresh slots `W02_006..010`,
   size-verified each on-disk file against the "keeper" source before writing.
2. **`reimport_thumbnails.py --limit 0`** — backfilled 1,434 thumbnails from
   `//pss-dc02/Document Store$/Thumbs/<stem>.jpg`, writing `<filed_stem>.thumb.jpg`
   next to each filed PDF and updating `scan.thumbnail_path`.
3. The stranded `Your Order…` upload was copied out of `//pss-dc02/cad_iot/documents/quarantine/`
   to a unique `W16_007` slot (PDF + existing `.thumb.png`).
4. **`reimport_certs.py` now seeds `seq_counter` from existing `filed_path` values in
   the DB before processing** so re-runs (batched or otherwise) cannot collide with
   prior runs or manual uploads.

### How to audit

Run this against Supabase to check for any duplicate `filed_path` across cert scans:

```sql
select s.filed_path, count(*)
from document_matl_cert c
join document_incoming_scan s on s.id = c.scan_id
group by s.filed_path
having count(*) > 1;
```

Current expected result: **0 rows**. Cert count: **1,435**, all with unique `filed_path`
and a `thumbnail_path` set.

## Key Design Decisions

- **Document service is agnostic** — it files PDFs, serves them back. No business logic about POs or projects.
- **Material cert tables own the business logic** — PO links, items, tracking, legacy refs.
- **Traceability, not stock control** — tracks what was bought and where it was used, not quantities.
- **One cert can cover multiple materials** — `document_matl_cert_item` handles per-section tracking.
- **Legacy data preserved** — `legacy_ref` and `legacy_project` columns keep old PO references searchable. 149 of 1,435 legacy certs auto-linked to current PO system.

## Environment Variables

| Variable | Where | Value |
|----------|-------|-------|
| NEXT_PUBLIC_SUPABASE_URL | app/.env.local | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | app/.env.local | Supabase anon key |
| NEXT_PUBLIC_DOC_SERVICE_URL | app/.env.local | `http://10.0.0.74:3000` |
| SUPABASE_KEY | migration env | Service role key (for migration script only) |

## Related Systems

- **pss-document-service** — files PDFs, serves them, post-filing hook
- **platform-portal** — Nginx gateway, shared packages (@platform/auth, ui, supabase)
- **purchase_orders** / **po_metadata** / **po_line_items** — PO data in Supabase
- **project_register** / **project_register_items** — project data
- **document_incoming_scan** — scan records (document service)
- **document_definition** — doc_code MAT-CER with type_code X-MC
