"""
Reimport thumbnails for material certs.

Companion to reimport_certs.py — the reimport deleted old thumbnails but never
regenerated them. Legacy thumbnails already exist at
//pss-dc02/Document Store$/Thumbs/<stem>.jpg with the same filenames as the
original PDFs, so we just copy them across and update thumbnail_path.

For each document_matl_cert:
1. Look up the source thumbnail by original file_name stem
2. Copy it next to the filed PDF as <filed_stem>.thumb.jpg
3. PATCH document_incoming_scan.thumbnail_path

Usage:
    python reimport_thumbnails.py --limit 5
    python reimport_thumbnails.py --limit 0
"""

import os
import sys
import shutil
import argparse
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hguvsjpmiyeypfcuvvko.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

THUMB_SOURCE_BASE = "//pss-dc02/Document Store$/Thumbs"
FILED_BASE = "//pss-dc02/cad_iot/documents/filed"
URL_PREFIX = "/files/documents/filed"


def headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--skip", type=int, default=0)
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_KEY environment variable")
        sys.exit(1)

    print("Loading certs from Supabase...")
    all_certs = []
    offset = 0
    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/document_matl_cert"
            f"?select=id,scan_id,created_at,"
            f"document_incoming_scan(id,file_name,filed_path,thumbnail_path)"
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
        filed_path = scan.get("filed_path", "")
        scan_id = scan["id"]

        if not file_name or not filed_path:
            print(f"[{i+1}] SKIP - missing file_name or filed_path")
            skipped += 1
            continue

        # Source thumbnail: same stem as original PDF, .jpg extension
        stem = os.path.splitext(file_name)[0]
        source_thumb = f"{THUMB_SOURCE_BASE}/{stem}.jpg"

        # Destination: sibling of filed PDF, <stem>.thumb.jpg
        # filed_path looks like /files/documents/filed/2022/02/X-MC_MAT-CER_2022-W02_001.pdf
        if not filed_path.startswith(URL_PREFIX):
            print(f"[{i+1}] SKIP - unexpected filed_path: {filed_path}")
            skipped += 1
            continue

        rel = filed_path[len(URL_PREFIX):]  # /2022/02/X-MC_MAT-CER_2022-W02_001.pdf
        new_thumb_rel = rel.rsplit(".", 1)[0] + ".thumb.jpg"
        new_thumb_url = URL_PREFIX + new_thumb_rel
        dest_thumb = FILED_BASE + new_thumb_rel

        print(f"[{i+1}/{len(all_certs)}] {stem}.jpg -> {os.path.basename(dest_thumb)}")

        if not os.path.exists(source_thumb):
            print(f"  SKIP - source thumb not found: {source_thumb}")
            skipped += 1
            continue

        try:
            os.makedirs(os.path.dirname(dest_thumb), exist_ok=True)
            shutil.copy2(source_thumb, dest_thumb)

            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/document_incoming_scan?id=eq.{scan_id}",
                json={"thumbnail_path": new_thumb_url},
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
