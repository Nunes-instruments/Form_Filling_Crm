from __future__ import annotations
import os, json, sqlite3, socket, tempfile, sys, subprocess, hashlib
import urllib.request, urllib.error
from pathlib import Path
from datetime import datetime
from functools import wraps

# V1.0.12 keeps the lightweight local package folder from V1.0.11 and adds a sequential team workflow UI.
# This avoids the Windows "No pyvenv.cfg file" problem and makes first setup faster.
_APP_ROOT = Path(__file__).resolve().parent
_RUNTIME_SITE = _APP_ROOT / ".nunes_runtime" / "site-packages"
if _RUNTIME_SITE.exists():
    sys.path.insert(0, str(_RUNTIME_SITE))

from werkzeug.security import generate_password_hash, check_password_hash
from flask import Flask, render_template, request, redirect, url_for, session, flash, send_file, jsonify

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
DB = DATA / "nunes_forms.db"
CONFIG = DATA / "integration_config.json"
FIRST_LOGIN = DATA / "OFFICE_MODE.txt"
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "Nunes@1234"

app = Flask(__name__)
SECRET_FILE = DATA / "app_secret.key"
if not SECRET_FILE.exists():
    import secrets
    SECRET_FILE.write_text(secrets.token_hex(32), encoding="utf-8")
app.secret_key = os.environ.get("NUNES_SECRET_KEY") or SECRET_FILE.read_text(encoding="utf-8").strip()

ROLES = ["Admin","Marketing","Dispatch","Payments","Supplier","Accounts","Approver","ReadOnly"]

# Office branch/company choices. Keep these labels stable because they are stored in reports/exports.
BRANCHES = [
    # Order ID prefix rules requested by office. The numeric sequence is GLOBAL
    # across all branches: whichever branch creates the next order gets the next number.
    #   Rathinapuri (Main) -> NM + month initial + global sequence
    #   Gandhipuram       -> NG + month initial + global sequence
    #   Gopalapuram       -> NGO + month initial + global sequence
    {"key": "MAIN", "name": "Nunes Instrumentation - Rathinapuri", "location": "Rathinapuri", "prefix": "NM"},
    {"key": "GANDHIPURAM", "name": "Nunes Instrumentation - Gandhipuram", "location": "Gandhipuram", "prefix": "NG"},
    {"key": "GOPALAPURAM", "name": "Nunes Instrumentation - Gopalapuram", "location": "Gopalapuram", "prefix": "NGO"},
]
BRANCH_BY_KEY = {b["key"]: b for b in BRANCHES}
DEFAULT_BRANCH = "MAIN"
MARKET_TYPES = ["IND", "EXPORT"]
DEFAULT_MARKET_TYPE = "IND"

# V1.0.12: one-at-a-time team workflow. A section becomes available only
# after the previous team has completed its section. Completed sections remain
# reviewable, while future sections stay locked until they are reached.
WORKFLOW_STEPS = [
    {"key":"marketing", "label":"Marketing", "complete_field":"marketing_complete", "team":"Marketing"},
    {"key":"dispatch", "label":"Dispatch", "complete_field":"dispatch_complete", "team":"Dispatch"},
    {"key":"payment", "label":"Payment", "complete_field":"payment_complete", "team":"Payments"},
    {"key":"supplier", "label":"Supplier", "complete_field":"supplier_complete", "team":"Supplier"},
    {"key":"accounts", "label":"Accounts", "complete_field":"accounts_complete", "team":"Accounts"},
    {"key":"approval", "label":"Final Approval", "complete_field":"approval_complete", "team":"Approver"},
]
WORKFLOW_BY_KEY = {x["key"]: x for x in WORKFLOW_STEPS}

def workflow_current_step(order):
    """Return the first incomplete workflow key, or 'completed'."""
    for step in WORKFLOW_STEPS:
        if not order[step["complete_field"]]:
            return step["key"]
    return "completed"

def workflow_step_available(order, section):
    """Completed/current sections can be opened; future sections are locked."""
    if section not in WORKFLOW_BY_KEY:
        return False
    target_index = next(i for i,s in enumerate(WORKFLOW_STEPS) if s["key"] == section)
    # A previously completed section always remains available for review/correction.
    if order[WORKFLOW_STEPS[target_index]["complete_field"]]:
        return True
    # An incomplete section is available only when every previous step is complete.
    return all(order[s["complete_field"]] for s in WORKFLOW_STEPS[:target_index])

