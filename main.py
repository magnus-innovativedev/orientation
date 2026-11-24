"""Magnus admission-counselling app (Flask + SQLite)."""
import csv, hashlib, io, json, os, secrets, shutil, sqlite3, threading, wave
from contextlib import contextmanager
from functools import wraps
from datetime import datetime, timedelta
import bcrypt
from dotenv import load_dotenv
from flask import Flask, Response, abort, g, jsonify, render_template, request, send_from_directory, session
from werkzeug.utils import secure_filename

BASE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE, "env", ".env"))
DATA = os.path.abspath(os.environ.get("MAGNUS_DATA_DIR", os.path.join(BASE, "data")))
MEDIA = os.path.join(DATA, "media")
LEGACY_MEDIA = os.path.join(BASE, "static", "media")
PHOTOS = os.path.join(DATA, "lead_photos")
RECORDINGS = os.path.join(DATA, "recordings")
for d in (DATA, MEDIA, LEGACY_MEDIA, PHOTOS, RECORDINGS):
    os.makedirs(d, exist_ok=True)
DB = os.path.join(DATA, "magnus.db")


def load_session_secret():
    configured = os.environ.get("FLASK_SECRET_KEY")
    if configured:
        return configured
    secret_path = os.path.join(DATA, "flask_session.key")
    try:
        with open(secret_path, "x", encoding="ascii") as secret_file:
            secret_file.write(secrets.token_urlsafe(64))
    except FileExistsError:
        pass
    with open(secret_path, encoding="ascii") as secret_file:
        return secret_file.read().strip()


app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = load_session_secret()
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # videos
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "").lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)

IMG_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
VID_EXT = {"mp4", "webm", "mov"}

BRANCH_NAMES = (
    "Manjeri", "Kasargod", "Kannur", "Kuttiyadi", "Kozhikode", "Tirur", "Palakkad",
    "Thrissur", "Ernakulam", "Alappuzha", "Kottayam", "Kollam", "Trivandrum",
    "Marthandam", "Nagpur", "Hyderabad", "Bangalore",
)

ROLE_DEFINITIONS = (
    ("orientation_manager", "Orientation Manager", 0),
    ("branch_manager", "Branch Manager", 0),
    ("admin", "Admin", 0),
    ("developer", "Developer", 1),
)


class Permission:
    VISITOR_CREATE = "visitor.create"
    VISITOR_VIEW_BRANCH = "visitor.view_branch"
    VISITOR_VIEW_ALL = "visitor.view_all"
    VISITOR_RESUME = "visitor.resume"
    USER_VIEW_OWN_BRANCH = "user.view_own_branch"
    USER_VIEW_ALL = "user.view_all"
    USER_ADD_RECEPTION = "user.add_reception"
    USER_REMOVE_RECEPTION = "user.remove_reception"
    USER_ADD_SCM = "user.add_scm"
    USER_REMOVE_SCM = "user.remove_scm"
    USER_ADD_HOD = "user.add_hod"
    USER_REMOVE_HOD = "user.remove_hod"
    USER_ADD_ORIENTATION_MANAGER = "user.add_orientation_manager"
    USER_REMOVE_ORIENTATION_MANAGER = "user.remove_orientation_manager"
    USER_ADD_BRANCH_MANAGER = "user.add_branch_manager"
    USER_REMOVE_BRANCH_MANAGER = "user.remove_branch_manager"
    USER_ADD_ADMIN = "user.add_admin"
    USER_ADD_DEVELOPER = "user.add_developer"
    USER_MANAGE_DEVELOPER = "user.manage_developer"
    USER_EDIT = "user.edit"
    USER_DEACTIVATE = "user.deactivate"
    USER_REMOVE = "user.remove"
    MEDIA_UPLOAD_IMAGE = "media.upload_image"
    MEDIA_UPLOAD_VIDEO = "media.upload_video"
    RECORDING_LISTEN = "recording.listen"
    ROLES_VIEW = "roles.view"
    ROLES_EDIT = "roles.edit"


PERMISSION_DEFINITIONS = (
    (Permission.VISITOR_CREATE, "Start a visitor session", "Visitors"),
    (Permission.VISITOR_VIEW_BRANCH, "View permitted visitors in the assigned branch; branch managers can view all", "Visitors"),
    (Permission.VISITOR_VIEW_ALL, "View visitors across all branches", "Visitors"),
    (Permission.VISITOR_RESUME, "Resume and update an unfinished visitor", "Visitors"),
    (Permission.USER_VIEW_OWN_BRANCH, "View users in the assigned branch", "Users"),
    (Permission.USER_VIEW_ALL, "View users across all branches", "Users"),
    (Permission.USER_ADD_RECEPTION, "Add Reception staff", "Users"),
    (Permission.USER_REMOVE_RECEPTION, "Remove Reception staff", "Users"),
    (Permission.USER_ADD_SCM, "Add SCM staff", "Users"),
    (Permission.USER_REMOVE_SCM, "Remove SCM staff", "Users"),
    (Permission.USER_ADD_HOD, "Add HOD staff", "Users"),
    (Permission.USER_REMOVE_HOD, "Remove HOD staff", "Users"),
    (Permission.USER_ADD_ORIENTATION_MANAGER, "Add Orientation Managers", "Users"),
    (Permission.USER_REMOVE_ORIENTATION_MANAGER, "Remove Orientation Managers", "Users"),
    (Permission.USER_ADD_BRANCH_MANAGER, "Add Branch Managers", "Users"),
    (Permission.USER_REMOVE_BRANCH_MANAGER, "Remove Branch Managers", "Users"),
    (Permission.USER_ADD_ADMIN, "Add Admin users", "Users"),
    (Permission.USER_ADD_DEVELOPER, "Add Developer users", "Users"),
    (Permission.USER_EDIT, "Edit user details and roles", "Users"),
    (Permission.USER_DEACTIVATE, "Deactivate users", "Users"),
    (Permission.USER_REMOVE, "Remove users", "Users"),
    (Permission.MEDIA_UPLOAD_IMAGE, "Upload images", "Media"),
    (Permission.MEDIA_UPLOAD_VIDEO, "Upload videos", "Media"),
    (Permission.RECORDING_LISTEN, "Listen to visitor recordings", "Recordings"),
    (Permission.ROLES_VIEW, "View roles and permissions", "Roles"),
    (Permission.ROLES_EDIT, "Edit roles and user overrides", "Roles"),
)


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
    "audio_retention_days": 90,
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
AUDIO_RETENTION_DAYS = int(os.environ.get("AUDIO_RETENTION_DAYS", CONFIG["audio_retention_days"]))
if AUDIO_RETENTION_DAYS < 1:
    raise ValueError("AUDIO_RETENTION_DAYS must be at least 1")
CONFIG["audio_retention_days"] = AUDIO_RETENTION_DAYS


# ---- DB ----
@contextmanager
def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def now():
    return datetime.now().isoformat(timespec="seconds")


