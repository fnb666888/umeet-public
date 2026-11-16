#!/bin/sh
set -eu
set -f
set -- ${SSH_ORIGINAL_COMMAND:-}
test "$#" -eq 2 || exit 2
action=$1
sha=$2
case "$sha" in *[!a-f0-9]*|'') exit 2;; esac
test "${#sha}" -eq 40 || exit 2
release=/opt/umeet/releases/ci-$sha
archive=/var/lib/umeet-deploy/$sha.tar.gz
case "$action" in
  upload)
    umask 077
    test ! -e "$archive"
    cat > "$archive"
    ;;
  deploy)
    exec 9>/var/lib/umeet-deploy/deploy.lock
    flock -n 9 || exit 3
    test -f "$archive"
    test ! -e "$release"
    mkdir "$release"
    python3 -c 'import tarfile,sys; t=tarfile.open(sys.argv[1]); t.extractall(sys.argv[2],filter="data")' "$archive" "$release"
    sh "$release/deploy/alicloud/build-release.sh" "$release"
    chgrp -R umeet "$release/apps/web/.next/standalone/apps/web/.next/cache"
    chmod -R g+rwX "$release/apps/web/.next/standalone/apps/web/.next/cache"
    sudo /usr/local/sbin/umeet-ci-activate "$sha"
    ;;
  *) exit 2;;
esac
