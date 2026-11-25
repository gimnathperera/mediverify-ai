# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
# The root manifest's dev deps pull in @mediverify/core, so onnxruntime-node installs here too.
# Skip its optional CUDA download (CPU-only embeddings; the 1.21.0 GPU asset 404s).
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter @mediverify/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @mediverify/web build

FROM nginx:1.31-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