def write_audit(con, actor_id, action, target_user_id=None, target_role_id=None,
                before=None, after=None, reason=None):
    con.execute(
        """INSERT INTO audit_log
           (actor_id, action, target_user_id, target_role_id, before_json, after_json, reason, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (actor_id, action, target_user_id, target_role_id,
         json.dumps(before, sort_keys=True) if before is not None else None,
         json.dumps(after, sort_keys=True) if after is not None else None,
         reason, now()),
    )


def seed_user_management(con, seed_matrix=False):
    for name in BRANCH_NAMES:
        branch_id = name.lower().replace(" ", "-")
        con.execute("INSERT OR IGNORE INTO branches (id, name, active) VALUES (?, ?, 1)", (branch_id, name))
    for role_key, role_name, locked in ROLE_DEFINITIONS:
        con.execute("INSERT OR IGNORE INTO roles (key, name, locked) VALUES (?, ?, ?)",
                    (role_key, role_name, locked))
    for permission_key, description, group_name in PERMISSION_DEFINITIONS:
        con.execute(
            "INSERT OR IGNORE INTO permissions (key, description, group_name) VALUES (?, ?, ?)",
            (permission_key, description, group_name),
        )
    if not seed_matrix:
        return

    all_permissions = {definition[0] for definition in PERMISSION_DEFINITIONS}
    orientation = {
        Permission.VISITOR_CREATE, Permission.VISITOR_VIEW_BRANCH, Permission.VISITOR_RESUME,
    }
    branch_manager = orientation | {
        Permission.USER_VIEW_OWN_BRANCH,
        Permission.USER_ADD_RECEPTION, Permission.USER_REMOVE_RECEPTION,
        Permission.USER_ADD_SCM, Permission.USER_REMOVE_SCM,
        Permission.USER_ADD_HOD, Permission.USER_REMOVE_HOD,
        Permission.USER_ADD_ORIENTATION_MANAGER, Permission.USER_REMOVE_ORIENTATION_MANAGER,
    }
    matrix = {
        "orientation_manager": orientation,
        "branch_manager": branch_manager,
        "admin": all_permissions - {Permission.USER_ADD_DEVELOPER},
        "developer": all_permissions,
    }
    for role_key, permission_keys in matrix.items():
        role_id = con.execute("SELECT id FROM roles WHERE key=?", (role_key,)).fetchone()["id"]
        for permission_key in permission_keys:
            permission_id = con.execute(
                "SELECT id FROM permissions WHERE key=?", (permission_key,)
            ).fetchone()["id"]
            con.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                (role_id, permission_id),
            )


def _column_exists(con, table, column):
    return any(row["name"] == column for row in con.execute(f"PRAGMA table_info({table})"))


def migrate_legacy_media():
    if DATA != os.path.abspath(os.path.join(BASE, "data")):
        return
    for filename in os.listdir(LEGACY_MEDIA):
        source = os.path.join(LEGACY_MEDIA, filename)
        slot, separator, extension = filename.rpartition(".")
        if not separator or extension.lower() not in IMG_EXT | VID_EXT or not os.path.isfile(source):
            continue
        destination = os.path.join(MEDIA, filename)
        if not os.path.exists(destination):
            os.replace(source, destination)


def run_migrations(con):
    con.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    for filename in sorted(os.listdir(os.path.join(BASE, "migrations"))):
        if not filename.endswith(".sql"):
            continue
        applied = con.execute("SELECT 1 FROM schema_migrations WHERE version=?", (filename,)).fetchone()
        if applied:
            continue
        path = os.path.join(BASE, "migrations", filename)
        with open(path, encoding="utf-8") as migration_file:
            statements = migration_file.read().split(";")
        for statement in statements:
            statement = statement.strip()
            if not statement:
                continue
            words = statement.split()
            if len(words) >= 6 and words[0].upper() == "ALTER" and words[1].upper() == "TABLE":
                table, column = words[2], words[5]
                if _column_exists(con, table, column):
                    continue
            con.execute(statement)
        con.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", (filename, now()))
        seed_user_management(con, seed_matrix=True)
    seed_user_management(con)


def init_db():
    with db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY, created TEXT, updated TEXT,
            name TEXT, phone TEXT, data TEXT DEFAULT '{}')""")
        con.execute("""CREATE TABLE IF NOT EXISTS audio_recordings (
            id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created TEXT NOT NULL,
            updated TEXT NOT NULL, completed TEXT, lead_id TEXT, status TEXT NOT NULL,
            sample_rate INTEGER NOT NULL, consented TEXT NOT NULL)""")
        con.execute("""CREATE TABLE IF NOT EXISTS audio_chunks (
            recording_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
            byte_length INTEGER NOT NULL, created TEXT NOT NULL,
            PRIMARY KEY (recording_id, chunk_index))""")
        con.execute("CREATE INDEX IF NOT EXISTS audio_recordings_lead_id ON audio_recordings(lead_id)")
        run_migrations(con)


init_db()
migrate_legacy_media()


PATCHABLE = {"parent_name", "place", "qualification", "course", "payment", "cash_amount", "docs",
             "terms", "booking_amount", "batch", "progress", "status", "acknowledgments"}


def current_user():
    if "authenticated_user" in g:
        return g.authenticated_user
    user_id = session.get("user_id")
    if not user_id:
        abort(401, "Sign in required")
    with db() as con:
        user = con.execute(
            """SELECT users.*, roles.key AS role_key, roles.name AS role_name,
                      branches.name AS branch_name
               FROM users
               LEFT JOIN roles ON roles.id=users.role_id
               LEFT JOIN branches ON branches.id=users.branch_id
               WHERE users.id=? AND users.active=1 AND users.deleted_at IS NULL""",
            (user_id,),
        ).fetchone()
    if not user:
        session.clear()
        abort(401, "Account is inactive")
    g.authenticated_user = user
    return user


def effective_permissions(user_id, con=None):
    if con is None:
        with db() as connection:
            return effective_permissions(user_id, connection)
    user = con.execute(
        """SELECT users.role_id, roles.locked AS role_locked
           FROM users LEFT JOIN roles ON roles.id=users.role_id WHERE users.id=?""",
        (user_id,),
    ).fetchone()
    permissions = set()
    if user and user["role_id"] is not None:
        permissions.update(row["key"] for row in con.execute(
            """SELECT permissions.key FROM role_permissions
               JOIN permissions ON permissions.id=role_permissions.permission_id
               WHERE role_permissions.role_id=?""",
            (user["role_id"],),
        ))
    if user and user["role_locked"]:
        permissions.update(row["key"] for row in con.execute("SELECT key FROM permissions"))
        permissions.add(Permission.USER_MANAGE_DEVELOPER)
    overrides = con.execute(
        """SELECT permissions.key, user_permission_overrides.allowed
           FROM user_permission_overrides
           JOIN permissions ON permissions.id=user_permission_overrides.permission_id
           WHERE user_permission_overrides.user_id=?""",
        (user_id,),
    ).fetchall()
    for override in overrides:
        if override["allowed"]:
            permissions.add(override["key"])
        else:
            permissions.discard(override["key"])
    return permissions


def require_permissions(*permission_keys):
    def decorate(function):
        @wraps(function)
        def guarded(*args, **kwargs):
            user = current_user()
            permissions = effective_permissions(user["id"])
            g.user_permissions = permissions
            if not any(permission in permissions for permission in permission_keys):
                abort(403, "You do not have permission to perform this action")
            return function(*args, **kwargs)
        return guarded
    return decorate


def user_permissions(user):
    permissions = getattr(g, "user_permissions", None)
    return permissions if permissions is not None else effective_permissions(user["id"])


def actor_can_manage_developer_accounts(user, con=None):
    return Permission.USER_MANAGE_DEVELOPER in effective_permissions(user["id"], con)


def require_lead_access(lead_id, permission, user=None, con=None):
    user = user or current_user()
    if con is None:
        with db() as connection:
            return require_lead_access(lead_id, permission, user, connection)
    row = con.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    if not row:
        abort(404, "Visitor not found")
    permissions = user_permissions(user)
    if permission not in permissions and Permission.VISITOR_VIEW_ALL not in permissions:
        abort(403, "You do not have permission to access this visitor")
    if Permission.VISITOR_VIEW_ALL not in permissions:
        if (Permission.VISITOR_VIEW_BRANCH not in permissions or not user["branch_id"]
                or row["branch_id"] != user["branch_id"]):
            abort(403, "Visitor is outside your branch")
        if (user["role_key"] == "orientation_manager"
                and row["created_by_user_id"] != user["id"]):
            abort(403, "Visitor belongs to another counsellor")
        data = json.loads(row["data"] or "{}")
        status = data.get("status", "in_progress")
        if status == "booked":
            if permission == Permission.VISITOR_RESUME:
                abort(403, "Booked visitors are read-only")
            if user["role_key"] not in {"branch_manager", "orientation_manager"}:
                abort(403, "Only unfinished visitors can be accessed in your branch")
        elif status != "in_progress":
            abort(403, "Only unfinished visitors can be accessed in your branch")
    return row


_recording_cleanup_lock = threading.Lock()
_last_recording_cleanup = None


def purge_expired_recordings():
    global _last_recording_cleanup
    today = datetime.now().date()
    if _last_recording_cleanup == today:
        return
    with _recording_cleanup_lock:
        if _last_recording_cleanup == today:
            return
        cutoff = (datetime.now() - timedelta(days=AUDIO_RETENTION_DAYS)).isoformat(timespec="seconds")
        with db() as con:
            expired = con.execute(
                "SELECT id FROM audio_recordings WHERE COALESCE(completed, updated) < ?", (cutoff,)
            ).fetchall()
            cleanup_deferred = False
            for row in expired:
                recording_dir = os.path.join(RECORDINGS, row["id"])
                if os.path.isdir(recording_dir):
                    shutil.rmtree(recording_dir)
                wav_path = os.path.join(RECORDINGS, f"{row['id']}.wav")
                if os.path.isfile(wav_path):
                    try:
                        os.remove(wav_path)
                    except PermissionError:
                        app.logger.warning("Expired audio recording %s is in use; retention cleanup will retry.", row["id"])
                        cleanup_deferred = True
                        continue
                con.execute("DELETE FROM audio_chunks WHERE recording_id=?", (row["id"],))
                con.execute("DELETE FROM audio_recordings WHERE id=?", (row["id"],))
        _last_recording_cleanup = today - timedelta(days=1) if cleanup_deferred else today


