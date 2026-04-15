"""
Transform Heroku Django dump data into Supabase-compatible INSERT statements.

Reads the COPY-format data from heroku_data.sql, joins docstore_document + millcerts_model_millcertlog (1:1),
resolves project IDs to project numbers, and outputs SQL for document_matl_cert and document_matl_cert_tracking.

Usage:
    python transform.py > 002_seed_data.sql
"""

import csv
import io
import uuid
import sys
from pathlib import Path


def parse_copy_block(sql_text: str, table_name: str) -> list[dict]:
    """Parse a COPY ... FROM stdin block into a list of dicts."""
    marker = f'COPY "public"."{table_name}"'
    start = sql_text.find(marker)
    if start == -1:
        print(f"WARNING: table {table_name} not found in dump", file=sys.stderr)
        return []

    # Extract column names from COPY statement
    header_end = sql_text.index("\n", start)
    header_line = sql_text[start:header_end]
    cols_start = header_line.index("(") + 1
    cols_end = header_line.index(")")
    columns = [c.strip().strip('"') for c in header_line[cols_start:cols_end].split(",")]

    # Extract data lines (between header and \. terminator)
    data_start = header_end + 1
    terminator = "\n\\.\n"
    data_end = sql_text.index(terminator, data_start)
    data_block = sql_text[data_start:data_end]

    rows = []
    reader = csv.reader(io.StringIO(data_block), delimiter="\t")
    for line in reader:
        if not line:
            continue
        row = {}
        for i, col in enumerate(columns):
            val = line[i] if i < len(line) else "\\N"
            row[col] = None if val == "\\N" else val
        rows.append(row)

    return rows


def escape_sql(val: str | None) -> str:
    if val is None:
        return "NULL"
    escaped = val.replace("'", "''")
    return f"'{escaped}'"


def main():
    dump_path = Path(__file__).parent / "heroku_data.sql"
    sql_text = dump_path.read_text(encoding="utf-8")

    # Parse all tables
    documents = parse_copy_block(sql_text, "docstore_document")
    certlogs = parse_copy_block(sql_text, "millcerts_model_millcertlog")
    tracking = parse_copy_block(sql_text, "millcerts_model_millcerttracking")
    projects = parse_copy_block(sql_text, "projects_projects")

    print(f"-- Parsed: {len(documents)} documents, {len(certlogs)} certs, "
          f"{len(tracking)} tracking, {len(projects)} projects", file=sys.stderr)

    # Build lookup maps
    doc_by_id = {row["id"]: row for row in documents}
    project_by_id = {row["id"]: row for row in projects}

    # Generate deterministic UUIDs from legacy IDs (reproducible mapping)
    NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

    def cert_uuid(legacy_id: str) -> str:
        return str(uuid.uuid5(NAMESPACE, f"matl_cert:{legacy_id}"))

    # -- Output SQL --
    print("-- ============================================================")
    print("-- Seed data: migrated from Heroku Django (PSS-Intranet)")
    print(f"-- Generated from transform.py")
    print(f"-- Source: {len(certlogs)} certs, {len(tracking)} tracking records")
    print("-- ============================================================")
    print()
    print("BEGIN;")
    print()

    # -- document_matl_cert (join docstore_document + millcerts_model_millcertlog) --
    print("-- document_matl_cert")
    skipped = 0
    inserted_certs = set()

    for cert in certlogs:
        doc = doc_by_id.get(cert["document_id"])
        if doc is None:
            skipped += 1
            continue

        new_id = cert_uuid(cert["id"])
        legacy_id = cert["id"]
        file_path = doc.get("document")
        thumbnail_path = doc.get("thumbnail")
        document_number = doc.get("rootdocumentnumber")
        title = doc.get("title")
        page_count = doc.get("pagecount") or "NULL"
        mill_name = cert["millname"]
        po_ref = cert.get("poref")
        comment = cert["comment"]
        status = "confirmed" if cert["confirmed"] == "t" else "pending"
        created_at = cert["created"]
        updated_at = cert["modified"]

        print(f"INSERT INTO document_matl_cert "
              f"(id, legacy_id, file_path, thumbnail_path, document_number, title, "
              f"page_count, mill_name, po_ref, comment, status, created_at, updated_at) VALUES ("
              f"'{new_id}', {legacy_id}, {escape_sql(file_path)}, {escape_sql(thumbnail_path)}, "
              f"{escape_sql(document_number)}, {escape_sql(title)}, "
              f"{page_count}, {escape_sql(mill_name)}, {escape_sql(po_ref)}, "
              f"{escape_sql(comment)}, '{status}', "
              f"'{created_at}', '{updated_at}');")

        inserted_certs.add(cert["id"])

    if skipped:
        print(f"-- WARNING: {skipped} certs skipped (no matching document)")

    print()
    print("-- document_matl_cert_tracking")
    skipped_tracking = 0

    for trk in tracking:
        if trk["millcert_id"] not in inserted_certs:
            skipped_tracking += 1
            continue

        new_id = str(uuid.uuid4())
        matl_cert_id = cert_uuid(trk["millcert_id"])
        jobcard_number = trk.get("millusedwhere") or "NULL"
        project_number = None
        if trk.get("project_id"):
            proj = project_by_id.get(trk["project_id"])
            if proj:
                project_number = str(proj["projectnumber"])

        created_at = trk["created"]
        updated_at = trk["modified"]
        demand = "true" if trk["demand"] == "t" else "false"

        print(f"INSERT INTO document_matl_cert_tracking "
              f"(id, matl_cert_id, jobcard_number, project_number, demand, created_at, updated_at) VALUES ("
              f"'{new_id}', '{matl_cert_id}', {jobcard_number}, {escape_sql(project_number)}, "
              f"{demand}, '{created_at}', '{updated_at}');")

    if skipped_tracking:
        print(f"-- WARNING: {skipped_tracking} tracking records skipped (cert not found)")

    print()
    print("COMMIT;")

    # Summary
    print(f"\n-- Migration complete: {len(inserted_certs)} certs, "
          f"{len(tracking) - skipped_tracking} tracking records", file=sys.stderr)
    if skipped:
        print(f"-- {skipped} certs had no matching document record", file=sys.stderr)
    if skipped_tracking:
        print(f"-- {skipped_tracking} tracking records had no matching cert", file=sys.stderr)


if __name__ == "__main__":
    main()
