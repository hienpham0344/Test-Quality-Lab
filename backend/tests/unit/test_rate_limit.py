import pytest
from redis.exceptions import ConnectionError

from app.modules.auth.rate_limit import (
    RateLimiter,
    RateLimitExceeded,
    RateLimitUnavailable,
    get_rate_limiter,
)


class FakeRedis:
    def __init__(self):
        self.counts = {}

    def eval(self, script, key_count, key, window):
        assert key_count == 1
        assert int(window) > 0
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]


def test_login_rate_limit_blocks_repeated_attempts_without_plain_email_keys():
    redis = FakeRedis()
    limiter = RateLimiter(redis)
    for _ in range(10):
        limiter.check("login", "127.0.0.1", "USER@example.com")

    with pytest.raises(RateLimitExceeded):
        limiter.check("login", "127.0.0.1", "user@example.com")
    assert all("user@example.com" not in key for key in redis.counts)


def test_redis_connection_failure_fails_closed():
    class UnavailableRedis:
        def eval(self, *_):
            raise ConnectionError("unavailable")

    with pytest.raises(RateLimitUnavailable):
        RateLimiter(UnavailableRedis()).check("login", "127.0.0.1", "user@example.com")


def test_unexpected_redis_reply_fails_closed():
    class OddRedis:
        def eval(self, *_):
            return None

    with pytest.raises(RateLimitUnavailable):
        RateLimiter(OddRedis()).check("verify", "127.0.0.1")


def test_actions_without_email_policy_ignore_the_email_dimension():
    redis = FakeRedis()
    RateLimiter(redis).check("verify", "127.0.0.1", "user@example.com")
    assert len(redis.counts) == 1


def test_rate_limiter_is_a_shared_instance_with_short_redis_timeouts():
    get_rate_limiter.cache_clear()
    limiter = get_rate_limiter()
    assert get_rate_limiter() is limiter
    assert limiter.redis.connection_pool.connection_kwargs["socket_timeout"] == 1
    get_rate_limiter.cache_clear()