@app.before_request
def cleanup_recording_retention():
    purge_expired_recordings()


def recording_for_token(recording_id, token):
    with db() as con:
        row = con.execute("SELECT * FROM audio_recordings WHERE id=?", (recording_id,)).fetchone()
    if not row:
        abort(404, "Recording session not found")
    supplied_hash = hashlib.sha256((token or "").encode("utf-8")).hexdigest()
    if not secrets.compare_digest(row["token_hash"], supplied_hash):
        abort(401, "Recording session token required")
    return row


def lead_out(row):
    d = json.loads(row["data"] or "{}")
    d.update(id=row["id"], name=row["name"], phone=row["phone"], created=row["created"], updated=row["updated"],
             photo=has_lead_photo(row["id"]))
    return d


def has_lead_photo(lid):
    return any(os.path.isfile(os.path.join(PHOTOS, f"{lid}.{extension}")) for extension in IMG_EXT)


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(409)
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


def auth_payload(user):
    return {
        "id": user["id"], "name": user["name"], "email": user["email"],
        "role": user["role_key"], "role_name": user["role_name"],
        "staff_type": user["staff_type"], "branch_id": user["branch_id"],
        "branch_name": user["branch_name"], "must_change_password": bool(user["must_change_password"]),
        "permissions": sorted(effective_permissions(user["id"])),
    }


