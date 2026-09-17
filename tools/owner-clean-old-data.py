from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    candidates = [text[:10], text]
    for candidate in candidates:
        try:
            return datetime.fromisoformat(candidate.replace('Z', '+00:00')).date()
        except Exception:
            pass
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except Exception:
            pass
    return None


def kill_listener(port: int) -> None:
    if os.name != 'nt':
        return
    # Never kill an unrelated app that happens to use the same port.
    if port == 5055:
        try:
            with urllib.request.urlopen('http://127.0.0.1:5055/api/health', timeout=0.8) as response:
                payload = json.loads(response.read().decode('utf-8', errors='replace'))
            if payload.get('app') != 'ServiceFlowJobCards':
                return
        except Exception:
            return
    try:
        proc = subprocess.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True, text=True, timeout=5)
        pids: set[str] = set()
        needle = f':{port}'
        for line in proc.stdout.splitlines():
            if needle not in line or 'LISTENING' not in line.upper():
                continue
            parts = line.split()
            if parts:
                pid = parts[-1]
                if pid.isdigit() and int(pid) > 0:
                    pids.add(pid)
        for pid in pids:
            subprocess.run(['taskkill', '/PID', pid, '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    except Exception:
        pass


def restart_servicing() -> None:
    if os.name != 'nt':
        return
    try:
        subprocess.Popen(
            ['schtasks', '/Run', '/TN', 'NUNES Servicing Warm'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
    except Exception:
        pass


def sqlite_backup(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(str(src), timeout=10)
    try:
        target = sqlite3.connect(str(dst), timeout=10)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()


def main() -> int:
    parser = argparse.ArgumentParser(description='Owner-only NUNES old data cleanup.')
    parser.add_argument('--cutoff', required=True, help='Start date to KEEP, YYYY-MM-DD')
    parser.add_argument('--yes', action='store_true', help='Perform deletion after preview')
    args = parser.parse_args()

    try:
        cutoff = datetime.strptime(args.cutoff, '%Y-%m-%d').date()
    except ValueError:
        print('ERROR: Date must be YYYY-MM-DD, for example 2026-09-01.')
        return 2

    local = Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local')))
    state = local / 'NUNES Operations'
    purchase_dir = state / 'PurchasingData'
    service_dir = state / 'ServiceData'
    purchase_db = purchase_dir / 'nunes_forms.db'
    jobs_file = service_dir / 'jobs.json'
    uploads_dir = service_dir / 'uploads'

    if not purchase_db.exists() and not jobs_file.exists():
        print('ERROR: NUNES persistent data was not found on this owner PC.')
        print(f'Expected under: {state}')
        return 3

    purchase_ids: list[int] = []
    purchase_kept = 0
    purchase_skipped = 0
    purchase_max_seq = 0
    if purchase_db.exists():
        conn = sqlite3.connect(str(purchase_db), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute('SELECT id, quote_date, created_at, order_seq FROM orders ORDER BY id').fetchall()
            for row in rows:
                purchase_max_seq = max(purchase_max_seq, int(row['order_seq'] or 0))
                d = parse_date(row['created_at']) or parse_date(row['quote_date'])
                if d is None:
                    purchase_skipped += 1
                elif d < cutoff:
                    purchase_ids.append(int(row['id']))
                else:
                    purchase_kept += 1
        finally:
            conn.close()

    service_db: dict = {'version': 1, 'nextSerial': 1, 'jobs': []}
    service_delete: list[dict] = []
    service_keep: list[dict] = []
    service_skipped = 0
    if jobs_file.exists():
        try:
            service_db = json.loads(jobs_file.read_text(encoding='utf-8-sig'))
        except Exception as exc:
            print(f'ERROR: Could not read Servicing jobs.json: {exc}')
            return 4
        jobs = service_db.get('jobs') if isinstance(service_db, dict) else []
        if not isinstance(jobs, list):
            print('ERROR: Servicing jobs.json has an unexpected format.')
            return 4
        for job in jobs:
            if not isinstance(job, dict):
                service_keep.append(job)
                service_skipped += 1
                continue
            d = parse_date(job.get('jobDate')) or parse_date(job.get('createdAt'))
            if d is None:
                service_keep.append(job)
                service_skipped += 1
            elif d < cutoff:
                service_delete.append(job)
            else:
                service_keep.append(job)

    print('')
    print('=' * 72)
    print(' NUNES OWNER OLD DATA CLEANUP - PREVIEW')
    print('=' * 72)
    print(f'Start date to KEEP : {cutoff.isoformat()}')
    print(f'Will remove before : {cutoff.isoformat()}')
    print('')
    print(f'Purchasing old records to remove : {len(purchase_ids)}')
    print(f'Purchasing records kept           : {purchase_kept}')
    if purchase_skipped:
        print(f'Purchasing records kept (no date) : {purchase_skipped}')
    print(f'Servicing old records to remove  : {len(service_delete)}')
    print(f'Servicing records kept            : {len(service_keep)}')
    if service_skipped:
        print(f'Servicing records kept (no date)  : {service_skipped}')
    print('')

    if not args.yes:
        print('PREVIEW ONLY. Nothing was deleted.')
        return 0

    if not purchase_ids and not service_delete:
        print('Nothing is older than the selected date. No changes were made.')
        return 0

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    archive = state / 'OwnerArchive' / f'before_{cutoff.isoformat()}_{stamp}'
    archive.mkdir(parents=True, exist_ok=False)

    manifest = {
        'createdAt': datetime.now().isoformat(timespec='seconds'),
        'cutoffKeepFrom': cutoff.isoformat(),
        'purchasingRemoved': len(purchase_ids),
        'servicingRemoved': len(service_delete),
        'note': 'Automatic safety backup created before owner-requested cleanup.',
    }

    # A full consistent purchasing DB backup is small and preserves all relational rows.
    if purchase_db.exists():
        sqlite_backup(purchase_db, archive / 'PurchasingData' / 'nunes_forms.db')

    # Preserve the complete jobs database before changing it.
    if jobs_file.exists():
        (archive / 'ServiceData').mkdir(parents=True, exist_ok=True)
        shutil.copy2(jobs_file, archive / 'ServiceData' / 'jobs.json')

    # Back up only attachment directories belonging to jobs that will be removed.
    removed_attachment_dirs = 0
    if uploads_dir.exists() and service_delete:
        backup_uploads = archive / 'ServiceData' / 'uploads'
        for job in service_delete:
            jid = str(job.get('id') or '').strip()
            if not jid:
                continue
            src = uploads_dir / jid
            if src.exists() and src.is_dir():
                shutil.copytree(src, backup_uploads / jid, dirs_exist_ok=True)
                removed_attachment_dirs += 1

    (archive / 'cleanup-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

    # Stop Servicing only while jobs.json is rewritten; otherwise its in-memory cache
    # could later write an older copy back over the cleanup.
    kill_listener(5055)

    try:
        if purchase_ids and purchase_db.exists():
            conn = sqlite3.connect(str(purchase_db), timeout=15)
            try:
                conn.execute('PRAGMA foreign_keys=ON')
                conn.execute('PRAGMA busy_timeout=10000')
                conn.execute('BEGIN IMMEDIATE')
                conn.executemany('DELETE FROM orders WHERE id=?', [(oid,) for oid in purchase_ids])
                # Preserve the previous sequence high-water mark so cleanup never causes
                # a future order number to go backwards if every active order was removed.
                conn.execute('CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)')
                conn.execute(
                    "INSERT INTO app_meta(key,value) VALUES('owner_cleanup_order_seq_highwater',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (str(purchase_max_seq),),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

        if service_delete and jobs_file.exists():
            # Keep nextSerial unchanged so future Service Job numbers never reuse old numbers.
            cleaned = dict(service_db)
            cleaned['jobs'] = service_keep
            temp = jobs_file.with_suffix('.json.cleanup.tmp')
            temp.write_text(json.dumps(cleaned, indent=2, ensure_ascii=False), encoding='utf-8')
            os.replace(temp, jobs_file)

            for job in service_delete:
                jid = str(job.get('id') or '').strip()
                if jid:
                    shutil.rmtree(uploads_dir / jid, ignore_errors=True)
    except Exception as exc:
        print(f'ERROR during cleanup: {exc}')
        print(f'Your automatic safety backup is here: {archive}')
        restart_servicing()
        return 5

    restart_servicing()

    print('=' * 72)
    print(' CLEANUP COMPLETED')
    print('=' * 72)
    print(f'Purchasing removed : {len(purchase_ids)}')
    print(f'Servicing removed  : {len(service_delete)}')
    print(f'Attachment folders : {removed_attachment_dirs}')
    print(f'Kept from date      : {cutoff.isoformat()} onward')
    print(f'Safety backup       : {archive}')
    print('')
    print('Old records are no longer active/reported. The backup remains owner-only')
    print('so the data can be recovered if the wrong cutoff date was entered.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
