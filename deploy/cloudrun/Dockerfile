FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
RUN npm ci
COPY apps/api ./apps/api
COPY apps/admin ./apps/admin
ENV DATABASE_PROVIDER=mysql DATABASE_URL=mysql://build:build@127.0.0.1:3306/build
RUN npm run build:api && npm run build -w @umeet/admin

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates nginx && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
RUN npm ci --omit=dev --workspace=@umeet/api --include-workspace-root
COPY deploy/cloudrun/migrate/package.json deploy/cloudrun/migrate/package-lock.json /opt/migrate/
RUN cd /opt/migrate && npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/admin/dist /app/apps/admin/dist
COPY apps/api/prisma ./apps/api/prisma
COPY deploy/cloudrun/migrate/prisma.config.mjs /opt/migrate/prisma.config.mjs
COPY deploy/cloudrun/nginx.conf /app/deploy/cloudrun/nginx.conf
COPY deploy/cloudrun/start.mjs /app/deploy/cloudrun/start.mjs
COPY deploy/cloudrun/init-db.mjs /app/deploy/cloudrun/init-db.mjs
ENV NODE_ENV=production DATABASE_PROVIDER=mysql LOCAL_DATABASE=false DEMO_MODE=false HOST=127.0.0.1 PORT=8080
# Cloud Hosting injects this CA for its api.weixin.qq.com HTTPS proxy.
# Node uses its own CA store, so system ca-certificates alone is insufficient.
ENV NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "deploy/cloudrun/start.mjs"]
