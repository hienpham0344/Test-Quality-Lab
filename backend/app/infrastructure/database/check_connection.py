"""Check the configured database without printing its connection details."""

import sys

from sqlalchemy import text


def main() -> int:
    try:
        from app.infrastructure.database import session

        with session.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        print(f"Database connection failed ({type(exc).__name__})", file=sys.stderr)
        return 1

    print("Database connection OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
