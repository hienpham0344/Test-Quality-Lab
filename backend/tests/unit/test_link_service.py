from datetime import timedelta

from app.modules.auth.link_service import LINK_TTL, AuthLinkService, LinkKind


def test_verification_is_sent_only_to_existing_unverified_accounts(auth, db, link_worker):
    links = AuthLinkService(db, link_worker.capture)
    links.send_verification("missing@example.com")
    auth.register_verified("verified@example.com")
    links.send_verification("verified@example.com")
    auth.register("pending@example.com")
    links.send_verification("PENDING@example.com")

    assert [item[1] for item in link_worker.outbox] == ["verified@example.com", "pending@example.com"]


def test_reset_is_sent_only_to_verified_accounts(auth, db, link_worker):
    links = AuthLinkService(db, link_worker.capture)
    auth.register("pending@example.com")
    links.send_password_reset("pending@example.com")
    links.send_password_reset("missing@example.com")
    auth.register_verified("verified@example.com")
    links.send_password_reset("verified@example.com")

    resets = [(email, valid_for) for kind, email, _, valid_for in link_worker.outbox if kind == "reset"]
    assert resets == [("verified@example.com", timedelta(minutes=30))]


def test_link_lifetimes_match_the_specification():
    assert LINK_TTL == {LinkKind.VERIFY: timedelta(hours=24), LinkKind.RESET: timedelta(minutes=30)}
