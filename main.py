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


def _allocate_locations(total, locations):
    weight_total = sum(location[3] for location in locations)
    exact_counts = [total * location[3] / weight_total for location in locations]
    counts = [int(count) for count in exact_counts]
    remaining = total - sum(counts)
    for index in sorted(range(len(locations)), key=lambda i: exact_counts[i] - counts[i], reverse=True)[:remaining]:
        counts[index] += 1
    return [
        {"name": name, "latitude": latitude, "longitude": longitude, "count": count}
        for (name, latitude, longitude, _), count in zip(locations, counts)
    ]


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
    "service_centres": {
        "total": 2000,
        "estimate_basis": "Illustrative estimates weighted by 2011 Census district populations; city and major-city counts are approximate allocations, not verified centre records.",
        "areas": [
            {"name": "Kerala", "count": 1300, "latitude": 10.8505, "longitude": 76.2711},
            {"name": "Outside Kerala", "count": 700},
        ],
        "kerala_districts": [
            {"name": "Thiruvananthapuram", "count": 129, "latitude": 8.5241, "longitude": 76.9366, "areas": _allocate_locations(129, [
                ("Thiruvananthapuram", 8.5241, 76.9366, 30), ("Neyyattinkara", 8.4016, 77.0850, 18),
                ("Attingal", 8.6961, 76.8152, 14), ("Varkala", 8.7379, 76.7163, 10),
                ("Nedumangad", 8.6027, 77.0010, 8), ("Vizhinjam", 8.3820, 76.9930, 5),
                ("Other areas", 8.4600, 76.9000, 15)])},
            {"name": "Kollam", "count": 102, "latitude": 8.8932, "longitude": 76.6141, "areas": _allocate_locations(102, [
                ("Kollam", 8.8932, 76.6141, 30), ("Punalur", 9.0196, 76.9226, 18),
                ("Kottarakkara", 9.0016, 76.7727, 14), ("Karunagappally", 9.0580, 76.5350, 10),
                ("Paravur", 8.7940, 76.6670, 8), ("Anchal", 8.9520, 76.9690, 5),
                ("Other areas", 8.9200, 76.7000, 15)])},
            {"name": "Pathanamthitta", "count": 47, "latitude": 9.2648, "longitude": 76.7870, "areas": _allocate_locations(47, [
                ("Pathanamthitta", 9.2648, 76.7870, 30), ("Adoor", 9.1551, 76.7310, 18),
                ("Thiruvalla", 9.3833, 76.5740, 14), ("Kozhencherry", 9.3290, 76.7500, 10),
                ("Ranni", 9.3840, 76.8140, 8), ("Pandalam", 9.2200, 76.6800, 5),
                ("Other areas", 9.3000, 76.7000, 15)])},
            {"name": "Alappuzha", "count": 83, "latitude": 9.4981, "longitude": 76.3388, "areas": _allocate_locations(83, [
                ("Alappuzha", 9.4981, 76.3388, 30), ("Cherthala", 9.6840, 76.3350, 18),
                ("Kayamkulam", 9.1810, 76.5000, 14), ("Mavelikkara", 9.2590, 76.5560, 10),
                ("Haripad", 9.2840, 76.4580, 8), ("Chengannur", 9.3150, 76.6150, 5),
                ("Other areas", 9.4200, 76.3500, 15)])},
            {"name": "Kottayam", "count": 77, "latitude": 9.5916, "longitude": 76.5222, "areas": _allocate_locations(77, [
                ("Kottayam", 9.5916, 76.5222, 30), ("Changanassery", 9.4667, 76.5500, 18),
                ("Pala", 9.7167, 76.6833, 14), ("Vaikom", 9.7500, 76.4000, 10),
                ("Ettumanoor", 9.6700, 76.5600, 8), ("Erattupetta", 9.6860, 76.7800, 5),
                ("Other areas", 9.5500, 76.5000, 15)])},
            {"name": "Idukki", "count": 43, "latitude": 9.8500, "longitude": 76.9700, "areas": _allocate_locations(43, [
                ("Thodupuzha", 9.8944, 76.7180, 30), ("Munnar", 10.0889, 77.0595, 18),
                ("Kattappana", 9.7540, 77.1170, 14), ("Adimali", 10.0110, 76.9500, 10),
                ("Kumily", 9.6060, 77.1670, 8), ("Nedumkandam", 9.8380, 77.1530, 5),
                ("Other areas", 9.9000, 76.9500, 15)])},
            {"name": "Ernakulam", "count": 128, "latitude": 9.9816, "longitude": 76.2999, "areas": _allocate_locations(128, [
                ("Kochi", 9.9312, 76.2673, 30), ("Aluva", 10.1000, 76.3500, 18),
                ("Perumbavoor", 10.1060, 76.4730, 14), ("Muvattupuzha", 9.9840, 76.5760, 10),
                ("Angamaly", 10.1960, 76.3860, 8), ("Tripunithura", 9.9470, 76.3260, 5),
                ("Other areas", 10.0000, 76.3500, 15)])},
            {"name": "Thrissur", "count": 121, "latitude": 10.5276, "longitude": 76.2144, "areas": _allocate_locations(121, [
                ("Thrissur", 10.5276, 76.2144, 30), ("Chalakkudy", 10.3070, 76.3370, 18),
                ("Guruvayur", 10.5940, 76.0420, 14), ("Irinjalakuda", 10.3420, 76.2110, 10),
                ("Kunnamkulam", 10.6500, 76.0830, 8), ("Kodungallur", 10.2200, 76.2000, 5),
                ("Other areas", 10.5000, 76.3000, 15)])},
            {"name": "Palakkad", "count": 109, "latitude": 10.7867, "longitude": 76.6548, "areas": _allocate_locations(109, [
                ("Palakkad", 10.7867, 76.6548, 30), ("Ottapalam", 10.7730, 76.3770, 18),
                ("Shoranur", 10.7670, 76.2830, 14), ("Chittur", 10.7000, 76.7470, 10),
                ("Mannarkkad", 10.9900, 76.4660, 8), ("Pattambi", 10.8050, 76.1950, 5),
                ("Other areas", 10.8500, 76.5500, 15)])},
            {"name": "Malappuram", "count": 160, "latitude": 11.0510, "longitude": 76.0711, "areas": _allocate_locations(160, [
                ("Malappuram", 11.0510, 76.0711, 30), ("Manjeri", 11.1200, 76.1190, 18),
                ("Tirur", 10.9130, 75.9220, 14), ("Ponnani", 10.7670, 75.9250, 10),
                ("Perinthalmanna", 10.9780, 76.2250, 8), ("Nilambur", 11.2800, 76.2250, 5),
                ("Other areas", 11.0500, 76.0000, 15)])},
            {"name": "Kozhikode", "count": 120, "latitude": 11.2588, "longitude": 75.7804, "areas": _allocate_locations(120, [
                ("Kozhikode", 11.2588, 75.7804, 30), ("Vadakara", 11.6080, 75.5910, 18),
                ("Koyilandy", 11.4400, 75.6960, 14), ("Ramanattukara", 11.1840, 75.8710, 10),
                ("Feroke", 11.1800, 75.8410, 8), ("Thamarassery", 11.4160, 76.0020, 5),
                ("Other areas", 11.3500, 75.9000, 15)])},
            {"name": "Wayanad", "count": 32, "latitude": 11.6854, "longitude": 76.1320, "areas": _allocate_locations(32, [
                ("Kalpetta", 11.6100, 76.0800, 30), ("Mananthavady", 11.8000, 76.0000, 18),
                ("Sulthan Bathery", 11.6640, 76.2570, 14), ("Vythiri", 11.5500, 76.0380, 10),
                ("Panamaram", 11.7410, 76.0740, 8), ("Meenangadi", 11.6600, 76.2080, 5),
                ("Other areas", 11.6500, 76.1500, 15)])},
            {"name": "Kannur", "count": 98, "latitude": 11.8745, "longitude": 75.3704, "areas": _allocate_locations(98, [
                ("Kannur", 11.8745, 75.3704, 30), ("Thalassery", 11.7480, 75.4890, 18),
                ("Payyannur", 12.0990, 75.2010, 14), ("Mattannur", 11.9300, 75.5710, 10),
                ("Taliparamba", 12.0410, 75.3580, 8), ("Iritty", 11.9890, 75.6740, 5),
                ("Other areas", 11.9000, 75.5000, 15)])},
            {"name": "Kasaragod", "count": 51, "latitude": 12.4996, "longitude": 74.9869, "areas": _allocate_locations(51, [
                ("Kasaragod", 12.4996, 74.9869, 30), ("Kanhangad", 12.3080, 75.0960, 18),
                ("Nileshwar", 12.2610, 75.1370, 14), ("Uppala", 12.5840, 74.9860, 10),
                ("Cheruvathur", 12.2160, 75.1660, 8), ("Manjeshwaram", 12.7170, 74.8900, 5),
                ("Other areas", 12.4500, 75.1000, 15)])},
        ],
        "outside_major_cities": _allocate_locations(700, [
            ("Mumbai", 19.0760, 72.8777, 18), ("Delhi", 28.6139, 77.2090, 18),
            ("Bengaluru", 12.9716, 77.5946, 11), ("Chennai", 13.0827, 80.2707, 10),
            ("Hyderabad", 17.3850, 78.4867, 10), ("Kolkata", 22.5726, 88.3639, 10),
            ("Pune", 18.5204, 73.8567, 8), ("Ahmedabad", 23.0225, 72.5714, 8),
            ("Surat", 21.1702, 72.8311, 7), ("Lucknow", 26.8467, 80.9462, 6),
            ("Jaipur", 26.9124, 75.7873, 6), ("Patna", 25.5941, 85.1376, 5),
            ("Kanpur", 26.4499, 80.3319, 5), ("Nagpur", 21.1458, 79.0882, 4),
            ("Indore", 22.7196, 75.8577, 4), ("Bhopal", 23.2599, 77.4126, 3),
            ("Visakhapatnam", 17.6868, 83.2185, 3), ("Coimbatore", 11.0168, 76.9558, 3),
            ("Guwahati", 26.1445, 91.7362, 2), ("Chandigarh", 30.7333, 76.7794, 2),
            ("Bhubaneswar", 20.2961, 85.8245, 2), ("Ranchi", 23.3441, 85.3096, 2),
            ("Ludhiana", 30.9010, 75.8573, 2), ("Dehradun", 30.3165, 78.0322, 1),
            ("Srinagar", 34.0837, 74.7973, 1),
        ]),
    },
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
