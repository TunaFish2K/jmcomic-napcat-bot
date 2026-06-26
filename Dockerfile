FROM node:22-alpine AS builder
ENV CI=true
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
ENV CI=true
RUN npm install -g pnpm
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/api/package.json packages/api/package.json
COPY --from=builder /app/packages/api/dist packages/api/dist
RUN pnpm install --prod --frozen-lockfile

VOLUME /app/packages/api/cache
CMD ["node", "packages/api/dist/index.js"]
