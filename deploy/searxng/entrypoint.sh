#!/bin/sh
set -eu
if [ -z "${SEARXNG_SECRET:-}" ]; then
  echo "SEARXNG_SECRET is required" >&2
  exit 1
fi
python3 - <<'PY'
import os
path = "/etc/searxng/settings.yml"
text = open(path, encoding="utf-8").read().replace("__SECRET__", os.environ["SEARXNG_SECRET"])
open(path, "w", encoding="utf-8").write(text)
PY
exec /usr/local/searxng/entrypoint.sh "$@"
