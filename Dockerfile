# syntax=docker/dockerfile:1


ARG APP=fds
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifests first so editing source does not invalidate the dependency layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline --config.dangerouslyAllowAllBuilds=true

ARG APP
RUN pnpm exec nx run "${APP}:prune"

RUN cp -r "dist/apps/${APP}" /out


FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=build /out ./
RUN pnpm install --prod --frozen-lockfile --config.dangerouslyAllowAllBuilds=true \
    && pnpm store prune

USER node
EXPOSE 3000

CMD ["node", "main.js"]
