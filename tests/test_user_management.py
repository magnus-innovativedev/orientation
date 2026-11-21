import os
import tempfile
import unittest

import bcrypt

TEST_DATA = tempfile.TemporaryDirectory(prefix="magnus-user-tests-")
os.environ["MAGNUS_DATA_DIR"] = TEST_DATA.name

import main


PASSWORD = "temporary-password-123"
BRANCH = "manjeri"
OTHER_BRANCH = "kannur"


def create_account(role_key, email, branch_id=None, staff_type=None):
    with main.db() as con:
        role_id = None
        if role_key:
            role_id = con.execute("SELECT id FROM roles WHERE key=?", (role_key,)).fetchone()["id"]
        user_id = f"{role_key or staff_type}-{email}"
        con.execute(
            """INSERT INTO users
               (id, name, mobile, email, password_hash, role_id, branch_id, staff_type,
                active, must_change_password, created_at, branch_manager_branch_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)""",
            (user_id, role_key or staff_type, "6123456789", email,
             bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode(),
             role_id, branch_id, staff_type, main.now(),
             branch_id if role_key == "branch_manager" else None),
        )
    return user_id


class UserManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
        cls.branches = {branch: branch.lower().replace(" ", "-") for branch in main.BRANCH_NAMES}

    def setUp(self):
        with main.db() as con:
            con.execute("DELETE FROM audit_log")
            con.execute("DELETE FROM user_permission_overrides")
            con.execute("DELETE FROM audio_chunks")
            con.execute("DELETE FROM audio_recordings")
            con.execute("DELETE FROM leads")
            con.execute("UPDATE users SET created_by=NULL")
            con.execute("DELETE FROM users")
            con.execute("DELETE FROM role_permissions")
            main.seed_user_management(con, seed_matrix=True)

    def client_as(self, role_key, email, branch_id=None):
        create_account(role_key, email, branch_id)
        client = main.app.test_client()
        response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.get_json())
        return client

    def test_orientation_manager_permissions(self):
        client = self.client_as("orientation_manager", "orientation@example.test", BRANCH)
        response = client.post("/api/recordings", json={"consent": True})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(client.get("/api/users").status_code, 403)
        self.assertEqual(client.get("/api/roles").status_code, 403)
        self.assertEqual(
            client.post("/api/media/photo", data={"kind": "photo"}).status_code,
            403,
        )

    def test_developer_counselling_records_are_isolated_from_branch_visitors(self):
        developer = self.client_as("developer", "developer-preview@example.test", BRANCH)
        recording = developer.post("/api/recordings", json={"consent": True}).get_json()
        with main.db() as con:
            row = con.execute(
                "SELECT branch_id FROM audio_recordings WHERE id=?", (recording["id"],)
            ).fetchone()
        self.assertIsNone(row["branch_id"])

        created = developer.post("/api/leads", json={
            "name": "Preview Visitor",
            "phone": "6123456789",
            "recording_id": recording["id"],
            "recording_token": recording["token"],
        })
        self.assertEqual(created.status_code, 201, created.get_json())
        with main.db() as con:
            row = con.execute(
                "SELECT branch_id FROM leads WHERE id=?", (created.get_json()["id"],)
            ).fetchone()
        self.assertIsNone(row["branch_id"])

        manager = self.client_as("orientation_manager", "manjeri@example.test", BRANCH)
        self.assertEqual(manager.get("/api/admin/leads").get_json(), [])
        self.assertEqual(manager.get("/api/admin/report").get_json()["visitors"], [])

    def test_orientation_managers_in_same_branch_only_access_their_own_visitors(self):
        first = self.client_as("orientation_manager", "first-counsellor@example.test", BRANCH)
        first_user = first.get("/api/auth/me").get_json()["user"]
        recording = first.post("/api/recordings", json={"consent": True}).get_json()
        created = first.post("/api/leads", json={
            "name": "First Visitor",
            "phone": "6123456789",
            "recording_id": recording["id"],
            "recording_token": recording["token"],
        })
        self.assertEqual(created.status_code, 201, created.get_json())
        lead_id = created.get_json()["id"]
        self.assertEqual(len(first.get("/api/admin/leads").get_json()), 1)
        booked = first.patch(f"/api/leads/{lead_id}", json={"status": "booked"})
        self.assertEqual(booked.status_code, 200, booked.get_json())
        self.assertEqual(first.get(f"/api/leads/{lead_id}").status_code, 200)
        self.assertEqual(first.patch(f"/api/leads/{lead_id}", json={"progress": 5}).status_code, 403)

        second = self.client_as("orientation_manager", "second-counsellor@example.test", BRANCH)
        self.assertEqual(second.get("/api/admin/leads").get_json(), [])
        self.assertEqual(second.get(f"/api/leads/{lead_id}").status_code, 403)
        self.assertEqual(second.patch(f"/api/leads/{lead_id}", json={"progress": 3}).status_code, 403)

        branch_manager = self.client_as("branch_manager", "branch-manager@example.test", BRANCH)
        self.assertEqual(len(branch_manager.get("/api/admin/leads").get_json()), 1)
        self.assertEqual(branch_manager.get(f"/api/leads/{lead_id}").status_code, 200)
        self.assertEqual(branch_manager.patch(f"/api/leads/{lead_id}", json={"progress": 5}).status_code, 403)
        branch_manager_user = branch_manager.get("/api/auth/me").get_json()["user"]
        bm_recording = branch_manager.post("/api/recordings", json={"consent": True}).get_json()
        bm_visitor = branch_manager.post("/api/leads", json={
            "name": "Branch Manager Visitor",
            "phone": "6123456790",
            "recording_id": bm_recording["id"],
            "recording_token": bm_recording["token"],
        })
        self.assertEqual(bm_visitor.status_code, 201, bm_visitor.get_json())
        self.assertEqual(len(branch_manager.get("/api/admin/leads").get_json()), 2)

        report = branch_manager.get("/api/admin/report").get_json()
        visits_by_name = {}
        for visitor in report["visitors"]:
            visits_by_name[visitor["visit_owner_name"]] = visits_by_name.get(visitor["visit_owner_name"], 0) + 1
        self.assertEqual(visits_by_name, {
            first_user["name"]: 1,
            branch_manager_user["name"]: 1,
        })
        self.assertEqual(
            [visitor["visit_owner_name"] for visitor in first.get("/api/admin/report").get_json()["visitors"]],
            [first_user["name"]],
        )
        self.assertEqual(second.get("/api/admin/report").get_json()["visitors"], [])

    def test_branch_manager_can_manage_only_allowed_branch_users(self):
        client = self.client_as("branch_manager", "manager@example.test", BRANCH)
        response = client.post("/api/users", json={
            "name": "Reception User", "mobile": "6123456789", "email": "reception@example.test",
            "role": "reception", "branch_id": BRANCH, "temporary_password": PASSWORD,
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        staff_id = response.get_json()["id"]
        visible = client.get(f"/api/users?branch={OTHER_BRANCH}").get_json()
        self.assertEqual([user["id"] for user in visible], [staff_id])
        cross_branch = client.post("/api/users", json={
            "name": "Other Reception", "mobile": "6123456780", "email": "other@example.test",
            "role": "reception", "branch_id": OTHER_BRANCH, "temporary_password": PASSWORD,
        })
        self.assertEqual(cross_branch.status_code, 403)
        self.assertEqual(client.delete(f"/api/users/{staff_id}").status_code, 200)

    def test_admin_permissions_and_developer_protection(self):
        client = self.client_as("admin", "admin@example.test")
        admin_permissions = client.get("/api/auth/me").get_json()["user"]["permissions"]
        self.assertNotIn(main.Permission.USER_ADD_DEVELOPER, admin_permissions)
        self.assertNotIn(main.Permission.USER_MANAGE_DEVELOPER, admin_permissions)
        developer_id = create_account("developer", "developer@example.test")
        self.assertIn(main.Permission.USER_MANAGE_DEVELOPER, main.effective_permissions(developer_id))
        self.assertEqual(client.get("/api/users").status_code, 200)
        self.assertEqual(client.put("/api/roles/developer", json={"permissions": []}).status_code, 403)
        self.assertEqual(client.post(f"/api/users/{developer_id}/deactivate").status_code, 403)
        self.assertEqual(client.patch(f"/api/users/{developer_id}", json={"name": "Changed"}).status_code, 403)
        self.assertEqual(client.post("/api/users", json={
            "name": "Another Developer", "mobile": "6123456780", "email": "new-dev@example.test",
            "role": "developer", "temporary_password": PASSWORD,
        }).status_code, 403)

    def test_developer_can_edit_roles_and_grant_permissions_missing_from_its_matrix(self):
        client = self.client_as("developer", "developer@example.test")
        developer_id = client.get("/api/auth/me").get_json()["user"]["id"]
        with main.db() as con:
            developer_role_id = con.execute(
                "SELECT id FROM roles WHERE key='developer'"
            ).fetchone()["id"]
            visitor_permission_ids = [
                row["id"] for row in con.execute(
                    "SELECT id FROM permissions WHERE key LIKE 'visitor.%'"
                )
            ]
            con.executemany(
                "DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",
                [(developer_role_id, permission_id) for permission_id in visitor_permission_ids],
            )

        self.assertIn(main.Permission.VISITOR_VIEW_ALL, main.effective_permissions(developer_id))
        developer_role = next(
            role for role in client.get("/api/roles").get_json()["roles"]
            if role["key"] == "developer"
        )
        self.assertTrue(developer_role["editable"])
        response = client.put(
            "/api/roles/orientation_manager",
            json={"permissions": [main.Permission.VISITOR_CREATE, main.Permission.VISITOR_VIEW_ALL]},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(
            next(role for role in client.get("/api/roles").get_json()["roles"]
                 if role["key"] == "orientation_manager")["permissions"],
            [main.Permission.VISITOR_CREATE, main.Permission.VISITOR_VIEW_ALL],
        )
        developer_permissions = developer_role["permissions"] + [
            main.Permission.VISITOR_CREATE,
            main.Permission.VISITOR_RESUME,
            main.Permission.VISITOR_VIEW_ALL,
            main.Permission.VISITOR_VIEW_BRANCH,
        ]
        restored = client.put("/api/roles/developer", json={"permissions": developer_permissions})
        self.assertEqual(restored.status_code, 200, restored.get_json())

    def test_admin_cannot_grant_permissions_they_do_not_hold(self):
        admin = self.client_as("admin", "admin@example.test")
        user_id = create_account("orientation_manager", "om@example.test", BRANCH)
        denied = admin.put(f"/api/users/{user_id}/permissions", json={
            "overrides": [{
                "key": main.Permission.USER_ADD_DEVELOPER,
                "allowed": True,
                "reason": "Not held",
            }],
        })
        self.assertEqual(denied.status_code, 403)

    def test_branch_isolation_for_leads(self):
        client = self.client_as("branch_manager", "manager@example.test", BRANCH)
        lead_id = "other-branch-lead"
        with main.db() as con:
            con.execute(
                """INSERT INTO leads (id, created, updated, name, phone, data, branch_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (lead_id, main.now(), main.now(), "Visitor", "6123456789",
                 '{"status":"in_progress"}', OTHER_BRANCH),
            )
        self.assertEqual(client.get(f"/api/leads/{lead_id}").status_code, 403)
        self.assertEqual(client.get("/api/admin/leads").get_json(), [])

    def test_last_admin_and_developer_cannot_be_deactivated(self):
        developer = self.client_as("developer", "developer@example.test")
        admin_id = create_account("admin", "admin@example.test")
        response = developer.post(f"/api/users/{admin_id}/deactivate")
        self.assertEqual(response.status_code, 409)

    def test_short_passwords_work_without_forced_first_login_change(self):
        admin = self.client_as("admin", "admin@example.test")
        payload = {
            "name": "Short Password User", "mobile": "6123456789",
            "email": "short-password@example.test", "role": "orientation_manager",
            "branch_id": BRANCH, "temporary_password": "x",
        }
        created = admin.post("/api/users", json=payload)
        self.assertEqual(created.status_code, 201, created.get_json())
        user = created.get_json()
        self.assertFalse(user["must_change_password"])

        with main.db() as con:
            con.execute("UPDATE users SET must_change_password=1 WHERE id=?", (user["id"],))
        client = main.app.test_client()
        login = client.post("/api/auth/login", json={"email": payload["email"], "password": "x"})
        self.assertEqual(login.status_code, 200, login.get_json())
        self.assertTrue(login.get_json()["user"]["must_change_password"])
        self.assertEqual(client.post("/api/recordings", json={"consent": True}).status_code, 201)

        for password in ("", "a" * 73):
            rejected = admin.post("/api/users", json={
                **payload, "email": f"rejected-{len(password)}@example.test",
                "temporary_password": password,
            })
            self.assertEqual(rejected.status_code, 400)

    def test_mobile_is_optional_when_creating_and_editing_users(self):
        admin = self.client_as("admin", "admin@example.test")
        created = admin.post("/api/users", json={
            "name": "No Mobile User", "email": "no-mobile@example.test",
            "role": "orientation_manager", "branch_id": BRANCH,
            "temporary_password": PASSWORD,
        })
        self.assertEqual(created.status_code, 201, created.get_json())
        user = created.get_json()
        self.assertEqual(user["mobile"], "")

        updated = admin.patch(f"/api/users/{user['id']}", json={
            "name": "No Mobile User", "mobile": "",
        })
        self.assertEqual(updated.status_code, 200, updated.get_json())
        self.assertEqual(updated.get_json()["mobile"], "")

        invalid = admin.post("/api/users", json={
            "name": "Invalid Mobile User", "mobile": "12345",
            "email": "invalid-mobile@example.test", "role": "orientation_manager",
            "branch_id": BRANCH, "temporary_password": PASSWORD,
        })
        self.assertEqual(invalid.status_code, 400)

    @classmethod
    def tearDownClass(cls):
        TEST_DATA.cleanup()


if __name__ == "__main__":
    unittest.main()
