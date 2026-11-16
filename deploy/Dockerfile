FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
RUN npm ci
COPY apps ./apps
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build:api && npm run build -w @umeet/admin

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
RUN npm ci --omit=dev --workspace=@umeet/api --include-workspace-root
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
ENV NODE_ENV=production LOCAL_DATABASE=false DEMO_MODE=false HOST=0.0.0.0
USER node
EXPOSE 3100
CMD ["node","apps/api/dist/main.js"]

FROM nginx:1.28-alpine AS gateway
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
