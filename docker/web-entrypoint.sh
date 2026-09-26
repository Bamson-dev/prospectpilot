#!/bin/sh
set -eu
npx prisma migrate deploy
exec npx next start --hostname 0.0.0.0 --port "${PORT:-3000}"
