"""
Fix the 5 W02 filed_path collisions from the batched reimport.

The reimport_certs.py resets its per-period sequence counter on each run. It
was run as `--limit 5` then `--skip 5 --limit 0`, so both runs wrote to
W02_001..005.pdf. Last write wins, so the earlier-numbered certs
(MQC-001..005) had their content overwritten by MQC-006..010.

This script:
1. Loads the 5 colliding scan pairs for 2022-W02
2. For each pair, identifies the overwritten scan (lower MQC number)
3. Verifies by file size that the on-disk PDF matches the OTHER scan's source
   (sanity check — last-write-wins theory)
4. Copies the overwritten cert's source PDF to a new unique W02 slot
5. PATCHes scan.filed_path

Usage:
    python fix_w02_collisions.py --dry-run    # no changes
    python fix_w02_collisions.py              # apply
"""

import os
import re
import sys
import shutil
import argparse
import requests
from collections import defaultdict

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hguvsjpmiyeypfcuvvko.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

SOURCE_BASE = "//pss-dc02/Document Store$/Docstore"
FILED_BASE = "//pss-dc02/cad_iot/documents/filed"
URL_PREFIX = "/files/documents/filed"


def headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def mqc_num(file_name):
    m = re.search(r"MQC-(\d+)", file_name)
    return int(m.group(1)) if m else -1


def url_to_phys(url_path):
    if not url_path.startswith(URL_PREFIX):
        return None
    return FILED_BASE + url_path[len(URL_PREFIX):]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_KEY environment variable")
        sys.exit(1)

    print("Loading scans...")
    all_rows = []
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/document_matl_cert"
            f"?select=id,document_incoming_scan(id,file_name,filed_path)"
            f"&limit=500&offset={offset}",
            headers=headers(),
        )
        rows = r.json()
        if not rows:
            break
        all_rows.extend(rows)
        offset += 500

    # Build map of filed_path -> list of scans
    by_path = defaultdict(list)
    used_seqs = set()
    w02_re = re.compile(r"X-MC_MAT-CER_2022-W02_(\d+)\.pdf$")

    for c in all_rows:
        s = c.get("document_incoming_scan")
        if not s or not s.get("filed_path"):
            continue
        by_path[s["filed_path"]].append(s)
        m = w02_re.search(s["filed_path"])
        if m:
            used_seqs.add(int(m.group(1)))

    collisions = sorted(
        [(p, scans) for p, scans in by_path.items() if len(scans) > 1 and "2022-W02" in p],
        key=lambda x: x[0],
    )
    print(f"W02 collisions: {len(collisions)}")
    print(f"W02 seqs in use: {sorted(used_seqs)}")

    next_seq = max(used_seqs, default=0) + 1
    print(f"Next free W02 seq: {next_seq:03d}")
    print()

    for colliding_path, scans in collisions:
        # Pick the scan to relocate = lower MQC number (overwritten one)
        scans_sorted = sorted(scans, key=lambda s: mqc_num(s["file_name"]))
        to_relocate = scans_sorted[0]   # lower MQC (overwritten)
        keeper = scans_sorted[1]        # higher MQC (actual content on disk)

        on_disk = url_to_phys(colliding_path)
        src_relocate = f"{SOURCE_BASE}/{to_relocate['file_name']}"
        src_keeper = f"{SOURCE_BASE}/{keeper['file_name']}"

        # Sanity check: which source matches the on-disk file by size?
        sizes = {}
        for label, p in [("on_disk", on_disk), ("relocate_src", src_relocate), ("keeper_src", src_keeper)]:
            sizes[label] = os.path.getsize(p) if os.path.exists(p) else None

        matches = "keeper" if sizes["on_disk"] == sizes["keeper_src"] else (
            "relocate" if sizes["on_disk"] == sizes["relocate_src"] else "neither"
        )

        # Build new path for the relocated cert
        new_seq = next_seq
        next_seq += 1
        new_name = f"X-MC_MAT-CER_2022-W02_{new_seq:03d}.pdf"
        new_url = f"{URL_PREFIX}/2022/01/{new_name}"
        new_phys = url_to_phys(new_url)

        print(f"Collision at {colliding_path}")
        print(f"  keeper:    {keeper['file_name']:30s} (keeps this path)")
        print(f"  relocate:  {to_relocate['file_name']:30s} -> {new_url}")
        print(f"  sizes: on_disk={sizes['on_disk']} keeper_src={sizes['keeper_src']} relocate_src={sizes['relocate_src']}  match={matches}")

        if matches != "keeper":
            print(f"  WARNING: on-disk content does not match keeper's source — skipping this collision")
            continue

        if args.dry_run:
            print(f"  DRY RUN — would copy {src_relocate} -> {new_phys}")
            print(f"  DRY RUN — would PATCH scan {to_relocate['id']} filed_path = {new_url}")
            print()
            continue

        try:
            os.makedirs(os.path.dirname(new_phys), exist_ok=True)
            shutil.copy2(src_relocate, new_phys)
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/document_incoming_scan?id=eq.{to_relocate['id']}",
                json={"filed_path": new_url},
                headers=headers(),
            )
            if resp.status_code not in (200, 204):
                print(f"  ERROR updating scan: {resp.status_code} {resp.text[:200]}")
                continue
            print(f"  OK")
        except Exception as e:
            print(f"  ERROR: {e}")
        print()

    print("Done.")


if __name__ == "__main__":
    main()
