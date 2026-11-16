#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo 'Usage: build-release.sh /opt/umeet/releases/RELEASE' >&2; exit 2; fi
release=$(realpath "$1")
case "$release" in /opt/umeet/releases/*) ;; *) echo 'Unexpected release path' >&2; exit 2;; esac
cd "$release"
export PATH=/opt/umeet/node/bin:$PATH
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS=--max-old-space-size=1024
node -e 'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)'
npm ci --no-audit --no-fund --registry=https://registry.npmjs.org
npm run build:api
npm run build:web
mkdir -p apps/web/.next/standalone/apps/web/.next/cache
cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -R apps/web/public apps/web/.next/standalone/apps/web/public
test -f apps/api/dist/apps/api/src/main.js
test -f apps/web/.next/standalone/apps/web/server.js
node -e 'import("sharp").then(s=>s.default({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer()).then(()=>console.log("Linux image runtime verified"))'
date -u +%FT%TZ > .build-complete
echo 'Release build completed; database configuration is still required before API start.'
