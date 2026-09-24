# One image for API, worker and migrations; choose the command per process.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist HOST=0.0.0.0 WORKER_MODE=separate
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @org/server
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
# API (default). Worker: ["node", "apps/server/dist/worker-main.js"]. Migrations: ["node", "apps/server/dist/migrate-main.js"]
CMD ["node", "apps/server/dist/main.js"]
