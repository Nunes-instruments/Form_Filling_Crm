from __future__ import annotations

import json
import os
import hashlib
import hmac
import platform
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

PLATFORM_DIR = Path(__file__).resolve().parent
ROOT_DIR = PLATFORM_DIR.parent
STATIC_DIR = PLATFORM_DIR / "static"
CLOUD_MODE = os.environ.get("NUNES_CLOUD", "0").strip().lower() in {"1", "true", "yes", "on"}
_modules_override = os.environ.get("NUNES_MODULES_FILE", "").strip()
MODULES_FILE = Path(_modules_override) if _modules_override else PLATFORM_DIR / (
    "modules.cloud.json" if CLOUD_MODE and (PLATFORM_DIR / "modules.cloud.json").exists() else "modules.json"
)
HOST = os.environ.get("NUNES_HOST", "0.0.0.0")
PORT = int(os.environ.get("NUNES_API_PORT", os.environ.get("NUNES_PORT", "8766")))
VERSION = "6.5.0"
DATA_API_TOKEN = os.environ.get("NUNES_DATA_API_TOKEN", "").strip()
BROWSER_ORIGINS = {
    "https://nunes-operations-workspace.vercel.app",
    "http://127.0.0.1:8795",
    "http://localhost:8795",
}
for _origin in os.environ.get("NUNES_BROWSER_ORIGINS", "").split(","):
    _origin = _origin.strip().rstrip("/")
    if _origin:
        BROWSER_ORIGINS.add(_origin)

with MODULES_FILE.open("r", encoding="utf-8") as fh:
    MODULES = json.load(fh)

_start_lock = threading.Lock()
_starting: dict[str, float] = {}
_health_lock = threading.Lock()
_health_cache: dict[str, tuple[float, bool]] = {}
_jobs_lock = threading.Lock()
_jobs_cache: dict[str, object] = {"stamp": None, "jobs": []}
_payload_lock = threading.Lock()
_payload_cache: dict[str, tuple[float, object, tuple]] = {}
_payload_key_locks: dict[str, threading.Lock] = {}

def _instance_id(path: Path) -> str:
    try:
        raw = str(path.resolve()).casefold().encode("utf-8", "ignore")
    except Exception:
        raw = str(path).casefold().encode("utf-8", "ignore")
    return hashlib.sha1(raw).hexdigest()[:16]

def _module_instance_id(mod: dict) -> str:
    return _instance_id(ROOT_DIR / mod["app_dir"])

def _port_pid(port: int) -> int | None:
    if os.name != "nt":
        return None
    try:
        out = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True, errors="ignore", timeout=2)
        marker = f":{int(port)}"
        for line in out.splitlines():
            if marker in line and "LISTENING" in line.upper():
                parts = line.split()
                if parts and parts[-1].isdigit():
                    return int(parts[-1])
    except Exception:
        pass
    return None

def _stop_pid(pid: int) -> bool:
    if os.name != "nt" or not pid:
        return False
    try:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        time.sleep(0.35)
        return True
    except Exception:
        return False

def _file_stamp(path: Path) -> tuple:
    try:
        st = path.stat(); return (st.st_mtime_ns, st.st_size)
    except Exception:
        return (0, 0)

def _data_stamp() -> tuple:
    db = ROOT_DIR / "apps" / "order_forms" / "data" / "nunes_forms.db"
    wal = Path(str(db) + "-wal")
    jobs = ROOT_DIR / "apps" / "service_operations" / "data" / "jobs.json"
    return (_file_stamp(db), _file_stamp(wal), _file_stamp(jobs))

def _cached_payload(name: str, ttl: float, builder):
    stamp = _data_stamp()
    now = time.monotonic()
    with _payload_lock:
        item = _payload_cache.get(name)
        if item and now - item[0] <= ttl and item[2] == stamp:
            return item[1]
        lock = _payload_key_locks.setdefault(name, threading.Lock())
    with lock:
        stamp = _data_stamp(); now = time.monotonic()
        with _payload_lock:
            item = _payload_cache.get(name)
            if item and now - item[0] <= ttl and item[2] == stamp:
                return item[1]
        value = builder()
        with _payload_lock:
            _payload_cache[name] = (time.monotonic(), value, stamp)
        return value

def _service_jobs() -> list[dict]:
    path = ROOT_DIR / "apps" / "service_operations" / "data" / "jobs.json"
    stamp = _file_stamp(path)
    with _jobs_lock:
        if _jobs_cache.get("stamp") == stamp:
            return list(_jobs_cache.get("jobs") or [])
    if not path.exists():
        jobs = []
    else:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            jobs = raw.get("jobs", []) if isinstance(raw, dict) else []
            if not isinstance(jobs, list): jobs = []
        except Exception:
            jobs = []
    with _jobs_lock:
        _jobs_cache["stamp"] = stamp; _jobs_cache["jobs"] = jobs
    return list(jobs)

def _latest_purchase_audits(conn) -> dict[int, dict]:
    if not (_table_exists(conn, "audit_log") and _table_exists(conn, "users")):
        return {}
    try:
        rows = conn.execute("""
            SELECT a.order_id, a.created_at, u.full_name
            FROM audit_log a
            JOIN (SELECT order_id, MAX(id) AS max_id FROM audit_log GROUP BY order_id) x ON x.max_id=a.id
            LEFT JOIN users u ON u.id=a.user_id
        """).fetchall()
        return {int(r["order_id"]): dict(r) for r in rows if r["order_id"] is not None}
    except Exception:
        return {}

BRANCH_MAP = {
    "MAIN": "Rathinapuri (Main)",
    "GANDHIPURAM": "Gandhipuram",
    "GOPALAPURAM": "Gopalapuram",
}
PURCHASE_STAGES = [
    ("marketing", "Marketing", "marketing_complete"),
    ("dispatch", "Dispatch", "dispatch_complete"),
    ("payment", "Payment", "payment_complete"),
    ("supplier", "Supplier", "supplier_complete"),
    ("accounts", "Accounts", "accounts_complete"),
    ("approval", "Final Approval", "approval_complete"),
]
SERVICE_STATUS_ORDER = [
    "DRAFT", "RECEIVED", "ESTIMATE_PENDING", "APPROVAL_PENDING",
    "REPAIRING", "READY", "DISPATCHED", "CLOSED",
]


def safe_float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def money(value) -> float:
    return round(safe_float(value), 2)


def text(value, fallback="") -> str:
    value = "" if value is None else str(value).strip()
    return value or fallback


def rowdict(row):
    return dict(row) if row is not None else None


def local_ipv4() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.2)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip and not ip.startswith(("127.", "169.254.")):
                return ip
    except Exception:
        pass
    return "127.0.0.1"


def module_probe(key: str, timeout: float = 0.22) -> tuple[str, dict]:
    mod = MODULES[key]
    url = f"http://127.0.0.1:{mod['port']}{mod.get('health_path', '/')}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"NUNES-Company-System/{VERSION}"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if not (200 <= resp.status < 500):
                return "offline", {}
            payload = json.loads(resp.read().decode("utf-8", "ignore") or "{}")
            expected = _module_instance_id(mod)
            actual = text(payload.get("instance_id"))
            if key == "service_operations":
                # V6.5.9 ULTRA-FAST readiness: compare the source signature when the
                # resident exposes it. This avoids the old brittle VERSION.txt text
                # comparison which could mark a healthy ServiceFlow as permanently stale
                # (and made the Forms card sit on "Preparing in background").
                recognized = text(payload.get("app")) == "ServiceFlowJobCards" and bool(payload.get("ok"))
                if not recognized:
                    return "foreign", payload
                expected_sig = ""
                try:
                    expected_sig = (ROOT_DIR / mod["app_dir"] / "SOURCE_SIGNATURE.txt").read_text(encoding="utf-8").strip()
                except Exception:
                    pass
                actual_sig = text(payload.get("source_signature"))
                if expected_sig and actual_sig:
                    return ("ready" if hmac.compare_digest(actual_sig, expected_sig) else "stale"), payload
                # Legacy resident fallback. A recognized ServiceFlow without a signature
                # is allowed to stay usable; the normal server update path explicitly
                # rebuilds/restarts Servicing when source changes. This keeps clicks fast
                # even while upgrading older resident installations.
                return "ready", payload
            else:
                recognized = bool(payload.get("ok")) and ("time" in payload or text(payload.get("app")) == "NunesPurchasingForms" or bool(actual))
                if not recognized:
                    return "foreign", payload
                if actual == expected:
                    return "ready", payload
                # Older NUNES module instances did not expose instance_id. Treat Purchasing
                # instances from another folder as stale because its SQLite data is local.
                return "stale", payload
    except Exception:
        return "offline", {}

