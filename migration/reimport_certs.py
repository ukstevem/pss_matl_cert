"""
Reimport material certs: copy PDFs directly on NAS, update scan records.

No upload/download — just file copy + database update.

For each existing document_matl_cert:
1. Delete old junk file at filed_path
2. Copy original PDF from Docstore to correct filing location
3. Update document_incoming_scan with new filed_path

Usage:
    python reimport_certs.py --limit 5       # test with 5
    python reimport_certs.py --limit 0       # all
"""

import os
import re
import sys
import shutil
import argparse
import requests
from collections import defaultdict
from datetime import datetime, timedelta

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hguvsjpmiyeypfcuvvko.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

SOURCE_BASE = "//pss-dc02/Document Store$/Docstore"
DEST_BASE = "//pss-dc02/cad_iot/documents/filed"


def headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def week_to_month(period):
    """Convert '2022-W05' to year='2022', month='02'."""
    try:
        year, week = period.split("-W")
        # ISO week to approximate month
        jan1 = datetime(int(year), 1, 1)
        d = jan1 + timedelta(weeks=int(week) - 1)
        return year, f"{d.month:02d}"
    except Exception:
        now = datetime.now()
        return str(now.year), f"{now.month:02d}"


def parse_period_from_filename(file_name):
    """PSS2205&MQC-026.pdf -> 2022-W05"""
    try:
        base = file_name.replace(".pdf", "").split("&")[0]
        yy = base[3:5]
        ww = base[5:7]
        return f"20{yy}-W{ww}"
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--skip", type=int, default=0)
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_KEY environment variable")
        sys.exit(1)

    # Load all certs with their scan records
    print("Loading certs from Supabase...")
    all_certs = []
    offset = 0
    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/document_matl_cert"
            f"?select=id,scan_id,legacy_ref,legacy_project,created_at,"
            f"document_incoming_scan(id,file_name,filed_path)"
            f"&order=created_at&limit=500&offset={offset}",
            headers=headers(),
        )
        rows = resp.json()
        if not rows:
            break
        all_certs.extend(rows)
        offset += 500

    print(f"Total certs: {len(all_certs)}")

    if args.skip > 0:
        all_certs = all_certs[args.skip:]
    if args.limit > 0:
        all_certs = all_certs[: args.limit]

    print(f"Processing: {len(all_certs)}")
    print()

    # Track sequence numbers per period.
    # Seed from existing filed_paths so re-runs (batched or otherwise) don't
    # collide with earlier runs or manual uploads. Without this, the counter
    # restarts at 1 every run and overwrites prior files of the same period.
    seq_counter = defaultdict(int)
    seed_rx = re.compile(r"X-MC_MAT-CER_(\d{4}-W\d{2})_(\d+)\.pdf$")
    print("Seeding sequence counters from existing filed_paths...")
    seed_offset = 0
    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/document_incoming_scan"
            f"?select=filed_path&filed_path=like.*X-MC_MAT-CER*"
            f"&limit=500&offset={seed_offset}",
            headers=headers(),
        )
        seed_rows = resp.json()
        if not seed_rows:
            break
        for row in seed_rows:
            m = seed_rx.search(row.get("filed_path") or "")
            if m:
                period, seq = m.group(1), int(m.group(2))
                if seq > seq_counter[period]:
                    seq_counter[period] = seq
        seed_offset += 500
    print(f"Seeded {len(seq_counter)} periods (next seq per period starts at max+1)")

    success = 0
    failed = 0
    skipped = 0

    for i, cert in enumerate(all_certs):
        scan = cert.get("document_incoming_scan")
        if not scan:
            print(f"[{i+1}] SKIP - no scan record")
            skipped += 1
            continue

        file_name = scan.get("file_name", "")
        old_filed_path = scan.get("filed_path", "")
        scan_id = scan["id"]

        # Parse period from original filename
        period = parse_period_from_filename(file_name)
        if not period:
            print(f"[{i+1}] SKIP - can't parse period from {file_name}")
            skipped += 1
            continue

        year, month = week_to_month(period)

        # Increment sequence for this period
        seq_counter[period] += 1
        seq = seq_counter[period]

        # Build paths
        new_filename = f"X-MC_MAT-CER_{period}_{seq:03d}.pdf"
        new_filed_path = f"/files/documents/filed/{year}/{month}/{new_filename}"
        dest_dir = f"{DEST_BASE}/{year}/{month}"
        dest_path = f"{dest_dir}/{new_filename}"
        source_path = f"{SOURCE_BASE}/{file_name}"

        print(f"[{i+1}/{len(all_certs)}] {file_name} -> {new_filename}")

        # Check source exists
        if not os.path.exists(source_path):
            print(f"  SKIP - source not found: {source_path}")
            skipped += 1
            continue

        try:
            # Step 1: Delete old junk file (if it exists and is different)
            if old_filed_path:
                old_phys = old_filed_path.replace(
                    "/files/documents/filed", DEST_BASE
                ).replace("/", os.sep if os.name == "nt" else "/")
                # Use forward slashes for UNC
                old_phys = old_filed_path.replace(
                    "/files/documents/filed", DEST_BASE
                )
                if os.path.exists(old_phys) and old_phys != dest_path:
                    os.remove(old_phys)
                    # Also remove thumbnail if exists
                    old_thumb = old_phys.replace(".pdf", ".thumb.png")
                    if os.path.exists(old_thumb):
                        os.remove(old_thumb)

            # Step 2: Ensure dest directory exists
            os.makedirs(dest_dir, exist_ok=True)

            # Step 3: Copy source PDF to destination
            shutil.copy2(source_path, dest_path)

            # Step 4: Update scan record with new filed_path
            update = {"filed_path": new_filed_path}
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/document_incoming_scan?id=eq.{scan_id}",
                json=update,
                headers=headers(),
            )
            if resp.status_code not in (200, 204):
                print(f"  ERROR updating scan: {resp.status_code} {resp.text[:100]}")
                failed += 1
                continue

            print(f"  OK")
            success += 1

        except Exception as e:
            print(f"  ERROR: {e}")
            failed += 1

    print()
    print(f"Complete: {success} success, {failed} failed, {skipped} skipped out of {len(all_certs)}")


if __name__ == "__main__":
    main()