def workflow_next_label(order):
    key=workflow_current_step(order)
    return "Completed" if key=="completed" else WORKFLOW_BY_KEY[key]["label"]

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 full_name TEXT NOT NULL,
 role TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 branch TEXT DEFAULT 'MAIN',
 market_type TEXT DEFAULT 'IND',
 order_name TEXT,
 order_month TEXT,
 order_seq INTEGER,
 quote_no TEXT,
 quote_date TEXT,
 marketing_person TEXT,
 delivery_period TEXT,
 customer_name TEXT,
 place TEXT,
 terms TEXT,
 service_demo INTEGER DEFAULT 0,
 service_installation INTEGER DEFAULT 0,
 service_calibration INTEGER DEFAULT 0,
 service_person TEXT,
 service_date TEXT,
 service_amount REAL DEFAULT 0,
 total_order_value REAL DEFAULT 0,
 order_place_to TEXT,
 remarks TEXT,
 approved_by TEXT,
 approval_date TEXT,
 marketing_complete INTEGER DEFAULT 0,
 dispatch_complete INTEGER DEFAULT 0,
 payment_complete INTEGER DEFAULT 0,
 supplier_complete INTEGER DEFAULT 0,
 accounts_complete INTEGER DEFAULT 0,
 approval_complete INTEGER DEFAULT 0,
 current_status TEXT DEFAULT 'Draft',
 version INTEGER DEFAULT 1,
 created_by INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 google_sheet_synced INTEGER DEFAULT 0,
 drive_pdf_url TEXT,
 drive_xlsx_url TEXT,
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS marketing_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 row_no INTEGER,
 item_name TEXT,
 model TEXT,
 qty REAL DEFAULT 0,
 item_value REAL DEFAULT 0,
 add_charge REAL DEFAULT 0,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS dispatch_details(
 order_id INTEGER PRIMARY KEY,
 packing_by TEXT,
 dispatch_on TEXT,
 weight TEXT,
 courier_mode TEXT,
 amount REAL DEFAULT 0,
 sign TEXT,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS customer_payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 row_no INTEGER,
 payment_date TEXT,
 bank_mode TEXT,
 amount REAL DEFAULT 0,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS supplier_rows(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 row_no INTEGER,
 supplier TEXT,
 model TEXT,
 net_value REAL DEFAULT 0,
 terms TEXT,
 delivery_period TEXT,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS accounts_details(
 order_id INTEGER PRIMARY KEY,
 estimate_delivery_date TEXT,
 po_date TEXT,
 po_no TEXT,
 supplier_name TEXT,
 terms TEXT,
 proforma_no TEXT,
 courier_today_basic TEXT,
 pdc_on_delivery TEXT,
 dispatch_date TEXT,
 courier TEXT,
 packing_mode TEXT,
 docket_no TEXT,
 courier_rs REAL DEFAULT 0,
 item_received_on TEXT,
 additional_cost REAL DEFAULT 0,
 weight TEXT,
 dispatch_method TEXT,
 purchase_bill_no TEXT,
 bill_date TEXT,
 total_purchase_cost REAL DEFAULT 0,
 total_selling_cost REAL DEFAULT 0,
 profit REAL DEFAULT 0,
 profit_percentage REAL DEFAULT 0,
 profile_override_reason TEXT,
 account_remarks TEXT,
 signature TEXT,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS accounts_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 row_no INTEGER,
 particulars TEXT,
 item_value REAL DEFAULT 0,
 pf_charges REAL DEFAULT 0,
 tax REAL DEFAULT 0,
 total REAL DEFAULT 0,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS supplier_payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 row_no INTEGER,
 payment_date TEXT,
 bank_branch TEXT,
 mode TEXT,
 amount REAL DEFAULT 0,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 order_id INTEGER,
 message TEXT NOT NULL,
 is_read INTEGER DEFAULT 0,
 created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS comments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 comment TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER,
 user_id INTEGER,
 section TEXT,
 action TEXT,
 details TEXT,
 created_at TEXT NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sync_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER,
 sync_type TEXT,
 status TEXT,
 details TEXT,
 created_at TEXT NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
"""

def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c

def now():
    return datetime.now().isoformat(timespec="seconds")

def _ensure_order_branch_columns(c):
    """Upgrade older V1.0.x databases in place without deleting existing data."""
    cols={r["name"] for r in c.execute("PRAGMA table_info(orders)").fetchall()}
    wanted={
        "branch": "TEXT DEFAULT 'MAIN'",
        "market_type": "TEXT DEFAULT 'IND'",
        "order_name": "TEXT",
        "order_month": "TEXT",
        "order_seq": "INTEGER",
    }
    for col,decl in wanted.items():
        if col not in cols:
            c.execute(f"ALTER TABLE orders ADD COLUMN {col} {decl}")
    c.execute("UPDATE orders SET branch=? WHERE branch IS NULL OR TRIM(branch)=''", (DEFAULT_BRANCH,))
    c.execute("UPDATE orders SET market_type=? WHERE market_type IS NULL OR TRIM(market_type)=''", (DEFAULT_MARKET_TYPE,))
    c.execute("UPDATE orders SET market_type=UPPER(TRIM(market_type))")
    c.execute("UPDATE orders SET market_type=? WHERE market_type NOT IN ('IND','EXPORT')", (DEFAULT_MARKET_TYPE,))

def _order_date_parts(date_text=None):
    try:
        d=datetime.fromisoformat(str(date_text)) if date_text else datetime.now()
    except Exception:
        d=datetime.now()
    # The stored YYYY-MM is useful for reports. The ID uses only the first
    # letter of the month, exactly as requested: September -> S, October -> O.
    return d.strftime("%Y-%m"), d.strftime("%b").upper()[0]

def next_order_identity(c, branch_key, date_text=None):
    """Return (order_id_text, YYYY-MM, sequence).

    The numeric sequence is ONE GLOBAL running count shared by every branch.
    It follows first-come order creation and NEVER resets when the branch or
    month changes. Only the branch prefix and month letter change.

    Example in September:
      1st order - MAIN        -> NMS1
      2nd order - GANDHIPURAM -> NGS2
      3rd order - GOPALAPURAM -> NGOS3
      4th order - MAIN        -> NMS4

    If the last September order is number 25, the first October order is 26
    regardless of which branch creates it.
    """
    branch_key = branch_key if branch_key in BRANCH_BY_KEY else DEFAULT_BRANCH
    month_key, month_code = _order_date_parts(date_text)
    row=c.execute("SELECT COALESCE(MAX(order_seq),0) n FROM orders").fetchone()
    max_seq=int(row["n"] or 0)
    # Owner cleanup may remove every old order. Preserve the previous high-water mark
    # so a cleanup never causes a future order number to be reused.
    try:
        meta=c.execute("SELECT value FROM app_meta WHERE key='owner_cleanup_order_seq_highwater'").fetchone()
        if meta: max_seq=max(max_seq,int(meta["value"] or 0))
    except sqlite3.OperationalError:
        pass
    seq=max_seq+1
    prefix=BRANCH_BY_KEY[branch_key]["prefix"]
    return f"{prefix}{month_code}{seq}", month_key, seq

def _upgrade_order_identity_scheme(c):
    """One-time migration to the shared global order-number rule (V1.0.9).

    Existing real records are renumbered once in original creation order so
    every order across Main, Gandhipuram and Gopalapuram has one shared
    first-come running number. The month still changes only the month letter.
    """
    c.execute("CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT)")
    row=c.execute("SELECT value FROM app_meta WHERE key='order_identity_scheme'").fetchone()
    if row and row["value"] == "global-monthinitial-continuous-v2":
        return

    # Remove only the exact built-in sample record from prior versions.
    c.execute("DELETE FROM orders WHERE quote_no='DEMO-001' AND customer_name='SAMPLE CUSTOMER - DELETE ME'")

    rows=c.execute("SELECT id,branch,created_at,quote_date FROM orders ORDER BY id").fetchall()
    for seq,r in enumerate(rows, start=1):
        branch=r["branch"] if r["branch"] in BRANCH_BY_KEY else DEFAULT_BRANCH
        # Month follows when the order was created. Fall back to quote date only
        # for very old data that does not have a usable created_at value.
        date_text=r["created_at"] or r["quote_date"]
        month_key,month_code=_order_date_parts(date_text)
        prefix=BRANCH_BY_KEY[branch]["prefix"]
        name=f"{prefix}{month_code}{seq}"
        c.execute("UPDATE orders SET branch=?,order_name=?,order_month=?,order_seq=? WHERE id=?",
                  (branch,name,month_key,seq,r["id"]))

    c.execute("INSERT INTO app_meta(key,value) VALUES('order_identity_scheme','global-monthinitial-continuous-v2') "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value")

def init_db():
    with db() as c:
        c.executescript(SCHEMA)
        _ensure_order_branch_columns(c)
        _upgrade_order_identity_scheme(c)
        count = c.execute("SELECT COUNT(*) n FROM users").fetchone()["n"]
        if count == 0:
            # Keep one internal system user for database foreign keys/audit compatibility. The UI has no login.
            # The administrator should change it immediately after the first successful sign-in.
            c.execute("INSERT INTO users(username,password_hash,full_name,role,created_at) VALUES(?,?,?,?,?)",
                      (DEFAULT_ADMIN_USERNAME, generate_password_hash(DEFAULT_ADMIN_PASSWORD),
                       "System Administrator", "Admin", now()))
            FIRST_LOGIN.write_text(
                "NUNES Form Workflow - OFFICE MODE\n"
                "Login is disabled. Open the server URL and the Task Board opens directly.\n"
                "The internal admin record is retained only for database/audit compatibility.\n",
                encoding="utf-8"
            )
        # No demo/sample order is created. The first real order must receive
        # sequence 1 for its selected branch.

def _office_admin():
    """Return the single internal office identity used in no-login mode."""
    with db() as c:
        return c.execute("SELECT * FROM users WHERE role='Admin' AND active=1 ORDER BY id LIMIT 1").fetchone()

def user():
    uid=session.get("user_id")
    if uid:
        with db() as c:
            u=c.execute("SELECT * FROM users WHERE id=? AND active=1",(uid,)).fetchone()
            if u: return u
    return _office_admin()

@app.before_request
def office_mode_identity():
    # Login has intentionally been removed. Keep one internal user id only so
    # existing audit/comment/foreign-key logic keeps working without changing
    # the rest of the workflow.
    if request.endpoint == "static":
        return None
    if not session.get("user_id"):
        u=_office_admin()
        if u:
            session["user_id"]=u["id"]
    return None

def login_required(fn):
    # Compatibility decorator: all office URLs are directly accessible.
    @wraps(fn)
    def wrap(*a,**k):
        return fn(*a,**k)
    return wrap

def admin_required(fn):
    # No-login shared office mode keeps existing admin pages functional.
    @wraps(fn)
    def wrap(*a,**k):
        return fn(*a,**k)
    return wrap

def can_edit(section):
    u=user()
    if not u: return False
    if u["role"]=="Admin": return True
    mapping = {
        "marketing":["Marketing"],
        "dispatch":["Dispatch"],
        "payment":["Payments"],
        "supplier":["Supplier"],
        "accounts":["Accounts"],
        "approval":["Approver"],
    }
    return u["role"] in mapping.get(section,[])

def fnum(x):
    try:
        if x in (None,""): return 0.0
        return float(str(x).replace(",","").strip())
    except: return 0.0

def audit(c, oid, section, action, details=""):
    c.execute("INSERT INTO audit_log(order_id,user_id,section,action,details,created_at) VALUES(?,?,?,?,?,?)",
              (oid,session.get("user_id"),section,action,details,now()))

def notify_roles(c, roles, oid, message):
    q = ",".join("?"*len(roles))
    rows = c.execute(f"SELECT id FROM users WHERE active=1 AND role IN ({q})", roles).fetchall()
    # Always include admin as safety/visibility
    admins = c.execute("SELECT id FROM users WHERE active=1 AND role='Admin'").fetchall()
    ids = {r["id"] for r in rows} | {r["id"] for r in admins}
    for uid in ids:
        c.execute("INSERT INTO notifications(user_id,order_id,message,created_at) VALUES(?,?,?,?)",
                  (uid,oid,message,now()))

def derive_status(o):
    if not o["marketing_complete"]: return "Draft"
    pending=[]
    for key,label in [("dispatch_complete","Dispatch"),("payment_complete","Payment"),("supplier_complete","Supplier"),
                      ("accounts_complete","Accounts"),("approval_complete","Approval")]:
        if not o[key]: pending.append(label)
    if not pending: return "Completed"
    if len(pending)==1: return "Waiting for " + pending[0]
    return "In Progress"

def recalc_order(c, oid):
    items = c.execute("SELECT * FROM marketing_items WHERE order_id=?",(oid,)).fetchall()
    total = sum((r["qty"] or 0)*(r["item_value"] or 0)+(r["add_charge"] or 0) for r in items)
    order = c.execute("SELECT service_amount FROM orders WHERE id=?",(oid,)).fetchone()
    total += fnum(order["service_amount"] if order else 0)
    c.execute("UPDATE orders SET total_order_value=? WHERE id=?",(round(total,2),oid))
    ai = c.execute("SELECT * FROM accounts_items WHERE order_id=?",(oid,)).fetchall()
    for r in ai:
        t=fnum(r["item_value"])+fnum(r["pf_charges"])+fnum(r["tax"])
        c.execute("UPDATE accounts_items SET total=? WHERE id=?",(round(t,2),r["id"]))
    return total

def get_order_bundle(oid):
    with db() as c:
        o = c.execute("SELECT * FROM orders WHERE id=?",(oid,)).fetchone()
        if not o: return None
        return {
            "order":o,
            "marketing_items":c.execute("SELECT * FROM marketing_items WHERE order_id=? ORDER BY row_no",(oid,)).fetchall(),
            "dispatch":c.execute("SELECT * FROM dispatch_details WHERE order_id=?",(oid,)).fetchone(),
            "customer_payments":c.execute("SELECT * FROM customer_payments WHERE order_id=? ORDER BY row_no",(oid,)).fetchall(),
            "supplier_rows":c.execute("SELECT * FROM supplier_rows WHERE order_id=? ORDER BY row_no",(oid,)).fetchall(),
            "accounts":c.execute("SELECT * FROM accounts_details WHERE order_id=?",(oid,)).fetchone(),
            "accounts_items":c.execute("SELECT * FROM accounts_items WHERE order_id=? ORDER BY row_no",(oid,)).fetchall(),
            "supplier_payments":c.execute("SELECT * FROM supplier_payments WHERE order_id=? ORDER BY row_no",(oid,)).fetchall(),
            "comments":c.execute("""SELECT comments.*,users.full_name FROM comments JOIN users ON users.id=comments.user_id
                WHERE order_id=? ORDER BY comments.id DESC""",(oid,)).fetchall(),
            "audit":c.execute("""SELECT audit_log.*,users.full_name FROM audit_log LEFT JOIN users ON users.id=audit_log.user_id
                WHERE order_id=? ORDER BY audit_log.id DESC LIMIT 80""",(oid,)).fetchall(),
        }

@app.context_processor
def ctx():
    u=user()
    unread=0
    if u:
        with db() as c:
            unread=c.execute("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0",(u["id"],)).fetchone()["n"]
    return dict(current_user=u, unread_notifications=unread, roles=ROLES, can_edit=can_edit, branches=BRANCHES, branch_by_key=BRANCH_BY_KEY, market_types=MARKET_TYPES)

@app.route("/login",methods=["GET","POST"])
def login():
    # Login removed by design: always open the Task Board directly.
    return redirect(url_for("dashboard"))

@app.route("/logout")
def logout():
    # Shared office mode has no sign-out screen.
    return redirect(url_for("dashboard"))

@app.route("/")
@login_required
def dashboard():
    # One branch selector controls the whole Task Board. Blank means all branches.
    branch=request.args.get("branch","").strip().upper()
    if branch and branch not in BRANCH_BY_KEY:
        branch=""
    where=""; args=[]
    if branch:
        where=" WHERE branch=?"; args=[branch]
    with db() as c:
        statuses = c.execute("SELECT current_status,COUNT(*) n FROM orders"+where+" GROUP BY current_status",args).fetchall()
        counts={r["current_status"]:r["n"] for r in statuses}
        latest_sql="SELECT * FROM orders"+where+" ORDER BY updated_at DESC LIMIT 10"
        latest=c.execute(latest_sql,args).fetchall()
        outstanding_sql="""SELECT COUNT(*) n FROM orders o WHERE o.total_order_value >
            COALESCE((SELECT SUM(amount) FROM customer_payments p WHERE p.order_id=o.id),0)"""
        out_args=[]
        if branch:
            outstanding_sql += " AND o.branch=?"
            out_args.append(branch)
        outstanding=c.execute(outstanding_sql,out_args).fetchone()["n"]
    return render_template("dashboard.html",counts=counts,latest=latest,outstanding=outstanding,branch=branch)

@app.route("/orders")
@login_required
def orders():
    q=request.args.get("q","").strip()
    status=request.args.get("status","").strip()
    branch=request.args.get("branch","").strip().upper()
    if branch and branch not in BRANCH_BY_KEY: branch=""
    sql="SELECT * FROM orders WHERE 1=1"; args=[]
    if q:
        sql+=" AND (order_name LIKE ? OR quote_no LIKE ? OR customer_name LIKE ? OR marketing_person LIKE ? OR place LIKE ? OR order_place_to LIKE ?)"
        sv=f"%{q}%"; args += [sv,sv,sv,sv,sv,sv]
    if status:
        sql+=" AND current_status=?"; args.append(status)
    if branch:
        sql+=" AND branch=?"; args.append(branch)
    sql+=" ORDER BY updated_at DESC"
    with db() as c:
        rows=c.execute(sql,args).fetchall()
    return render_template("orders.html",orders=rows,q=q,status=status,branch=branch)

@app.route("/order/new",methods=["GET","POST"])
@login_required
def new_order():
    if not can_edit("marketing"):
        flash("Only Marketing or Admin can create a new record.","error")
        return redirect(url_for("orders"))
    if request.method=="POST":
        with db() as c:
            branch=request.form.get("branch",DEFAULT_BRANCH)
            if branch not in BRANCH_BY_KEY: branch=DEFAULT_BRANCH
            market_type=request.form.get("market_type",DEFAULT_MARKET_TYPE).strip().upper()
            if market_type not in MARKET_TYPES: market_type=DEFAULT_MARKET_TYPE
            quote_date=request.form.get("quote_date","")
            order_name,order_month,order_seq=next_order_identity(c,branch)
            cur=c.execute("INSERT INTO orders(branch,market_type,order_name,order_month,order_seq,quote_no,quote_date,customer_name,marketing_person,current_status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                          (branch,market_type,order_name,order_month,order_seq,request.form.get("quote_no",""),quote_date,request.form.get("customer_name",""),
                           request.form.get("marketing_person",""),"Draft",session["user_id"],now(),now()))
            oid=cur.lastrowid
            c.execute("INSERT INTO dispatch_details(order_id) VALUES(?)",(oid,))
            c.execute("INSERT INTO accounts_details(order_id) VALUES(?)",(oid,))
            audit(c,oid,"record","created","New record")
        return redirect(url_for("order_form",oid=oid))
    selected_branch=request.args.get("branch",DEFAULT_BRANCH).strip().upper()
    if selected_branch not in BRANCH_BY_KEY: selected_branch=DEFAULT_BRANCH
    return render_template("new_order.html",selected_branch=selected_branch)

@app.route("/order/<int:oid>")
@login_required
def order_form(oid):
    b=get_order_bundle(oid)
    if not b: return ("Not found",404)
    o=b["order"]
    cp_total=sum(fnum(x["amount"]) for x in b["customer_payments"])
    cp_balance=fnum(o["total_order_value"])-cp_total
    bill_amount=sum(fnum(x["total"]) for x in b["accounts_items"])
    sp_total=sum(fnum(x["amount"]) for x in b["supplier_payments"])
    supplier_balance=bill_amount-sp_total
    progress=sum(1 for step in WORKFLOW_STEPS if o[step["complete_field"]])

    current_step=workflow_current_step(o)
    requested_step=request.args.get("step","").strip().lower()
    if requested_step and workflow_step_available(o,requested_step):
        active_step=requested_step
    elif current_step=="completed":
        # When every team is finished, show the completion screen by default.
        active_step="completed"
    else:
        active_step=current_step

    return render_template("order_form.html",b=b,cp_total=cp_total,cp_balance=cp_balance,
                           bill_amount=bill_amount,sp_total=sp_total,supplier_balance=supplier_balance,
                           progress=progress,workflow_steps=WORKFLOW_STEPS,
                           current_step=current_step,active_step=active_step)

def replace_rows(c, table, oid, rows, cols):
    c.execute(f"DELETE FROM {table} WHERE order_id=?",(oid,))
    for idx,row in enumerate(rows,1):
        vals=[oid,idx]+[row.get(col) for col in cols]
        ph=",".join("?"*len(vals))
        names="order_id,row_no,"+",".join(cols)
        c.execute(f"INSERT INTO {table}({names}) VALUES({ph})",vals)

@app.post("/order/<int:oid>/save/<section>")
@login_required
def save_section(oid,section):
    if section not in WORKFLOW_BY_KEY:
        return ("Unknown section",400)
    if not can_edit(section):
        flash("Your role cannot edit this section.","error")
        return redirect(url_for("order_form",oid=oid))
    complete=request.form.get("action")=="complete"
    with db() as c:
        o=c.execute("SELECT * FROM orders WHERE id=?",(oid,)).fetchone()
        if not o: return ("Not found",404)
        if not workflow_step_available(o,section):
            current=workflow_current_step(o)
            label=WORKFLOW_BY_KEY[current]["label"] if current in WORKFLOW_BY_KEY else "current team"
            flash(f"Complete {label} before moving to the next team.","error")
            return redirect(url_for("order_form",oid=oid,step=current))
        was_complete=bool(o[WORKFLOW_BY_KEY[section]["complete_field"]])
        if section=="marketing":
            market_type=request.form.get("market_type",o["market_type"] or DEFAULT_MARKET_TYPE).strip().upper()
            if market_type not in MARKET_TYPES: market_type=DEFAULT_MARKET_TYPE
            c.execute("""UPDATE orders SET quote_no=?,quote_date=?,marketing_person=?,delivery_period=?,customer_name=?,place=?,terms=?,market_type=?,
                service_demo=?,service_installation=?,service_calibration=?,service_person=?,service_date=?,service_amount=?,
                marketing_complete=?,updated_at=?,version=version+1 WHERE id=?""",
                (request.form.get("quote_no"),request.form.get("quote_date"),request.form.get("marketing_person"),
                 request.form.get("delivery_period"),request.form.get("customer_name"),request.form.get("place"),request.form.get("terms"),market_type,
                 1 if request.form.get("service_demo") else 0,1 if request.form.get("service_installation") else 0,
                 1 if request.form.get("service_calibration") else 0,request.form.get("service_person"),request.form.get("service_date"),
                 fnum(request.form.get("service_amount")),1 if complete else o["marketing_complete"],now(),oid))
            names=request.form.getlist("item_name[]"); models=request.form.getlist("model[]")
            qtys=request.form.getlist("qty[]"); vals=request.form.getlist("item_value[]"); adds=request.form.getlist("add_charge[]")
            rows=[]
            for i in range(max(len(names),3)):
                row={"item_name":names[i] if i<len(names) else "","model":models[i] if i<len(models) else "",
                     "qty":fnum(qtys[i] if i<len(qtys) else 0),"item_value":fnum(vals[i] if i<len(vals) else 0),
                     "add_charge":fnum(adds[i] if i<len(adds) else 0)}
                if any([row["item_name"],row["model"],row["qty"],row["item_value"],row["add_charge"]]): rows.append(row)
            replace_rows(c,"marketing_items",oid,rows,["item_name","model","qty","item_value","add_charge"])
            recalc_order(c,oid)
        elif section=="dispatch":
            c.execute("""INSERT INTO dispatch_details(order_id,packing_by,dispatch_on,weight,courier_mode,amount,sign)
                VALUES(?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET packing_by=excluded.packing_by,dispatch_on=excluded.dispatch_on,
                weight=excluded.weight,courier_mode=excluded.courier_mode,amount=excluded.amount,sign=excluded.sign""",
                (oid,request.form.get("packing_by"),request.form.get("dispatch_on"),request.form.get("weight"),
                 request.form.get("courier_mode"),fnum(request.form.get("amount")),request.form.get("sign")))
            c.execute("UPDATE orders SET dispatch_complete=?,updated_at=?,version=version+1 WHERE id=?",
                      (1 if complete else o["dispatch_complete"],now(),oid))
        elif section=="payment":
            dates=request.form.getlist("payment_date[]"); modes=request.form.getlist("bank_mode[]"); amounts=request.form.getlist("payment_amount[]")
            rows=[]
            for i in range(max(len(dates),3)):
                r={"payment_date":dates[i] if i<len(dates) else "","bank_mode":modes[i] if i<len(modes) else "",
                   "amount":fnum(amounts[i] if i<len(amounts) else 0)}
                if any([r["payment_date"],r["bank_mode"],r["amount"]]): rows.append(r)
            replace_rows(c,"customer_payments",oid,rows,["payment_date","bank_mode","amount"])
            c.execute("UPDATE orders SET payment_complete=?,updated_at=?,version=version+1 WHERE id=?",
                      (1 if complete else o["payment_complete"],now(),oid))
        elif section=="supplier":
            suppliers=request.form.getlist("supplier[]"); models=request.form.getlist("supplier_model[]")
            nets=request.form.getlist("net_value[]"); terms=request.form.getlist("supplier_terms[]"); dps=request.form.getlist("supplier_delivery[]")
            rows=[]
            for i in range(max(len(suppliers),3)):
                r={"supplier":suppliers[i] if i<len(suppliers) else "","model":models[i] if i<len(models) else "",
                   "net_value":fnum(nets[i] if i<len(nets) else 0),"terms":terms[i] if i<len(terms) else "",
                   "delivery_period":dps[i] if i<len(dps) else ""}
                if any([r["supplier"],r["model"],r["net_value"],r["terms"],r["delivery_period"]]): rows.append(r)
            replace_rows(c,"supplier_rows",oid,rows,["supplier","model","net_value","terms","delivery_period"])
            c.execute("UPDATE orders SET order_place_to=?,supplier_complete=?,updated_at=?,version=version+1 WHERE id=?",
                      (request.form.get("order_place_to"),1 if complete else o["supplier_complete"],now(),oid))
        elif section=="accounts":
            vals=[request.form.get("estimate_delivery_date"),request.form.get("po_date"),request.form.get("po_no"),
                  request.form.get("supplier_name"),request.form.get("accounts_terms"),request.form.get("proforma_no"),
                  request.form.get("courier_today_basic"),request.form.get("pdc_on_delivery"),request.form.get("dispatch_date"),
                  request.form.get("courier"),request.form.get("packing_mode"),request.form.get("docket_no"),
                  fnum(request.form.get("courier_rs")),request.form.get("item_received_on"),fnum(request.form.get("additional_cost")),
                  request.form.get("accounts_weight"),request.form.get("dispatch_method"),request.form.get("purchase_bill_no"),
                  request.form.get("bill_date"),fnum(request.form.get("total_purchase_cost")),fnum(request.form.get("total_selling_cost")),
                  request.form.get("profile_override_reason"),request.form.get("account_remarks"),request.form.get("signature")]
            c.execute("""INSERT INTO accounts_details(order_id,estimate_delivery_date,po_date,po_no,supplier_name,terms,proforma_no,courier_today_basic,
                pdc_on_delivery,dispatch_date,courier,packing_mode,docket_no,courier_rs,item_received_on,additional_cost,weight,dispatch_method,
                purchase_bill_no,bill_date,total_purchase_cost,total_selling_cost,profile_override_reason,account_remarks,signature)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(order_id) DO UPDATE SET estimate_delivery_date=excluded.estimate_delivery_date,po_date=excluded.po_date,po_no=excluded.po_no,
                supplier_name=excluded.supplier_name,terms=excluded.terms,proforma_no=excluded.proforma_no,courier_today_basic=excluded.courier_today_basic,
                pdc_on_delivery=excluded.pdc_on_delivery,dispatch_date=excluded.dispatch_date,courier=excluded.courier,packing_mode=excluded.packing_mode,
                docket_no=excluded.docket_no,courier_rs=excluded.courier_rs,item_received_on=excluded.item_received_on,additional_cost=excluded.additional_cost,
                weight=excluded.weight,dispatch_method=excluded.dispatch_method,purchase_bill_no=excluded.purchase_bill_no,bill_date=excluded.bill_date,
                total_purchase_cost=excluded.total_purchase_cost,total_selling_cost=excluded.total_selling_cost,
                profile_override_reason=excluded.profile_override_reason,account_remarks=excluded.account_remarks,signature=excluded.signature""",[oid]+vals)
            parts=request.form.getlist("particulars[]"); ivs=request.form.getlist("acc_item_value[]")
            pfs=request.form.getlist("pf_charges[]"); taxes=request.form.getlist("tax[]")
            rows=[]
            for i in range(max(len(parts),3)):
                iv=fnum(ivs[i] if i<len(ivs) else 0); pf=fnum(pfs[i] if i<len(pfs) else 0); tx=fnum(taxes[i] if i<len(taxes) else 0)
                r={"particulars":parts[i] if i<len(parts) else "","item_value":iv,"pf_charges":pf,"tax":tx,"total":iv+pf+tx}
                if any([r["particulars"],iv,pf,tx]): rows.append(r)
            replace_rows(c,"accounts_items",oid,rows,["particulars","item_value","pf_charges","tax","total"])
            dates=request.form.getlist("sp_date[]"); branches=request.form.getlist("bank_branch[]")
            modes=request.form.getlist("sp_mode[]"); amounts=request.form.getlist("sp_amount[]")
            prows=[]
            for i in range(max(len(dates),3)):
                r={"payment_date":dates[i] if i<len(dates) else "","bank_branch":branches[i] if i<len(branches) else "",
                   "mode":modes[i] if i<len(modes) else "","amount":fnum(amounts[i] if i<len(amounts) else 0)}
                if any([r["payment_date"],r["bank_branch"],r["mode"],r["amount"]]): prows.append(r)
            replace_rows(c,"supplier_payments",oid,prows,["payment_date","bank_branch","mode","amount"])
            # authoritative calculated profit
            a=c.execute("SELECT total_purchase_cost,total_selling_cost FROM accounts_details WHERE order_id=?",(oid,)).fetchone()
            profit=fnum(a["total_selling_cost"])-fnum(a["total_purchase_cost"])
            pct=(profit/fnum(a["total_purchase_cost"])*100) if fnum(a["total_purchase_cost"]) else 0
            c.execute("UPDATE accounts_details SET profit=?,profit_percentage=? WHERE order_id=?",(round(profit,2),round(pct,2),oid))
            c.execute("UPDATE orders SET accounts_complete=?,updated_at=?,version=version+1 WHERE id=?",
                      (1 if complete else o["accounts_complete"],now(),oid))
            recalc_order(c,oid)
        elif section=="approval":
            c.execute("""UPDATE orders SET remarks=?,approved_by=?,approval_date=?,approval_complete=?,updated_at=?,version=version+1 WHERE id=?""",
                      (request.form.get("remarks"),request.form.get("approved_by"),request.form.get("approval_date"),
                       1 if complete else o["approval_complete"],now(),oid))
        else:
            return ("Unknown section",400)

        fresh=c.execute("SELECT * FROM orders WHERE id=?",(oid,)).fetchone()
        # Sequential handover notifications. Fire only when a section changes
        # from incomplete to complete, so editing an already-completed section
        # does not spam the next team.
        if complete and not was_complete:
            handover={
                "marketing": ("Dispatch", ["Dispatch"]),
                "dispatch": ("Payment", ["Payments"]),
                "payment": ("Supplier", ["Supplier"]),
                "supplier": ("Accounts", ["Accounts"]),
                "accounts": ("Final Approval", ["Approver"]),
            }
            if section in handover:
                next_label,roles=handover[section]
                notify_roles(c,roles,oid,f"{WORKFLOW_BY_KEY[section]['label']} completed for {fresh['order_name'] or fresh['quote_no'] or 'Order #'+str(oid)}. {next_label} is now ready.")
            elif section=="approval":
                notify_roles(c,["Marketing","Dispatch","Payments","Supplier","Accounts"],oid,f"Order {fresh['order_name'] or fresh['quote_no'] or '#'+str(oid)} is fully completed and approved.")

        c.execute("UPDATE orders SET current_status=? WHERE id=?",(derive_status(fresh),oid))
        audit(c,oid,section,"completed" if complete else "saved","")
    # Keep a continuously updated local master Excel workbook even when Google is not configured.
    try:
        build_master_xlsx()
    except Exception as exc:
        with db() as c:
            c.execute("INSERT INTO sync_log(order_id,sync_type,status,details,created_at) VALUES(?,?,?,?,?)",
                      (oid,"Local Master Excel","Error",str(exc)[:500],now()))
    # best-effort Google sync on section completion
    if complete:
        try: sync_google(oid, upload_files=(section=="approval"))
        except Exception as exc:
            with db() as c:
                c.execute("INSERT INTO sync_log(order_id,sync_type,status,details,created_at) VALUES(?,?,?,?,?)",
                          (oid,"Google","Error",str(exc)[:500],now()))
    if complete:
        with db() as c:
            latest=c.execute("SELECT * FROM orders WHERE id=?",(oid,)).fetchone()
        next_step=workflow_current_step(latest)
        if next_step=="completed":
            flash("All teams completed. This order is now fully completed.","ok")
            return redirect(url_for("order_form",oid=oid))
        next_label=WORKFLOW_BY_KEY[next_step]["label"]
        flash(f"{WORKFLOW_BY_KEY[section]['label']} completed. Moved to {next_label}.","ok")
        return redirect(url_for("order_form",oid=oid,step=next_step))

    flash("Draft saved. You can continue this team section.","ok")
    return redirect(url_for("order_form",oid=oid,step=section))

@app.post("/order/<int:oid>/comment")
@login_required
def add_comment(oid):
    txt=request.form.get("comment","").strip()
    if txt:
        with db() as c:
            c.execute("INSERT INTO comments(order_id,user_id,comment,created_at) VALUES(?,?,?,?)",(oid,session["user_id"],txt,now()))
            audit(c,oid,"comment","added",txt[:250])
    return redirect(url_for("order_form",oid=oid))

@app.route("/inbox")
@login_required
def inbox():
    u=user()
    with db() as c:
        rows=c.execute("""SELECT notifications.*,orders.quote_no,orders.customer_name FROM notifications
            LEFT JOIN orders ON orders.id=notifications.order_id WHERE notifications.user_id=?
            ORDER BY notifications.id DESC LIMIT 200""",(u["id"],)).fetchall()
    return render_template("inbox.html",notifications=rows)

@app.post("/notification/<int:nid>/read")
@login_required
def mark_read(nid):
    with db() as c:
        c.execute("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",(nid,session["user_id"]))
    return redirect(request.referrer or url_for("inbox"))

@app.route("/users",methods=["GET","POST"])
@login_required
@admin_required
def users_admin():
    with db() as c:
        if request.method=="POST":
            action=request.form.get("action")
            if action=="create":
                try:
                    c.execute("INSERT INTO users(username,password_hash,full_name,role,created_at) VALUES(?,?,?,?,?)",
                              (request.form["username"].strip(),generate_password_hash(request.form["password"]),
                               request.form["full_name"].strip(),request.form["role"],now()))
                    flash("User created.","ok")
                except sqlite3.IntegrityError: flash("Username already exists.","error")
            elif action=="password":
                c.execute("UPDATE users SET password_hash=? WHERE id=?",(generate_password_hash(request.form["password"]),request.form["user_id"]))
                flash("Password updated.","ok")
            elif action=="toggle":
                c.execute("UPDATE users SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?",(request.form["user_id"],))
        rows=c.execute("SELECT * FROM users ORDER BY id").fetchall()
    return render_template("users.html",users=rows)

def load_config():
    default={"enabled":False,"service_account_file":"","spreadsheet_id":"","worksheet_name":"Orders",
             "drive_folder_id":"","last_saved":""}
    if CONFIG.exists():
        try:
            default.update(json.loads(CONFIG.read_text(encoding="utf-8")))
        except: pass
    return default

@app.route("/integrations",methods=["GET","POST"])
@login_required
@admin_required
def integrations():
    cfg=load_config()
    if request.method=="POST":
        cfg={
            "enabled": bool(request.form.get("enabled")),
            "service_account_file": request.form.get("service_account_file","").strip(),
            "spreadsheet_id": request.form.get("spreadsheet_id","").strip(),
            "worksheet_name": request.form.get("worksheet_name","Orders").strip() or "Orders",
            "drive_folder_id": request.form.get("drive_folder_id","").strip(),
            "last_saved": now()
        }
        CONFIG.write_text(json.dumps(cfg,indent=2),encoding="utf-8")
        flash("Integration settings saved.","ok")
    return render_template("integrations.html",cfg=cfg)


def build_master_xlsx():
    """Rebuild the continuously updated office master workbook from the database."""
    from openpyxl import Workbook
    from openpyxl.styles import Font
    out=DATA/"NUNES_MASTER.xlsx"
    with db() as c:
        orders=c.execute("""SELECT o.*,
          COALESCE((SELECT SUM(amount) FROM customer_payments p WHERE p.order_id=o.id),0) received,
          COALESCE((SELECT total_purchase_cost FROM accounts_details a WHERE a.order_id=o.id),0) purchase_cost,
          COALESCE((SELECT total_selling_cost FROM accounts_details a WHERE a.order_id=o.id),0) selling_cost,
          COALESCE((SELECT profit FROM accounts_details a WHERE a.order_id=o.id),0) profit,
          COALESCE((SELECT profit_percentage FROM accounts_details a WHERE a.order_id=o.id),0) profit_percentage,
          (SELECT po_no FROM accounts_details a WHERE a.order_id=o.id) po_no,
          (SELECT supplier_name FROM accounts_details a WHERE a.order_id=o.id) account_supplier,
          (SELECT purchase_bill_no FROM accounts_details a WHERE a.order_id=o.id) purchase_bill_no
          FROM orders o ORDER BY o.id""").fetchall()
        mi=c.execute("SELECT * FROM marketing_items ORDER BY order_id,row_no").fetchall()
        cp=c.execute("SELECT * FROM customer_payments ORDER BY order_id,row_no").fetchall()
        sr=c.execute("SELECT * FROM supplier_rows ORDER BY order_id,row_no").fetchall()
        ai=c.execute("SELECT * FROM accounts_items ORDER BY order_id,row_no").fetchall()
        sp=c.execute("SELECT * FROM supplier_payments ORDER BY order_id,row_no").fetchall()
    wb=Workbook(); ws=wb.active; ws.title="Orders"
    headers=["Record ID","Order ID","Branch","IND / EXPORT","Quote No","Quote Date","Customer Name","Place","Marketing Person","Delivery Period","Terms",
             "Total Order Value","Amount Received","Outstanding","Order Place To","Status","PO No","Account Supplier",
             "Purchase Bill No","Total Purchase Cost","Total Selling Cost","Profit","Profit %","Updated At",
             "Marketing Complete","Dispatch Complete","Payment Complete","Supplier Complete","Accounts Complete","Approval Complete"]
    ws.append(headers)
    for c1 in ws[1]: c1.font=Font(bold=True)
    for o in orders:
        ws.append([o["id"],o["order_name"],BRANCH_BY_KEY.get(o["branch"],BRANCH_BY_KEY[DEFAULT_BRANCH])["name"],o["market_type"],o["quote_no"],o["quote_date"],o["customer_name"],o["place"],o["marketing_person"],o["delivery_period"],o["terms"],
                   o["total_order_value"],o["received"],fnum(o["total_order_value"])-fnum(o["received"]),o["order_place_to"],o["current_status"],
                   o["po_no"],o["account_supplier"],o["purchase_bill_no"],o["purchase_cost"],o["selling_cost"],o["profit"],o["profit_percentage"],o["updated_at"],
                   o["marketing_complete"],o["dispatch_complete"],o["payment_complete"],o["supplier_complete"],o["accounts_complete"],o["approval_complete"]])
    def add_sheet(name,headers,rows):
        sh=wb.create_sheet(name); sh.append(headers)
        for cc in sh[1]: cc.font=Font(bold=True)
        for row in rows: sh.append(row)
        sh.freeze_panes="A2"
        for col in sh.columns:
            sh.column_dimensions[col[0].column_letter].width=min(max(11,max(len(str(x.value or "")) for x in col)+2),38)
    add_sheet("Marketing Items",["Order ID","S.No","Item Name","Model","Qty","Item Value","Add Charge"],
              [[r["order_id"],r["row_no"],r["item_name"],r["model"],r["qty"],r["item_value"],r["add_charge"]] for r in mi])
    add_sheet("Customer Payments",["Order ID","S.No","Date","Bank Mode","Amount"],
              [[r["order_id"],r["row_no"],r["payment_date"],r["bank_mode"],r["amount"]] for r in cp])
    add_sheet("Supplier Rows",["Order ID","S.No","Supplier","Model","Net Value","Terms","Delivery Period"],
              [[r["order_id"],r["row_no"],r["supplier"],r["model"],r["net_value"],r["terms"],r["delivery_period"]] for r in sr])
    add_sheet("Accounts Items",["Order ID","S.No","Particulars","Item Value","P&F Charges","Tax","Total"],
              [[r["order_id"],r["row_no"],r["particulars"],r["item_value"],r["pf_charges"],r["tax"],r["total"]] for r in ai])
    add_sheet("Supplier Payments",["Order ID","S.No","Date","Bank & Branch","Mode","Amount"],
              [[r["order_id"],r["row_no"],r["payment_date"],r["bank_branch"],r["mode"],r["amount"]] for r in sp])
    for sh in wb.worksheets:
        sh.freeze_panes="A2" if sh.max_row>1 else None
    tmp=out.with_suffix(".tmp.xlsx")
    wb.save(tmp)
    tmp.replace(out)
    return out

def build_xlsx(oid):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    b=get_order_bundle(oid); o=b["order"]
    wb=Workbook()
    ws=wb.active; ws.title="Order"
    pairs=[
        ("Record ID",o["id"]),("Order ID",o["order_name"]),("Branch",BRANCH_BY_KEY.get(o["branch"],BRANCH_BY_KEY[DEFAULT_BRANCH])["name"]),("IND / EXPORT",o["market_type"]),("Quote No",o["quote_no"]),("Quote Date",o["quote_date"]),("Marketing Person",o["marketing_person"]),
        ("Delivery Period",o["delivery_period"]),("Customer Name",o["customer_name"]),("Place",o["place"]),("Terms",o["terms"]),
        ("Total Order Value",o["total_order_value"]),("Order Place To",o["order_place_to"]),("Status",o["current_status"]),
        ("Approved By",o["approved_by"]),("Approval Date",o["approval_date"]),("Drive PDF",o["drive_pdf_url"]),("Drive XLSX",o["drive_xlsx_url"])
    ]
    for r,(k,v) in enumerate(pairs,1):
        ws.cell(r,1,k).font=Font(bold=True); ws.cell(r,2,v)
    def sheet(name,headers,rows):
        s=wb.create_sheet(name)
        for j,h in enumerate(headers,1):
            cell=s.cell(1,j,h); cell.font=Font(bold=True)
        for i,row in enumerate(rows,2):
            for j,val in enumerate(row,1): s.cell(i,j,val)
        s.freeze_panes="A2"
        for col in s.columns:
            width=min(max(12,max(len(str(c.value or "")) for c in col)+2),40)
            s.column_dimensions[col[0].column_letter].width=width
    sheet("Marketing Items",["Order ID","S.No","Item Name","Model","Qty","Item Value","Add Charge"],
          [[oid,r["row_no"],r["item_name"],r["model"],r["qty"],r["item_value"],r["add_charge"]] for r in b["marketing_items"]])
    sheet("Customer Payments",["Order ID","S.No","Date","Bank Mode","Amount"],
          [[oid,r["row_no"],r["payment_date"],r["bank_mode"],r["amount"]] for r in b["customer_payments"]])
    sheet("Supplier Rows",["Order ID","S.No","Supplier","Model","Net Value","Terms","Delivery Period"],
          [[oid,r["row_no"],r["supplier"],r["model"],r["net_value"],r["terms"],r["delivery_period"]] for r in b["supplier_rows"]])
    sheet("Accounts Items",["Order ID","S.No","Particulars","Item Value","P&F Charges","Tax","Total"],
          [[oid,r["row_no"],r["particulars"],r["item_value"],r["pf_charges"],r["tax"],r["total"]] for r in b["accounts_items"]])
    sheet("Supplier Payments",["Order ID","S.No","Date","Bank & Branch","Mode","Amount"],
          [[oid,r["row_no"],r["payment_date"],r["bank_branch"],r["mode"],r["amount"]] for r in b["supplier_payments"]])
    out=DATA/f"Order_{oid}_{(o['quote_no'] or 'NO_QUOTE').replace('/','-')}.xlsx"
    wb.save(out); return out

def build_pdf(oid):
    """Create a two-page A4 PDF that duplicates the company's paper forms."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.pdfbase.pdfmetrics import stringWidth

    b=get_order_bundle(oid)
    if not b:
        raise ValueError("Order not found")
    o=b["order"]
    a=b["accounts"] or {}
    d=b["dispatch"] or {}
    out=DATA/f"Order_{oid}_{(o['quote_no'] or 'NO_QUOTE').replace('/','-')}.pdf"

    W,H=A4
    mm=72/25.4
    BLUE=colors.HexColor("#6676A6")
    INK=colors.HexColor("#4D5B82")
    LIGHT=colors.HexColor("#F4F5F8")
    WHITE=colors.white
    c=canvas.Canvas(str(out),pagesize=A4)
    c.setTitle(f"NUNES Form - {o['quote_no'] or oid}")

    # Coordinates below are in millimetres from the top-left of A4.
    def X(v): return v*mm
    def Y(v): return H-v*mm

    def clean(v):
        if v is None: return ''
        if isinstance(v,float) and v.is_integer(): return str(int(v))
        s=str(v)
        return '' if s.lower()=='none' else s

    def g(row,key,default=''):
        if row is None: return default
        try: value=row[key]
        except Exception:
            try: value=row.get(key,default)
            except Exception: return default
        return default if value is None else value

    def fit_text(text,font,size,maxw):
        s=clean(text)
        if maxw is None: return s
        while s and stringWidth(s,font,size)>maxw:
            s=s[:-1]
        return s if s==clean(text) else (s[:-3]+'...' if len(s)>3 else s)

    def text(x,top,s,size=8,font='Helvetica',bold=False,align='left',color=INK,maxw=None):
        f=('Helvetica-Bold' if bold and font=='Helvetica' else
           'Times-Bold' if bold and font=='Times' else
           'Helvetica' if font=='Helvetica' else 'Times-Roman')
        ss=fit_text(s,f,size,X(maxw) if maxw is not None else None)
        c.setFont(f,size); c.setFillColor(color)
        xx=X(x); yy=Y(top)
        if align=='center': c.drawCentredString(xx,yy,ss)
        elif align=='right': c.drawRightString(xx,yy,ss)
        else: c.drawString(xx,yy,ss)

    def solid_line(x1,top,x2,width=.55):
        c.setStrokeColor(INK); c.setLineWidth(width); c.setDash()
        c.line(X(x1),Y(top),X(x2),Y(top))

    def dotted_line(x1,top,x2,width=.55):
        c.setStrokeColor(INK); c.setLineWidth(width); c.setDash(1.0,1.4)
        c.line(X(x1),Y(top),X(x2),Y(top)); c.setDash()

    def rect(x,top,w,h,width=.6,fill=None,radius=0):
        c.setStrokeColor(INK); c.setLineWidth(width); c.setDash()
        if fill is not None: c.setFillColor(fill)
        if radius:
            c.roundRect(X(x),Y(top+h),X(w),X(h),X(radius),fill=1 if fill is not None else 0,stroke=1)
        else:
            c.rect(X(x),Y(top+h),X(w),X(h),fill=1 if fill is not None else 0,stroke=1)

    def blue_bar(x,top,w,label,h=7.4,center=False,rounded=False,size=13.2):
        c.setFillColor(BLUE); c.setStrokeColor(BLUE); c.setLineWidth(0)
        if rounded:
            c.roundRect(X(x),Y(top+h),X(w),X(h),X(2.3),fill=1,stroke=0)
        else:
            c.rect(X(x),Y(top+h),X(w),X(h),fill=1,stroke=0)
        text(x+w/2 if center else x+3.2,top+h-2.0,label,size=size,font='Times' if not center else 'Helvetica',bold=True,
             align='center' if center else 'left',color=WHITE)

    def field(x,top,label,value,end,size=8.2,label_bold=True,dotted=True,value_bold=False):
        f='Helvetica-Bold' if label_bold else 'Helvetica'
        c.setFont(f,size)
        lw=stringWidth(label,f,size)/mm
        text(x,top,label,size=size,bold=label_bold)
        x1=x+lw+1.5
        (dotted_line if dotted else solid_line)(x1,top+1.0,end)
        text(x1+1.2,top-0.2,value,size=size-0.2,bold=value_bold,maxw=max(.1,end-x1-2))

    def checkbox(x,top,label,checked=False):
        text(x,top,label,size=8.0,bold=True)
        f='Helvetica-Bold'; lw=stringWidth(label,f,8.0)/mm
        s=3.4; bx=x+lw+1.2; by=top-2.5
        rect(bx,by,s,s,width=.55)
        if checked:
            c.setStrokeColor(INK); c.setLineWidth(.9)
            c.line(X(bx+.6),Y(by+2.0),X(bx+1.4),Y(by+2.8))
            c.line(X(bx+1.4),Y(by+2.8),X(bx+2.9),Y(by+.6))
        return bx+s

    def table(x,top,widths,heights,rows,header=True,font_size=7.7,aligns=None,header_fill=LIGHT):
        totalw=sum(widths); totalh=sum(heights)
        # header background first
        if header and heights:
            c.setFillColor(header_fill); c.rect(X(x),Y(top+heights[0]),X(totalw),X(heights[0]),fill=1,stroke=0)
        c.setStrokeColor(INK); c.setLineWidth(.55); c.setDash()
        c.rect(X(x),Y(top+totalh),X(totalw),X(totalh),fill=0,stroke=1)
        xx=x
        for w in widths[:-1]:
            xx+=w; c.line(X(xx),Y(top),X(xx),Y(top+totalh))
        yy=top
        for h in heights[:-1]:
            yy+=h; c.line(X(x),Y(yy),X(x+totalw),Y(yy))
        yy=top
        for ri,row in enumerate(rows):
            h=heights[ri]
            baseline=yy+h/2+1.0
            xx=x
            for ci,w in enumerate(widths):
                s=row[ci] if ci<len(row) else ''
                al=aligns[ci] if aligns and ci<len(aligns) else 'center'
                if al=='left': text(xx+1.4,baseline,s,size=font_size,bold=(header and ri==0),maxw=w-2.8)
                elif al=='right': text(xx+w-1.4,baseline,s,size=font_size,bold=(header and ri==0),align='right',maxw=w-2.8)
                else: text(xx+w/2,baseline,s,size=font_size,bold=(header and ri==0),align='center',maxw=w-2.8)
                xx+=w
            yy+=h
        return top+totalh

    def outer_border():
        c.setStrokeColor(BLUE); c.setLineWidth(2.5); c.setDash()
        c.rect(X(10.5),Y(291),X(189),X(282),fill=0,stroke=1)

    # ------------------------------------------------------------------
    # PAGE 1 - Marketing / Dispatch / Customer Payment / Supplier
    # ------------------------------------------------------------------
    outer_border()
    left=20.0; right=190.5; inner=right-left

    text(105,17.0,"NUNES INSTRUMENTS / INSTRUMENTATION",size=14.8,font='Times',bold=True,align='center')
    text(183.5,25.1,clean(o['id']),size=12.6,font='Times',align='center')

    blue_bar(left,27.0,78.0,"Marketing Details",h=7.5,size=14.0)

    field(left,44.0,"Quote No:",o['quote_no'],37.0,size=8.3)
    field(39.0,44.0,"Dt:",o['quote_date'],76.5,size=8.3)
    field(78.0,44.0,"MKT Person:",o['marketing_person'],137.0,size=8.3)
    field(140.0,44.0,"Delivery Period:",o['delivery_period'],190.0,size=8.3)

    field(left,56.0,"Customer Name:",o['customer_name'],99.0,size=8.3)
    field(101.5,56.0,"Place:",o['place'],151.0,size=8.3)
    field(154.0,56.0,"Terms:",o['terms'],190.0,size=8.3)

    mt_top=62.0
    mt_widths=[12,66,26,17,26,23.5]
    mt_rows=[["Sl.No","Item Name","Model","Qty","Item Value","Add.Charge"]]
    for i in range(3):
        r=b['marketing_items'][i] if i<len(b['marketing_items']) else None
        mt_rows.append([str(i+1),clean(r['item_name']) if r else '',clean(r['model']) if r else '',clean(r['qty']) if r else '',clean(r['item_value']) if r else '',clean(r['add_charge']) if r else ''])
    mt_rows.append(["","","","","Total Order Value",clean(o['total_order_value'])])
    table(left,mt_top,mt_widths,[7.5,10,10,10,8.5],mt_rows,font_size=7.8,aligns=['center','left','center','center','center','center'])

    # service strip
    service_top=110.8; service_h=7.5
    rect(left,service_top,inner,service_h,width=.55)
    x=21.2
    x=checkbox(x,116.0,"Demo",bool(o['service_demo']))+2.0
    x=checkbox(x,116.0,"Installation",bool(o['service_installation']))+2.0
    x=checkbox(x,116.0,"Calibration",bool(o['service_calibration']))+2.2
    field(x,116.0,"Ser.Person:",o['service_person'],143.0,size=7.6)
    field(145.0,116.0,"Dt:",o['service_date'],168.0,size=7.6)
    field(170.0,116.0,"Amount:",o['service_amount'],189.5,size=7.6)

    # middle headings / dispatch + payment
    blue_bar(left,122.0,69.0,"Dispatch Details",h=7.6,size=14.0)
    pay_x=98.0; pay_w=92.0
    blue_bar(pay_x,122.0,77.0,"Payment Details",h=7.6,size=14.0)

    field(left,143.0,"Packing By:",g(d,'packing_by'),88.0,size=8.4)
    field(left,155.5,"Dispatch On:",g(d,'dispatch_on'),57.0,size=8.4)
    field(58.0,155.5,"Weight:",g(d,'weight'),88.0,size=8.4)
    text(left,168.0,"Courier : AIR / ROAD / RAILWAY / OTHER",size=8.6,bold=True)
    field(left,181.0,"Amount:",g(d,'amount'),54.0,size=8.4)
    field(56.0,181.0,"Sign:",g(d,'sign'),88.0,size=8.4)

    cp_total=sum(fnum(x['amount']) for x in b['customer_payments'])
    cp_balance=fnum(o['total_order_value'])-cp_total
    p_rows=[["Date","Bank Mode","Amount"]]
    for i in range(3):
        r=b['customer_payments'][i] if i<len(b['customer_payments']) else None
        p_rows.append([clean(r['payment_date']) if r else '',clean(r['bank_mode']) if r else '',clean(r['amount']) if r else ''])
    p_rows.append(["","Total Amount Received",clean(cp_total)])
    p_widths=[21,48,23]
    p_bottom=table(pay_x,131.5,p_widths,[7.5,10.5,10.5,10.5,8.5],p_rows,font_size=7.8,aligns=['center','center','center'])
    # Balance exactly as the paper: label below the table and only the amount box outlined.
    text(pay_x+62.0,p_bottom+6.6,"Balance",size=8.2,bold=True,align='center')
    rect(pay_x+69.0,p_bottom,23.0,9.5,width=.65)
    text(pay_x+80.5,p_bottom+6.3,clean(cp_balance),size=7.8,bold=True,align='center')

    # supplier
    blue_bar(left,189.5,68.0,"Supplier Details",h=7.6,size=14.0)
    s_rows=[["Sl.No","Supplier","Model","Net Value","Terms","Delivery\nPeriod"]]
    for i in range(3):
        r=b['supplier_rows'][i] if i<len(b['supplier_rows']) else None
        s_rows.append([str(i+1),clean(r['supplier']) if r else '',clean(r['model']) if r else '',clean(r['net_value']) if r else '',clean(r['terms']) if r else '',clean(r['delivery_period']) if r else ''])
    # draw table ourselves then overlay two-line final header cleanly
    s_widths=[10,64,29,25,19,23.5]
    s_bottom=table(left,201.0,s_widths,[8,10.5,10.5,10.5],s_rows,font_size=7.8,aligns=['center','left','center','center','center','center'])
    # Delivery Period header should be two compact lines like original.
    last_center=left+sum(s_widths[:-1])+s_widths[-1]/2
    c.setFillColor(LIGHT); c.rect(X(left+sum(s_widths[:-1])),Y(209.0),X(s_widths[-1]),X(8),fill=1,stroke=0)
    c.setStrokeColor(INK); c.setLineWidth(.55); c.rect(X(left+sum(s_widths[:-1])),Y(209.0),X(s_widths[-1]),X(8),fill=0,stroke=1)
    text(last_center,204.5,"Delivery",size=7.5,bold=True,align='center')
    text(last_center,207.4,"Period",size=7.5,bold=True,align='center')

    text(left+2.5,253.0,"ORDER PLACE TO :",size=8.7,bold=True)
    solid_line(58.0,254.0,183.0,.55)
    text(59.0,252.8,clean(o['order_place_to']),size=8.1,bold=True,maxw=122.0)

    # sign sits above the approval box exactly like the paper
    text(166.0,266.0,"Sign :",size=8.5,bold=True)
    # compact bottom boxes - no large blank area
    box_top=270.0; box_h=18.0
    remarks_w=118.5; gap=2.0; appr_x=left+remarks_w+gap; appr_w=right-appr_x
    rect(left,box_top,remarks_w,box_h,width=.7)
    rect(appr_x,box_top,appr_w,box_h,width=.7)
    text(left+2.5,275.0,"Remarks :",size=8.2,bold=True)
    text(left+19.0,275.0,clean(o['remarks']),size=8.0,maxw=remarks_w-22)
    text(appr_x+2.5,275.0,"Date:",size=8.2,bold=True)
    text(appr_x+17.0,275.0,clean(o['approval_date']),size=8.0,bold=True,maxw=appr_w-20)
    text(appr_x+2.5,285.0,"Approved by :",size=8.2,bold=True)
    text(appr_x+25.0,285.0,clean(o['approved_by']),size=8.0,bold=True,maxw=appr_w-28)

    c.showPage()

    # ------------------------------------------------------------------
    # PAGE 2 - Accounts Details / Supplier Payment / Profile Margin
    # ------------------------------------------------------------------
    outer_border()
    left=18.0; right=192.0; inner=right-left

    blue_bar(61.0,7.0,88.0,"ACCOUNTS DETAILS",h=10.5,center=True,rounded=True,size=12.7)
    # The original accounts sheet has the form/order number at upper-left.
    text(20.0,26.0,clean(o['id']),size=11.5,font='Times',align='center')
    text(131.0,31.0,"Estimate Delivery Date :",size=8.0,bold=True)
    dotted_line(169.0,32.0,190.0,.55)
    text(169.5,30.8,clean(g(a,'estimate_delivery_date')),size=7.8,bold=True,maxw=20.0)

    # top four boxes
    box_top=39.0; box_h=14.0
    boxes=[(18.0,34.0,'PO Dt :-',g(a,'po_date')),(55.0,35.0,'PO No :-',g(a,'po_no')),(93.0,66.0,'Supplier Name :-',g(a,'supplier_name')),(162.0,30.0,'Terms :-',g(a,'terms'))]
    for x,w,lab,val in boxes:
        rect(x,box_top,w,box_h,width=.65)
        text(x+2.0,44.0,lab,size=7.8,bold=True)
        text(x+2.0,50.2,clean(val),size=7.8,bold=True,maxw=w-4)

    # account rows with dotted paper lines
    field(18.0,64.5,"Proforma No.",g(a,'proforma_no'),82.0,size=8.0)
    text(85.0,64.5,"Courier Today Basic Yes/No",size=8.1,bold=True)
    text(132.0,64.5,clean(g(a,'courier_today_basic')),size=7.8,bold=True,maxw=10)
    text(146.0,64.5,"PDC On Delivery Yes/No",size=8.1,bold=True)
    dotted_line(185.0,65.5,191.0,.55)
    text(185.2,64.3,clean(g(a,'pdc_on_delivery')),size=7.5,bold=True,maxw=5.5)

    field(18.0,77.0,"Dispatch Dt :",g(a,'dispatch_date'),72.0,size=8.0)
    field(75.0,77.0,"Courier :",g(a,'courier'),128.0,size=8.0)
    field(132.0,77.0,"Packing Mode :",g(a,'packing_mode'),191.0,size=8.0)

    field(18.0,89.5,"Docket No :",g(a,'docket_no'),73.0,size=8.0)
    field(76.0,89.5,"Courier Rs. :",g(a,'courier_rs'),128.0,size=8.0)
    field(132.0,89.5,"Item Received On :",g(a,'item_received_on'),191.0,size=8.0)

    field(18.0,102.0,"Additional Cost :",g(a,'additional_cost'),72.0,size=8.0)
    field(75.0,102.0,"Weight:",g(a,'weight'),118.0,size=8.0)
    text(122.0,102.0,"Dispatch : ROAD / AIR / RAILWAY / OTHER",size=8.1,bold=True)
    if clean(g(a,'dispatch_method')):
        text(190.0,106.0,clean(g(a,'dispatch_method')),size=7.5,bold=True,align='right',maxw=30)

    # item table
    ai_rows=[["S.No","Particulars","Item Value","P&F\nCharges","Tax","Total"]]
    for i in range(3):
        r=b['accounts_items'][i] if i<len(b['accounts_items']) else None
        ai_rows.append([str(i+1),clean(r['particulars']) if r else '',clean(r['item_value']) if r else '',clean(r['pf_charges']) if r else '',clean(r['tax']) if r else '',clean(r['total']) if r else ''])
    bill_amount=sum(fnum(x['total']) for x in b['accounts_items'])
    ai_rows.append(["","","","","Bill Amount",clean(bill_amount)])
    ai_widths=[11,79,25,22,20,17]
    table(left,109.0,ai_widths,[8,10.5,10.5,10.5,8.5],ai_rows,font_size=7.7,aligns=['center','left','center','center','center','center'])

    field(left,160.5,"Purchase Bill No :",g(a,'purchase_bill_no'),93.0,size=8.1)
    field(98.0,160.5,"Bill Dt:",g(a,'bill_date'),139.0,size=8.1)

    # Accounts payment details: boxed header only, then three dotted writing rows.
    blue_bar(left,165.0,60.0,"Payment Details",h=7.5,size=13.4)
    hdr_top=174.0; hdr_h=8.0
    pw=[11,35,76,35,27]
    # keep the right edge aligned to paper width by reducing bank column a little
    pw=[11,34,72,35,22]
    table(left,hdr_top,pw,[hdr_h],[['S.No','Date','Bank & Branch','Mode','Amount']],font_size=7.5,aligns=['center','center','center','center','center'])
    sp_rows=[]
    for i in range(3):
        r=b['supplier_payments'][i] if i<len(b['supplier_payments']) else None
        sp_rows.append((str(i+1),clean(r['payment_date']) if r else '',clean(r['bank_branch']) if r else '',clean(r['mode']) if r else '',clean(r['amount']) if r else ''))
    x_positions=[left,left+pw[0],left+pw[0]+pw[1],left+sum(pw[:3]),left+sum(pw[:4]),left+sum(pw)]
    row_bases=[191.0,204.0,217.0]
    for idx,(sn,dt,bank,mode,amt) in enumerate(sp_rows):
        top=row_bases[idx]
        text(left+3.0,top,sn,size=8.0,bold=True)
        # dotted fields reproduce the handwriting lines from the original paper.
        dotted_line(x_positions[1]+2,top+1.0,x_positions[2]-2)
        dotted_line(x_positions[2]+3,top+1.0,x_positions[3]-3)
        dotted_line(x_positions[3]+3,top+1.0,x_positions[4]-3)
        dotted_line(x_positions[4]+3,top+1.0,x_positions[5]-2)
        text(x_positions[1]+3,top-0.2,dt,size=7.6,bold=True,maxw=pw[1]-6)
        text(x_positions[2]+3,top-0.2,bank,size=7.6,bold=True,maxw=pw[2]-6)
        text(x_positions[3]+3,top-0.2,mode,size=7.6,bold=True,maxw=pw[3]-6)
        text(x_positions[4]+3,top-0.2,amt,size=7.6,bold=True,maxw=pw[4]-6)

    sp_total=sum(fnum(x['amount']) for x in b['supplier_payments'])
    supplier_balance=bill_amount-sp_total
    text(145.0,230.0,"Balance :-",size=8.7,bold=True)
    dotted_line(166.0,231.0,190.0,.7)
    text(167.0,229.8,clean(supplier_balance),size=8.0,bold=True,maxw=22)
    solid_line(166.0,236.0,190.0,.7)
    solid_line(166.0,238.2,190.0,.7)

    # Compact Profile Margin area - matches the original paper, no oversized blank box.
    blue_bar(left,244.0,inner,"Profile Margin",h=7.5,center=True,size=12.5)
    rect(left,251.5,inner,23.0,width=.65)
    field(22.0,260.0,"Total Purchase Cost :",g(a,'total_purchase_cost'),89.0,size=8.0)
    field(102.0,260.0,"Total Selling Cost :",g(a,'total_selling_cost'),188.0,size=8.0)
    field(22.0,271.0,"Profit :",g(a,'profit'),91.0,size=8.0)
    pp=clean(g(a,'profit_percentage'))
    if pp and not pp.endswith('%'): pp += '%'
    field(102.0,271.0,"Profit in Percentage :",pp,188.0,size=8.0)

    # Bottom remarks/signature are plain lines, not a large blank footer.
    text(22.0,285.0,"Remarks :",size=8.5,bold=True)
    dotted_line(39.0,286.0,106.0,.55)
    text(40.0,284.8,clean(g(a,'account_remarks')),size=7.8,bold=True,maxw=65)
    text(151.0,285.0,"Signature :",size=8.5,bold=True)
    dotted_line(172.0,286.0,190.0,.55)
    text(172.5,284.8,clean(g(a,'signature')),size=7.8,bold=True,maxw=17)

    c.save()
    return out

@app.route("/order/<int:oid>/excel")
@login_required
def export_excel(oid):
    return send_file(build_xlsx(oid),as_attachment=True)

@app.route("/order/<int:oid>/pdf")
@login_required
def export_pdf(oid):
    return send_file(build_pdf(oid),as_attachment=True)

@app.route("/order/<int:oid>/paper")
@login_required
def paper_view(oid):
    b=get_order_bundle(oid)
    if not b: return ("Not found",404)
    cp_total=sum(fnum(x["amount"]) for x in b["customer_payments"])
    bill_amount=sum(fnum(x["total"]) for x in b["accounts_items"])
    sp_total=sum(fnum(x["amount"]) for x in b["supplier_payments"])
    return render_template("paper.html",b=b,cp_total=cp_total,cp_balance=fnum(b["order"]["total_order_value"])-cp_total,
                           bill_amount=bill_amount,supplier_balance=bill_amount-sp_total)

def _ensure_google_packages():
    """Install Google integration packages only when Google sync is actually used.

    Core startup intentionally excludes the large Google API dependency tree so normal
    Task Board startup is much faster. The first enabled Google sync installs these
    packages into the same app-local runtime folder, then future syncs are immediate.
    """
    try:
        import google.auth  # noqa: F401
        import googleapiclient  # noqa: F401
        return True, "Google support ready"
    except Exception:
        pass

    req = _APP_ROOT / "requirements_google.txt"
    if not req.exists():
        return False, "Google support requirements file is missing."

    _RUNTIME_SITE.mkdir(parents=True, exist_ok=True)
    cache = _APP_ROOT / ".nunes_runtime" / "pip-cache"
    cache.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "pip", "install",
        "--disable-pip-version-check", "--no-warn-script-location",
        "--prefer-binary", "--no-compile",
        "--cache-dir", str(cache),
        "--target", str(_RUNTIME_SITE),
        "-r", str(req),
    ]
    try:
        proc = subprocess.run(cmd, cwd=str(_APP_ROOT), capture_output=True, text=True, timeout=420)
    except Exception as exc:
        return False, f"Google support installation failed: {exc}"
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "package installation failed").strip().splitlines()
        tail = detail[-1] if detail else "package installation failed"
        return False, f"Google support could not be installed: {tail}"

    if str(_RUNTIME_SITE) not in sys.path:
        sys.path.insert(0, str(_RUNTIME_SITE))
    try:
        import google.auth  # noqa: F401
        import googleapiclient  # noqa: F401
        return True, "Google support installed"
    except Exception as exc:
        return False, f"Google support installed but could not be loaded: {exc}"


def sync_google(oid,upload_files=False):
    cfg=load_config()
    with db() as c:
        if not cfg.get("enabled"):
            c.execute("INSERT INTO sync_log(order_id,sync_type,status,details,created_at) VALUES(?,?,?,?,?)",(oid,"Google","Pending","Integration disabled",now()))
            return False,"Integration disabled"
    ready, dep_msg = _ensure_google_packages()
    if not ready:
        with db() as c:
            c.execute("INSERT INTO sync_log(order_id,sync_type,status,details,created_at) VALUES(?,?,?,?,?)",
                      (oid,"Google","Error",dep_msg[:500],now()))
        return False, dep_msg

    sa=cfg.get("service_account_file","")
    if sa and not os.path.isabs(sa): sa=str((BASE/sa).resolve())
    if not sa or not Path(sa).exists():
        return False,"Service account file not found"
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    scopes=["https://www.googleapis.com/auth/spreadsheets","https://www.googleapis.com/auth/drive"]
    creds=Credentials.from_service_account_file(sa,scopes=scopes)
    b=get_order_bundle(oid); o=b["order"]; a=b["accounts"]
    # Sheets sync
    if cfg.get("spreadsheet_id"):
        sheets=build("sheets","v4",credentials=creds,cache_discovery=False)
        name=cfg.get("worksheet_name","Orders")
        headers=["Record ID","Order ID","Branch","IND / EXPORT","Quote No","Quote Date","Customer Name","Place","Marketing Person","Delivery Period","Terms","Total Order Value",
                 "Order Place To","Status","PO No","Supplier Name","Purchase Bill No","Total Purchase Cost","Total Selling Cost","Profit","Profit %",
                 "Updated At"]
        values=[oid,o["order_name"],BRANCH_BY_KEY.get(o["branch"],BRANCH_BY_KEY[DEFAULT_BRANCH])["name"],o["market_type"],o["quote_no"],o["quote_date"],o["customer_name"],o["place"],o["marketing_person"],o["delivery_period"],o["terms"],o["total_order_value"],
                o["order_place_to"],o["current_status"],a["po_no"] if a else "",a["supplier_name"] if a else "",a["purchase_bill_no"] if a else "",
                a["total_purchase_cost"] if a else 0,a["total_selling_cost"] if a else 0,a["profit"] if a else 0,a["profit_percentage"] if a else 0,o["updated_at"]]
        api=sheets.spreadsheets().values()
        try:
            existing=api.get(spreadsheetId=cfg["spreadsheet_id"],range=f"{name}!A:A").execute().get("values",[])
        except Exception:
            # create sheet if missing
            sheets.spreadsheets().batchUpdate(spreadsheetId=cfg["spreadsheet_id"],body={"requests":[{"addSheet":{"properties":{"title":name}}}]}).execute()
            existing=[]
        if not existing:
            api.update(spreadsheetId=cfg["spreadsheet_id"],range=f"{name}!A1",valueInputOption="RAW",body={"values":[headers,values]}).execute()
        else:
            ids=[str(r[0]) if r else "" for r in existing]
            if str(oid) in ids:
                row=ids.index(str(oid))+1
                api.update(spreadsheetId=cfg["spreadsheet_id"],range=f"{name}!A{row}",valueInputOption="RAW",body={"values":[values]}).execute()
            else:
                api.append(spreadsheetId=cfg["spreadsheet_id"],range=f"{name}!A1",valueInputOption="RAW",insertDataOption="INSERT_ROWS",body={"values":[values]}).execute()
        with db() as c: c.execute("UPDATE orders SET google_sheet_synced=1 WHERE id=?",(oid,))
    # Drive upload only on final
    if upload_files and cfg.get("drive_folder_id"):
        drive=build("drive","v3",credentials=creds,cache_discovery=False)
        pdf=build_pdf(oid); xlsx=build_xlsx(oid)
        urls={}
        for typ,path,mime in [("pdf",pdf,"application/pdf"),("xlsx",xlsx,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]:
            meta={"name":Path(path).name,"parents":[cfg["drive_folder_id"]]}
            f=drive.files().create(body=meta,media_body=MediaFileUpload(str(path),mimetype=mime,resumable=False),fields="id,webViewLink").execute()
            urls[typ]=f.get("webViewLink") or f"https://drive.google.com/file/d/{f['id']}/view"
        with db() as c: c.execute("UPDATE orders SET drive_pdf_url=?,drive_xlsx_url=? WHERE id=?",(urls.get("pdf"),urls.get("xlsx"),oid))
    with db() as c:
        c.execute("INSERT INTO sync_log(order_id,sync_type,status,details,created_at) VALUES(?,?,?,?,?)",(oid,"Google","Success","Synced",now()))
    return True,"Synced"

@app.post("/order/<int:oid>/sync")
@login_required
def manual_sync(oid):
    try:
        ok,msg=sync_google(oid,upload_files=False)
    except Exception as exc:
        ok,msg=False,f"Sync failed: {exc}"
        with db() as c:
            c.execute("INSERT INTO sync_log(order_id,sync_type,status,details,created_at) VALUES(?,?,?,?,?)",
                      (oid,"Google","Error",str(exc)[:500],now()))
    flash(msg,"ok" if ok else "error")
    return redirect(url_for("order_form",oid=oid))

@app.route("/master-excel")
@login_required
def master_excel():
    return send_file(build_master_xlsx(),as_attachment=True)

@app.route("/reports")
@login_required
def reports():
    start=request.args.get("start",""); end=request.args.get("end",""); status=request.args.get("status","")
    branch=request.args.get("branch","").strip().upper()
    if branch and branch not in BRANCH_BY_KEY: branch=""
    market_type=request.args.get("market_type","").strip().upper()
    if market_type and market_type not in MARKET_TYPES: market_type=""
    sql="""SELECT o.*,
      COALESCE((SELECT SUM(amount) FROM customer_payments p WHERE p.order_id=o.id),0) received,
      COALESCE((SELECT total_purchase_cost FROM accounts_details a WHERE a.order_id=o.id),0) purchase_cost,
      COALESCE((SELECT total_selling_cost FROM accounts_details a WHERE a.order_id=o.id),0) selling_cost,
      COALESCE((SELECT profit FROM accounts_details a WHERE a.order_id=o.id),0) profit,
      COALESCE((SELECT profit_percentage FROM accounts_details a WHERE a.order_id=o.id),0) profit_percentage
      FROM orders o WHERE 1=1"""
    args=[]
    if start: sql+=" AND quote_date>=?"; args.append(start)
    if end: sql+=" AND quote_date<=?"; args.append(end)
    if status: sql+=" AND current_status=?"; args.append(status)
    if branch: sql+=" AND branch=?"; args.append(branch)
    if market_type: sql+=" AND market_type=?"; args.append(market_type)
    sql+=" ORDER BY quote_date DESC, id DESC"
    with db() as c: rows=c.execute(sql,args).fetchall()
    return render_template("reports.html",rows=rows,start=start,end=end,status=status,branch=branch,market_type=market_type)

@app.route("/reports/order/<int:oid>")
@login_required
def report_order_detail(oid):
    """Complete on-screen report for one order without changing the paper/PDF form."""
    b=get_order_bundle(oid)
    if not b: return ("Not found",404)
    o=b["order"]
    cp_total=sum(fnum(x["amount"]) for x in b["customer_payments"])
    cp_balance=fnum(o["total_order_value"])-cp_total
    bill_amount=sum(fnum(x["total"]) for x in b["accounts_items"])
    sp_total=sum(fnum(x["amount"]) for x in b["supplier_payments"])
    supplier_balance=bill_amount-sp_total
    return render_template("report_order_detail.html",b=b,cp_total=cp_total,cp_balance=cp_balance,
                           bill_amount=bill_amount,sp_total=sp_total,supplier_balance=supplier_balance)

# NUNES V2.8.6 PURCHASING CAMERA / GEMINI / PROOF
PURCHASE_UPLOADS = DATA / "purchasing_uploads"
PURCHASE_UPLOADS.mkdir(exist_ok=True)
PURCHASE_ALLOWED_EXT = {".jpg",".jpeg",".png",".webp",".pdf"}

def _purchase_order_exists(oid:int) -> bool:
    with db() as c:
        return c.execute("SELECT 1 FROM orders WHERE id=?",(oid,)).fetchone() is not None

def _purchase_upload_dir(oid:int) -> Path:
    p=PURCHASE_UPLOADS/str(int(oid))
    p.mkdir(parents=True,exist_ok=True)
    return p

def _safe_purchase_filename(name:str) -> str:
    raw=Path(str(name or "photo.jpg")).name
    stem="".join(ch if ch.isalnum() or ch in "-_ ." else "_" for ch in Path(raw).stem).strip(" .")[:80] or "photo"
    ext=Path(raw).suffix.lower()
    if ext not in PURCHASE_ALLOWED_EXT: ext=".jpg"
    return f"{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}_{stem}{ext}"

@app.post("/order/<int:oid>/gemini-scan")
@login_required
def purchase_gemini_scan(oid):
    if not _purchase_order_exists(oid): return jsonify(error="Purchasing order not found."),404
    body=request.get_json(silent=True) or {}
    if not body.get("fileDataUrl"): return jsonify(error="Purchasing form image/PDF is missing."),400
    req=urllib.request.Request("http://127.0.0.1:5055/api/forms/purchasing-gemini-parse",
        data=json.dumps({"fileDataUrl":body.get("fileDataUrl"),"fileName":body.get("fileName","purchasing-form")}).encode("utf-8"),
        method="POST",headers={"Content-Type":"application/json","User-Agent":"NUNES-Purchasing-Camera/2.8.6"})
    try:
        with urllib.request.urlopen(req,timeout=35) as resp:
            payload=json.loads(resp.read().decode("utf-8","ignore") or "{}")
            return jsonify(payload),resp.status
    except urllib.error.HTTPError as exc:
        raw=exc.read().decode("utf-8","ignore")
        try: payload=json.loads(raw or "{}")
        except Exception: payload={"error":raw or f"Gemini scan failed ({exc.code})."}
        return jsonify(payload),exc.code
    except Exception as exc:
        return jsonify(error=f"Gemini purchasing scan service is unavailable: {exc}"),503

@app.route("/order/<int:oid>/attachments",methods=["GET","POST"])
@login_required
def purchase_attachments(oid):
    if not _purchase_order_exists(oid): return jsonify(error="Purchasing order not found."),404
    folder=_purchase_upload_dir(oid)
    if request.method=="GET":
        files=[]
        for p in sorted(folder.iterdir(),key=lambda x:x.stat().st_mtime if x.is_file() else 0,reverse=True):
            if not p.is_file(): continue
            files.append({"name":p.name,"url":url_for("purchase_attachment_file",oid=oid,name=p.name)})
        return jsonify(files=files)
    f=request.files.get("file")
    if not f or not f.filename: return jsonify(error="Photo/file is missing."),400
    ext=Path(f.filename).suffix.lower()
    if ext not in PURCHASE_ALLOWED_EXT: return jsonify(error="Use JPG, PNG, WEBP or PDF."),400
    # 15 MB hard safety limit without changing the global Flask request limit.
    f.stream.seek(0,2); size=f.stream.tell(); f.stream.seek(0)
    if size>15*1024*1024: return jsonify(error="File is larger than 15 MB."),413
    name=_safe_purchase_filename(f.filename)
    dest=folder/name
    f.save(dest)
    with db() as c: audit(c,oid,"attachment","uploaded",name)
    return jsonify(ok=True,name=name,url=url_for("purchase_attachment_file",oid=oid,name=name))

@app.get("/order/<int:oid>/attachment/<path:name>")
@login_required
def purchase_attachment_file(oid,name):
    if not _purchase_order_exists(oid): return ("Not found",404)
    safe=Path(name).name
    p=_purchase_upload_dir(oid)/safe
    if not p.exists() or not p.is_file(): return ("Not found",404)
    return send_file(p)

# NUNES V2.8.6.5 USB DEBUGGING PHONE BRIDGE
def _service_usb_json(path, method="GET"):
    url="http://127.0.0.1:5055"+path
    data=b"{}" if method=="POST" else None
    req=urllib.request.Request(url,data=data,method=method,headers={"Content-Type":"application/json","User-Agent":"NUNES-Purchasing-USB-Phone/2.8.6.5"})
    try:
        with urllib.request.urlopen(req,timeout=12) as resp:
            raw=resp.read().decode("utf-8","ignore")
            return (json.loads(raw or "{}"),resp.status)
    except urllib.error.HTTPError as exc:
        raw=exc.read().decode("utf-8","ignore")
        try: payload=json.loads(raw or "{}")
        except Exception: payload={"error":raw or f"USB phone bridge failed ({exc.code})."}
        return (payload,exc.code)
    except Exception as exc:
        return ({"error":f"USB phone bridge is unavailable: {exc}","code":"USB_PHONE_PROXY_UNAVAILABLE"},503)

@app.post("/order/<int:oid>/usb-phone/start")
@login_required
def purchase_usb_phone_start(oid):
    if not _purchase_order_exists(oid): return jsonify(error="Purchasing order not found."),404
    payload,status=_service_usb_json("/api/phone-usb/start","POST")
    return jsonify(payload),status

@app.get("/order/<int:oid>/usb-phone/session/<sid>")
@login_required
def purchase_usb_phone_session(oid,sid):
    if not _purchase_order_exists(oid): return jsonify(error="Purchasing order not found."),404
    safe="".join(ch for ch in sid if ch.isalnum() or ch in "-_")[:100]
    if not safe: return jsonify(error="Invalid USB phone session."),400
    payload,status=_service_usb_json(f"/api/phone-usb/session/{safe}")
    return jsonify(payload),status

@app.get("/order/<int:oid>/usb-phone/session/<sid>/file")
@login_required
def purchase_usb_phone_file(oid,sid):
    if not _purchase_order_exists(oid): return ("Purchasing order not found.",404)
    safe="".join(ch for ch in sid if ch.isalnum() or ch in "-_")[:100]
    if not safe: return ("Invalid USB phone session.",400)
    req=urllib.request.Request(f"http://127.0.0.1:5055/api/phone-usb/session/{safe}/file",headers={"User-Agent":"NUNES-Purchasing-USB-Phone/2.8.6.5"})
    try:
        with urllib.request.urlopen(req,timeout=12) as resp:
            raw=resp.read()
            return raw,resp.status,{"Content-Type":resp.headers.get("Content-Type","image/jpeg"),"Cache-Control":"no-store"}
    except urllib.error.HTTPError as exc:
        return exc.read(),exc.code,{"Content-Type":exc.headers.get("Content-Type","text/plain")}
    except Exception as exc:
        return (f"USB phone bridge is unavailable: {exc}",503)

@app.route("/health")
def health():
    raw = str(BASE.resolve()).casefold().encode("utf-8", "ignore")
    return jsonify(ok=True,time=now(),app="NunesPurchasingForms",version="1.0.12",instance_id=hashlib.sha1(raw).hexdigest()[:16])

def lan_ip():
    candidates=[]
    try:
        candidates += socket.gethostbyname_ex(socket.gethostname())[2]
    except Exception:
        pass
    try:
        s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        s.connect(("8.8.8.8",80))
        candidates.append(s.getsockname()[0]); s.close()
    except Exception:
        pass
    for ip in candidates:
        if ip.startswith(("10.","192.168.","172.")) and not ip.startswith("127."):
            return ip
    for ip in candidates:
        if ip and not ip.startswith("127."):
            return ip
    return "127.0.0.1"

if __name__=="__main__":
    init_db()
    port=int(os.environ.get("PORT","8770"))
    url=f"http://{lan_ip()}:{port}"
    (DATA/"CLIENT_ACCESS.txt").write_text(f"NUNES FORM WORKFLOW\nServer local: http://127.0.0.1:{port}\nOffice/LAN clients: {url}\n\nKeep server PC ON.\n",encoding="utf-8")
    try:
        build_master_xlsx()
    except Exception:
        pass
    print("="*60)
    print(" NUNES FORM WORKFLOW")
    print("="*60)
    print("Server:",f"http://127.0.0.1:{port}")
    print("Office clients:",url)
    print("Mode: Shared office task board - no login required")
    print("="*60)
    app.run(host="0.0.0.0",port=port,debug=False,threaded=True)
