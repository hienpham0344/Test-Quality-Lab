from sqlalchemy import create_engine

from app.infrastructure.database import session
from app.infrastructure.database.check_connection import main


def test_connection_check_reports_success(monkeypatch, capsys):
    engine = create_engine("sqlite://")
    monkeypatch.setattr(session, "engine", engine)

    assert main() == 0
    assert capsys.readouterr().out == "Database connection OK\n"
    engine.dispose()


def test_connection_check_does_not_print_connection_details(monkeypatch, capsys):
    class BrokenEngine:
        def connect(self):
            raise RuntimeError("postgresql://user:example-secret@host/database")

    monkeypatch.setattr(session, "engine", BrokenEngine())

    assert main() == 1
    output = capsys.readouterr()
    assert "example-secret" not in output.err
    assert output.err == "Database connection failed (RuntimeError)\n"
