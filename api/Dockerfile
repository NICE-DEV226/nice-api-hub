# NICE-API'HUB API. Build from this folder:
#   docker build -t nice-api-hub .
FROM node:26-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# ---- all dependencies (for the build) ---------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- compile ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src src
RUN npm run build

# ---- production dependencies only ---------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY package.json ./package.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
