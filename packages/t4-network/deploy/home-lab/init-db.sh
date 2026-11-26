#!/bin/sh
set -eu
: "${IWXA_DB_PASSWORD:?Missing identity DB password}"
psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 --set=app_password="$IWXA_DB_PASSWORD" <<'SQL'
CREATE ROLE iwxa_identity LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
CREATE DATABASE identity_test OWNER iwxa_identity;
REVOKE CONNECT ON DATABASE identity_test FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
SQL
