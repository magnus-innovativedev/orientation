"""Magnus admission-counselling app (Flask + SQLite).

Run:  pip install -r requirements.txt && python main.py
Env:  ADMIN_PIN=<your pin>   (default 1234 - change it!)
"""
import csv, io, json, os, secrets, sqlite3
from datetime import datetime
from flask import Flask, Response, abort, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
MEDIA = os.path.join(BASE, "static", "media")
PHOTOS = os.path.join(DATA, "lead_photos")
for d in (DATA, MEDIA, PHOTOS):
    os.makedirs(d, exist_ok=True)
DB = os.path.join(DATA, "magnus.db")
ADMIN_PIN = os.environ.get("ADMIN_PIN", "1234")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # videos

IMG_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
VID_EXT = {"mp4", "webm", "mov"}

# ---- Single source of truth for every number in the PPT. Override in config.json ----
CONFIG = {
    "institute": "Magnus",
    "courses": {
        "smartphone": {"name": "Smartphone Chip-Level Engineering", "short": "Smartphone",
                       "months": 20, "training": 8, "ojt": 12,
                       "student_fee": 156000, "franchise_fee": 86000, "stipend": 66000,
                       "emi_first": 36000, "emi_each": 15000, "emi_count": 8},
        "laptop": {"name": "Smartphone and Laptop Chip-Level Engineering", "short": "Smartphone + Laptop",
                   "months": 22, "training": 10, "ojt": 12,
                   "student_fee": 186000, "franchise_fee": 86000, "stipend": 66000,
                   "emi_first": 36000, "emi_each": 15000, "emi_count": 10},
    },
    "stipend_range": [70000, 150000],
    "salary_range": [20000, 50000],
    "expenses": [
        {"label": "Uniform", "note": "₹420 × 2", "amount": 840},
        {"label": "Agreement paper", "note": "", "amount": 200},
        {"label": "Food making expense", "note": "Self cooking - varies", "amount": None},
    ],
    "cheque": {"amount": 86000, "student": 1, "parent": 1},
    "loan": {"emi_from_month": 25, "years": 7},
    "booking": {"first_payment_total": 36980,
                "options": [36980, 20980, 10980, 5980, 2980, 1980, 980]},
    "next_batch": {"date": "2026-12-01", "time": "09:30 AM"},  # EDIT ME
    "documents": [
        {"key": "aadhaar", "label": "Aadhaar card", "note": "Student & father"},
        {"key": "pan", "label": "PAN card", "note": "Student & father"},
        {"key": "photos", "label": "Photos", "note": "Student & father"},
        {"key": "land_tax", "label": "Land tax copy", "note": ""},
        {"key": "income", "label": "Income certificate", "note": ""},
        {"key": "bank", "label": "Bank account", "note": ""},
    ],
}
_cfg_file = os.path.join(BASE, "config.json")
if os.path.exists(_cfg_file):
    with open(_cfg_file, encoding="utf-8") as f:
        CONFIG.update(json.load(f))


