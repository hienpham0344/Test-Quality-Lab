"""HTTP contract of UC-01 and UC-02 (docs/api/contracts/auth.md)."""

import pytest

from app.infrastructure.email.queue import EmailQueueUnavailable
from app.modules.auth import router as auth_router
from app.modules.auth.rate_limit import RateLimitExceeded, RateLimitUnavailable
from tests.integration.conftest import bearer


def detail(response) -> dict:
    return response.json()["detail"]


# --- UC-01 register and verify ------------------------------------------------------


def test_uc01_main_flow_register_verify_then_login(api):
    response = api.register("New@Example.com", display_name="Hoa")
    assert response.status_code == 201
    assert response.json()["status"] == "verification_requested"

    assert api.login("new@example.com").status_code == 403
    verified = api.verify(api.worker.latest("verify"))
    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"

    tokens = api.login("new@example.com").json()
    me = api.client.get("/api/v1/auth/me", headers=bearer(tokens))
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"
    assert me.json()["display_name"] == "Hoa"


def test_uc01_invalid_input_returns_400_with_field_errors(api):
    response = api.client.post(
        "/api/v1/auth/register",
        json={"email": "bad", "password": "short", "confirm_password": "other"},
    )

    assert response.status_code == 400
    assert detail(response)["code"] == "AUTH_INVALID_INPUT"
    assert set(detail(response)["fields"]) == {"email", "password", "confirm_password"}


@pytest.mark.parametrize(
    "body",
    [{}, {"email": "user@example.com", "password": "long-enough-password"},
     {"email": "user@example.com", "password": "x" * 12, "confirm_password": "x" * 12, "role": "admin"}],
)
def test_uc01_missing_or_unknown_fields_return_400(api, body):
    response = api.client.post("/api/v1/auth/register", json=body)
    assert response.status_code == 400
    assert detail(response)["code"] == "AUTH_INVALID_INPUT"


def test_uc01_duplicate_email_returns_409(api):
    api.register_and_login("user@example.com")

    response = api.register("USER@example.com")

    assert response.status_code == 409
    assert detail(response)["code"] == "AUTH_DUPLICATE_EMAIL"
    assert "email" in detail(response)["fields"]


def test_uc01_invalid_or_reused_link_returns_400(api):
    api.register("user@example.com")
    token = api.worker.latest("verify")
    assert api.verify(token).status_code == 200

    for bad in (token, "invalid"):
        response = api.verify(bad)
        assert response.status_code == 400
        assert detail(response)["code"] == "AUTH_INVALID_TOKEN"


def test_uc01_a1_resend_sends_new_link_and_retires_the_old_one(api):
    api.register("user@example.com")
    old = api.worker.latest("verify")

    response = api.client.post("/api/v1/auth/verification/request", json={"email": "user@example.com"})

    assert response.status_code == 200
    assert response.json()["status"] == "request_accepted"
    assert api.verify(old).status_code == 400
    assert api.verify(api.worker.latest("verify")).status_code == 200


def test_uc01_resend_answers_the_same_for_unknown_email(api):
    response = api.client.post("/api/v1/auth/verification/request", json={"email": "nobody@example.com"})
    assert response.status_code == 200
    assert api.worker.outbox == []


def test_uc01_email_queue_outage_returns_503(api, monkeypatch):
    def unavailable(*_):
        raise EmailQueueUnavailable

    monkeypatch.setattr(auth_router, "enqueue_auth_link", unavailable)
    response = api.register("user@example.com")

    assert response.status_code == 503
    assert detail(response)["code"] == "SERVICE_UNAVAILABLE"
    assert api.login("user@example.com").status_code == 403


# --- UC-02 login and logout -----------------------------------------------------------


def test_uc02_wrong_password_and_unknown_email_return_same_401(api):
    api.register_and_login("user@example.com")

    wrong = api.login("user@example.com", "wrong-password-long")
    unknown = api.login("nobody@example.com")

    assert wrong.status_code == unknown.status_code == 401
    assert detail(wrong) == detail(unknown)
    assert detail(wrong)["code"] == "AUTH_INVALID_CREDENTIALS"
    assert wrong.headers["WWW-Authenticate"] == "Bearer"


def test_uc02_unverified_account_returns_403(api):
    api.register("user@example.com")
    response = api.login("user@example.com")
    assert response.status_code == 403
    assert detail(response)["code"] == "AUTH_EMAIL_NOT_VERIFIED"


def test_uc02_login_returns_bearer_tokens(api):
    tokens = api.register_and_login("user@example.com")
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 900
    assert tokens["access_token"] != tokens["refresh_token"]


def test_uc02_logout_ends_session_and_refresh(api):
    tokens = api.register_and_login("user@example.com")

    response = api.client.post("/api/v1/auth/logout", headers=bearer(tokens))
    assert response.status_code == 200
    assert response.json()["status"] == "logged_out"
    assert api.client.post("/api/v1/auth/logout", headers=bearer(tokens)).status_code == 200

    me = api.client.get("/api/v1/auth/me", headers=bearer(tokens))
    assert me.status_code == 401
    assert detail(me)["code"] == "AUTH_SESSION_INVALID"
    assert api.client.post("/api/v1/auth/refresh", json={"token": tokens["refresh_token"]}).status_code == 401


def test_uc02_refresh_rotates_tokens(api):
    tokens = api.register_and_login("user@example.com")

    rotated = api.client.post("/api/v1/auth/refresh", json={"token": tokens["refresh_token"]})

    assert rotated.status_code == 200
    assert api.client.get("/api/v1/auth/me", headers=bearer(rotated.json())).status_code == 200
    assert api.client.get("/api/v1/auth/me", headers=bearer(tokens)).status_code == 401


def test_protected_routes_require_a_bearer_token(api):
    for response in (api.client.get("/api/v1/auth/me"), api.client.post("/api/v1/auth/logout")):
        assert response.status_code == 401
        assert detail(response)["code"] == "AUTH_SESSION_INVALID"


@pytest.mark.parametrize(
    "error,status,code",
    [(RateLimitExceeded, 429, "AUTH_RATE_LIMITED"), (RateLimitUnavailable, 503, "SERVICE_UNAVAILABLE")],
)
def test_rate_limit_outcomes(api, error, status, code):
    class Limiter:
        def check(self, *_):
            raise error

    api.set_limiter(Limiter())
    response = api.login("user@example.com")
    assert response.status_code == status
    assert detail(response)["code"] == code


# --- UC-12 password reset (kept working by this change) ----------------------------


def test_reset_does_not_reveal_account_and_revokes_sessions(api):
    tokens = api.register_and_login("user@example.com")
    before = len(api.worker.outbox)
    missing = api.client.post("/api/v1/auth/password/forgot", json={"email": "missing@example.com"})
    existing = api.client.post("/api/v1/auth/password/forgot", json={"email": "user@example.com"})
    assert missing.json() == existing.json()
    assert len(api.worker.outbox) == before + 1

    reset = api.client.post(
        "/api/v1/auth/password/reset",
        json={"token": api.worker.latest("reset"), "new_password": "new-password-123"},
    )
    assert reset.status_code == 200
    assert api.client.get("/api/v1/auth/me", headers=bearer(tokens)).status_code == 401
    assert api.login("user@example.com").status_code == 401
    assert api.login("user@example.com", "new-password-123").status_code == 200
    invalid = api.client.post(
        "/api/v1/auth/password/reset", json={"token": "invalid", "new_password": "long-password-123"}
    )
    assert invalid.status_code == 400
