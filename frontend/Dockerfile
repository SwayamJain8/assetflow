# syntax=docker/dockerfile:1
#
# Next.js standalone build. Three stages so a code-only change does not reinstall
# node_modules, and the final image ships without dev dependencies or sources.

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* is inlined at BUILD time, not read at runtime — so the API URL the
# browser will call has to be known here. It is passed as a build arg from compose.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# The standalone output bundles only the files the server actually needs.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER bun

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["bun", "server.js"]
