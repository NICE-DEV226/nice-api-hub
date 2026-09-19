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
ENV NODE_ENV=production PORT=3000
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
