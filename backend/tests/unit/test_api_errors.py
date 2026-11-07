"""Standard error body {"detail": {"code", "message", "fields"}} (coding rules 7.3)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.api.errors import HTTP_STATUS, register_error_handlers
from app.core.exceptions import AppError, ErrorCode


class Payload(BaseModel):
    name: str


@pytest.fixture
def api() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/raise/{code}")
    def raise_error(code: ErrorCode):
        raise AppError(code, "Readable message", {"field": "reason"})

    @app.post("/api/v1/auth/echo")
    def auth_echo(payload: Payload):
        return payload

    @app.post("/api/v1/other/echo")
    def other_echo(payload: Payload):
        return payload

    return TestClient(app)


def test_every_error_code_has_an_http_status():
    assert set(HTTP_STATUS) == set(ErrorCode)


@pytest.mark.parametrize("code", list(ErrorCode))
def test_app_error_uses_standard_body(api, code):
    response = api.get(f"/raise/{code.value}")

    assert response.status_code == HTTP_STATUS[code]
    assert response.json() == {
        "detail": {"code": code.value, "message": "Readable message", "fields": {"field": "reason"}}
    }
    assert ("WWW-Authenticate" in response.headers) == (response.status_code == 401)


def test_auth_request_shape_errors_are_400_auth_invalid_input(api):
    response = api.post("/api/v1/auth/echo", json={})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "AUTH_INVALID_INPUT"
    assert set(response.json()["detail"]["fields"]) == {"name"}


def test_other_request_shape_errors_are_422_input_invalid(api):
    response = api.post("/api/v1/other/echo", content=b"not json", headers={"Content-Type": "application/json"})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INPUT_INVALID"
    assert response.json()["detail"]["fields"]
