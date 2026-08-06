# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-web,target=/pnpm/store pnpm install --frozen-lockfile --prod=false
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NODE_ENV=production NEXT_OUTPUT_MODE=standalone
RUN pnpm --filter @bba/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini curl && addgroup -S nextjs && adduser -S -G nextjs nextjs
WORKDIR /app
COPY --from=build --chown=nextjs:nextjs /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /workspace/apps/web/.next/static ./apps/web/.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