def module_health(key: str, timeout: float = 0.22) -> bool:
    now = time.monotonic()
    with _health_lock:
        hit = _health_cache.get(key)
        ttl = 0.12 if key == "service_operations" else 0.9
        if hit and now - hit[0] <= ttl:
            return hit[1]
    state, _ = module_probe(key, timeout)
    ready = state == "ready"
    with _health_lock:
        _health_cache[key] = (time.monotonic(), ready)
    return ready


def _external_starting(key: str) -> bool:
    if key != "service_operations":
        return False
    try:
        lock = ROOT_DIR / MODULES[key]["app_dir"] / "data" / "startup.lock"
        if not lock.exists():
            return False
        age = time.time() - lock.stat().st_mtime
        if age < 180:
            return True
        lock.unlink(missing_ok=True)
    except Exception:
        pass
    return False


def module_public_url(key: str, mod: dict) -> str:
    env_key = mod.get("public_url_env")
    if env_key:
        value = os.environ.get(str(env_key), "").strip().rstrip("/")
        if value:
            return value
    return ""


def module_statuses() -> dict:
    now = time.time()
    keys = list(MODULES)
    if not keys: return {}
    with ThreadPoolExecutor(max_workers=min(4, len(keys))) as pool:
        ready_map = dict(zip(keys, pool.map(module_health, keys)))
    result = {}
    for key, mod in MODULES.items():
        ready = bool(ready_map.get(key))
        starting = bool((_starting.get(key) and now - _starting[key] < 600 or _external_starting(key)) and not ready)
        result[key] = {
            "ready": ready,
            "starting": starting,
            "port": mod["port"],
            "public_port": mod.get("public_port", mod["port"]),
            "public_url": module_public_url(key, mod),
            "name": mod["name"],
            "subtitle": mod.get("subtitle", ""),
            "home_path": mod.get("home_path", "/"),
            "report_path": mod.get("report_path", "/"),
        }
    return result


def module_status_one(key: str) -> dict:
    if key not in MODULES:
        return {"error": "Unknown module", "ready": False, "starting": False}
    mod = MODULES[key]
    # Fresh direct probe: the embedded form page needs to detect readiness immediately,
    # not wait for the general module-health cache used by dashboard cards.
    state, _payload = module_probe(key, 0.45 if key == "service_operations" else 0.18)
    ready = state == "ready"
    now = time.time()
    return {
        "ready": ready,
        "starting": bool((_starting.get(key) and now - _starting[key] < 600 or _external_starting(key)) and not ready),
        "state": state,
        "port": mod["port"],
        "public_port": mod.get("public_port", mod["port"]),
        "public_url": module_public_url(key, mod),
        "name": mod["name"],
        "subtitle": mod.get("subtitle", ""),
        "home_path": mod.get("home_path", "/"),
        "report_path": mod.get("report_path", "/"),
    }


