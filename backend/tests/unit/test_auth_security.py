from app.modules.auth.security import (
    hash_password,
    new_token,
    token_hash,
    verify_password,
    verify_password_or_dummy,
)


def test_password_hash_is_salted_one_way_digest():
    first, second = hash_password("long-enough-password"), hash_password("long-enough-password")
    assert first != second
    assert "long-enough-password" not in first
    assert first.startswith("pbkdf2_sha256$600000$")
    assert verify_password("long-enough-password", first)
    assert not verify_password("wrong-password-long", first)


def test_malformed_or_foreign_digest_never_verifies():
    assert not verify_password("anything", "not-a-digest")
    assert not verify_password("anything", "bcrypt$1$00$00")
    assert not verify_password("anything", "pbkdf2_sha256$1$zz$00")


def test_missing_account_still_spends_hashing_time_and_fails():
    assert verify_password_or_dummy("long-enough-password", None) is False
    assert verify_password_or_dummy("long-enough-password", hash_password("long-enough-password"))


def test_new_token_returns_raw_value_and_its_hash_only():
    raw, digest = new_token()
    assert len(raw) >= 43
    assert digest == token_hash(raw) != raw
