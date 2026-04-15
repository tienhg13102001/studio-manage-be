# ── Stage 1: Build TypeScript ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

# ── Stage 2: Production image ───────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --production --frozen-lockfile && yarn cache clean

COPY --from=builder /app/dist ./dist

EXPOSE 5002

CMD ["node", "dist/app.js"]
