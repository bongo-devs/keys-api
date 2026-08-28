# Bun runs TypeScript directly, so there is no build stage and no compiler in the shipped image.
FROM oven/bun:1.4.0-alpine

WORKDIR /app

# Manifest first: a code change then rebuilds from here, not from the install.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

# The database and its -wal/-shm siblings live here, so this is the one path worth a volume — without
# one, every key in the pool dies with the container.
RUN mkdir -p data && chown bun:bun data
VOLUME /app/data
USER bun

ENV PORT=8787
EXPOSE 8787
# /api/health needs no credentials, which is exactly what makes it usable from here.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1

CMD ["bun", "src/index.ts"]
