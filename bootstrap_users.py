import os
import secrets
import sys

import bcrypt

import main


def bootstrap_developer():
    email = os.environ.get("DEVELOPER_EMAIL", "").strip().lower()
    password = os.environ.get("DEVELOPER_PASSWORD", "")
    name = os.environ.get("DEVELOPER_NAME", "Developer").strip()
    mobile = os.environ.get("DEVELOPER_MOBILE", "").strip()
    if not email or not password or len(password.encode("utf-8")) > 72:
        raise ValueError("Set DEVELOPER_EMAIL and a non-empty DEVELOPER_PASSWORD of at most 72 UTF-8 bytes.")

    with main.db() as con:
        role = con.execute("SELECT id FROM roles WHERE key='developer'").fetchone()
        if not role:
            raise RuntimeError("The user-management migration or role seed did not run.")
        existing = con.execute(
            """SELECT 1 FROM users
               WHERE role_id=? AND deleted_at IS NULL
               LIMIT 1""",
            (role["id"],),
        ).fetchone()
        if existing:
            return "A Developer account already exists; no account was changed."
        if con.execute("SELECT 1 FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone():
            raise ValueError("That email address is already assigned to another account.")

        user_id = secrets.token_urlsafe(18)
        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")
        con.execute(
            """INSERT INTO users
               (id, name, mobile, email, password_hash, role_id, branch_id, active,
                must_change_password, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 0, NULL, ?)""",
            (user_id, name or "Developer", mobile, email, password_hash, role["id"], main.now()),
        )
        main.write_audit(
            con, None, "developer.bootstrap", user_id,
            after={"name": name or "Developer", "email": email, "role": "developer"},
        )
    return "Developer account created."


if __name__ == "__main__":
    try:
        print(bootstrap_developer())
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
