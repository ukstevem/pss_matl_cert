"""
Migrate legacy material certs through the document service pipeline.

Flow per cert:
1. POST PDF to document service upload endpoint
2. Create document_incoming_scan row with status=queued AND override_metadata
   (type_code=X-MC, period from original filename)
3. Worker sees override, skips QR, files directly with correct date shard
4. Post-filing hook creates document_matl_cert (status=pending)
5. Script adds item + confirms

Usage:
    python migrate_certs.py --limit 4
    python migrate_certs.py --limit 0   # all certs
"""

import csv
import io
import json
import os
import sys
import time
import argparse
import requests

DOC_SERVICE_URL = os.environ.get("DOC_SERVICE_URL", "http://10.0.0.74:3000")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hguvsjpmiyeypfcuvvko.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
NAS_BASE = "//pss-dc02/Document Store$"
POLL_INTERVAL = 2
POLL_TIMEOUT = 60


def parse_copy(sql_text, table_name):
    marker = f'COPY "public"."{table_name}"'
    start = sql_text.find(marker)
    if start == -1: return []
    header_end = sql_text.index("\n", start)
    header_line = sql_text[start:header_end]
    cols_start = header_line.index("(") + 1
    cols_end = header_line.index(")")
    columns = [c.strip().strip('"') for c in header_line[cols_start:cols_end].split(",")]
    data_start = header_end + 1
    term = "\n\\.\n"
    data_end = sql_text.index(term, data_start)
    data_block = sql_text[data_start:data_end]
    rows = []
    for line in csv.reader(io.StringIO(data_block), delimiter="\t"):
        if not line: continue
        row = {}
        for i, col in enumerate(columns):
            val = line[i] if i < len(line) else "\\N"
            row[col] = None if val == "\\N" else val
        rows.append(row)
    return rows


def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def parse_period(file_name):
    """PSS2205&MQC-026.pdf -> 2022-W05"""
    try:
        base = file_name.replace(".pdf", "").split("&")[0]
        yy = base[3:5]
        ww = base[5:7]
        return f"20{yy}-W{ww}"
    except Exception:
        return None


def upload_pdf(file_path):
    url = f"{DOC_SERVICE_URL}/api/scan/upload"
    with open(file_path, "rb") as f:
        resp = requests.post(url, files={"file": (os.path.basename(file_path), f, "application/pdf")})
    if resp.status_code not in (200, 201):
        print(f"  Upload failed: {resp.status_code} {resp.text[:200]}")
        return None
    return resp.json()


def create_scan_row_with_override(file_name, file_path, period, po_ref):
    """Create scan row with override_metadata so worker skips QR and files directly."""
    url = f"{SUPABASE_URL}/rest/v1/document_incoming_scan"
    override = {
        "type_code": "X-MC",
        "doc_code": "MAT-CER",
        "asset_code": "RP-MAT-CER-001",
        "period": period,
        "skip_duplicate_check": True,
    }
    payload = {
        "file_name": file_name,
        "file_path": file_path,
        "status": "queued",
        "override_metadata": override,
    }
    resp = requests.post(url, json=payload, headers=supabase_headers())
    if resp.status_code not in (200, 201):
        print(f"  Scan row failed: {resp.status_code} {resp.text[:200]}")
        return None
    data = resp.json()
    return data[0] if isinstance(data, list) else data


def wait_for_filed(scan_id):
    """Poll until status reaches filed or error."""
    url = f"{SUPABASE_URL}/rest/v1/document_incoming_scan?id=eq.{scan_id}&select=id,status,filed_path,error_message"
    elapsed = 0
    while elapsed < POLL_TIMEOUT:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL
        resp = requests.get(url, headers=supabase_headers())
        if resp.status_code == 200:
            rows = resp.json()
            if rows and rows[0].get("status") in ("error", "filed"):
                return rows[0]
        sys.stdout.write(".")
        sys.stdout.flush()
    print()
    return None


def wait_for_cert_record(scan_id):
    url = f"{SUPABASE_URL}/rest/v1/document_matl_cert?scan_id=eq.{scan_id}&select=id,status"
    elapsed = 0
    while elapsed < POLL_TIMEOUT:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL
        resp = requests.get(url, headers=supabase_headers())
        if resp.status_code == 200:
            rows = resp.json()
            if rows:
                return rows[0]
    return None


def parse_po_ref(po_ref):
    """Split 'MT001753-9310' into po_part and project_part.
    Normalises: W005/w005 -> 0005, strips trailing slashes."""
    if not po_ref:
        return None, None
    if "-" in po_ref:
        parts = po_ref.split("-", 1)
        proj = parts[1].strip("/")
        # W005/w005 -> 0005
        if proj.upper().startswith("W") and proj[1:].isdigit():
            proj = proj[1:].zfill(4)
        # Known aliases
        if proj.upper() == "STOCK":
            proj = "0006"
        elif proj.upper() == "PB":
            proj = None
        return parts[0], proj
    return po_ref, None


