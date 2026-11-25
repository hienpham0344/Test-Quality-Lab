import base64

import pytest

from app.core.exceptions import AppError, ErrorCode
from app.core.security import CredentialVault, mask_secret

KEY_1 = base64.urlsafe_b64encode(b"0" * 32).decode()
KEY_2 = base64.urlsafe_b64encode(b"1" * 32).decode()


def test_encrypt_decrypt_roundtrip_binds_aad() -> None:
    vault = CredentialVault(f"k1:{KEY_1}")
    key_id, token = vault.encrypt("gsk_live_super_secret_token_9876", aad="proj-1:groq")

    assert key_id == "k1"
    assert token.startswith("v1:k1:")
    assert "gsk_live" not in token
    decrypted = vault.decrypt(token, aad="proj-1:groq")
    assert decrypted.get_secret_value() == "gsk_live_super_secret_token_9876"
    assert "gsk_live" not in repr(decrypted)


def test_decrypt_rejects_aad_mismatch_and_tampering() -> None:
    vault = CredentialVault(f"k1:{KEY_1}")
    _, token = vault.encrypt("AIzaSySecretKeyValue1234567890", aad="proj-1:gemini")

    with pytest.raises(AppError) as wrong_project:
        vault.decrypt(token, aad="proj-2:gemini")
    assert wrong_project.value.code == ErrorCode.ACCESS_DENIED

    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(AppError) as corrupted:
        vault.decrypt(tampered, aad="proj-1:gemini")
    assert corrupted.value.code == ErrorCode.ACCESS_DENIED


def test_key_rotation_decrypts_legacy_key_and_rewraps_to_primary() -> None:
    legacy_vault = CredentialVault(f"k1:{KEY_1}")
    _, old_token = legacy_vault.encrypt("sk-or-v1-secret-value-abcdef123456", aad="proj-1:openrouter")

    rotated_vault = CredentialVault(f"k2:{KEY_2},k1:{KEY_1}")
    assert rotated_vault.active_key_id == "k2"
    assert rotated_vault.needs_rotation(old_token) is True
    assert rotated_vault.decrypt(old_token, aad="proj-1:openrouter").get_secret_value() == (
        "sk-or-v1-secret-value-abcdef123456"
    )

    new_key_id, new_token = rotated_vault.rotate(old_token, aad="proj-1:openrouter")
    assert new_key_id == "k2"
    assert rotated_vault.needs_rotation(new_token) is False
    assert rotated_vault.decrypt(new_token, aad="proj-1:openrouter").get_secret_value() == (
        "sk-or-v1-secret-value-abcdef123456"
    )


def test_unconfigured_keyring_fails_closed() -> None:
    with pytest.raises(AppError) as exc_info:
        CredentialVault("   ")
    assert exc_info.value.code == ErrorCode.SERVICE_UNAVAILABLE


def test_mask_secret_never_exposes_prefix_or_short_keys() -> None:
    assert mask_secret("shortkey123") == "••••••••"
    masked = mask_secret("gsk_live_1234567890wxyz")
    assert masked == "••••••••wxyz"
    assert "gsk_live" not in masked
