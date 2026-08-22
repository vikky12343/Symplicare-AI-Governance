# Care governance API.
#
# Multi-stage so the runtime image carries compiled output and production
# dependencies only — no source, no toolchain, no dev packages.

FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @cgi/core && npm run build -w @cgi/api

# Reinstall without dev dependencies for the runtime layer.
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

# Never run as root.
RUN addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
COPY --from=build --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/packages/core/dist ./packages/core/dist
COPY --from=build --chown=app:app /repo/packages/core/package.json ./packages/core/
COPY --from=build --chown=app:app /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./apps/api/

USER app
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
