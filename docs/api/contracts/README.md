FastAPI exposes OpenAPI at `/openapi.json`; each module also has a behaviour contract here
for frontend integration (see the coding rules, section 7.4).

| Module | Contract | Verification |
|---|---|---|
| auth | [auth.md](auth.md) | `docs/api/postman/` folder `auth` |
| datasets | [datasets.md](datasets.md) | `backend/tests/integration/test_datasets_api.py` |

Authentication errors use `{"detail": {"code", "message", "fields"}}`. Generate a client in a future
feature PR; never hand-edit generated client code.
