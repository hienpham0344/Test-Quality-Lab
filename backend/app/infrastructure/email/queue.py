from kombu.exceptions import KombuError  # type: ignore[import-untyped]

from app.infrastructure.queue.celery_app import celery_app


class EmailQueueUnavailable(Exception):
    pass


def enqueue_auth_link(kind: str, email: str) -> None:
    try:
        celery_app.send_task(
            "auth.request_link", args=[kind, email], argsrepr="(<redacted>)",
            ignore_result=True, retry=False,
        )
    except (KombuError, OSError) as exc:
        raise EmailQueueUnavailable from exc
