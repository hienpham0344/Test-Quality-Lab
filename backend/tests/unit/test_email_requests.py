import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.modules.auth import router


class AllowedLimiter:
    def check(self, *_):
        pass


@pytest.mark.parametrize("handler,kind", [(router.forgot, "reset"), (router.request_verification, "verify")])
def test_email_request_queues_without_account_lookup(monkeypatch, handler, kind):
    queued = []
    monkeypatch.setattr(router, "enqueue_auth_link", lambda *args: queued.append(args), raising=False)

    def no_service(_):
        pytest.fail("Public email requests must not look up accounts before responding")

    monkeypatch.setattr(router, "_service", no_service)
    request = Request({"type": "http", "client": ("127.0.0.1", 80)})
    result = handler(router.EmailRequest(email="USER@example.com"), request, limiter=AllowedLimiter())
    assert result == {"status": "request_accepted"}
    assert queued == [(kind, "user@example.com")]


def test_email_request_rejects_invalid_address_before_queue(monkeypatch):
    queued = []
    monkeypatch.setattr(router, "enqueue_auth_link", lambda *args: queued.append(args), raising=False)
    request = Request({"type": "http", "client": ("127.0.0.1", 80)})
    with pytest.raises(HTTPException) as error:
        router.forgot(router.EmailRequest(email="invalid"), request, limiter=AllowedLimiter())
    assert error.value.status_code == 422
    assert queued == []