# ---- DB ----
def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY, created TEXT, updated TEXT,
            name TEXT, phone TEXT, data TEXT DEFAULT '{}')""")


init_db()
PATCHABLE = {"parent_name", "place", "qualification", "course", "payment", "cash_amount", "docs",
             "terms", "booking_amount", "batch", "progress", "status", "acknowledgments"}


def now():
    return datetime.now().isoformat(timespec="seconds")


def lead_out(row):
    d = json.loads(row["data"] or "{}")
    d.update(id=row["id"], name=row["name"], phone=row["phone"], created=row["created"], updated=row["updated"])
    return d


def need_admin():
    if request.headers.get("X-Admin-Pin") != ADMIN_PIN:
        abort(401, "Admin PIN required")


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(404)
@app.errorhandler(413)
def api_error(e):
    return jsonify(error=getattr(e, "description", str(e))), e.code


# ---- Pages ----
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/admin")
def admin_page():
    return render_template("admin.html")


# ---- Public API ----
@app.get("/api/config")
def get_config():
    return jsonify(CONFIG)


def media_map():
    out = {}
    for fn in os.listdir(MEDIA):
        slot, _, ext = fn.rpartition(".")
        ext = ext.lower()
        if slot and ext in IMG_EXT | VID_EXT:
            out[slot] = {"url": f"/static/media/{fn}?v={int(os.path.getmtime(os.path.join(MEDIA, fn)))}",
                         "type": "video" if ext in VID_EXT else "image"}
    return out


@app.get("/api/media")
def get_media():
    return jsonify(media_map())


@app.post("/api/leads")
def create_lead():
    b = request.get_json(silent=True) or {}
    name, phone = (b.get("name") or "").strip(), "".join(c for c in str(b.get("phone", "")) if c.isdigit())[-10:]
    if len(name) < 2:
        abort(400, "Enter the visitor's name")
    if len(phone) != 10 or phone[0] not in "6789":
        abort(400, "Enter a valid 10-digit mobile number")
    lid = secrets.token_urlsafe(8)  # unguessable id, so visitors can't read each other's data
    extra = {k: (b.get(k) or "").strip() for k in ("parent_name", "place", "qualification")}
    extra.update(status="in_progress", progress=0, docs={})
    with db() as con:
        con.execute("INSERT INTO leads VALUES (?,?,?,?,?,?)", (lid, now(), now(), name, phone, json.dumps(extra)))
        row = con.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
    return jsonify(lead_out(row)), 201


@app.get("/api/leads/<lid>")
def read_lead(lid):
    with db() as con:
        row = con.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
    if not row:
        abort(404, "Visitor not found")
    return jsonify(lead_out(row))


@app.patch("/api/leads/<lid>")
def update_lead(lid):
    b = request.get_json(silent=True) or {}
    with db() as con:
        row = con.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
        if not row:
            abort(404, "Visitor not found")
        data = json.loads(row["data"] or "{}")
        data.update({k: v for k, v in b.items() if k in PATCHABLE})
        con.execute("UPDATE leads SET data=?, updated=? WHERE id=?", (json.dumps(data), now(), lid))
        row = con.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
    return jsonify(lead_out(row))


@app.post("/api/leads/<lid>/photo")
def lead_photo(lid):
    f = request.files.get("file")
    ext = (f.filename.rsplit(".", 1)[-1].lower() if f and "." in f.filename else "")
    if not f or ext not in IMG_EXT:
        abort(400, "Upload a JPG, PNG or WEBP photo")
    with db() as con:
        if not con.execute("SELECT 1 FROM leads WHERE id=?", (lid,)).fetchone():
            abort(404, "Visitor not found")
    for old in os.listdir(PHOTOS):
        if old.startswith(lid + "."):
            os.remove(os.path.join(PHOTOS, old))
    f.save(os.path.join(PHOTOS, f"{lid}.{ext}"))
    return jsonify(ok=True)


# ---- Admin API ----
@app.post("/api/admin/login")
def admin_login():
    need_admin()
    return jsonify(ok=True)


@app.post("/api/media/<slot>")
def upload_media(slot):
    need_admin()
    f = request.files.get("file")
    slot = secure_filename(slot)
    ext = (f.filename.rsplit(".", 1)[-1].lower() if f and "." in f.filename else "")
    if not f or not slot or ext not in IMG_EXT | VID_EXT:
        abort(400, "Upload an image (jpg, png, webp) or video (mp4, webm)")
    for old in os.listdir(MEDIA):  # one file per slot
        if old.rpartition(".")[0] == slot:
            os.remove(os.path.join(MEDIA, old))
    f.save(os.path.join(MEDIA, f"{slot}.{ext}"))
    return jsonify(media_map().get(slot))


@app.get("/api/admin/leads")
def admin_leads():
    need_admin()
    with db() as con:
        rows = con.execute("SELECT * FROM leads ORDER BY updated DESC").fetchall()
    return jsonify([lead_out(r) for r in rows])


@app.get("/api/admin/leads.csv")
def admin_csv():
    need_admin()
    with db() as con:
        rows = [lead_out(r) for r in con.execute("SELECT * FROM leads ORDER BY created DESC")]
    cols = ["id", "created", "name", "phone", "parent_name", "place", "qualification", "course", "payment",
            "cash_amount", "booking_amount", "batch", "terms", "status", "progress"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols + ["docs_ready"])
    for r in rows:
        w.writerow([r.get(c, "") for c in cols] + [sum(1 for v in (r.get("docs") or {}).values() if v)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=magnus_leads.csv"})


@app.get("/api/admin/lead_photo/<lid>")
def admin_photo(lid):
    need_admin()
    for fn in os.listdir(PHOTOS):
        if fn.startswith(secure_filename(lid) + "."):
            return send_from_directory(PHOTOS, fn)
    abort(404, "No photo")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