def start_module(key: str) -> tuple[bool, str]:
    if key not in MODULES:
        return False, "Unknown module"
    if os.name != "nt":
        if CLOUD_MODE:
            return True, "Cloud service is managed automatically"
        return False, "Automatic app start is available on Windows."

    # Servicing hot path: one tiny direct probe, then launch its dedicated fast
    # starter immediately. The starter itself handles stale/foreign port ownership.
    # This avoids the older double health-probe path before Next.js even starts.
    if key == "service_operations":
        state, _ = module_probe(key, 0.35)
        if state == "ready":
            return True, "Already ready"
        if _external_starting(key):
            return True, "Starting"
        with _start_lock:
            last = _starting.get(key, 0)
            if time.time() - last < 2.0:
                return True, "Starting"
            _starting[key] = time.time()
            mod = MODULES[key]
            # SPEED-ONLY: always start Servicing through the owner-PC local-runtime wrapper.
            # This keeps Next.js/node_modules/.next off a NAS/UNC workspace without changing
            # the Servicing UI, API contract, port, data model or workflow.
            start_file = ROOT_DIR / "tools" / "EARLY_START_SERVICING.bat"
            app_dir = ROOT_DIR
            if not start_file.exists():
                return False, f"Startup file is missing: {start_file.name}"
            env = os.environ.copy()
            env["NUNES_INSTANCE_ID"] = _module_instance_id(mod)
            env["NUNES_EMBEDDED"] = "1"
            env["PORT"] = str(mod["port"])
            try:
                subprocess.Popen(
                    ["cmd.exe", "/d", "/c", str(start_file)],
                    cwd=str(app_dir), env=env,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                return True, "Starting"
            except Exception as exc:
                return False, f"Could not start: {exc}"

    if module_health(key):
        return True, "Already ready"
    with _start_lock:
        if module_health(key):
            return True, "Already ready"
        last = _starting.get(key, 0)
        if time.time() - last < 8:
            return True, "Starting"
        _starting[key] = time.time()
        mod = MODULES[key]
        app_dir = ROOT_DIR / mod["app_dir"]
        start_file = app_dir / mod["start_file"]
        if not start_file.exists():
            return False, f"Startup file is missing: {start_file.name}"
        state, _probe = module_probe(key, 0.25)
        if state == "stale":
            stale_pid = _port_pid(int(mod["port"]))
            if stale_pid:
                _stop_pid(stale_pid)
            with _health_lock:
                _health_cache.pop(key, None)
        elif state == "foreign":
            return False, f"Port {mod['port']} is being used by another program."
        env = os.environ.copy()
        env["NUNES_INSTANCE_ID"] = _module_instance_id(mod)
        env["NUNES_EMBEDDED"] = "1"
        env["PORT"] = str(mod["port"])
        try:
            subprocess.Popen(
                ["cmd.exe", "/d", "/c", str(start_file)],
                cwd=str(app_dir), env=env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return True, "Starting"
        except Exception as exc:
            return False, f"Could not start: {exc}"


def _table_exists(conn, name: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def _table_rows(conn, table: str, order_id: int, order_by: str = "row_no") -> list[dict]:
    if not _table_exists(conn, table):
        return []
    try:
        rows = conn.execute(f"SELECT * FROM {table} WHERE order_id=? ORDER BY {order_by}", (order_id,)).fetchall()
    except sqlite3.OperationalError:
        rows = conn.execute(f"SELECT * FROM {table} WHERE order_id=?", (order_id,)).fetchall()
    return [dict(r) for r in rows]


def _table_one(conn, table: str, order_id: int):
    if not _table_exists(conn, table):
        return None
    return rowdict(conn.execute(f"SELECT * FROM {table} WHERE order_id=?", (order_id,)).fetchone())


def _latest_audit_by_section(audit_rows: list[dict]) -> dict[str, dict]:
    latest = {}
    for row in audit_rows:
        section = text(row.get("section")).lower()
        if section and section not in latest:
            latest[section] = row
    return latest


def purchase_report_detail(order_id: int) -> dict:
    db_path = ROOT_DIR / "apps" / "order_forms" / "data" / "nunes_forms.db"
    if not db_path.exists():
        return {"available": False, "error": "Purchasing database has not been created yet."}
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=1.5)
        conn.row_factory = sqlite3.Row
        order = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone() if _table_exists(conn, "orders") else None
        if not order:
            conn.close()
            return {"available": False, "error": "Purchasing report not found."}
        o = dict(order)
        products = _table_rows(conn, "marketing_items", order_id)
        dispatch = _table_one(conn, "dispatch_details", order_id)
        customer_payments = _table_rows(conn, "customer_payments", order_id)
        suppliers = _table_rows(conn, "supplier_rows", order_id)
        accounts = _table_one(conn, "accounts_details", order_id)
        accounts_items = _table_rows(conn, "accounts_items", order_id)
        supplier_payments = _table_rows(conn, "supplier_payments", order_id)
        comments = []
        if _table_exists(conn, "comments") and _table_exists(conn, "users"):
            comments = [dict(r) for r in conn.execute(
                "SELECT c.*, u.full_name FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.order_id=? ORDER BY c.id DESC LIMIT 25",
                (order_id,),
            ).fetchall()]
        audit = []
        if _table_exists(conn, "audit_log"):
            if _table_exists(conn, "users"):
                audit = [dict(r) for r in conn.execute(
                    "SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.order_id=? ORDER BY a.id DESC LIMIT 80",
                    (order_id,),
                ).fetchall()]
            else:
                audit = [dict(r) for r in conn.execute(
                    "SELECT * FROM audit_log WHERE order_id=? ORDER BY id DESC LIMIT 80", (order_id,)
                ).fetchall()]
        conn.close()

        latest_audit = _latest_audit_by_section(audit)
        def audit_person(section):
            a = latest_audit.get(section) or {}
            return text(a.get("full_name"), "")
        def audit_when(section):
            a = latest_audit.get(section) or {}
            return text(a.get("created_at"), "")

        dispatch = dispatch or {}
        accounts = accounts or {}
        stage_people = [
            {
                "key": "marketing", "stage": "Marketing", "completed": bool(o.get("marketing_complete")),
                "person": text(o.get("marketing_person"), audit_person("marketing") or "Not recorded"),
                "role_detail": "Marketing person", "updated_at": audit_when("marketing"),
            },
            {
                "key": "dispatch", "stage": "Dispatch", "completed": bool(o.get("dispatch_complete")),
                "person": text(dispatch.get("packing_by"), text(dispatch.get("sign"), audit_person("dispatch") or "Not recorded")),
                "role_detail": "Packing / dispatch", "updated_at": audit_when("dispatch") or text(dispatch.get("dispatch_on")),
            },
            {
                "key": "payment", "stage": "Payment", "completed": bool(o.get("payment_complete")),
                "person": audit_person("payment") or "Not recorded in form",
                "role_detail": "Saved by", "updated_at": audit_when("payment"),
            },
            {
                "key": "supplier", "stage": "Supplier", "completed": bool(o.get("supplier_complete")),
                "person": audit_person("supplier") or "Not recorded in form",
                "role_detail": "Saved by", "updated_at": audit_when("supplier"),
            },
            {
                "key": "accounts", "stage": "Accounts", "completed": bool(o.get("accounts_complete")),
                "person": text(accounts.get("signature"), audit_person("accounts") or "Not recorded"),
                "role_detail": "Accounts signature", "updated_at": audit_when("accounts") or text(accounts.get("bill_date")),
            },
            {
                "key": "approval", "stage": "Final Approval", "completed": bool(o.get("approval_complete")),
                "person": text(o.get("approved_by"), audit_person("approval") or "Not recorded"),
                "role_detail": "Approved by", "updated_at": text(o.get("approval_date"), audit_when("approval")),
            },
        ]

        order_value = safe_float(o.get("total_order_value"))
        received = sum(safe_float(x.get("amount")) for x in customer_payments)
        purchase_cost = safe_float(accounts.get("total_purchase_cost"))
        selling_cost = safe_float(accounts.get("total_selling_cost"))
        profit = safe_float(accounts.get("profit"))
        supplier_bill = sum(safe_float(x.get("total")) for x in accounts_items)
        supplier_paid = sum(safe_float(x.get("amount")) for x in supplier_payments)

        return {
            "available": True,
            "type": "purchasing",
            "order": {
                "id": o.get("id"),
                "order_id": text(o.get("order_name"), f"Order #{o.get('id')}"),
                "quote_no": text(o.get("quote_no")),
                "quote_date": text(o.get("quote_date")),
                "branch": BRANCH_MAP.get(text(o.get("branch"), "MAIN"), text(o.get("branch"), "MAIN").title()),
                "market_type": text(o.get("market_type"), "IND"),
                "customer_name": text(o.get("customer_name"), "—"),
                "place": text(o.get("place"), "—"),
                "marketing_person": text(o.get("marketing_person"), "—"),
                "delivery_period": text(o.get("delivery_period"), "—"),
                "terms": text(o.get("terms"), "—"),
                "service_person": text(o.get("service_person"), "—"),
                "service_date": text(o.get("service_date")),
                "service_amount": money(o.get("service_amount")),
                "order_place_to": text(o.get("order_place_to"), "—"),
                "remarks": text(o.get("remarks"), "—"),
                "approved_by": text(o.get("approved_by"), "—"),
                "approval_date": text(o.get("approval_date")),
                "status": text(o.get("current_status"), "Draft"),
                "created_at": text(o.get("created_at")),
                "updated_at": text(o.get("updated_at")),
            },
            "financials": {
                "order_value": money(order_value),
                "received": money(received),
                "outstanding": money(max(0, order_value - received)),
                "purchase_cost": money(purchase_cost),
                "selling_cost": money(selling_cost),
                "profit": money(profit),
                "profit_percentage": money(accounts.get("profit_percentage")),
                "supplier_bill": money(supplier_bill),
                "supplier_paid": money(supplier_paid),
                "supplier_balance": money(max(0, supplier_bill - supplier_paid)),
            },
            "products": products,
            "dispatch": dispatch,
            "customer_payments": customer_payments,
            "suppliers": suppliers,
            "accounts": accounts,
            "accounts_items": accounts_items,
            "supplier_payments": supplier_payments,
            "people": stage_people,
            "audit": audit,
            "comments": comments,
            "links": {"form": f"/order/{order_id}", "report": f"/reports/order/{order_id}"},
        }
    except Exception as exc:
        return {"available": False, "error": str(exc)}


def form_overview() -> dict:
    db_path = ROOT_DIR / "apps" / "order_forms" / "data" / "nunes_forms.db"
    empty = {
        "available": False, "data_state": "waiting", "total_orders": 0, "active_orders": 0, "completed_orders": 0,
        "order_value": 0.0, "received": 0.0, "outstanding": 0.0, "purchase_cost": 0.0, "selling_cost": 0.0,
        "profit": 0.0, "this_month_orders": 0, "this_month_value": 0.0, "today_forms": 0, "this_month_forms": 0,
        "statuses": {}, "stage_completion": [], "branches": [], "recent": [], "monthly": [], "daily": [], "latest_output": None,
    }
    if not db_path.exists():
        empty["message"] = "No Purchasing forms have been saved on this server yet."
        return empty
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=1.5)
        conn.row_factory = sqlite3.Row
        if not _table_exists(conn, "orders"):
            conn.close(); return empty
        rows = conn.execute("""
            WITH payment_totals AS (
              SELECT order_id, SUM(COALESCE(amount,0)) AS received
              FROM customer_payments GROUP BY order_id
            ), item_totals AS (
              SELECT order_id, COUNT(*) AS item_count,
                     GROUP_CONCAT(CASE WHEN TRIM(COALESCE(item_name,''))<>'' THEN TRIM(item_name) END, ', ') AS products_summary
              FROM marketing_items GROUP BY order_id
            )
            SELECT o.*,
              COALESCE(p.received,0) received,
              COALESCE(a.total_purchase_cost,0) purchase_cost,
              COALESCE(a.total_selling_cost,0) selling_cost,
              COALESCE(a.profit,0) profit,
              COALESCE(a.profit_percentage,0) profit_percentage,
              COALESCE(mi.item_count,0) item_count,
              COALESCE(mi.products_summary,'') products_summary,
              COALESCE(d.packing_by,'') packing_by,
              COALESCE(d.sign,'') dispatch_sign,
              COALESCE(a.signature,'') accounts_signature
            FROM orders o
            LEFT JOIN payment_totals p ON p.order_id=o.id
            LEFT JOIN item_totals mi ON mi.order_id=o.id
            LEFT JOIN dispatch_details d ON d.order_id=o.id
            LEFT JOIN accounts_details a ON a.order_id=o.id
            ORDER BY o.updated_at DESC, o.id DESC
        """).fetchall()
        conn.close()

        statuses = Counter(text(r["current_status"], "Draft") for r in rows)
        total_value = sum(safe_float(r["total_order_value"]) for r in rows)
        received = sum(safe_float(r["received"]) for r in rows)
        purchase = sum(safe_float(r["purchase_cost"]) for r in rows)
        selling = sum(safe_float(r["selling_cost"]) for r in rows)
        profit = sum(safe_float(r["profit"]) for r in rows)
        today = date.today()
        month_prefix = today.strftime("%Y-%m")
        month_rows = [r for r in rows if text(r["quote_date"]).startswith(month_prefix)]
        # Form-fill reporting is based on when the form record was created, not on quote date.
        # Older records fall back to quote_date so legacy data remains visible.
        purchase_created_dates = []
        for r in rows:
            d = parse_dt(r["created_at"]) or parse_dt(r["quote_date"])
            purchase_created_dates.append(d.date() if d else None)
        today_forms = sum(1 for d in purchase_created_dates if d == today)
        this_month_forms = sum(1 for d in purchase_created_dates if d and d.strftime("%Y-%m") == month_prefix)

        branch_data = defaultdict(lambda: {"orders": 0, "completed": 0, "value": 0.0, "outstanding": 0.0})
        for r in rows:
            key = text(r["branch"], "MAIN")
            b = branch_data[key]; b["orders"] += 1
            if text(r["current_status"]) == "Completed": b["completed"] += 1
            value = safe_float(r["total_order_value"]); rec = safe_float(r["received"])
            b["value"] += value; b["outstanding"] += max(0.0, value - rec)
        branches = []
        ordered_keys = ["MAIN", "GANDHIPURAM", "GOPALAPURAM"] + [k for k in branch_data if k not in {"MAIN", "GANDHIPURAM", "GOPALAPURAM"}]
        for key in ordered_keys:
            if key not in branch_data: continue
            b = branch_data[key]
            branches.append({"key": key, "name": BRANCH_MAP.get(key, key.title()), "orders": b["orders"], "completed": b["completed"], "value": money(b["value"]), "outstanding": money(b["outstanding"])})

        stage_completion = []
        for key, label, field in PURCHASE_STAGES:
            stage_completion.append({"key": key, "label": label, "completed": sum(1 for r in rows if bool(r[field])), "total": len(rows)})

        recent = []
        for r in rows[:20]:
            value = safe_float(r["total_order_value"]); rec = safe_float(r["received"])
            staff = [text(r["marketing_person"]), text(r["packing_by"]), text(r["accounts_signature"]), text(r["approved_by"])]
            staff = [x for x in staff if x]
            done = 0
            current_stage = "Completed"
            for _key, _label, _field in PURCHASE_STAGES:
                if bool(r[_field]):
                    done += 1
                elif current_stage == "Completed":
                    current_stage = _label
            latest_person = next((x for x in [text(r["approved_by"]), text(r["accounts_signature"]), text(r["packing_by"]), text(r["marketing_person"])] if x), "Not recorded")
            recent.append({
                "id": r["id"], "order_id": text(r["order_name"], f"Order #{r['id']}"),
                "quote_no": text(r["quote_no"]), "quote_date": text(r["quote_date"]),
                "branch": BRANCH_MAP.get(text(r["branch"], "MAIN"), text(r["branch"], "MAIN").title()),
                "market_type": text(r["market_type"], "IND"), "customer": text(r["customer_name"], "—"),
                "products": text(r["products_summary"], "—"), "marketing_person": text(r["marketing_person"], "—"), "staff": staff[:4],
                "latest_person": latest_person, "current_stage": current_stage, "progress": round(done / max(1, len(PURCHASE_STAGES)) * 100),
                "status": text(r["current_status"], "Draft"), "value": money(value), "received": money(rec),
                "outstanding": money(max(0.0, value-rec)), "item_count": int(r["item_count"] or 0),
                "updated_at": text(r["updated_at"]), "path": f"/order/{r['id']}", "report_path": f"/reports/order/{r['id']}",
            })

        monthly = []
        for offset in range(5, -1, -1):
            y, m = today.year, today.month - offset
            while m <= 0: m += 12; y -= 1
            prefix = f"{y:04d}-{m:02d}"
            mrows = [r for r in rows if text(r["quote_date"]).startswith(prefix)]
            monthly.append({"key": prefix, "label": datetime(y, m, 1).strftime("%b"), "orders": len(mrows), "value": money(sum(safe_float(r["total_order_value"]) for r in mrows),), "received": money(sum(safe_float(r["received"]) for r in mrows))})

        daily = []
        for offset in range(13, -1, -1):
            d = today - timedelta(days=offset)
            count = sum(1 for x in purchase_created_dates if x == d)
            daily.append({"key": d.isoformat(), "label": d.strftime("%d %b"), "forms": count})

        latest_output = purchase_report_detail(int(rows[0]["id"])) if rows else None
        return {
            "available": True, "data_state": "live", "total_orders": len(rows),
            "active_orders": len(rows) - statuses.get("Completed", 0), "completed_orders": statuses.get("Completed", 0),
            "order_value": money(total_value), "received": money(received), "outstanding": money(max(0.0, total_value-received)),
            "purchase_cost": money(purchase), "selling_cost": money(selling), "profit": money(profit),
            "this_month_orders": len(month_rows), "this_month_value": money(sum(safe_float(r["total_order_value"]) for r in month_rows)),
            "today_forms": today_forms, "this_month_forms": this_month_forms,
            "statuses": dict(statuses), "stage_completion": stage_completion, "branches": branches, "recent": recent, "monthly": monthly, "daily": daily,
            "latest_output": latest_output,
        }
    except Exception as exc:
        empty["data_state"] = "error"; empty["error"] = str(exc); return empty


def service_report_detail(job_id: str) -> dict:
    jobs_path = ROOT_DIR / "apps" / "service_operations" / "data" / "jobs.json"
    if not jobs_path.exists():
        return {"available": False, "error": "Servicing database has not been created yet."}
    try:
        jobs = _service_jobs()
        job = next((j for j in jobs if str(j.get("id")) == str(job_id)), None)
        if not job:
            return {"available": False, "error": "Service report not found."}
        customer = job.get("customer") or {}; receipt = job.get("receipt") or {}; dispatch = job.get("dispatch") or {}; payment = job.get("payment") or {}; signoff = job.get("signoff") or {}
        products = job.get("products") or []; totals = job.get("totals") or {}; communication = job.get("communication") or {}
        people = [
            {"stage": "Received", "person": text(signoff.get("receivedBy"), "Not recorded"), "role_detail": "Received by", "completed": bool(text(signoff.get("receivedBy")))},
            {"stage": "Inspection", "person": text(signoff.get("inspectedBy"), "Not recorded"), "role_detail": "Inspected by", "completed": bool(text(signoff.get("inspectedBy")))},
            {"stage": "Estimate", "person": text(signoff.get("estimateConfirmedBy"), "Not recorded"), "role_detail": "Estimate confirmed by", "completed": bool(text(signoff.get("estimateConfirmedBy")))},
            {"stage": "Repair", "person": text(signoff.get("repairedBy"), "Not recorded"), "role_detail": "Repaired by", "completed": bool(text(signoff.get("repairedBy")))},
            {"stage": "Testing / Dispatch", "person": text(dispatch.get("testedBy"), "Not recorded"), "role_detail": "Tested by", "completed": bool(text(dispatch.get("testedBy")))},
            {"stage": "Payment", "person": text(payment.get("receivedBy"), "Not recorded"), "role_detail": "Payment received by", "completed": bool(text(payment.get("receivedBy")))},
        ]
        return {
            "available": True, "type": "servicing",
            "job": {
                "id": job.get("id"), "job_no": text(job.get("jobNo"), "Service Job"), "job_date": text(job.get("jobDate")),
                "status": text(job.get("status"), "RECEIVED"), "branch": text(job.get("branchName"), "—"),
                "office_type": text(job.get("officeType"), "—"), "notes": text(job.get("notes"), "—"),
                "created_at": text(job.get("createdAt")), "updated_at": text(job.get("updatedAt")),
            },
            "customer": customer, "receipt": receipt, "dispatch": dispatch, "payment": payment, "signoff": signoff,
            "products": products, "totals": {
                "product_value": money(totals.get("productValue")), "repair_estimate": money(totals.get("repairEstimate")),
                "discount": money(totals.get("discount")), "total_estimate": money(totals.get("totalEstimate")),
            },
            "communication": communication, "attachments": job.get("attachments") or [], "people": people,
            "links": {"form": f"/jobs/{job.get('id')}" if job.get("id") else "/"},
        }
    except Exception as exc:
        return {"available": False, "error": str(exc)}


def service_overview() -> dict:
    jobs_path = ROOT_DIR / "apps" / "service_operations" / "data" / "jobs.json"
    empty = {
        "available": False, "data_state": "waiting", "total_jobs": 0, "open_jobs": 0, "repairing": 0, "ready": 0,
        "pending_price": 0, "total_estimate": 0.0, "today_forms": 0, "this_month_forms": 0,
        "statuses": {}, "recent": [], "monthly": [], "daily": [], "branches": [], "latest_output": None,
    }
    if not jobs_path.exists():
        empty["message"] = "No Servicing forms have been saved on this server yet."
        return empty
    try:
        jobs = _service_jobs()
        jobs = sorted(jobs, key=lambda j: text(j.get("updatedAt")), reverse=True)
        statuses = Counter(text(j.get("status"), "RECEIVED") for j in jobs)
        closed = {"CLOSED", "DISPATCHED"}
        total_estimate = sum(safe_float((j.get("totals") or {}).get("totalEstimate")) for j in jobs)
        pending_price = sum(1 for j in jobs if any(not bool(p.get("onlinePriceConfirmed")) for p in (j.get("products") or [])))

        branches_map = defaultdict(lambda: {"jobs": 0, "open": 0, "estimate": 0.0})
        recent = []
        for j in jobs:
            bname = text(j.get("branchName"), "—")
            b = branches_map[bname]; b["jobs"] += 1; b["estimate"] += safe_float((j.get("totals") or {}).get("totalEstimate"))
            if text(j.get("status")) not in closed: b["open"] += 1
        _service_progress = {"DRAFT": 5, "RECEIVED": 15, "ESTIMATE_PENDING": 35, "APPROVAL_PENDING": 45, "REPAIRING": 65, "READY": 82, "DISPATCHED": 95, "CLOSED": 100}
        _service_stage = {"DRAFT": "Draft", "RECEIVED": "Received / Inspection", "ESTIMATE_PENDING": "Estimate", "APPROVAL_PENDING": "Customer Approval", "REPAIRING": "Repair", "READY": "Testing / Ready", "DISPATCHED": "Dispatch", "CLOSED": "Completed"}
        for j in jobs[:20]:
            products = j.get("products") or []; customer = j.get("customer") or {}; signoff = j.get("signoff") or {}; dispatch = j.get("dispatch") or {}; payment = j.get("payment") or {}
            staff = [text(signoff.get("receivedBy")), text(signoff.get("inspectedBy")), text(signoff.get("estimateConfirmedBy")), text(signoff.get("repairedBy")), text(dispatch.get("testedBy")), text(payment.get("receivedBy"))]
            staff = [x for i,x in enumerate(staff) if x and x not in staff[:i]]
            first = products[0] if products else {}
            status = text(j.get("status"), "RECEIVED")
            recent.append({
                "id": j.get("id"), "job_no": text(j.get("jobNo"), "Service Job"), "date": text(j.get("jobDate")),
                "branch": text(j.get("branchName"), "—"), "customer": text(customer.get("name"), "—"),
                "product": text(first.get("productName"), "—"), "model": text(first.get("makeModel"), "—"), "product_count": len(products),
                "problem": text(first.get("complaint"), text(first.get("repairWork"), "—")), "repair_work": text(first.get("repairWork"), "—"),
                "status": status, "current_stage": _service_stage.get(status, status.replace("_", " ").title()), "progress": _service_progress.get(status, 20),
                "estimate": money((j.get("totals") or {}).get("totalEstimate")), "payment_mode": text(payment.get("mode"), text(payment.get("paymentMode"))),
                "staff": staff[:6], "latest_person": staff[-1] if staff else "Not recorded",
                "updated_at": text(j.get("updatedAt")), "path": f"/jobs/{j.get('id')}" if j.get("id") else "/",
            })

        today = date.today(); monthly = []
        month_prefix = today.strftime("%Y-%m")
        service_created_dates = []
        for j in jobs:
            d = parse_dt(j.get("createdAt")) or parse_dt(j.get("jobDate"))
            service_created_dates.append(d.date() if d else None)
        today_forms = sum(1 for d in service_created_dates if d == today)
        this_month_forms = sum(1 for d in service_created_dates if d and d.strftime("%Y-%m") == month_prefix)
        for offset in range(5, -1, -1):
            y, m = today.year, today.month - offset
            while m <= 0: m += 12; y -= 1
            prefix = f"{y:04d}-{m:02d}"
            mrows = [j for j in jobs if text(j.get("jobDate"), text(j.get("createdAt"))).startswith(prefix)]
            monthly.append({
                "key": prefix, "label": datetime(y, m, 1).strftime("%b"), "jobs": len(mrows),
                "estimate": money(sum(safe_float((j.get("totals") or {}).get("totalEstimate")) for j in mrows)),
            })
        daily = []
        for offset in range(13, -1, -1):
            d = today - timedelta(days=offset)
            count = sum(1 for x in service_created_dates if x == d)
            daily.append({"key": d.isoformat(), "label": d.strftime("%d %b"), "forms": count})
        branches = [{"name": k, "jobs": v["jobs"], "open": v["open"], "estimate": money(v["estimate"])} for k, v in branches_map.items()]
        branches.sort(key=lambda x: (-x["jobs"], x["name"]))
        latest_output = service_report_detail(str(jobs[0].get("id"))) if jobs and jobs[0].get("id") else None
        return {
            "available": True, "data_state": "live", "total_jobs": len(jobs),
            "open_jobs": sum(1 for j in jobs if text(j.get("status")) not in closed), "repairing": statuses.get("REPAIRING", 0),
            "ready": statuses.get("READY", 0), "pending_price": pending_price, "total_estimate": money(total_estimate),
            "today_forms": today_forms, "this_month_forms": this_month_forms,
            "statuses": {k: statuses.get(k, 0) for k in SERVICE_STATUS_ORDER if statuses.get(k, 0)} | {k: v for k, v in statuses.items() if k not in SERVICE_STATUS_ORDER},
            "recent": recent, "monthly": monthly, "daily": daily, "branches": branches, "latest_output": latest_output,
        }
    except Exception as exc:
        empty["data_state"] = "error"; empty["error"] = str(exc); return empty



def _build_process_status_payload() -> dict:
    purchasing = []
    db_path = ROOT_DIR / "apps" / "order_forms" / "data" / "nunes_forms.db"
    if db_path.exists():
        try:
            conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=1.5)
            conn.row_factory = sqlite3.Row
            if _table_exists(conn, "orders"):
                rows = conn.execute("SELECT * FROM orders ORDER BY updated_at DESC, id DESC LIMIT 150").fetchall()
                latest_audit = _latest_purchase_audits(conn)
                for r in rows:
                    o = dict(r)
                    done = 0
                    current_stage = "Completed"
                    for key, label, field in PURCHASE_STAGES:
                        if bool(o.get(field)):
                            done += 1
                        elif current_stage == "Completed":
                            current_stage = label
                    staff = []
                    for v in [o.get("marketing_person"), o.get("approved_by")]:
                        v = text(v)
                        if v and v not in staff: staff.append(v)
                    latest_person = staff[-1] if staff else ""
                    a = latest_audit.get(int(o.get("id") or 0)) or {}
                    if text(a.get("full_name")):
                        latest_person = text(a.get("full_name"))
                        if latest_person not in staff: staff.insert(0, latest_person)
                    purchasing.append({
                        "id": o.get("id"), "order_id": text(o.get("order_name"), f"Order #{o.get('id')}"),
                        "customer": text(o.get("customer_name"), "—"), "market_type": text(o.get("market_type"), "IND"),
                        "branch": BRANCH_MAP.get(text(o.get("branch"), "MAIN"), text(o.get("branch"), "MAIN").title()),
                        "status": text(o.get("current_status"), "Draft"), "current_stage": current_stage,
                        "progress": round(done / max(1, len(PURCHASE_STAGES)) * 100), "staff": staff[:5],
                        "latest_person": latest_person or "Not recorded", "updated_at": text(o.get("updated_at")),
                        "value": money(o.get("total_order_value")),
                    })
            conn.close()
        except Exception:
            pass

    servicing = []
    jobs_path = ROOT_DIR / "apps" / "service_operations" / "data" / "jobs.json"
    if jobs_path.exists():
        try:
            jobs = sorted(_service_jobs(), key=lambda j: text(j.get("updatedAt")), reverse=True)[:150]
            progress_map = {
                "DRAFT": 5, "RECEIVED": 15, "ESTIMATE_PENDING": 35, "APPROVAL_PENDING": 45,
                "REPAIRING": 65, "READY": 82, "DISPATCHED": 95, "CLOSED": 100,
            }
            stage_map = {
                "DRAFT": "Draft", "RECEIVED": "Received / Inspection", "ESTIMATE_PENDING": "Estimate",
                "APPROVAL_PENDING": "Customer Approval", "REPAIRING": "Repair", "READY": "Testing / Ready",
                "DISPATCHED": "Dispatch", "CLOSED": "Completed",
            }
            for j in jobs:
                status = text(j.get("status"), "RECEIVED")
                signoff = j.get("signoff") or {}; dispatch = j.get("dispatch") or {}; payment = j.get("payment") or {}
                staff = []
                for v in [signoff.get("receivedBy"), signoff.get("inspectedBy"), signoff.get("estimateConfirmedBy"), signoff.get("repairedBy"), dispatch.get("testedBy"), payment.get("receivedBy")]:
                    v = text(v)
                    if v and v not in staff: staff.append(v)
                products = j.get("products") or []; customer = j.get("customer") or {}
                servicing.append({
                    "id": j.get("id"), "job_no": text(j.get("jobNo"), "Service Job"),
                    "customer": text(customer.get("name"), "—"), "branch": text(j.get("branchName"), "—"),
                    "status": status, "current_stage": stage_map.get(status, status.replace("_", " ").title()),
                    "progress": progress_map.get(status, 20), "staff": staff[:6],
                    "latest_person": staff[-1] if staff else "Not recorded",
                    "updated_at": text(j.get("updatedAt")),
                    "product": text(products[0].get("productName") if products else "", "—"),
                    "estimate": money((j.get("totals") or {}).get("totalEstimate")),
                })
        except Exception:
            pass
    return {"generated_at": datetime.now().isoformat(timespec="seconds"), "purchasing": purchasing, "servicing": servicing}


