# syntax=docker/dockerfile:1.7
# Multi-stage image for the NestJS API (target: api) and the pipeline worker (target: worker).

FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /app

# ── install (cached on manifests only) ────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts=false

# ── compile TypeScript ────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json tsconfig.scripts.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY scripts scripts
RUN pnpm --filter "./packages/**" --filter @mediverify/api --filter @mediverify/worker build \
 && pnpm exec tsc -p tsconfig.scripts.json

# ── runtime: API (+ migrate/seed one-shot) ────────────────────────────────────
FROM base AS api
ENV NODE_ENV=production
COPY --from=build /app /app
COPY db/migrations db/migrations
COPY resources/reference_document_medical.pdf resources/reference_document_medical.pdf
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

# ── runtime: worker (LibreOffice for DOCX→PDF, embedding model baked in) ──────
FROM base AS worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    EMBEDDING_CACHE_DIR=/app/.model-cache \
    SOFFICE_BIN=soffice \
    HOME=/tmp
COPY --from=build /app /app
COPY fixtures/llm fixtures/llm
# Download the embedding model at build time so the container runs offline and starts fast.
RUN cd packages/core && node -e "import('@huggingface/transformers').then(async (t) => { t.env.cacheDir = '/app/.model-cache'; await t.pipeline('feature-extraction', process.env.EMBEDDING_MODEL || 'Xenova/bge-small-en-v1.5', { dtype: 'q8' }); console.log('embedding model cached'); })" \
 && chown -R node:node /app/.model-cache
ENV EMBEDDING_OFFLINE=true LLM_FIXTURE_DIR=/app/fixtures/llm
USER node
CMD ["node", "apps/worker/dist/main.js"]
