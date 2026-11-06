import pytest
from redis.exceptions import ConnectionError

from app.modules.auth.rate_limit import RateLimiter, RateLimitExceeded, RateLimitUnavailable


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