def hash_password(password):
    if not isinstance(password, str) or not password:
        abort(400, "Password must not be empty")
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        abort(400, "Password must not exceed 72 UTF-8 bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("ascii")


@app.post("/api/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    email = str(body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    with db() as con:
        user = con.execute(
            """SELECT users.*, roles.key AS role_key, roles.name AS role_name,
                      branches.name AS branch_name
               FROM users
               LEFT JOIN roles ON roles.id=users.role_id
               LEFT JOIN branches ON branches.id=users.branch_id
               WHERE users.email=? COLLATE NOCASE AND users.active=1 AND users.deleted_at IS NULL""",
            (email,),
        ).fetchone()
        valid = False
        if user and isinstance(password, str):
            try:
                valid = bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("ascii"))
            except (ValueError, TypeError):
                valid = False
        if not valid:
            abort(401, "Email or password is incorrect")
        con.execute("UPDATE users SET last_login=? WHERE id=?", (now(), user["id"]))
        user = con.execute(
            """SELECT users.*, roles.key AS role_key, roles.name AS role_name,
                      branches.name AS branch_name
               FROM users
               LEFT JOIN roles ON roles.id=users.role_id
               LEFT JOIN branches ON branches.id=users.branch_id
               WHERE users.id=?""",
            (user["id"],),
        ).fetchone()
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    return jsonify(user=auth_payload(user))


@app.get("/api/auth/me")
def get_current_user():
    return jsonify(user=auth_payload(current_user()))


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/auth/change-password")
def change_password():
    user = current_user()
    body = request.get_json(silent=True) or {}
    current_password = body.get("current_password") or ""
    new_password = body.get("new_password") or ""
    if not isinstance(current_password, str):
        current_password = ""
    with db() as con:
        row = con.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        try:
            valid = row and bcrypt.checkpw(current_password.encode("utf-8"), row["password_hash"].encode("ascii"))
        except (ValueError, TypeError):
            valid = False
        if not valid:
            abort(401, "Current password is incorrect")
        password_hash = hash_password(new_password)
        con.execute(
            "UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?",
            (password_hash, user["id"]),
        )
        write_audit(con, user["id"], "user.password_change", user["id"],
                    before={"must_change_password": bool(user["must_change_password"])},
                    after={"must_change_password": False})
    g.pop("authenticated_user", None)
    return jsonify(ok=True)


def media_map():
    out = {}
    for fn in os.listdir(MEDIA):
        slot, _, ext = fn.rpartition(".")
        ext = ext.lower()
        if slot and ext in IMG_EXT | VID_EXT:
            out[slot] = {"url": f"/media/{secure_filename(fn)}?v={int(os.path.getmtime(os.path.join(MEDIA, fn)))}",
                         "type": "video" if ext in VID_EXT else "image"}
    return out


@app.get("/api/media")
def get_media():
    return jsonify(media_map())


@app.get("/media/<filename>")
def public_media(filename):
    filename = secure_filename(filename)
    if not filename or filename != request.view_args["filename"]:
        abort(404, "Media not found")
    extension = filename.rpartition(".")[2].lower()
    if extension not in IMG_EXT | VID_EXT:
        abort(404, "Media not found")
    return send_from_directory(MEDIA, filename, conditional=True, max_age=3600)


@app.post("/api/recordings")
@require_permissions(Permission.VISITOR_CREATE)
def create_recording():
    body = request.get_json(silent=True) or {}
    if body.get("consent") is not True:
        abort(400, "Visitor consent is required before recording")
    user = current_user()
    recording_id, token = secrets.token_urlsafe(18), secrets.token_urlsafe(32)
    created = now()
    branch_id = None if user["role_key"] == "developer" else user["branch_id"]
    with db() as con:
        con.execute(
            """INSERT INTO audio_recordings
               (id, token_hash, created, updated, status, sample_rate, consented, branch_id, created_by_user_id)
               VALUES (?, ?, ?, ?, 'active', 16000, ?, ?, ?)""",
            (recording_id, hashlib.sha256(token.encode("utf-8")).hexdigest(), created, created,
             created, branch_id, user["id"]),
        )
    return jsonify(id=recording_id, token=token, sample_rate=16000, next_index=0, status="active"), 201


@app.get("/api/recordings/<recording_id>/status")
def recording_status(recording_id):
    row = recording_for_token(recording_id, request.headers.get("X-Recording-Token"))
    with db() as con:
        next_index = con.execute(
            "SELECT COALESCE(MAX(chunk_index) + 1, 0) FROM audio_chunks WHERE recording_id=?",
            (recording_id,),
        ).fetchone()[0]
    return jsonify(status=row["status"], sample_rate=row["sample_rate"], next_index=next_index,
                   lead_linked=bool(row["lead_id"]))


@app.put("/api/recordings/<recording_id>/chunks/<int:chunk_index>")
def upload_recording_chunk(recording_id, chunk_index):
    row = recording_for_token(recording_id, request.headers.get("X-Recording-Token"))
    if row["status"] != "active":
        abort(409, "Recording session is no longer active")
    if chunk_index < 0 or chunk_index > 1_000_000:
        abort(400, "Invalid audio chunk index")
    try:
        sample_rate = int(request.headers.get("X-Audio-Sample-Rate", "0"))
    except ValueError:
        abort(400, "Invalid audio sample rate")
    if sample_rate != row["sample_rate"]:
        abort(400, "Audio sample rate does not match the recording session")
    audio = request.get_data(cache=False)
    if not audio or len(audio) > 1024 * 1024 or len(audio) % 2:
        abort(400, "Audio chunk must contain up to 1 MiB of 16-bit PCM data")
    with db() as con:
        existing = con.execute(
            "SELECT 1 FROM audio_chunks WHERE recording_id=? AND chunk_index=?",
            (recording_id, chunk_index),
        ).fetchone()
        if existing:
            return jsonify(ok=True, duplicate=True)
    recording_dir = os.path.join(RECORDINGS, recording_id)
    os.makedirs(recording_dir, exist_ok=True)
    chunk_path = os.path.join(recording_dir, f"{chunk_index:08d}.pcm")
    temporary_path = chunk_path + ".tmp"
    with open(temporary_path, "wb") as audio_file:
        audio_file.write(audio)
    os.replace(temporary_path, chunk_path)
    with db() as con:
        con.execute(
            "INSERT INTO audio_chunks VALUES (?, ?, ?, ?)",
            (recording_id, chunk_index, len(audio), now()),
        )
        con.execute("UPDATE audio_recordings SET updated=? WHERE id=?", (now(), recording_id))
    return jsonify(ok=True, next_index=chunk_index + 1)


@app.post("/api/recordings/<recording_id>/link")
def link_recording(recording_id):
    row = recording_for_token(recording_id, request.headers.get("X-Recording-Token"))
    body = request.get_json(silent=True) or {}
    lead_id = body.get("lead_id")
    if not lead_id:
        abort(400, "Visitor record is required")
    user = current_user()
    if row["created_by_user_id"] != user["id"]:
        abort(403, "Recording session belongs to another user")
    lead = require_lead_access(lead_id, Permission.VISITOR_RESUME, user)
    if Permission.VISITOR_VIEW_ALL not in user_permissions(user):
        if row["branch_id"] != user["branch_id"] or lead["branch_id"] != user["branch_id"]:
            abort(403, "Visitor is outside your branch")
    with db() as con:
        if row["status"] != "active":
            abort(409, "Recording session is no longer active")
        if row["lead_id"] and row["lead_id"] != lead_id:
            abort(409, "Recording is already linked to a different visitor")
        con.execute("UPDATE audio_recordings SET lead_id=?, updated=? WHERE id=?",
                    (lead_id, now(), recording_id))
    return jsonify(ok=True)


@app.post("/api/recordings/<recording_id>/complete")
def complete_recording(recording_id):
    row = recording_for_token(recording_id, request.headers.get("X-Recording-Token"))
    if row["status"] == "complete":
        return jsonify(ok=True, status="complete")
    if row["status"] != "active" or not row["lead_id"]:
        abort(409, "Recording must be linked to a visitor before completion")
    body = request.get_json(silent=True) or {}
    try:
        expected_chunks = int(body.get("expected_chunks", -1))
    except (TypeError, ValueError):
        abort(400, "Invalid expected audio chunk count")
    if expected_chunks < 1 or expected_chunks > 1_000_000:
        abort(400, "Invalid expected audio chunk count")
    with db() as con:
        chunks = con.execute(
            "SELECT chunk_index FROM audio_chunks WHERE recording_id=? ORDER BY chunk_index",
            (recording_id,),
        ).fetchall()
    indexes = [chunk["chunk_index"] for chunk in chunks]
    if indexes != list(range(expected_chunks)):
        abort(409, "Recording chunks are still uploading")
    total_bytes = sum(
        os.path.getsize(os.path.join(RECORDINGS, recording_id, f"{index:08d}.pcm"))
        for index in indexes
    )
    if total_bytes > 0xFFFFFFFF - 44:
        abort(413, "Recording exceeds the WAV file size limit")
    wav_path = os.path.join(RECORDINGS, f"{recording_id}.wav")
    temporary_path = wav_path + ".tmp"
    with wave.open(temporary_path, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(row["sample_rate"])
        for index in indexes:
            chunk_path = os.path.join(RECORDINGS, recording_id, f"{index:08d}.pcm")
            with open(chunk_path, "rb") as audio_file:
                output.writeframesraw(audio_file.read())
    os.replace(temporary_path, wav_path)
    completed = now()
    with db() as con:
        con.execute("UPDATE audio_recordings SET status='complete', completed=?, updated=? WHERE id=?",
                    (completed, completed, recording_id))
        con.execute("DELETE FROM audio_chunks WHERE recording_id=?", (recording_id,))
    shutil.rmtree(os.path.join(RECORDINGS, recording_id), ignore_errors=False)
    return jsonify(ok=True, status="complete")


@app.post("/api/leads")
@require_permissions(Permission.VISITOR_CREATE)
def create_lead():
    user = current_user()
    b = request.get_json(silent=True) or {}
    name, phone = (b.get("name") or "").strip(), "".join(c for c in str(b.get("phone", "")) if c.isdigit())[-10:]
    if len(name) < 2:
        abort(400, "Enter the visitor's name")
    if len(phone) != 10 or phone[0] not in "6789":
        abort(400, "Enter a valid 10-digit mobile number")
    recording_id, recording_token = b.get("recording_id"), b.get("recording_token")
    recording = recording_for_token(recording_id, recording_token) if recording_id else None
    if not recording or recording["status"] != "active" or recording["lead_id"]:
        abort(400, "Start an active recording session before entering visitor details")
    is_developer = user["role_key"] == "developer"
    if recording["created_by_user_id"] != user["id"]:
        abort(403, "Recording session belongs to another user")
    if not is_developer and recording["branch_id"] != user["branch_id"]:
        abort(403, "Recording session is outside your branch")
    lid = secrets.token_urlsafe(8)  # unguessable id, so visitors can't read each other's data
    extra = {k: (b.get(k) or "").strip() for k in ("parent_name", "place", "qualification")}
    extra.update(status="in_progress", progress=0, docs={})
    with db() as con:
        current_recording = con.execute(
            "SELECT * FROM audio_recordings WHERE id=?", (recording_id,)
        ).fetchone()
        if (not current_recording or current_recording["status"] != "active" or current_recording["lead_id"]
                or not secrets.compare_digest(
                    current_recording["token_hash"],
                    hashlib.sha256((recording_token or "").encode("utf-8")).hexdigest(),
                )):
            abort(409, "Recording session is no longer available")
        con.execute(
            """INSERT INTO leads
               (id, created, updated, name, phone, data, branch_id, created_by_user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (lid, now(), now(), name, phone, json.dumps(extra),
             None if is_developer else user["branch_id"], user["id"]),
        )
        con.execute("UPDATE audio_recordings SET lead_id=?, updated=? WHERE id=?",
                    (lid, now(), recording_id))
        row = con.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
    return jsonify(lead_out(row)), 201


@app.get("/api/leads/<lid>")
@require_permissions(Permission.VISITOR_VIEW_BRANCH, Permission.VISITOR_VIEW_ALL)
def read_lead(lid):
    row = require_lead_access(lid, Permission.VISITOR_VIEW_BRANCH)
    return jsonify(lead_out(row))


@app.patch("/api/leads/<lid>")
@require_permissions(Permission.VISITOR_RESUME, Permission.VISITOR_VIEW_ALL)
def update_lead(lid):
    b = request.get_json(silent=True) or {}
    with db() as con:
        row = require_lead_access(lid, Permission.VISITOR_RESUME, con=con)
        if b.get("status") == "booked" and not has_lead_photo(lid):
            abort(400, "Capture or upload a student photo before confirming the booking")
        data = json.loads(row["data"] or "{}")
        data.update({k: v for k, v in b.items() if k in PATCHABLE})
        con.execute("UPDATE leads SET data=?, updated=? WHERE id=?", (json.dumps(data), now(), lid))
        row = con.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
    return jsonify(lead_out(row))


@app.post("/api/leads/<lid>/photo")
@require_permissions(Permission.VISITOR_RESUME, Permission.VISITOR_VIEW_ALL)
def lead_photo(lid):
    require_lead_access(lid, Permission.VISITOR_RESUME)
    f = request.files.get("file")
    ext = (f.filename.rsplit(".", 1)[-1].lower() if f and "." in f.filename else "")
    if not f or ext not in IMG_EXT:
        abort(400, "Upload a JPG, PNG or WEBP photo")
    _validate_uploaded_media(f, ext, "photo")
    with db() as con:
        if not con.execute("SELECT 1 FROM leads WHERE id=?", (lid,)).fetchone():
            abort(404, "Visitor not found")
    for old in os.listdir(PHOTOS):
        if old.startswith(lid + "."):
            os.remove(os.path.join(PHOTOS, old))
    f.save(os.path.join(PHOTOS, f"{lid}.{ext}"))
    return jsonify(ok=True)


# ---- User, lead and media administration API ----
def user_out(row):
    kind = row["staff_type"] or row["role_key"]
    return {
        "id": row["id"], "name": row["name"], "mobile": row["mobile"], "email": row["email"],
        "role": kind, "role_name": row["role_name"] or kind.upper(),
        "staff_type": row["staff_type"], "branch_id": row["branch_id"],
        "branch": row["branch_name"], "active": bool(row["active"]),
        "deleted_at": row["deleted_at"], "last_login": row["last_login"],
        "must_change_password": bool(row["must_change_password"]),
        "locked": bool(row["role_locked"]),
    }


USER_SELECT = """SELECT users.*, roles.key AS role_key, roles.name AS role_name,
                        roles.locked AS role_locked, branches.name AS branch_name
                 FROM users
                 LEFT JOIN roles ON roles.id=users.role_id
                 LEFT JOIN branches ON branches.id=users.branch_id"""


def get_user(user_id, con=None):
    if con is None:
        with db() as connection:
            return get_user(user_id, connection)
    return con.execute(USER_SELECT + " WHERE users.id=?", (user_id,)).fetchone()


def require_target_scope(actor, target):
    if Permission.USER_VIEW_ALL in user_permissions(actor):
        return
    if not actor["branch_id"] or target["branch_id"] != actor["branch_id"]:
        abort(403, "User is outside your branch")


def assignment_permission(role_key, staff_type):
    staff_permissions = {
        "reception": Permission.USER_ADD_RECEPTION,
        "scm": Permission.USER_ADD_SCM,
        "hod": Permission.USER_ADD_HOD,
    }
    role_permissions = {
        "orientation_manager": Permission.USER_ADD_ORIENTATION_MANAGER,
        "branch_manager": Permission.USER_ADD_BRANCH_MANAGER,
        "admin": Permission.USER_ADD_ADMIN,
        "developer": Permission.USER_ADD_DEVELOPER,
    }
    return staff_permissions.get(staff_type) if staff_type else role_permissions.get(role_key)


def removal_permission(target):
    kind = target["staff_type"] or target["role_key"]
    permissions = {
        "reception": Permission.USER_REMOVE_RECEPTION,
        "scm": Permission.USER_REMOVE_SCM,
        "hod": Permission.USER_REMOVE_HOD,
        "orientation_manager": Permission.USER_REMOVE_ORIENTATION_MANAGER,
        "branch_manager": Permission.USER_REMOVE_BRANCH_MANAGER,
    }
    return permissions.get(kind, Permission.USER_REMOVE)


def validate_assignment(actor, role_key, staff_type, branch_id, con):
    permission = assignment_permission(role_key, staff_type)
    if not permission or permission not in user_permissions(actor):
        abort(403, "You cannot add this user type")
    if role_key == "developer" and not actor_can_manage_developer_accounts(actor, con):
        abort(403, "Only a Developer can create another Developer")

    branch_scoped = bool(staff_type or role_key in {"orientation_manager", "branch_manager"})
    if branch_scoped:
        if not branch_id:
            abort(400, "Select a branch for this user")
        branch = con.execute("SELECT 1 FROM branches WHERE id=? AND active=1", (branch_id,)).fetchone()
        if not branch:
            abort(400, "Select an active branch")
        if Permission.USER_VIEW_ALL not in user_permissions(actor) and branch_id != actor["branch_id"]:
            abort(403, "You cannot manage users in another branch")
        return branch_id
    if role_key in {"admin", "developer"}:
        return None
    abort(400, "Select a valid role")


def check_last_privileged_user(con, target, next_role_key=None, next_active=True):
    current_role = target["role_key"]
    if current_role not in {"admin", "developer"} or not target["active"]:
        return
    if next_active and next_role_key == current_role:
        return
    count = con.execute(
        """SELECT COUNT(*) FROM users JOIN roles ON roles.id=users.role_id
           WHERE roles.key=? AND users.active=1 AND users.deleted_at IS NULL""",
        (current_role,),
    ).fetchone()[0]
    if count <= 1:
        abort(409, f"The last active {target['role_name']} cannot be deactivated, removed, or demoted")


@app.get("/api/branches")
@require_permissions(Permission.USER_VIEW_ALL, Permission.USER_VIEW_OWN_BRANCH)
def list_branches():
    user = current_user()
    with db() as con:
        if Permission.USER_VIEW_ALL in user_permissions(user):
            branches = con.execute("SELECT id, name FROM branches WHERE active=1 ORDER BY name").fetchall()
        elif user["branch_id"]:
            branches = con.execute("SELECT id, name FROM branches WHERE id=? AND active=1", (user["branch_id"],)).fetchall()
        else:
            branches = []
    return jsonify([dict(branch) for branch in branches])


@app.get("/api/users")
@require_permissions(Permission.USER_VIEW_ALL, Permission.USER_VIEW_OWN_BRANCH)
def list_users():
    actor = current_user()
    permissions = user_permissions(actor)
    clauses, values = [], []
    if Permission.USER_VIEW_ALL not in permissions:
        if not actor["branch_id"]:
            return jsonify([])
        clauses.append("users.branch_id=?")
        values.append(actor["branch_id"])

    branch_filter = request.args.get("branch", "").strip()
    if branch_filter and Permission.USER_VIEW_ALL in permissions:
        clauses.append("users.branch_id=?")
        values.append(branch_filter)
    role_filter = request.args.get("role", "").strip()
    if role_filter:
        clauses.append("(roles.key=? OR users.staff_type=?)")
        values.extend((role_filter, role_filter))
    search = request.args.get("q", "").strip()
    if search:
        clauses.append("(users.name LIKE ? OR users.mobile LIKE ?)")
        values.extend((f"%{search}%", f"%{search}%"))
    status_filter = request.args.get("status", "active")
    if status_filter == "active":
        clauses.extend(("users.active=1", "users.deleted_at IS NULL"))
    elif status_filter == "inactive":
        clauses.extend(("users.active=0", "users.deleted_at IS NULL"))
    elif status_filter == "removed":
        clauses.append("users.deleted_at IS NOT NULL")
    elif status_filter != "all":
        abort(400, "Invalid user status filter")

    query = USER_SELECT
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY users.name COLLATE NOCASE"
    with db() as con:
        rows = con.execute(query, values).fetchall()
    visible = [user_out(row) for row in rows]
    if Permission.USER_VIEW_ALL not in permissions:
        visible = [
            row for row in visible
            if removal_permission({"role_key": row["role"] if not row["staff_type"] else None,
                                   "staff_type": row["staff_type"]}) in permissions
            or assignment_permission(row["role"] if not row["staff_type"] else None,
                                     row["staff_type"]) in permissions
        ]
    return jsonify(visible)


@app.post("/api/users")
@require_permissions(Permission.USER_ADD_RECEPTION, Permission.USER_ADD_SCM, Permission.USER_ADD_HOD,
                     Permission.USER_ADD_ORIENTATION_MANAGER, Permission.USER_ADD_BRANCH_MANAGER,
                     Permission.USER_ADD_ADMIN, Permission.USER_ADD_DEVELOPER)
def create_user():
    actor = current_user()
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    mobile = "".join(char for char in str(body.get("mobile") or "") if char.isdigit())
    email = str(body.get("email") or "").strip().lower()
    password = body.get("temporary_password") or ""
    requested_role = str(body.get("role") or "")
    staff_type = requested_role if requested_role in {"reception", "scm", "hod"} else None
    role_key = None if staff_type else requested_role
    if len(name) < 2 or not email or (mobile and len(mobile) < 10):
        abort(400, "Enter a name, email, and a valid mobile number if provided")
    if not isinstance(password, str) or not password or len(password.encode("utf-8")) > 72:
        abort(400, "Password must be non-empty and no more than 72 UTF-8 bytes")
    if role_key not in {role[0] for role in ROLE_DEFINITIONS} and not staff_type:
        abort(400, "Select a valid user type")
    with db() as con:
        branch_id = validate_assignment(actor, role_key, staff_type,
                                        body.get("branch_id") or None, con)
        role_id = None
        if role_key:
            role_id = con.execute("SELECT id FROM roles WHERE key=?", (role_key,)).fetchone()["id"]
        user_id = secrets.token_urlsafe(18)
        branch_manager_branch_id = branch_id if role_key == "branch_manager" else None
        try:
            con.execute(
                """INSERT INTO users
                   (id, name, mobile, email, password_hash, role_id, branch_id, staff_type,
                    active, must_change_password, created_by, created_at, branch_manager_branch_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)""",
                (user_id, name, mobile, email,
                 hash_password(password),
                 role_id, branch_id, staff_type, actor["id"], now(), branch_manager_branch_id),
            )
        except sqlite3.IntegrityError as error:
            if "branch_manager_branch_id" in str(error):
                abort(409, "This branch already has an active Branch Manager")
            abort(409, "A user with this email already exists")
        user = get_user(user_id, con)
        write_audit(con, actor["id"], "user.create", user_id, after=user_out(user))
    return jsonify(user_out(user)), 201


@app.patch("/api/users/<user_id>")
@require_permissions(Permission.USER_EDIT)
def edit_user(user_id):
    actor = current_user()
    body = request.get_json(silent=True) or {}
    with db() as con:
        target = get_user(user_id, con)
        if not target or target["deleted_at"]:
            abort(404, "User not found")
        require_target_scope(actor, target)
        if target["role_locked"] and not actor_can_manage_developer_accounts(actor, con):
            abort(403, "Only a Developer can edit a Developer account")
        if user_id == actor["id"] and any(key in body for key in ("role", "branch_id", "staff_type")):
            abort(403, "You cannot change your own role or permissions")

        before = user_out(target)
        name = str(body.get("name", target["name"])).strip()
        mobile = "".join(char for char in str(body.get("mobile", target["mobile"])) if char.isdigit())
        email = str(body.get("email", target["email"])).strip().lower()
        if len(name) < 2 or not email or (mobile and len(mobile) < 10):
            abort(400, "Enter a name, email, and a valid mobile number if provided")

        role_id, role_key, staff_type = target["role_id"], target["role_key"], target["staff_type"]
        branch_id = target["branch_id"]
        if any(key in body for key in ("role", "branch_id", "staff_type")):
            requested_role = str(body.get("role", staff_type or role_key) or "")
            staff_type = requested_role if requested_role in {"reception", "scm", "hod"} else None
            role_key = None if staff_type else requested_role
            if role_key not in {role[0] for role in ROLE_DEFINITIONS} and not staff_type:
                abort(400, "Select a valid user type")
            if role_key == "developer" and not actor_can_manage_developer_accounts(actor, con):
                abort(403, "Only a Developer can assign the Developer role")
            branch_id = validate_assignment(actor, role_key, staff_type,
                                            body.get("branch_id", target["branch_id"]), con)
            role_id = con.execute("SELECT id FROM roles WHERE key=?", (role_key,)).fetchone()["id"] if role_key else None
        check_last_privileged_user(con, target, next_role_key=role_key)
        new_password = body.get("temporary_password")
        password_hash = target["password_hash"]
        must_change_password = 0
        if new_password:
            password_hash = hash_password(new_password)
            must_change_password = 0
        manager_slot = branch_id if role_key == "branch_manager" and target["active"] else None
        try:
            con.execute(
                """UPDATE users SET name=?, mobile=?, email=?, password_hash=?, role_id=?,
                   branch_id=?, staff_type=?, must_change_password=?, branch_manager_branch_id=?
                   WHERE id=?""",
                (name, mobile, email, password_hash, role_id, branch_id, staff_type,
                 must_change_password, manager_slot, user_id),
            )
        except sqlite3.IntegrityError as error:
            if "branch_manager_branch_id" in str(error):
                abort(409, "This branch already has an active Branch Manager")
            abort(409, "A user with this email already exists")
        updated = get_user(user_id, con)
        write_audit(con, actor["id"], "user.edit", user_id, before=before, after=user_out(updated))
    return jsonify(user_out(updated))


@app.post("/api/users/<user_id>/deactivate")
@require_permissions(Permission.USER_DEACTIVATE)
def deactivate_user(user_id):
    actor = current_user()
    with db() as con:
        target = get_user(user_id, con)
        if not target or target["deleted_at"]:
            abort(404, "User not found")
        if user_id == actor["id"]:
            abort(403, "You cannot deactivate your own account")
        require_target_scope(actor, target)
        if target["role_locked"] and not actor_can_manage_developer_accounts(actor, con):
            abort(403, "Only a Developer can deactivate a Developer account")
        check_last_privileged_user(con, target, next_active=False)
        before = user_out(target)
        con.execute(
            """UPDATE users SET active=0, branch_manager_branch_id=NULL
               WHERE id=?""",
            (user_id,),
        )
        updated = get_user(user_id, con)
        write_audit(con, actor["id"], "user.deactivate", user_id, before=before, after=user_out(updated))
    return jsonify(user_out(updated))


@app.post("/api/users/<user_id>/activate")
@require_permissions(Permission.USER_EDIT)
def activate_user(user_id):
    actor = current_user()
    with db() as con:
        target = get_user(user_id, con)
        if not target or target["deleted_at"]:
            abort(404, "User not found")
        require_target_scope(actor, target)
        if target["role_locked"] and not actor_can_manage_developer_accounts(actor, con):
            abort(403, "Only a Developer can activate a Developer account")
        before = user_out(target)
        manager_slot = target["branch_id"] if target["role_key"] == "branch_manager" else None
        try:
            con.execute(
                "UPDATE users SET active=1, branch_manager_branch_id=? WHERE id=?",
                (manager_slot, user_id),
            )
        except sqlite3.IntegrityError:
            abort(409, "This branch already has an active Branch Manager")
        updated = get_user(user_id, con)
        write_audit(con, actor["id"], "user.activate", user_id, before=before, after=user_out(updated))
    return jsonify(user_out(updated))


@app.delete("/api/users/<user_id>")
@require_permissions(Permission.USER_REMOVE, Permission.USER_REMOVE_RECEPTION, Permission.USER_REMOVE_SCM,
                     Permission.USER_REMOVE_HOD, Permission.USER_REMOVE_ORIENTATION_MANAGER,
                     Permission.USER_REMOVE_BRANCH_MANAGER)
def remove_user(user_id):
    actor = current_user()
    with db() as con:
        target = get_user(user_id, con)
        if not target or target["deleted_at"]:
            abort(404, "User not found")
        if user_id == actor["id"]:
            abort(403, "You cannot remove your own account")
        require_target_scope(actor, target)
        if target["role_locked"] and not actor_can_manage_developer_accounts(actor, con):
            abort(403, "Only a Developer can remove a Developer account")
        if removal_permission(target) not in user_permissions(actor):
            abort(403, "You cannot remove this user type")
        check_last_privileged_user(con, target, next_active=False)
        before = user_out(target)
        removed_at = now()
        con.execute(
            """UPDATE users SET active=0, deleted_at=?, branch_manager_branch_id=NULL
               WHERE id=?""",
            (removed_at, user_id),
        )
        updated = get_user(user_id, con)
        write_audit(con, actor["id"], "user.remove", user_id, before=before, after=user_out(updated))
    return jsonify(user_out(updated))


@app.get("/api/roles")
@require_permissions(Permission.ROLES_VIEW)
def list_roles():
    actor = current_user()
    can_edit = Permission.ROLES_EDIT in user_permissions(actor)
    can_manage_locked_roles = actor_can_manage_developer_accounts(actor)
    with db() as con:
        roles = con.execute("SELECT * FROM roles ORDER BY id").fetchall()
        permissions = con.execute("SELECT * FROM permissions ORDER BY group_name, key").fetchall()
        role_rows = con.execute(
            """SELECT role_permissions.role_id, permissions.key
               FROM role_permissions JOIN permissions ON permissions.id=role_permissions.permission_id"""
        ).fetchall()
    role_permissions_map = {}
    for row in role_rows:
        role_permissions_map.setdefault(row["role_id"], []).append(row["key"])
    grouped = {}
    for permission in permissions:
        grouped.setdefault(permission["group_name"], []).append({
            "key": permission["key"], "description": permission["description"],
        })
    return jsonify(
        groups=grouped,
        roles=[{
            "key": role["key"], "name": role["name"], "locked": bool(role["locked"]),
            "editable": can_edit and (not role["locked"] or can_manage_locked_roles),
            "permissions": sorted(role_permissions_map.get(role["id"], [])),
        } for role in roles],
    )


@app.put("/api/roles/<role_key>")
@require_permissions(Permission.ROLES_EDIT)
def update_role_permissions(role_key):
    actor = current_user()
    body = request.get_json(silent=True) or {}
    requested = body.get("permissions")
    if not isinstance(requested, list) or any(not isinstance(key, str) for key in requested):
        abort(400, "Permissions must be a list of permission keys")
    requested_set = set(requested)
    if len(requested_set) != len(requested):
        abort(400, "Duplicate permissions are not allowed")
    actor_permissions = user_permissions(actor)
    if not requested_set.issubset(actor_permissions):
        abort(403, "You cannot grant a permission you do not have")
    with db() as con:
        role = con.execute("SELECT * FROM roles WHERE key=?", (role_key,)).fetchone()
        if not role:
            abort(404, "Role not found")
        if role["locked"] and not actor_can_manage_developer_accounts(actor, con):
            abort(403, "Only a Developer can edit the locked Developer role")
        known = {row["key"]: row["id"] for row in con.execute("SELECT id, key FROM permissions")}
        if not requested_set.issubset(known):
            abort(400, "Unknown permission key")
        before = sorted(row["key"] for row in con.execute(
            """SELECT permissions.key FROM role_permissions
               JOIN permissions ON permissions.id=role_permissions.permission_id
               WHERE role_permissions.role_id=?""",
            (role["id"],),
        ))
        con.execute("DELETE FROM role_permissions WHERE role_id=?", (role["id"],))
        con.executemany(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
            [(role["id"], known[key]) for key in sorted(requested_set)],
        )
        after = sorted(requested_set)
        if before != after:
            write_audit(con, actor["id"], "role.permissions.edit", target_role_id=role["id"],
                        before={"permissions": before}, after={"permissions": after})
    return jsonify(role=role_key, permissions=sorted(requested_set))


@app.get("/api/users/<user_id>/permissions")
@require_permissions(Permission.ROLES_VIEW)
def get_user_permission_overrides(user_id):
    actor = current_user()
    if user_id == actor["id"]:
        abort(403, "You cannot edit or inspect your own permission overrides")
    with db() as con:
        target = get_user(user_id, con)
        if not target or target["deleted_at"]:
            abort(404, "User not found")
        require_target_scope(actor, target)
        if (Permission.USER_VIEW_ALL not in user_permissions(actor)
                and removal_permission(target) not in user_permissions(actor)):
            abort(403, "You cannot manage permissions for this user type")
        if target["role_locked"] and not actor_can_manage_developer_accounts(actor, con):
            return jsonify(user=user_out(target), permissions=sorted(effective_permissions(user_id, con)),
                           overrides=[], locked=True)
        overrides = con.execute(
            """SELECT permissions.key, user_permission_overrides.allowed,
                      user_permission_overrides.reason
               FROM user_permission_overrides
               JOIN permissions ON permissions.id=user_permission_overrides.permission_id
               WHERE user_permission_overrides.user_id=? ORDER BY permissions.key""",
            (user_id,),
        ).fetchall()
        permissions = sorted(effective_permissions(user_id, con))
    return jsonify(user=user_out(target), permissions=permissions,
                   overrides=[dict(row) for row in overrides], locked=False)


@app.put("/api/users/<user_id>/permissions")
@require_permissions(Permission.ROLES_EDIT)
def update_user_permission_overrides(user_id):
    actor = current_user()
    if user_id == actor["id"]:
        abort(403, "You cannot change your own permissions")
    body = request.get_json(silent=True) or {}
    changes = body.get("overrides")
    if not isinstance(changes, list):
        abort(400, "Overrides must be a list")
    with db() as con:
        target = get_user(user_id, con)
        if not target or target["deleted_at"]:
            abort(404, "User not found")
        require_target_scope(actor, target)
        if (Permission.USER_VIEW_ALL not in user_permissions(actor)
                and removal_permission(target) not in user_permissions(actor)):
            abort(403, "You cannot manage permissions for this user type")
        if target["role_locked"] and not actor_can_manage_developer_accounts(actor, con):
            abort(403, "Only a Developer can edit a Developer account")
        known = {row["key"]: row["id"] for row in con.execute("SELECT id, key FROM permissions")}
        actor_permissions = user_permissions(actor)
        seen = set()
        for item in changes:
            if not isinstance(item, dict):
                abort(400, "Each override must be an object")
            key, allowed = item.get("key"), item.get("allowed")
            reason = str(item.get("reason") or "").strip()
            if key not in known or key in seen or allowed not in (True, False, None):
                abort(400, "Invalid or duplicate permission override")
            if allowed is True and key not in actor_permissions:
                abort(403, "You cannot grant a permission you do not have")
            if allowed is not None and not reason:
                abort(400, "A reason is required for every permission override")
            seen.add(key)
            previous = con.execute(
                "SELECT allowed, reason FROM user_permission_overrides WHERE user_id=? AND permission_id=?",
                (user_id, known[key]),
            ).fetchone()
            next_value = None if allowed is None else {"allowed": int(allowed), "reason": reason}
            old_value = None if not previous else {"allowed": previous["allowed"], "reason": previous["reason"]}
            if next_value == old_value:
                continue
            if allowed is None:
                con.execute(
                    "DELETE FROM user_permission_overrides WHERE user_id=? AND permission_id=?",
                    (user_id, known[key]),
                )
            else:
                con.execute(
                    """INSERT INTO user_permission_overrides
                       (user_id, permission_id, allowed, reason, changed_by, changed_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(user_id, permission_id) DO UPDATE SET
                       allowed=excluded.allowed, reason=excluded.reason,
                       changed_by=excluded.changed_by, changed_at=excluded.changed_at""",
                    (user_id, known[key], int(allowed), reason, actor["id"], now()),
                )
            write_audit(con, actor["id"], "user.permission.override", user_id,
                        before={key: old_value}, after={key: next_value}, reason=reason or None)
    return get_user_permission_overrides(user_id)


@app.get("/api/audit")
@require_permissions(Permission.ROLES_VIEW)
def list_audit_log():
    try:
        limit = min(max(int(request.args.get("limit", 200)), 1), 500)
    except ValueError:
        abort(400, "Invalid audit-log limit")
    actor = current_user()
    query = """SELECT audit_log.*, actors.name AS actor_name, targets.name AS target_name,
                      roles.name AS target_role_name
               FROM audit_log
               LEFT JOIN users AS actors ON actors.id=audit_log.actor_id
               LEFT JOIN users AS targets ON targets.id=audit_log.target_user_id
               LEFT JOIN roles ON roles.id=audit_log.target_role_id"""
    values = []
    if Permission.USER_VIEW_ALL not in user_permissions(actor):
        query += """ WHERE audit_log.target_role_id IS NULL
                     AND (actors.branch_id=? OR targets.branch_id=?)"""
        values.extend((actor["branch_id"], actor["branch_id"]))
    query += " ORDER BY audit_log.timestamp DESC LIMIT ?"
    values.append(limit)
    with db() as con:
        rows = con.execute(query, values).fetchall()
    return jsonify([{
        "id": row["id"], "actor_id": row["actor_id"], "actor_name": row["actor_name"],
        "action": row["action"], "target_user_id": row["target_user_id"],
        "target_name": row["target_name"], "target_role_name": row["target_role_name"],
        "before": json.loads(row["before_json"]) if row["before_json"] else None,
        "after": json.loads(row["after_json"]) if row["after_json"] else None,
        "reason": row["reason"], "timestamp": row["timestamp"],
    } for row in rows])


def _validate_uploaded_media(file, extension, kind):
    max_bytes = 20 * 1024 * 1024 if kind == "photo" else 200 * 1024 * 1024
    current = file.stream.tell()
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(current)
    if size < 1 or size > max_bytes:
        abort(413, "File size exceeds the allowed limit")
    header = file.stream.read(16)
    file.stream.seek(0)
    valid = False
    if extension in {"jpg", "jpeg"}:
        valid = header.startswith(b"\xff\xd8\xff")
    elif extension == "png":
        valid = header.startswith(b"\x89PNG\r\n\x1a\n")
    elif extension == "gif":
        valid = header.startswith((b"GIF87a", b"GIF89a"))
    elif extension == "webp":
        valid = header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    elif extension in {"mp4", "mov"}:
        valid = header[4:8] == b"ftyp"
    elif extension == "webm":
        valid = header.startswith(b"\x1a\x45\xdf\xa3")
    if not valid:
        abort(400, "The file content does not match its extension")


@app.post("/api/media/<slot>")
def upload_media(slot):
    file = request.files.get("file")
    slot = secure_filename(slot)
    kind = request.form.get("kind")
    permission = (Permission.MEDIA_UPLOAD_IMAGE if kind == "photo"
                  else Permission.MEDIA_UPLOAD_VIDEO if kind == "video" else "")
    if not permission:
        abort(400, "Choose an image or video upload type")
    actor = current_user()
    if permission not in effective_permissions(actor["id"]):
        abort(403, "You do not have permission to upload this media type")
    extension = (file.filename.rsplit(".", 1)[-1].lower() if file and "." in file.filename else "")
    allowed_extensions = IMG_EXT if kind == "photo" else VID_EXT
    if not file or not slot or extension not in allowed_extensions:
        abort(400, "Choose an image for a photo slot or a video for a video slot")
    _validate_uploaded_media(file, extension, kind)
    temporary_path = os.path.join(MEDIA, f".{slot}.{secrets.token_hex(8)}.tmp")
    file.save(temporary_path)
    target_path = os.path.join(MEDIA, f"{slot}.{extension}")
    try:
        for old in os.listdir(MEDIA):
            if old.rpartition(".")[0] == slot and old != os.path.basename(temporary_path):
                os.remove(os.path.join(MEDIA, old))
        os.replace(temporary_path, target_path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
    return jsonify(media_map().get(slot))


@app.delete("/api/media/<slot>")
def delete_media(slot):
    actor = current_user()
    slot = secure_filename(slot)
    if not slot:
        abort(400, "Invalid media slot")
    files = [filename for filename in os.listdir(MEDIA)
             if filename.rpartition(".")[0] == slot and filename.rpartition(".")[2].lower() in IMG_EXT | VID_EXT]
    if not files:
        abort(404, "Media not found")
    for filename in files:
        extension = filename.rpartition(".")[2].lower()
        permission = Permission.MEDIA_UPLOAD_VIDEO if extension in VID_EXT else Permission.MEDIA_UPLOAD_IMAGE
        if permission not in effective_permissions(actor["id"]):
            abort(403, "You do not have permission to remove this media type")
    for filename in files:
        os.remove(os.path.join(MEDIA, filename))
    return jsonify(ok=True)


def visible_lead_rows(user, con):
    permissions = user_permissions(user)
    if Permission.VISITOR_VIEW_ALL in permissions:
        return con.execute("SELECT * FROM leads ORDER BY updated DESC").fetchall()
    if Permission.VISITOR_VIEW_BRANCH not in permissions or not user["branch_id"]:
        abort(403, "You do not have permission to view visitors")
    rows = con.execute(
        "SELECT * FROM leads WHERE branch_id=? ORDER BY updated DESC",
        (user["branch_id"],),
    ).fetchall()
    if user["role_key"] == "orientation_manager":
        rows = [row for row in rows if row["created_by_user_id"] == user["id"]]
    if user["role_key"] in {"branch_manager", "orientation_manager"}:
        return rows
    return [row for row in rows if json.loads(row["data"] or "{}").get("status", "in_progress") == "in_progress"]


@app.get("/api/admin/leads")
@require_permissions(Permission.VISITOR_VIEW_BRANCH, Permission.VISITOR_VIEW_ALL)
def admin_leads():
    user = current_user()
    with db() as con:
        rows = visible_lead_rows(user, con)
        recordings = con.execute("SELECT lead_id, status FROM audio_recordings WHERE lead_id IS NOT NULL").fetchall()
    recording_status = {row["lead_id"]: row["status"] for row in recordings}
    leads = [lead_out(row) for row in rows]
    for lead in leads:
        lead["recording_status"] = recording_status.get(lead["id"])
    return jsonify(leads)


@app.get("/api/admin/report")
def admin_report():
    """Aggregate-friendly visitor rows for the Reports tab (no phone numbers).

    Users with visitor.view_all get every branch; branch-scoped users get their allowed visitors.
    """
    user = current_user()
    permissions = effective_permissions(user["id"])
    is_developer = user["role_key"] == "developer"
    if not (is_developer or permissions & {Permission.VISITOR_VIEW_ALL, Permission.VISITOR_VIEW_BRANCH}):
        abort(403, "You do not have permission to view reports")
    all_branches = is_developer or Permission.VISITOR_VIEW_ALL in permissions
    with db() as con:
        if all_branches:
            rows = con.execute(
                """SELECT leads.*, users.name AS visit_owner_name
                   FROM leads LEFT JOIN users ON users.id=leads.created_by_user_id
                   ORDER BY leads.created, leads.rowid"""
            ).fetchall()
            branches = con.execute("SELECT id, name FROM branches WHERE active=1 ORDER BY rowid").fetchall()
        else:
            if not user["branch_id"]:
                abort(403, "You do not have permission to view visitors")
            if user["role_key"] == "orientation_manager":
                rows = con.execute(
                    """SELECT leads.*, users.name AS visit_owner_name
                       FROM leads LEFT JOIN users ON users.id=leads.created_by_user_id
                       WHERE leads.branch_id=? AND leads.created_by_user_id=?
                       ORDER BY leads.created, leads.rowid""",
                    (user["branch_id"], user["id"]),
                ).fetchall()
            else:
                rows = con.execute(
                    """SELECT leads.*, users.name AS visit_owner_name
                       FROM leads LEFT JOIN users ON users.id=leads.created_by_user_id
                       WHERE leads.branch_id=? ORDER BY leads.created, leads.rowid""",
                    (user["branch_id"],),
                ).fetchall()
            branches = con.execute("SELECT id, name FROM branches WHERE id=?", (user["branch_id"],)).fetchall()
        rec_rows = con.execute(
            "SELECT lead_id, COUNT(*) AS n FROM audio_recordings WHERE lead_id IS NOT NULL GROUP BY lead_id"
        ).fetchall()
    rec_counts = {row["lead_id"]: row["n"] for row in rec_rows}

    def number(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    visitors = []
    for row in rows:
        data = json.loads(row["data"] or "{}")
        booked = data.get("status") == "booked"
        visitors.append({
            "id": row["id"], "name": row["name"], "created": row["created"], "updated": row["updated"],
            "qualification": (data.get("qualification") or "").strip() or None,
            "has_place": bool((data.get("place") or "").strip()),
            "status": "booked" if booked else "in_progress",
            "step": number(data.get("progress")) or 0,
            "course": data.get("course") or None, "payment": data.get("payment") or None,
            "amount": number(data.get("booking_amount")), "batch": (data.get("batch") or "").split(",")[0] or None,
            "branch_id": row["branch_id"], "recordings": rec_counts.get(row["id"], 0),
            "visit_owner_name": row["visit_owner_name"],
        })
    return jsonify(
        today=datetime.now().date().isoformat(), visitors=visitors,
        branches=[dict(branch) for branch in branches],
        scope="all" if all_branches else "branch",
        branch_name=None if all_branches else user["branch_name"],
        role=user["role_key"] or "staff",
    )


@app.get("/api/admin/leads.csv")
@require_permissions(Permission.VISITOR_VIEW_BRANCH, Permission.VISITOR_VIEW_ALL)
def admin_csv():
    user = current_user()
    with db() as con:
        rows = [lead_out(row) for row in visible_lead_rows(user, con)]
    cols = ["id", "created", "name", "phone", "parent_name", "place", "qualification", "course", "payment",
            "cash_amount", "booking_amount", "batch", "terms", "status", "progress"]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols + ["docs_ready"])
    for lead in rows:
        writer.writerow([lead.get(column, "") for column in cols]
                        + [sum(1 for value in (lead.get("docs") or {}).values() if value)])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=magnus_leads.csv"})


@app.get("/api/admin/lead_photo/<lid>")
@require_permissions(Permission.VISITOR_VIEW_BRANCH, Permission.VISITOR_VIEW_ALL)
def admin_photo(lid):
    require_lead_access(lid, Permission.VISITOR_VIEW_BRANCH)
    for filename in os.listdir(PHOTOS):
        if filename.startswith(secure_filename(lid) + "."):
            return send_from_directory(PHOTOS, filename)
    abort(404, "No photo")


@app.get("/api/admin/lead_recording/<lid>")
@require_permissions(Permission.RECORDING_LISTEN)
def admin_recording(lid):
    user = current_user()
    require_lead_access(lid, Permission.VISITOR_VIEW_BRANCH, user)
    with db() as con:
        row = con.execute(
            """SELECT audio_recordings.id, audio_recordings.created, leads.name, leads.phone
               FROM audio_recordings JOIN leads ON leads.id=audio_recordings.lead_id
               WHERE leads.id=? AND audio_recordings.status='complete'""",
            (lid,),
        ).fetchone()
        if not row:
            abort(404, "No completed recording")
        write_audit(con, user["id"], "recording.listen", target_user_id=None,
                    after={"recording_id": row["id"], "lead_id": lid})
    filename = secure_filename(f"{row['name']}_{row['phone']}_{row['created'].replace(':', '-')}.wav")
    return send_from_directory(
        RECORDINGS, f"{row['id']}.wav", as_attachment=request.args.get("download") == "1",
        download_name=filename, mimetype="audio/wav",
    )


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG", "").lower() == "true", host="0.0.0.0", port=5000)
