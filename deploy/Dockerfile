# Build context is the repo root: docker build -f deploy/Dockerfile .
FROM node:24-slim AS build
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate
WORKDIR /repo
# Hard Rule 8: no telemetry, in build and runtime.
ENV NEXT_TELEMETRY_DISABLED=1 CLERK_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
# Public values only; they are inlined into the client bundle. Secrets are runtime-only.
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN pnpm --filter console build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CLERK_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/console/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/console/.next/static ./apps/console/.next/static
COPY --from=build --chown=node:node /repo/apps/console/public ./apps/console/public
USER node
EXPOSE 3000
CMD ["node", "apps/console/server.js"]
