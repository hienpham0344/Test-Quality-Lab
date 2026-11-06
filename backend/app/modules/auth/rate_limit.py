"""Shared Redis rate limits for public authentication endpoints."""

import hashlib
from functools import lru_cache

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

_INCREMENT_WITH_EXPIRY = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
"""

_POLICIES = {
    "register": ((5, 60), (3, 3600)),
    "login": ((20, 60), (10, 900)),
    "verification_request": ((5, 60), (3, 3600)),
    "forgot": ((5, 60), (3, 3600)),
    "verify": ((20, 60), None),
    "reset": ((10, 60), None),
    "refresh": ((30, 60), None),
}


class RateLimitExceeded(Exception):
    pass


class RateLimitUnavailable(Exception):
    pass


class RateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    def check(self, action: str, client_ip: str, email: str | None = None) -> None:
        ip_policy, email_policy = _POLICIES[action]
        self._increment(action, "ip", client_ip, *ip_policy)
        if email is not None and email_policy is not None:
            self._increment(action, "email", email.strip().lower(), *email_policy)

    def _increment(self, action: str, dimension: str, value: str, limit: int, window: int) -> None:
        digest = hashlib.sha256(value.encode()).hexdigest()
        key = f"tql:auth-rate:{action}:{dimension}:{digest}"
        try:
            raw_count = self.redis.eval(_INCREMENT_WITH_EXPIRY, 1, key, str(window))
            if not isinstance(raw_count, (int, str, bytes)):
                raise RateLimitUnavailable
            count = int(raw_count)
        except (RedisError, ValueError) as exc:
            raise RateLimitUnavailable from exc
        if count > limit:
            raise RateLimitExceeded


@lru_cache
def get_rate_limiter() -> RateLimiter:
    redis = Redis.from_url(
        get_settings().redis_url,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    return RateLimiter(redis)
