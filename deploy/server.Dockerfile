# KESTREL control plane. Build from the repository root:
#   fly deploy -c fly.server.toml
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build -w @kestrel/core && npm run build -w @kestrel/server

# The server is one bundle; it needs no node_modules at runtime. The scanner
# bundle is uploaded into every sandbox, and templates seed new projects.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/core/dist/kestrel-scan.cjs ./packages/core/dist/kestrel-scan.cjs
COPY --from=build /app/templates ./templates
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "apps/server/dist/main.mjs"]
