# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store pnpm install --frozen-lockfile --prod=false --filter @bba/api...
COPY apps/api apps/api
RUN pnpm --filter @bba/api prisma:generate && pnpm --filter @bba/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4000
RUN apk add --no-cache tini curl && addgroup -S app && adduser -S -G app app
WORKDIR /workspace
COPY --from=build --chown=app:app /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=build --chown=app:app /workspace/node_modules ./node_modules
COPY --from=build --chown=app:app /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=app:app /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /workspace/apps/api/prisma ./apps/api/prisma
USER app
WORKDIR /workspace/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:4000/health/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server.js"]
