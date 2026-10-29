"""Fail-closed placeholder: no untrusted execution until security signoff."""

import sys


def main() -> int:
    print("Sandbox execution is disabled: launcher/security policy not implemented.", file=sys.stderr)
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
