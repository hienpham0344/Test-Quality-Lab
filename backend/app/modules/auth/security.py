"""Password hashing and opaque token helpers. Raw secrets are never stored."""

import hashlib
import hmac
import secrets
from functools import lru_cache

PBKDF2_ROUNDS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


@lru_cache
def _dummy_digest() -> str:
    return hash_password(secrets.token_urlsafe(16))


def verify_password_or_dummy(password: str, stored: str | None) -> bool:
    """Spend the same hashing time when the account does not exist (no timing oracle)."""
    if stored is None:
        verify_password(password, _dummy_digest())
        return False
    return verify_password(password, stored)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    """Return ``(raw, sha256_hash)``; only the hash may be persisted."""
    raw = secrets.token_urlsafe(32)
    return raw, token_hash(raw)
