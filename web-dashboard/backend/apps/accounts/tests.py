from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.db import IntegrityError, close_old_connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from config.errors import ServiceError

from .models import User
from .services import register_account, transition_account

PASSWORD = "Lab-notebook!2026-safe"


def account(email, status="pending", role="user"):
    return User.objects.create_user(email, PASSWORD, first_name="Assay", last_name="Reviewer",
                                    organization="Synthetic laboratory", status=status, role=role)


@override_settings(SECURE_SSL_REDIRECT=False, SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False)
class AccessTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = account("admin@example.test", "approved", "admin")
        cls.user = account("user@example.test", "approved")
        cls.pending = account("pending@example.test")

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def token(self, client=None):
        return (client or self.client).get("/api/v1/auth/csrf/").json()["csrf_token"]

    def post(self, path, data, client=None):
        client = client or self.client
        return client.post("/api/v1" + path, data, format="json", HTTP_X_CSRFTOKEN=self.token(client))

    def login(self, user=None, client=None, password=PASSWORD):
        return self.post("/auth/login/", {"email": (user or self.user).email, "password": password}, client)

    def registration(self, **kwargs):
        return {"email": "new@example.test", "first_name": "New", "last_name": "Analyst",
                "organization": "Test laboratory", "password": PASSWORD, "password_confirm": PASSWORD, **kwargs}

    def test_registration_is_pending_and_has_no_session(self):
        response = self.post("/auth/register/", self.registration(email="  NEW@Example.test "))
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(email="new@example.test")
        self.assertEqual((user.status, user.role, user.is_active, user.is_staff), ("pending", "user", False, False))
        self.assertTrue(user.check_password(PASSWORD))
        self.assertNotEqual(user.password, PASSWORD)
        self.assertNotIn("sessionid", self.client.cookies)
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 403)

    def test_registration_rejects_invalid_fields(self):
        cases = [
            ({"role": "admin"}, "role"), ({"status": "approved"}, "status"),
            ({"is_superuser": True}, "is_superuser"), ({"password_confirm": "different"}, "password_confirm"),
            ({"password": "123456789012", "password_confirm": "123456789012"}, "password"),
            ({"email": "PENDING@example.test"}, "email"), ({"first_name": " "}, "first_name"),
            ({"password": "x" * 129, "password_confirm": "x" * 129}, "password"),
        ]
        for changes, field in cases:
            with self.subTest(field=field):
                response = self.post("/auth/register/", self.registration(**changes))
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json()["error"]["fields"])

    def test_password_whitespace_is_preserved(self):
        password = "  Valid!lab passphrase  "
        self.assertEqual(self.post("/auth/register/", self.registration(password=password, password_confirm=password)).status_code, 201)
        user = User.objects.get(email="new@example.test")
        self.assertTrue(user.check_password(password))
        self.assertFalse(user.check_password(password.strip()))

    def test_anonymous_mutations_require_csrf_and_reject_bad_origin(self):
        for route, data in [("/auth/login/", {"email": self.user.email, "password": PASSWORD}),
                            ("/auth/register/", self.registration()), ("/auth/logout/", {})]:
            response = self.client.post("/api/v1" + route, data, format="json")
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["error"]["code"], "csrf_failed")
        response = self.client.post("/api/v1/auth/login/", {"email": self.user.email, "password": PASSWORD},
                                    format="json", HTTP_X_CSRFTOKEN=self.token(), HTTP_ORIGIN="https://attacker.example")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Session.objects.count(), 0)

    def test_status_disclosed_only_after_correct_password(self):
        for status in ["pending", "rejected", "suspended"]:
            user = account(f"{status}-case@example.test", status)
            wrong = self.login(user, password="wrong-password")
            self.assertEqual(wrong.status_code, 401)
            self.assertEqual(wrong.json()["error"]["code"], "invalid_credentials")
            correct = self.login(user)
            self.assertEqual(correct.status_code, 403)
            self.assertEqual(correct.json()["error"]["code"], f"account_{status}")
        self.assertEqual(Session.objects.count(), 0)

    def test_session_rotation_identity_expiry_and_logout(self):
        old_csrf = self.token()
        anonymous = self.client.session
        anonymous["test"] = True
        anonymous.save()
        self.client.cookies["sessionid"] = anonymous.session_key
        self.assertEqual(self.login().status_code, 200)
        new_key = self.client.cookies["sessionid"].value
        self.assertNotEqual(new_key, anonymous.session_key)
        before = self.client.session.get_expiry_date()
        self.assertAlmostEqual((before - timezone.now()).total_seconds(), 8 * 3600, delta=3)
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.json()["user"]["id"], str(self.user.pk))
        self.assertEqual(before, self.client.session.get_expiry_date())
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn("password", response.json()["user"])
        bad = self.client.post("/api/v1/auth/logout/", {}, format="json", HTTP_X_CSRFTOKEN=old_csrf)
        self.assertEqual(bad.status_code, 403)
        self.assertEqual(self.post("/auth/logout/", {}).status_code, 204)
        replay = APIClient(enforce_csrf_checks=True)
        replay.cookies["sessionid"] = new_key
        self.assertEqual(replay.get("/api/v1/auth/me/").status_code, 403)

    def test_absolute_expiration_denies_session(self):
        self.login()
        Session.objects.filter(session_key=self.client.cookies["sessionid"].value).update(
            expire_date=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.get("/api/v1/auth/me/").json()["error"]["code"], "authentication_required")

    def test_approval_suspension_and_reactivation(self):
        self.assertEqual(self.login(self.admin).status_code, 200)
        route = f"/admin/users/{self.pending.pk}"
        response = self.post(route + "/approve/", {})
        self.assertEqual(response.status_code, 200, response.data)
        browser = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.login(self.pending, browser).status_code, 200)
        self.assertEqual(self.post(route + "/suspend/", {}).status_code, 400)
        self.assertEqual(self.post(route + "/suspend/", {"reason": "Access review"}).status_code, 200)
        self.assertEqual(browser.get("/api/v1/auth/me/").status_code, 403)
        self.assertEqual(self.post("/auth/logout/", {}, browser).status_code, 204)
        self.assertEqual(self.post(route + "/reactivate/", {}).status_code, 200)
        self.assertEqual(self.login(self.pending, browser).status_code, 200)
        self.assertEqual(AuditEvent.objects.filter(target_id=self.pending.pk).count(), 3)

    def test_reactivation_does_not_revive_old_sessions(self):
        browser = APIClient(enforce_csrf_checks=True)
        self.login(self.user, browser)
        old_cookie = browser.cookies["sessionid"].value
        transition_account(self.admin, self.user.pk, "suspend", "Review", "test")
        transition_account(self.admin, self.user.pk, "reactivate", "", "test")
        browser.cookies["sessionid"] = old_cookie
        self.assertEqual(browser.get("/api/v1/auth/me/").status_code, 403)
        self.assertEqual(self.login(self.user, browser).status_code, 200)

    def test_admin_routes_reject_standard_user_and_target_privilege(self):
        self.login()
        self.assertEqual(self.client.get("/api/v1/admin/users/").status_code, 403)
        self.assertEqual(self.post(f"/admin/users/{self.pending.pk}/approve/", {}).status_code, 403)
        self.login(self.admin)
        self.assertEqual(self.post(f"/admin/users/{self.admin.pk}/suspend/", {"reason": "no"}).status_code, 403)
        other = account("other-admin@example.test", "approved", "admin")
        self.assertEqual(self.post(f"/admin/users/{other.pk}/suspend/", {"reason": "no"}).status_code, 403)
        self.assertEqual(self.post(f"/admin/users/{self.pending.pk}/approve/", {"role": "admin"}).status_code, 400)
        self.assertEqual(self.client.post(f"/api/v1/admin/users/{self.pending.pk}/approve/", {}, format="json").status_code, 403)

    def test_rejected_terminal_and_invalid_transition(self):
        self.login(self.admin)
        route = f"/admin/users/{self.pending.pk}"
        self.assertEqual(self.post(route + "/reject/", {"reason": "Not eligible"}).status_code, 200)
        self.assertEqual(self.post(route + "/approve/", {}).status_code, 409)
        self.assertEqual(self.post(route + "/reactivate/", {}).status_code, 409)
        self.assertEqual(AuditEvent.objects.filter(target_id=self.pending.pk).count(), 1)

    def test_audit_failure_rolls_back_transition(self):
        with patch("apps.accounts.services.AuditEvent.objects.create", side_effect=RuntimeError("test rollback")):
            with self.assertRaises(RuntimeError):
                transition_account(self.admin, self.pending.pk, "approve", "", "test")
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, "pending")
        self.assertEqual(AuditEvent.objects.count(), 0)

    def test_email_uniqueness_and_status_checks_at_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create(email="USER@EXAMPLE.TEST")
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=self.pending.pk).update(is_active=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.filter(pk=self.user.pk).update(is_staff=True)

    def test_admin_pagination_and_filters(self):
        self.login(self.admin)
        data = self.client.get("/api/v1/admin/users/?page_size=1&role=user").json()
        self.assertEqual(len(data["results"]), 1)
        self.assertTrue(data["next"].startswith("/api/v1/admin/users/"))
        data = self.client.get("/api/v1/admin/users/?status=pending&search=PENDING").json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(self.client.get("/api/v1/admin/users/?page_size=101").status_code, 400)
        self.assertEqual(self.client.get("/api/v1/admin/users/?role=root").status_code, 400)

    def test_me_and_login_report_absolute_session_expiry_and_request_dates(self):
        user = User.objects.create_user("expiry@example.test", "Sample-long-test-secret", first_name="Ex",
                                        last_name="Piry", organization="Lab", status="approved")
        client = APIClient(enforce_csrf_checks=True)
        token = client.get("/api/v1/auth/csrf/").data["csrf_token"]
        before = timezone.now()
        login = client.post("/api/v1/auth/login/", {"email": user.email, "password": "Sample-long-test-secret"},
                            format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(login.status_code, 200)
        expires = login.data["session_expires_at"]
        self.assertTrue(before + timedelta(hours=8) - timedelta(minutes=1) <= expires <= timezone.now() + timedelta(hours=8))
        me = client.get("/api/v1/auth/me/")
        self.assertEqual(me.data["session_expires_at"], expires)
        self.assertIn("created_at", me.data["user"])

    def test_admin_status_counts_follow_list_filters(self):
        account("rejected@example.test", "rejected")
        account("suspended@example.test", "suspended")
        route = "/api/v1/admin/users/counts/"
        self.assertEqual(self.client.get(route).status_code, 403)
        self.login(self.user)
        self.assertEqual(self.client.get(route).status_code, 403)
        self.client.logout()
        self.login(self.admin)
        data = self.client.get(route).json()
        self.assertEqual(data, {"counts": {"pending": 1, "approved": 2, "suspended": 1, "rejected": 1}})
        data = self.client.get(route + "?role=user").json()
        self.assertEqual(data["counts"]["approved"], 1)
        data = self.client.get(route + "?role=user&search=SUSPENDED").json()
        self.assertEqual(data, {"counts": {"pending": 0, "approved": 0, "suspended": 1, "rejected": 0}})
        listed = self.client.get("/api/v1/admin/users/?role=user&status=approved").json()["count"]
        self.assertEqual(listed, self.client.get(route + "?role=user").json()["counts"]["approved"])
        self.assertEqual(self.client.get(route + "?status=pending").status_code, 400)
        self.assertEqual(self.client.get(route + "?role=root").status_code, 400)

    def test_auth_rate_limit_and_no_forwarded_ip_bypass(self):
        for i in range(10):
            response = self.client.post("/api/v1/auth/login/", {}, format="json",
                                        HTTP_X_CSRFTOKEN=self.token(), HTTP_X_FORWARDED_FOR=f"10.0.0.{i}")
            self.assertEqual(response.status_code, 400)
        response = self.post("/auth/login/", {})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "rate_limited")
        self.assertIn("Retry-After", response)

    def test_health_and_request_limits(self):
        self.assertEqual(self.client.get("/api/v1/health/live/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/health/ready/").status_code, 403)
        with override_settings(READINESS_TOKEN="test-ready-token"):
            self.assertEqual(self.client.get("/api/v1/health/ready/", HTTP_X_READINESS_TOKEN="test-ready-token").status_code, 200)
        response = self.client.post("/api/v1/auth/register/", "x" * 32769, content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("request_id", response.json()["error"])

    @override_settings(SECURE_SSL_REDIRECT=False, SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True)
    def test_hosted_cookie_flags(self):
        self.assertEqual(self.login().status_code, 200)
        cookie = self.client.cookies["sessionid"]
        self.assertTrue(cookie["secure"])
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")


class ConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()

    def test_concurrent_registration_creates_one_user(self):
        barrier = Barrier(2)
        data = {"email": "race@example.test", "password": PASSWORD, "first_name": "Race",
                "last_name": "Test", "organization": "Synthetic"}

        def register():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    register_account(data)
                    return "created"
                except Exception as exc:
                    from rest_framework.exceptions import ValidationError
                    if not isinstance(exc, ValidationError):
                        raise
                    return "duplicate"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: register(), range(2)))
        self.assertCountEqual(results, ["created", "duplicate"])
        self.assertEqual(User.objects.filter(email=data["email"]).count(), 1)

    def test_concurrent_review_has_one_event(self):
        admins = [account(f"admin{i}@example.test", "approved", "admin") for i in range(2)]
        target = account("review@example.test")
        barrier = Barrier(2)

        def review(admin):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    transition_account(admin, target.pk, "approve", "", "concurrent-test")
                    return "approved"
                except ServiceError as exc:
                    return exc.detail.code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(review, admins))
        self.assertCountEqual(results, ["approved", "invalid_transition"])
        self.assertEqual(AuditEvent.objects.filter(target_id=target.pk).count(), 1)
