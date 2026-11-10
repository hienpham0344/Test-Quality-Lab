from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.infrastructure.database.base import Base
from app.modules.audit.models import AuditEvent  # noqa: F401 — register metadata
from app.modules.auth.models import AuthSession, AuthToken, User  # noqa: F401 — register metadata
from app.modules.datasets.models import Dataset, DatasetVersion  # noqa: F401 — register metadata
from app.modules.projects.models import Project, ProjectHistory  # noqa: F401 — register metadata
from app.modules.sources.models import Source, SourceVersion  # noqa: F401 — register metadata

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=get_settings().database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
