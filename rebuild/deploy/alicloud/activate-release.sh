#!/bin/sh
set -eu
release=$(realpath "$1")
case "$release" in /opt/umeet/releases/*) ;; *) exit 2;; esac
test -f "$release/.build-complete"
previous=$(readlink -f /opt/umeet/current)
rollback() {
  ln -sfn "$previous" /opt/umeet/current
  systemctl restart umeet-api umeet-web
}
ln -sfn "$release" /opt/umeet/current
if ! systemctl restart umeet-api umeet-web; then rollback; exit 1; fi
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl --fail --silent --max-time 8 http://127.0.0.1:3188/api/v1/ready >/dev/null && curl --fail --silent --max-time 8 http://127.0.0.1:8080/ >/dev/null; then
    echo "Release healthy: $release"; exit 0
  fi
  sleep 5
done
rollback
echo "Health checks failed; restored previous application release" >&2
exit 1
