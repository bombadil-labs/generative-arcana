"""Migration-only libpq transport. JSON-lines RPC; never log driver errors/secrets."""
import datetime
import json
import os
import sys
from urllib.parse import parse_qsl, urlsplit


def emit(value):
    print(json.dumps(value, default=lambda v: v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else str(v)), flush=True)


def connect(request):
    import certifi
    import psycopg
    from psycopg.rows import dict_row

    # Bundled, version-checked libpq implements require, including refusal of
    # non-SCRAM/trust authentication. No pg preference flag or private hook.
    if psycopg.pq.version() < 170000 or psycopg.pq.__impl__ != "binary":
        raise ValueError("unsupported_libpq")
    uri = request["connectionString"]
    parsed = urlsplit(uri)
    options = parse_qsl(parsed.query, keep_blank_values=True)
    if parsed.scheme not in ("postgres", "postgresql") or parsed.fragment:
        raise ValueError("invalid_uri")
    if len(dict(options)) != len(options) or any(k not in ("sslmode", "channel_binding") for k, _ in options):
        raise ValueError("invalid_parameters")
    if dict(options).get("channel_binding") != "require" or dict(options).get("sslmode") not in ("require", "verify-full"):
        raise ValueError("tls_and_channel_binding_required")
    if not parsed.hostname or not parsed.username or not parsed.password or not parsed.path.strip("/"):
        raise ValueError("explicit_connection_required")
    # Do not inherit service files, passfiles or SSL/auth overrides. The URI is
    # supplied over stdin, not a command argument, and is never emitted.
    for key in list(os.environ):
        if key.startswith("PG") or key in ("SSL_CERT_FILE", "SSL_CERT_DIR"):
            os.environ.pop(key)
    return psycopg.connect(
        uri, autocommit=True, cursor_factory=psycopg.RawCursor,
        row_factory=dict_row, connect_timeout=10,
        channel_binding="require", sslmode="verify-full",
        sslrootcert=request.get("caFile") or certifi.where(),
    )


def main():
    connection = None
    try:
        first = json.loads(sys.stdin.readline())
        connection = connect(first)
        emit({"id": 0, "ready": True, "transport": "libpq", "channelBinding": "require", "tls": "verify-full"})
        for line in sys.stdin:
            request = json.loads(line)
            identifier = request["id"]
            if request.get("close"):
                # close never commits; loss of parent stdin closes the same
                # connection too, rolling back any open transaction.
                emit({"id": identifier, "rows": []})
                break
            try:
                with connection.cursor() as cursor:
                    cursor.execute(request["sql"], request.get("values"), prepare=False)
                    rows = cursor.fetchall() if cursor.description else []
                    while cursor.nextset():
                        rows = cursor.fetchall() if cursor.description else []
                emit({"id": identifier, "rows": rows})
            except Exception as error:
                state = getattr(error, "sqlstate", None)
                emit({"id": identifier, "error": "query_failed", "sqlstate": state if isinstance(state, str) and len(state) == 5 and state.isalnum() else None})
    except (ImportError, ModuleNotFoundError):
        emit({"id": 0, "error": "migration_libpq_dependencies_unavailable"})
    except Exception:
        emit({"id": 0, "error": "libpq_connection_or_protocol_failed"})
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    main()