def process_status_payload() -> dict:
    return _cached_payload("process-status", 0.8, _build_process_status_payload)

def parse_dt(value):
    raw=text(value)
    if not raw: return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        for fmt in ("%Y-%m-%d %H:%M:%S","%Y-%m-%d","%d-%m-%Y","%d/%m/%Y"):
            try: return datetime.strptime(raw[:19], fmt)
            except Exception: pass
    return None

def waiting_hours(value) -> int:
    d=parse_dt(value)
    if not d: return 0
    return max(0, int((datetime.now()-d).total_seconds()//3600))

def is_today(value) -> bool:
    d=parse_dt(value)
    return bool(d and d.date()==date.today())

def current_purchase_stage(o: dict) -> tuple[str,int]:
    done=0; current="Completed"
    for _,label,field in PURCHASE_STAGES:
        if bool(o.get(field)): done+=1
        elif current=="Completed": current=label
    return current, round(done/max(1,len(PURCHASE_STAGES))*100)

SERVICE_STAGE_MAP={
    "DRAFT":"Draft","RECEIVED":"Received / Inspection","ESTIMATE_PENDING":"Estimate",
    "APPROVAL_PENDING":"Customer Approval","REPAIRING":"Repair","READY":"Testing / Ready",
    "DISPATCHED":"Dispatch","CLOSED":"Completed",
}
SERVICE_PROGRESS_MAP={"DRAFT":5,"RECEIVED":15,"ESTIMATE_PENDING":35,"APPROVAL_PENDING":45,"REPAIRING":65,"READY":82,"DISPATCHED":95,"CLOSED":100}

def _build_tasks_payload() -> dict:
    pitems=[]; sitems=[]; completed_today=0
    db_path=ROOT_DIR/"apps"/"order_forms"/"data"/"nunes_forms.db"
    if db_path.exists():
        try:
            conn=sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro",uri=True,timeout=1.5); conn.row_factory=sqlite3.Row
            if _table_exists(conn,"orders"):
                rows=conn.execute("SELECT * FROM orders ORDER BY updated_at DESC,id DESC LIMIT 250").fetchall()
                latest_audit=_latest_purchase_audits(conn)
                for rr in rows:
                    o=dict(rr); stage,progress=current_purchase_stage(o); status=text(o.get("current_status"),"Draft"); wh=waiting_hours(o.get("updated_at"))
                    if status=="Completed":
                        if is_today(o.get("updated_at")): completed_today+=1
                        continue
                    staff=[]
                    for v in [o.get("marketing_person"),o.get("approved_by")]:
                        v=text(v)
                        if v and v not in staff: staff.append(v)
                    latest=staff[-1] if staff else ""
                    a=latest_audit.get(int(o.get("id") or 0)) or {}
                    if text(a.get("full_name")): latest=text(a.get("full_name"))
                    attention=wh>=48
                    priority="High" if attention else ("Normal" if wh>=12 else "Low")
                    pitems.append({"id":o.get("id"),"source":"purchasing","record_no":text(o.get("order_name"),f"Order #{o.get('id')}"),"customer":text(o.get("customer_name"),"—"),"branch":BRANCH_MAP.get(text(o.get("branch"),"MAIN"),text(o.get("branch"),"MAIN").title()),"current_stage":stage,"status":status,"progress":progress,"responsible_team":stage,"assigned_to":latest,"priority":priority,"updated_at":text(o.get("updated_at")),"waiting_hours":wh,"needs_attention":attention,"action_path":f"/process/purchasing/{o.get('id')}"})
            conn.close()
        except Exception: pass
    jobs_path=ROOT_DIR/"apps"/"service_operations"/"data"/"jobs.json"
    if jobs_path.exists():
        try:
            jobs=_service_jobs()
            for j in sorted(jobs,key=lambda x:text(x.get("updatedAt")),reverse=True)[:250]:
                status=text(j.get("status"),"RECEIVED"); wh=waiting_hours(j.get("updatedAt"))
                if status=="CLOSED":
                    if is_today(j.get("updatedAt")): completed_today+=1
                    continue
                sign=j.get("signoff") or {}; dispatch=j.get("dispatch") or {}; payment=j.get("payment") or {}
                staff=[text(x) for x in [sign.get("receivedBy"),sign.get("inspectedBy"),sign.get("estimateConfirmedBy"),sign.get("repairedBy"),dispatch.get("testedBy"),payment.get("receivedBy")] if text(x)]
                latest=staff[-1] if staff else ""; attention=wh>=48 or (status in {"ESTIMATE_PENDING","APPROVAL_PENDING"} and wh>=24)
                priority="High" if attention else ("Normal" if wh>=12 else "Low")
                customer=j.get("customer") or {}; products=j.get("products") or []
                sitems.append({"id":j.get("id"),"source":"servicing","record_no":text(j.get("jobNo"),"Service Job"),"customer":text(customer.get("name"),"—"),"product":text(products[0].get("productName") if products else "","—"),"branch":text(j.get("branchName"),"—"),"current_stage":SERVICE_STAGE_MAP.get(status,status.replace("_"," ").title()),"status":status,"progress":SERVICE_PROGRESS_MAP.get(status,20),"responsible_team":SERVICE_STAGE_MAP.get(status,status.replace("_"," ").title()),"assigned_to":latest,"priority":priority,"updated_at":text(j.get("updatedAt")),"waiting_hours":wh,"needs_attention":attention,"action_path":f"/process/servicing/{j.get('id')}"})
        except Exception: pass
    all_items=pitems+sitems
    return {"generated_at":datetime.now().isoformat(timespec="seconds"),"purchasing":pitems,"servicing":sitems,"summary":{"active":len(all_items),"waiting":sum(1 for x in all_items if x["waiting_hours"]>=12),"needs_attention":sum(1 for x in all_items if x["needs_attention"]),"completed_today":completed_today}}


def tasks_payload() -> dict:
    return _cached_payload("tasks", 0.8, _build_tasks_payload)

def _build_activity_payload(limit=120) -> dict:
    items=[]
    db_path=ROOT_DIR/"apps"/"order_forms"/"data"/"nunes_forms.db"
    if db_path.exists():
        try:
            conn=sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro",uri=True,timeout=1.5); conn.row_factory=sqlite3.Row
            if _table_exists(conn,"audit_log"):
                join_users="LEFT JOIN users u ON u.id=a.user_id" if _table_exists(conn,"users") else ""
                user_col="u.full_name" if _table_exists(conn,"users") else "'' as full_name"
                rows=conn.execute(f"SELECT a.*, {user_col}, o.order_name, o.customer_name FROM audit_log a {join_users} LEFT JOIN orders o ON o.id=a.order_id ORDER BY a.id DESC LIMIT ?",(limit,)).fetchall()
                for r in rows:
                    d=dict(r); items.append({"id":f"p-{d.get('id')}","source":"purchasing","record_id":d.get("order_id"),"record_no":text(d.get("order_name"),f"Order #{d.get('order_id')}"),"customer":text(d.get("customer_name")),"person":text(d.get("full_name"),"System / not recorded"),"department":text(d.get("section"),"Purchasing").title(),"action":text(d.get("action"),"Updated"),"detail":text(d.get("details")),"timestamp":text(d.get("created_at")),"kind":"audit"})
            conn.close()
        except Exception: pass
    jobs_path=ROOT_DIR/"apps"/"service_operations"/"data"/"jobs.json"
    if jobs_path.exists():
        try:
            jobs=_service_jobs()
            for j in sorted(jobs,key=lambda x:text(x.get("updatedAt")),reverse=True)[:limit]:
                sign=j.get("signoff") or {}; dispatch=j.get("dispatch") or {}; payment=j.get("payment") or {}
                staff=[text(x) for x in [sign.get("receivedBy"),sign.get("inspectedBy"),sign.get("estimateConfirmedBy"),sign.get("repairedBy"),dispatch.get("testedBy"),payment.get("receivedBy")] if text(x)]
                customer=j.get("customer") or {}; status=text(j.get("status"),"RECEIVED")
                items.append({"id":f"s-{j.get('id')}-{text(j.get('updatedAt'))}","source":"servicing","record_id":j.get("id"),"record_no":text(j.get("jobNo"),"Service Job"),"customer":text(customer.get("name")),"person":staff[-1] if staff else "Not recorded","department":SERVICE_STAGE_MAP.get(status,"Servicing"),"action":f"Service job updated — {SERVICE_STAGE_MAP.get(status,status.replace('_',' ').title())}","detail":"Latest saved service-job activity. Detailed per-stage timestamps are not stored by the current Servicing source application.","timestamp":text(j.get("updatedAt")),"kind":"snapshot"})
        except Exception: pass
    items.sort(key=lambda x: parse_dt(x.get("timestamp")) or datetime.min, reverse=True)
    return {"generated_at":datetime.now().isoformat(timespec="seconds"),"items":items[:limit],"source_counts":{"purchasing":sum(1 for x in items if x["source"]=="purchasing"),"servicing":sum(1 for x in items if x["source"]=="servicing")}}

def activity_payload(limit=120) -> dict:
    return _cached_payload(f"activity:{limit}", 1.2, lambda: _build_activity_payload(limit))

def _build_team_payload() -> dict:
    people={}; purchasing_users=[]
    def touch(name,module,when="",role=""):
        name=text(name)
        if not name: return
        x=people.setdefault(name,{"name":name,"purchasing_actions":0,"purchasing_records":set(),"servicing_jobs":set(),"service_roles":set(),"latest_activity":"","modules":set()})
        x["modules"].add(module)
        if when and (not x["latest_activity"] or (parse_dt(when) or datetime.min)>(parse_dt(x["latest_activity"]) or datetime.min)): x["latest_activity"]=when
        if role: x["service_roles"].add(role)
    db_path=ROOT_DIR/"apps"/"order_forms"/"data"/"nunes_forms.db"
    if db_path.exists():
        try:
            conn=sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro",uri=True,timeout=1.5); conn.row_factory=sqlite3.Row
            if _table_exists(conn,"users"):
                purchasing_users=[dict(r) for r in conn.execute("SELECT id,username,full_name,role,active,created_at FROM users ORDER BY active DESC,full_name").fetchall()]
            if _table_exists(conn,"audit_log") and _table_exists(conn,"users"):
                for r in conn.execute("SELECT a.order_id,a.created_at,u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC").fetchall():
                    name=text(r["full_name"]); touch(name,"Purchasing",text(r["created_at"]));
                    if name:
                        people[name]["purchasing_actions"]+=1; people[name]["purchasing_records"].add(r["order_id"])
            conn.close()
        except Exception: pass
    jobs_path=ROOT_DIR/"apps"/"service_operations"/"data"/"jobs.json"
    if jobs_path.exists():
        try:
            jobs=_service_jobs()
            roles=[("Received",lambda j:(j.get("signoff") or {}).get("receivedBy")),("Inspection",lambda j:(j.get("signoff") or {}).get("inspectedBy")),("Estimate",lambda j:(j.get("signoff") or {}).get("estimateConfirmedBy")),("Repair",lambda j:(j.get("signoff") or {}).get("repairedBy")),("Testing",lambda j:(j.get("dispatch") or {}).get("testedBy")),("Payment",lambda j:(j.get("payment") or {}).get("receivedBy"))]
            for j in jobs:
                for role,getter in roles:
                    name=text(getter(j)); touch(name,"Servicing",text(j.get("updatedAt")),role)
                    if name: people[name]["servicing_jobs"].add(str(j.get("id")))
        except Exception: pass
    out=[]
    for x in people.values():
        out.append({"name":x["name"],"purchasing_actions":x["purchasing_actions"],"purchasing_records":len(x["purchasing_records"]),"servicing_jobs":len(x["servicing_jobs"]),"service_roles":sorted(x["service_roles"]),"latest_activity":x["latest_activity"],"modules":sorted(x["modules"])})
    out.sort(key=lambda x:(x["purchasing_actions"]+x["servicing_jobs"],x["latest_activity"]),reverse=True)
    return {"generated_at":datetime.now().isoformat(timespec="seconds"),"people":out,"purchasing_users":purchasing_users,"summary":{"people":len(out),"purchasing_people":sum(1 for x in out if "Purchasing" in x["modules"]),"servicing_people":sum(1 for x in out if "Servicing" in x["modules"])}}

def team_payload() -> dict:
    return _cached_payload("team", 5.0, _build_team_payload)

def search_payload(query: str) -> dict:
    q=text(query).lower(); results=[]
    if len(q)<2: return {"query":query,"results":[]}
    statuses=process_status_payload()
    for r in statuses.get("purchasing",[]):
        blob=" ".join([str(r.get(k,"")) for k in ["order_id","customer","branch","status","current_stage","latest_person"]]+[str(x) for x in r.get("staff",[]) ]).lower()
        if q in blob:
            results.append({"source":"purchasing","id":r.get("id"),"record_no":r.get("order_id"),"title":r.get("customer"),"subtitle":r.get("branch"),"status":r.get("status"),"stage":r.get("current_stage"),"matched":"Order / customer / worker / status","updated_at":r.get("updated_at")})
    for r in statuses.get("servicing",[]):
        blob=" ".join([str(r.get(k,"")) for k in ["job_no","customer","product","branch","status","current_stage","latest_person"]]+[str(x) for x in r.get("staff",[]) ]).lower()
        if q in blob:
            results.append({"source":"servicing","id":r.get("id"),"record_no":r.get("job_no"),"title":r.get("customer"),"subtitle":r.get("product"),"status":r.get("status"),"stage":r.get("current_stage"),"matched":"Job / customer / product / worker / status","updated_at":r.get("updated_at")})
    results.sort(key=lambda x:parse_dt(x.get("updated_at")) or datetime.min,reverse=True)
    return {"query":query,"results":results[:30]}

def notifications_payload() -> dict:
    t=tasks_payload(); items=[]
    for x in (t["purchasing"]+t["servicing"]):
        if x["needs_attention"]:
            items.append({"id":f"attention-{x['source']}-{x['id']}","source":x["source"],"title":f"{x['record_no']} needs attention","detail":f"{x['current_stage']} has not changed for about {x['waiting_hours']} hours.","severity":"danger","timestamp":x["updated_at"],"href":x["action_path"]})
        elif x["waiting_hours"]>=12:
            items.append({"id":f"waiting-{x['source']}-{x['id']}","source":x["source"],"title":f"{x['record_no']} is waiting","detail":f"Current stage: {x['current_stage']}.","severity":"warning","timestamp":x["updated_at"],"href":x["action_path"]})
    items.sort(key=lambda x:parse_dt(x.get("timestamp")) or datetime.min,reverse=True)
    return {"generated_at":datetime.now().isoformat(timespec="seconds"),"count":len(items),"items":items[:20]}

def _build_overview_payload() -> dict:
    # Dashboard data must never wait on form-engine health checks. Engine status is loaded
    # separately on the Forms page, which keeps the owner dashboard fast.
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_forms = pool.submit(form_overview)
        f_service = pool.submit(service_overview)
        forms = f_forms.result(); service = f_service.result()
    ip = local_ipv4(); public_url = os.environ.get("NUNES_PUBLIC_URL", "").strip()
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"), "forms": forms, "service": service, "modules": {},
        "system": {
            "product": "NUNES Company Data API", "version": VERSION, "mode": "cloud" if CLOUD_MODE else "windows", "port": PORT,
            "lan_ip": ip, "lan_url": public_url or f"http://{ip}:{PORT}", "public_url": public_url,
            "local_url": f"http://127.0.0.1:{PORT}", "windows_arch": platform.machine(),
        },
    }


def overview_payload() -> dict:
    return _cached_payload("overview", 0.8, _build_overview_payload)

def revision_payload() -> dict:
    stamp = _data_stamp()
    token = hashlib.sha1(repr(stamp).encode("utf-8", "ignore")).hexdigest()[:20]
    return {
        "revision": token,
        "purchasing": {"db": stamp[0], "wal": stamp[1]},
        "servicing": {"jobs": stamp[2]},
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and "/api/overview" in args[0]: return
        super().log_message(fmt, *args)

    def _cors_headers(self):
        origin = self.headers.get("Origin", "").strip().rstrip("/")
        if origin in BROWSER_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Nunes-Data-Token, X-Nunes-Client")
            # Chrome Local Network Access / Private Network Access preflight support.
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def _json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers(); self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _api_authorized(self) -> bool:
        if not CLOUD_MODE:
            return True
        if not DATA_API_TOKEN:
            return False
        supplied = self.headers.get("Authorization", "").strip()
        if supplied.lower().startswith("bearer "):
            supplied = supplied[7:].strip()
        else:
            supplied = self.headers.get("X-Nunes-Data-Token", "").strip()
        return bool(supplied) and hmac.compare_digest(supplied, DATA_API_TOKEN)

    def do_GET(self):
        parsed = urlparse(self.path); p = parsed.path
        if p == "/api/health":
            return self._json({"ok": True, "product": "NUNES Company Data API", "version": VERSION, "mode": "cloud" if CLOUD_MODE else "windows", "auth_required": bool(CLOUD_MODE), "port": PORT, "time": datetime.now().isoformat(timespec="seconds")})
        if p.startswith("/api/") and not self._api_authorized():
            return self._json({"error": "Unauthorized company data request"}, 401)
        if p == "/api/overview": return self._json(overview_payload())
        if p == "/api/revision": return self._json(revision_payload())
        if p == "/api/process-status": return self._json(process_status_payload())
        if p == "/api/tasks": return self._json(tasks_payload())
        if p == "/api/activity": return self._json(activity_payload())
        if p == "/api/team": return self._json(team_payload())
        if p == "/api/notifications": return self._json(notifications_payload())
        if p == "/api/search":
            qs=parse_qs(parsed.query); return self._json(search_payload((qs.get("q") or [""])[0]))
        if p == "/api/modules": return self._json(module_statuses())
        if p.startswith("/api/modules/"):
            key = p.split("/api/modules/", 1)[1].strip("/")
            if key and "/" not in key:
                status = module_status_one(key)
                return self._json(status, 200 if "error" not in status else 404)
        if p.startswith("/api/reports/purchasing/"):
            try: oid = int(p.rsplit("/", 1)[-1]); return self._json(purchase_report_detail(oid))
            except Exception: return self._json({"available": False, "error": "Invalid Purchasing report id."}, 400)
        if p.startswith("/api/reports/servicing/"):
            jid = unquote(p.split("/api/reports/servicing/", 1)[1])
            return self._json(service_report_detail(jid))
        if p.startswith("/api/"): return self._json({"error": "Not found"}, 404)
        if p not in {"/", "/index.html"} and not (STATIC_DIR / p.lstrip("/")).exists(): self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self._api_authorized():
            return self._json({"error": "Unauthorized company data request"}, 401)
        if parsed.path.startswith("/api/modules/") and parsed.path.endswith("/start"):
            key = parsed.path.split("/")[3]; ok, message = start_module(key)
            return self._json({"ok": ok, "message": message, "module": key}, 200 if ok else 400)
        return self._json({"error": "Not found"}, 404)


def main():
    print("=" * 72); print(f" NUNES COMPANY DATA API - V{VERSION}"); print("=" * 72)
    print(f" Data API       : http://127.0.0.1:{PORT}")
    if CLOUD_MODE:
        print(f" Public URL     : {os.environ.get('NUNES_PUBLIC_URL', 'configured by cloud installer')}")
        print(" Purchasing     : live report data read directly from its saved database")
        print(" Servicing      : live report data read directly from its saved job records")
    else:
        print(f" Other devices  : http://{local_ipv4()}:{PORT}")
    print("=" * 72)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == "__main__":
    main()
