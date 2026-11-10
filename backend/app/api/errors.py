"""HTTP mapping for domain errors and request validation errors.

Every error body has the shape ``{"detail": {"code", "message", "fields"}}``.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import AppError, ErrorCode

HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.AUTH_INVALID_INPUT: 400,
    ErrorCode.AUTH_INVALID_TOKEN: 400,
    ErrorCode.AUTH_INVALID_CREDENTIALS: 401,
    ErrorCode.AUTH_SESSION_INVALID: 401,
    ErrorCode.AUTH_EMAIL_NOT_VERIFIED: 403,
    ErrorCode.ACCESS_DENIED: 403,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.AUTH_DUPLICATE_EMAIL: 409,
    ErrorCode.INPUT_INVALID: 422,
    ErrorCode.CSV_SCHEMA: 422,
    ErrorCode.CSV_ROW_INVALID: 422,
    ErrorCode.AUTH_RATE_LIMITED: 429,
    ErrorCode.SERVICE_UNAVAILABLE: 503,
}

# Request-shape errors use the module's own SRS code; first matching prefix wins.
VALIDATION_CODE_BY_PREFIX: tuple[tuple[str, ErrorCode], ...] = (
    ("/api/v1/auth/", ErrorCode.AUTH_INVALID_INPUT),
)


def error_response(error: AppError) -> JSONResponse:
    status = HTTP_STATUS[error.code]
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None
    body = {"code": error.code, "message": error.message, "fields": error.fields}
    return JSONResponse(status_code=status, content={"detail": body}, headers=headers)


def validation_error(request: Request, exc: RequestValidationError) -> AppError:
    code = next(
        (code for prefix, code in VALIDATION_CODE_BY_PREFIX if request.url.path.startswith(prefix)),
        ErrorCode.INPUT_INVALID,
    )
    fields: dict[str, str] = {}
    for item in exc.errors():
        name = ".".join(str(part) for part in item["loc"][1:]) or "body"
        fields.setdefault(name, item["msg"])
    return AppError(code, "Invalid request", fields)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(validation_error(request, exc))
