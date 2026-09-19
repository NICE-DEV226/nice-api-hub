# NICE-API'HUB gateway — build from the repository root:
#   docker build -f apps/gateway/Dockerfile -t nice-api-hub .
FROM node:22-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# ---- all dependencies (for the build) ---------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/
RUN npm ci --workspace=@nice-api-hub/gateway

# ---- compile ------------------------------------------------------------------
FROM deps AS build
COPY apps/gateway/tsconfig.json apps/gateway/tsconfig.build.json apps/gateway/
COPY apps/gateway/src apps/gateway/src
RUN npm run build --workspace=@nice-api-hub/gateway

# ---- production dependencies only ---------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/
RUN npm ci --workspace=@nice-api-hub/gateway --omit=dev \
 && mkdir -p apps/gateway/node_modules

# ---- runtime ------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 XDG_CACHE_HOME=/tmp/.cache

# Extraction (yt-dlp) and media packaging (ffmpeg). yt-dlp is pinned for reproducible builds, but
# YouTube changes often: rebuild regularly with a newer --build-arg YTDLP_VERSION (see the daily probe workflow).
ARG YTDLP_VERSION=2026.8.19
RUN apk add --no-cache python3 py3-pip ffmpeg ca-certificates \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp==${YTDLP_VERSION}" \
 && ln -s /opt/yt-dlp/bin/yt-dlp /usr/local/bin/yt-dlp \
 && yt-dlp --version && ffmpeg -version | head -1

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=build /app/apps/gateway/dist ./apps/gateway/dist
COPY apps/gateway/migrations ./apps/gateway/migrations
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY package.json ./package.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/gateway/dist/main.js"]
