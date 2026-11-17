CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
);

CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role_id INTEGER REFERENCES roles(id),
    branch_id TEXT REFERENCES branches(id),
    staff_type TEXT CHECK (staff_type IN ('reception', 'scm', 'hod')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_login TEXT,
    deleted_at TEXT,
    branch_manager_branch_id TEXT UNIQUE,
    CHECK ((role_id IS NOT NULL AND staff_type IS NULL)
        OR (role_id IS NULL AND staff_type IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS users_branch_active ON users(branch_id, active, deleted_at);
CREATE INDEX IF NOT EXISTS users_role_active ON users(role_id, active, deleted_at);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    reason TEXT NOT NULL,
    changed_by TEXT NOT NULL REFERENCES users(id),
    changed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    actor_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    target_user_id TEXT REFERENCES users(id),
    target_role_id INTEGER REFERENCES roles(id),
    before_json TEXT,
    after_json TEXT,
    reason TEXT,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_timestamp ON audit_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

ALTER TABLE leads ADD COLUMN branch_id TEXT REFERENCES branches(id);
ALTER TABLE audio_recordings ADD COLUMN branch_id TEXT REFERENCES branches(id);
ALTER TABLE audio_recordings ADD COLUMN created_by_user_id TEXT REFERENCES users(id);
