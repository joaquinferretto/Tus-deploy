# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy the workspace with a root build context so workspace dependencies resolve.
COPY . .

# Install dependencies without lifecycle side effects.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate Prisma client
WORKDIR /app/apps/api
RUN pnpm prisma generate

# Build
RUN pnpm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Use non-root user
USER node

EXPOSE 3001

ENV NODE_ENV=production

WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
