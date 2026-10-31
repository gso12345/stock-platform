#!/usr/bin/env bash
# DB 를 통째로 받아 gzip → gpg(AES256)로 암호화해 둔다 — .github/workflows/backup.yml 이 부른다.
#
#   DATABASE_URL       postgres:// · postgresql:// · postgresql+psycopg2:// 모두 받는다(앱의 설정 그대로)
#   BACKUP_PASSPHRASE  백업 파일을 여는 암호
#   $1                 쓸 파일(기본 db.sql.gz.gpg)
#
# pg_dump 는 서버보다 옛 판이면 받기를 거절한다. 서버 판을 먼저 묻고, 그 판의 pg_dump 가 없으면 깐다.
# 다 받은 뒤에는 실제로 풀어 끝까지 읽히는지 본다 — 안 열리는 백업은 없는 것보다 나쁘다(있는 줄 안다).
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL 이 없어요}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE 가 없어요}"
out="${1:-db.sql.gz.gpg}"

url=$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?(\+[A-Za-z0-9]+)?://#postgresql://#')
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$url"; fi

major=$(psql "$url" -tAc 'SHOW server_version_num' | tr -d '[:space:]' | cut -c1-2)
case "$major" in ''|*[!0-9]*) echo "서버 판을 못 읽었어요" >&2; exit 1 ;; esac
pgdump="/usr/lib/postgresql/$major/bin/pg_dump"
if [ ! -x "$pgdump" ]; then
  echo "PostgreSQL $major 의 pg_dump 를 깝니다"
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-common > /dev/null
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y > /dev/null
  sudo apt-get install -y -qq "postgresql-client-$major" > /dev/null
fi

pass() { printf '%s' "$BACKUP_PASSPHRASE"; }
"$pgdump" --no-owner --no-privileges "$url" \
  | gzip -9 \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file <(pass) \
        --symmetric --cipher-algo AES256 -o "$out"

tail_lines=$(gpg --batch --quiet --pinentry-mode loopback --passphrase-file <(pass) -d "$out" | gunzip | tail -n 5)
if ! grep -q "PostgreSQL database dump complete" <<< "$tail_lines"; then
  echo "백업 파일이 끝까지 안 읽혀요" >&2
  exit 1
fi
echo "백업 $(du -h "$out" | cut -f1) — PostgreSQL $major"
