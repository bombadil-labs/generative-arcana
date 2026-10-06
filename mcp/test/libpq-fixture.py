"""Prepare ONLY the explicit disposable local PostgreSQL TLS fixture."""
import os
import psycopg

if os.environ.get("MIGRATION_LIBPQ_TEST") != "1":
    raise SystemExit("Explicit local fixture opt-in required")
with psycopg.connect("postgresql://migration_test:local-test-only@127.0.0.1:54481/postgres?sslmode=verify-full&channel_binding=require",
                     sslrootcert=os.environ["MIGRATION_TEST_CA_FILE"], autocommit=True) as db:
    for name in ("arcana_tls_test", "arcana_tls_baseline"):
        # Never reset an existing database. A fresh disposable fixture is required.
        db.execute(psycopg.sql.SQL("CREATE DATABASE {}").format(psycopg.sql.Identifier(name)))
    db.execute("SET password_encryption = 'md5'")
    for name in ("trust_user", "md5_user", "clear_user"):
        db.execute(psycopg.sql.SQL("CREATE ROLE {} LOGIN PASSWORD 'local-test-only'").format(psycopg.sql.Identifier(name)))
print("Prepared only local disposable TLS fixture databases/authentication roles.")
