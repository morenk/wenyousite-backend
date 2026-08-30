#!/usr/bin/env bash
set -euo pipefail

if rg -n '\$(query|execute)RawUnsafe' src --glob '*.ts' --glob '!**/*.spec.ts'; then
  echo '业务源码禁止使用 Prisma RawUnsafe API' >&2
  exit 1
fi

echo '业务源码未发现 Prisma RawUnsafe API'
