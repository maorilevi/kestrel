# KESTREL web app. Build from the repository root:
#   fly deploy -c fly.web.toml
FROM node:24-slim AS build
WORKDIR /app
# Baked into the build: where /api is proxied to, and where the browser opens WebSockets.
ARG KESTREL_SERVER_URL
ARG NEXT_PUBLIC_KESTREL_WS_URL
ENV KESTREL_SERVER_URL=$KESTREL_SERVER_URL
ENV NEXT_PUBLIC_KESTREL_WS_URL=$NEXT_PUBLIC_KESTREL_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build -w @kestrel/web

# Next's standalone output: a self-contained server plus the static assets.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
