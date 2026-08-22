# Care governance web client, served by nginx with the API proxied at /api so
# the session cookie stays first-party.

FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @cgi/core && npm run build -w @cgi/web

FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
