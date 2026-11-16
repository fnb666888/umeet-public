#!/bin/sh
set -eu
test "$#" -eq 1 || exit 2
case "$1" in *[!a-f0-9]*|'') exit 2;; esac
test "${#1}" -eq 40 || exit 2
release=/opt/umeet/releases/ci-$1
test "$(realpath "$release")" = "$release" || exit 2
test -f "$release/.build-complete"
test -f "$release/apps/api/dist/apps/api/src/main.js"
test -f "$release/apps/web/.next/standalone/apps/web/server.js"
previous=$(readlink -f /opt/umeet/current)
switch() {
  ln -sfn "$1" /opt/umeet/current.next
  mv -Tf /opt/umeet/current.next /opt/umeet/current
  systemctl restart umeet-api umeet-web
}
if switch "$release"; then
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if curl -fsS --max-time 8 http://127.0.0.1:3188/api/v1/ready >/dev/null && curl -fsS --max-time 8 http://127.0.0.1:8080/ >/dev/null; then
      echo "Release healthy: $release"
      exit 0
    fi
    sleep 5
  done
fi
switch "$previous"
echo "Health checks failed; restored previous application release" >&2
exit 1
