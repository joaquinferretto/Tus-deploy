# Production-Ready Turborepo Monorepo

A production-ready Turborepo monorepo boilerplate featuring Next.js 15, Express backend with Node.js cluster mode, and a hybrid database strategy (PostgreSQL + MongoDB + Redis). Built with security-first principles and designed for 100K+ concurrent users.

## Tech Stack

**Monorepo Tooling:**
- Turborepo 1.12+ (build orchestration with caching)
- pnpm 9+ (efficient package management)

**Frontend (`apps/web`):**
- Next.js 15 (App Router)
- React 19
- Zustand 5 (state management)
- React Query 5 (server state & caching)
- TypeScript 5.3+

**Backend (`apps/api`):**
- Node.js 20+ with Cluster mode (horizontal scaling)
- Express 4.18+ (REST API)
- TypeScript 5.3+
- Clean/Hexagonal Architecture

**Database Strategy:**
- **PostgreSQL**: Prisma (ORM) + pg-pool (raw SQL for performance-critical queries)
- **MongoDB**: Mongoose (document store)
- **Redis**: ioredis (caching + rate limiting)

**Security & Resilience:**
- Helmet (HTTP security headers)
- express-rate-limit with Redis backend
- Zod (schema validation)
- opossum (Circuit Breaker pattern)
- CORS (restrictive, environment-based)
- Trufflehog (secret scanning)
- eslint-plugin-security (SAST)

**Deployment:**
- Frontend: Vercel (recommended)
- Backend: Render / Railway (containerized)
- Database: Railway / Supabase

## Prerequisites

- **Docker** 24+ and **Docker Compose** 2+
- **Node.js** 20+
- **pnpm** 9+

## Quick Start

### 1. Clone and Setup
```bash
git clone <repo-url>
cd output-boilerplate
cp .env.example .env
```

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Start Development Environment
```bash
make up
```

This starts:
- PostgreSQL at `localhost:5432`
- MongoDB at `localhost:27017`
- Redis at `localhost:6379`
- Backend API at `http://localhost:3101`

### 4. Start Frontend
```bash
pnpm --filter @factory/web dev
```

Frontend will be available at `http://localhost:3000`.

### 5. Run Tests
```bash
make test
```

### 6. Run Security Checks
```bash
make secure
```

## Project Structure

```
output-boilerplate/
├── apps/
│   ├── web/                    # Next.js 15 frontend
│   └── api/                    # Express backend (Clean Architecture)
├── packages/
│   ├── eslint-config/          # Shared ESLint configuration
│   ├── typescript-config/      # Shared TypeScript configuration
│   └── zod-schemas/            # Shared validation schemas (E2E type safety)
├── turbo.json                  # Turborepo pipeline config
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Makefile
├── README.md
├── ARCHITECTURE.md
└── .ai-manifest.md
```

## Available Commands

```bash
make help        # Show all available commands
make install     # Install dependencies
make up          # Start development environment
make down        # Stop development environment
make test        # Run all tests
make lint        # Run linters
make secure      # Run security checks (secrets + audit)
make clean       # Clean up (removes volumes and node_modules)
```

## Development Workflow

1. Make changes to code
2. Run `make test` to ensure tests pass
3. Run `make lint` to check code quality
4. Run `make secure` before committing to scan for vulnerabilities
5. Commit and push (CI will run additional security checks)

## Deployment

### Frontend (Vercel)
1. Push to GitHub
2. Connect repository to Vercel
3. In Vercel Project Settings, set the production and preview `NEXT_PUBLIC_API_URL` to the deployed API URL. `vercel.json` intentionally carries no URL or secret.
4. Deploy

### Backend (Render)
1. Push to GitHub
2. Create a new Web Service on Render
3. Use the checked-in build command: `pnpm install --frozen-lockfile && pnpm --filter @factory/api build`
4. Use the checked-in pre-deploy migration: `pnpm --filter @factory/api prisma:migrate:deploy`, then start with `pnpm --filter @factory/api start`
5. Add environment variables: `DATABASE_URL`, `MONGODB_URL` (the `MONGODB_URI` compatibility alias is accepted only by the API adapter), `REDIS_URL`, `CORS_ORIGINS`

### Database (Railway)
1. Create PostgreSQL, MongoDB, and Redis services
2. Copy connection strings to your environment variables

## Security Features

✅ **Non-root containers**: All Dockerfiles use unprivileged users  
✅ **Secret scanning**: Trufflehog integration in CI  
✅ **SAST**: ESLint Security plugin for static analysis  
✅ **Dependency auditing**: Automated npm audit in CI  
✅ **Rate limiting**: Redis-backed rate limiting per IP  
✅ **CORS**: Restrictive, environment-based origins  
✅ **Helmet**: HTTP security headers  
✅ **Circuit Breaker**: Fault tolerance for external services  

## Health Checks

- `GET /health` - Basic liveness check
- `GET /ready` - Readiness check (validates DB connections)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

## AI Context

See [.ai-manifest.md](.ai-manifest.md) for AI-readable context about this codebase.

## License

MIT
