"""Authenticated envelope encryption and masking for AI provider credentials."""

from __future__ import annotations

import base64
import os
from collections import OrderedDict

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from pydantic import SecretStr

from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, ErrorCode

ENVELOPE_VERSION = "v1"
NONCE_BYTES = 12
HKDF_INFO = b"tql-provider-credential-v1"
PLACEHOLDER_MARKER = "CHANGE_ME"


def _derive_aes_key(key_id: str, raw_material: str) -> bytes:
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=key_id.encode("utf-8"),
        info=HKDF_INFO,
    )
    return hkdf.derive(raw_material.encode("utf-8"))


def mask_secret(raw: str) -> str:
    """Return a non-reversible masked hint that never reveals key prefixes."""
    trimmed = raw.strip()
    if len(trimmed) < 12:
        return "••••••••"
    return f"••••••••{trimmed[-4:]}"


class CredentialVault:
    """AES-256-GCM keyring supporting zero-downtime key rotation and AAD binding."""

    def __init__(self, keyring_spec: str) -> None:
        keys: OrderedDict[str, AESGCM] = OrderedDict()
        for entry in (part.strip() for part in keyring_spec.split(",") if part.strip()):
            if ":" not in entry:
                raise AppError(
                    ErrorCode.SERVICE_UNAVAILABLE,
                    "Credential encryption keyring entry is malformed",
                )
            key_id, secret_material = (piece.strip() for piece in entry.split(":", 1))
            if (
                not key_id
                or len(secret_material) < 16
                or PLACEHOLDER_MARKER in secret_material
            ):
                raise AppError(
                    ErrorCode.SERVICE_UNAVAILABLE,
                    "Credential encryption key is not configured",
                )
            if key_id in keys:
                raise AppError(
                    ErrorCode.SERVICE_UNAVAILABLE,
                    "Duplicate key identifier in credential encryption keyring",
                )
            keys[key_id] = AESGCM(_derive_aes_key(key_id, secret_material))

        if not keys:
            raise AppError(
                ErrorCode.SERVICE_UNAVAILABLE,
                "Credential encryption key is not configured",
            )
        self._keys = keys
        self._active_key_id = next(iter(keys))

    @property
    def active_key_id(self) -> str:
        return self._active_key_id

    def encrypt(self, plaintext: str, *, aad: str) -> tuple[str, str]:
        cleaned = plaintext.strip()
        if not cleaned:
            raise AppError(ErrorCode.INPUT_INVALID, "API key cannot be empty", {"api_key": "Required"})
        nonce = os.urandom(NONCE_BYTES)
        cipher = self._keys[self._active_key_id]
        ciphertext = cipher.encrypt(nonce, cleaned.encode("utf-8"), aad.encode("utf-8"))
        nonce_b64 = base64.urlsafe_b64encode(nonce).decode("ascii")
        ct_b64 = base64.urlsafe_b64encode(ciphertext).decode("ascii")
        return self._active_key_id, f"{ENVELOPE_VERSION}:{self._active_key_id}:{nonce_b64}:{ct_b64}"

    def decrypt(self, token: str, *, aad: str) -> SecretStr:
        version, key_id, nonce, ciphertext = self._parse_envelope(token)
        if version != ENVELOPE_VERSION or key_id not in self._keys:
            raise AppError(ErrorCode.ACCESS_DENIED, "Stored credential cannot be decrypted")
        try:
            raw_bytes = self._keys[key_id].decrypt(nonce, ciphertext, aad.encode("utf-8"))
        except InvalidTag as exc:
            raise AppError(ErrorCode.ACCESS_DENIED, "Stored credential failed authentication") from exc
        return SecretStr(raw_bytes.decode("utf-8"))

    def needs_rotation(self, token: str) -> bool:
        _, key_id, _, _ = self._parse_envelope(token)
        return key_id != self._active_key_id

    def rotate(self, token: str, *, aad: str) -> tuple[str, str]:
        secret = self.decrypt(token, aad=aad)
        return self.encrypt(secret.get_secret_value(), aad=aad)

    @staticmethod
    def _parse_envelope(token: str) -> tuple[str, str, bytes, bytes]:
        parts = token.split(":")
        if len(parts) != 4:
            raise AppError(ErrorCode.ACCESS_DENIED, "Malformed encrypted credential envelope")
        version, key_id, nonce_b64, ct_b64 = parts
        try:
            nonce = base64.urlsafe_b64decode(nonce_b64.encode("ascii"))
            ciphertext = base64.urlsafe_b64decode(ct_b64.encode("ascii"))
        except (ValueError, TypeError) as exc:
            raise AppError(ErrorCode.ACCESS_DENIED, "Malformed encrypted credential payload") from exc
        if len(nonce) != NONCE_BYTES:
            raise AppError(ErrorCode.ACCESS_DENIED, "Invalid credential nonce length")
        return version, key_id, nonce, ciphertext


def get_credential_vault(settings: Settings | None = None) -> CredentialVault:
    cfg = settings or get_settings()
    if cfg.credential_encryption_keys is None:
        raise AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "Credential encryption key is not configured",
        )
    return CredentialVault(cfg.credential_encryption_keys.get_secret_value())