def lookup_po(po_part):
    """Match po_part against purchase_orders (try stripping leading zeros)."""
    if not po_part:
        return None
    stripped = po_part.lstrip("0")
    if not stripped:
        return None
    url = f"{SUPABASE_URL}/rest/v1/purchase_orders?po_number=eq.{stripped}&select=id,po_number&limit=1"
    resp = requests.get(url, headers=supabase_headers())
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    # Also try unstripped
    url = f"{SUPABASE_URL}/rest/v1/purchase_orders?po_number=eq.{po_part}&select=id,po_number&limit=1"
    resp = requests.get(url, headers=supabase_headers())
    if resp.status_code == 200 and resp.json():
        return resp.json()[0]
    return None


def update_cert(cert_id, description, po_ref, original_date=None):
    # Add item
    url = f"{SUPABASE_URL}/rest/v1/document_matl_cert_item"
    requests.post(url, json={"matl_cert_id": cert_id, "description": description}, headers=supabase_headers())

    # Parse and split PO ref
    po_part, proj_part = parse_po_ref(po_ref)

    # Build update
    update = {"status": "confirmed", "legacy_ref": po_part, "legacy_project": proj_part}

    # Preserve original date
    if original_date:
        update["created_at"] = original_date

    # Try to auto-link PO
    po = lookup_po(po_part)
    if po:
        update["po_id"] = po["id"]

    url = f"{SUPABASE_URL}/rest/v1/document_matl_cert?id=eq.{cert_id}"
    requests.patch(url, json=update, headers=supabase_headers())

    return po_part, proj_part, po


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--skip", type=int, default=0, help="Skip first N certs")
    parser.add_argument("--dump", default="heroku_data.sql")
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_KEY environment variable")
        sys.exit(1)

    print(f"Loading legacy data from {args.dump}...")
    sql = open(args.dump).read()
    certs = parse_copy(sql, "millcerts_model_millcertlog")
    docs = parse_copy(sql, "docstore_document")
    doc_map = {d["id"]: d for d in docs}

    if args.skip > 0:
        certs = certs[args.skip:]
    if args.limit > 0:
        certs = certs[:args.limit]

    print(f"Migrating {len(certs)} certs...")
    print()

    success = 0
    failed = 0

    for i, cert in enumerate(certs):
        doc = doc_map.get(cert["document_id"])
        if not doc:
            print(f"[{i+1}] SKIP - no document")
            failed += 1
            continue

        rel_path = doc.get("document", "")
        file_name = rel_path.split("/")[-1] if "/" in rel_path else rel_path
        nas_path = NAS_BASE + "/" + rel_path
        description = cert.get("comment", "")
        if description in ("ADD COMMENT", "No Comments", ""):
            description = None
        po_ref = cert.get("poref", "")
        period = parse_period(file_name)

        print(f"[{i+1}/{len(certs)}] {file_name} | period={period} | PO={po_ref}")

        if not os.path.exists(nas_path):
            print(f"  SKIP - file not found: {nas_path}")
            failed += 1
            continue

        # Step 1: Upload PDF
        upload_result = upload_pdf(nas_path)
        if not upload_result:
            failed += 1
            continue
        uploaded_path = upload_result.get("path", upload_result.get("filePath", file_name))

        # Step 2: Create scan row with override (worker skips QR)
        scan = create_scan_row_with_override(file_name, uploaded_path, period, po_ref)
        if not scan:
            failed += 1
            continue
        scan_id = scan["id"]

        # Step 3: Wait for filing
        sys.stdout.write("  Filing")
        filed = wait_for_filed(scan_id)
        if not filed:
            print(f"  TIMEOUT")
            failed += 1
            continue
        print(f" -> {filed['status']} | {filed.get('filed_path', '?')}")

        if filed["status"] == "error":
            print(f"  ERROR: {filed.get('error_message', '?')}")
            failed += 1
            continue

        # Step 4: Wait for cert record (from post-filing hook)
        sys.stdout.write("  Cert record")
        cert_record = wait_for_cert_record(scan_id)
        if not cert_record:
            print(f" TIMEOUT")
            failed += 1
            continue
        print(f" -> {cert_record['id']}")

        # Step 5: Add item + set legacy ref/project + original date + try PO match + confirm
        original_date = cert.get("created")
        po_part, proj_part, po = update_cert(cert_record["id"], description, po_ref, original_date)
        parts = []
        if po_part: parts.append(f"ref={po_part}")
        if proj_part: parts.append(f"proj={proj_part}")
        if po: parts.append(f"PO LINKED: {po['po_number']}")
        print(f"  {' | '.join(parts) if parts else 'no PO ref'}")
        print(f"  OK")
        success += 1
        print()

    print(f"Complete: {success} success, {failed} failed out of {len(certs)}")


if __name__ == "__main__":
    main()
