# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy the workspace with a root build context so workspace dependencies resolve.
COPY . .

# Install dependencies without lifecycle side effects.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build
WORKDIR /app/apps/web
RUN pnpm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy standalone build
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Use non-root user
USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["node", "apps/web/server.js"]
