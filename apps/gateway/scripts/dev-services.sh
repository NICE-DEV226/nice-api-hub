#!/usr/bin/env bash
# Throwaway Postgres + Redis for local dev/tests when Docker isn't handy.
#   scripts/dev-services.sh start|stop|env
# Data lives in $DEV_DATA_DIR (default: ./.dev-data, git-ignored).
set -euo pipefail

DATA="${DEV_DATA_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.dev-data}"
PG_PORT="${DEV_PG_PORT:-55432}"
REDIS_PORT="${DEV_REDIS_PORT:-56379}"

start() {
  mkdir -p "$DATA"
  if [ ! -d "$DATA/pg/base" ]; then
    initdb -D "$DATA/pg" -U nah --auth=trust >/dev/null
  fi
  pg_ctl -D "$DATA/pg" -o "-p $PG_PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l "$DATA/pg.log" -w start >/dev/null
  createdb -h 127.0.0.1 -p "$PG_PORT" -U nah nah 2>/dev/null || true
  createdb -h 127.0.0.1 -p "$PG_PORT" -U nah nah_test 2>/dev/null || true
  redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no \
    --daemonize yes --dir "$DATA" --pidfile "$DATA/redis.pid" --logfile "$DATA/redis.log" >/dev/null
  env
}

stop() {
  pg_ctl -D "$DATA/pg" -m fast stop >/dev/null 2>&1 || true
  [ -f "$DATA/redis.pid" ] && kill "$(cat "$DATA/redis.pid")" 2>/dev/null || true
}

env() {
  cat <<ENV
export DATABASE_URL=postgres://nah@127.0.0.1:$PG_PORT/nah
export REDIS_URL=redis://127.0.0.1:$REDIS_PORT
export TEST_DATABASE_URL=postgres://nah@127.0.0.1:$PG_PORT/nah_test
export TEST_REDIS_URL=redis://127.0.0.1:$REDIS_PORT/1
ENV
}

"${1:-env}"
