# syntax=docker/dockerfile:1.7

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
# Prisma engines need openssl at install-time for detection.
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---- build ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# openssl is required at runtime for the Prisma query/schema engines.
RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 krwn \
  && adduser  --system --uid 1001 krwn

COPY --from=builder /app/public ./public
COPY --from=builder --chown=krwn:krwn /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

USER krwn
EXPOSE 3000
CMD ["npm", "run", "start"]
