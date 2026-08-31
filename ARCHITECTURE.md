# Architecture Documentation

## Overview

This monorepo follows **Clean Architecture** (also known as Hexagonal Architecture or Ports & Adapters) in the backend, with a modern React frontend optimized for performance and scalability.

## Architectural Principles

1. **Dependency Inversion**: Inner layers (Domain) do NOT depend on outer layers (Infrastructure).
2. **Testability**: Business logic is isolated and testable without external dependencies.
3. **Flexibility**: Swap databases, frameworks, or APIs without changing business logic.
4. **Separation of Concerns**: Each layer has a single, well-defined responsibility.

## Monorepo Structure

### Apps

- **`apps/web`**: Next.js 15 frontend with App Router, React 19, Zustand, and React Query
- **`apps/api`**: Express backend with TypeScript, Clean Architecture, and Node.js cluster mode

### Packages (Shared Code)

- **`@repo/eslint-config`**: Shared ESLint configuration for security and code quality
- **`@repo/typescript-config`**: Shared TypeScript compiler configurations (base, Next.js, Node.js)
- **`@repo/zod-schemas`**: Shared validation schemas for end-to-end type safety

## Frontend Architecture (`apps/web`)

### Technology Choices

- **Next.js 15 (App Router)**: Server Components, streaming SSR, optimized performance
- **React 19**: Latest features including improved hydration and concurrent rendering
- **Zustand 5**: Lightweight state management (no boilerplate, devtools integration)
- **React Query 5**: Server state management with automatic caching, refetching, and background updates

### Directory Structure

```
apps/web/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout with providers
│   │   └── page.tsx            # Home page
│   ├── components/             # Reusable React components
│   ├── lib/                    # Utilities
│   │   ├── api-client.ts       # Typed API client with Zod validation
│   │   └── query-client.tsx    # React Query configuration
│   └── store/                  # Zustand stores
│       └── example-store.ts    # Example store structure
├── public/                     # Static assets
├── next.config.js              # Next.js configuration
└── Dockerfile                  # Production deployment
```

### State Management Strategy

- **Local UI State**: Zustand stores (modals, forms, UI toggles)
- **Server State**: React Query (API data, caching, mutations)
- **URL State**: Next.js router for navigation and shareable state

### API Communication

All API calls use the `apiClient` utility which:
1. Handles timeout logic
2. Parses responses with Zod schemas for type safety
3. Provides consistent error handling
4. Automatically includes headers (Content-Type, Authorization)

## Backend Architecture (`apps/api`)

### Clean Architecture Layers

```
apps/api/
├── src/
│   ├── index.ts                # Entry point (Cluster mode setup)
│   ├── server.ts               # Express app setup
│   ├── domain/                 # Domain Layer (Business Logic)
│   │   ├── entities/           # Core business entities
│   │   └── repositories/       # Repository interfaces (ports)
│   ├── application/            # Application Layer (Use Cases)
│   │   └── usecases/           # Business use cases
│   ├── infrastructure/         # Infrastructure Layer (Adapters)
│   │   ├── database/
│   │   │   ├── prisma/         # Prisma client + migrations
│   │   │   ├── postgres/       # pg-pool for raw SQL
│   │   │   ├── mongodb/        # Mongoose connection
│   │   │   └── redis/          # ioredis client
│   │   └── config/             # Configuration loaders
│   └── presentation/           # Presentation Layer (HTTP)
│       ├── http/               # Controllers
│       ├── middleware/         # Security, rate limiting, CORS
│       └── routes/             # Route definitions
└── prisma/
    └── schema.prisma           # Prisma schema
```

### Layer Responsibilities

#### 1. Domain Layer (`domain/`)

**Purpose**: Core business logic and entities.

**Contains**:
- `entities/`: Business entities (e.g., User, Order, Product)
- `repositories/`: Repository interfaces (ports)

**Dependencies**: NONE. This layer is pure business logic.

**Example**:
```typescript
// Repository interface (port)
export interface UserRepository {
  findById(id: string): Promise<User | null>
  save(user: User): Promise<void>
}
```

#### 2. Application Layer (`application/`)

**Purpose**: Use cases and application workflows.

**Contains**:
- `usecases/`: Business use cases (e.g., CreateUser, ProcessOrder)

**Dependencies**: Domain Layer only.

**Example**:
```typescript
export class CreateUserUseCase {
  constructor(private userRepo: UserRepository) {}
  
  async execute(input: CreateUserDTO): Promise<void> {
    const user = new User(input.name, input.email)
    await this.userRepo.save(user)
  }
}
```

#### 3. Infrastructure Layer (`infrastructure/`)

**Purpose**: Adapters for external systems.

**Contains**:
- `database/`: Database implementations (PostgreSQL, MongoDB, Redis)
- `config/`: Configuration loading

**Dependencies**: Domain Layer (implements repository interfaces).

**Example**:
```typescript
// PostgreSQL adapter implementing UserRepository
export class PostgresUserRepository implements UserRepository {
  constructor(private pool: Pool) {}
  
  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id])
    // Map to domain entity
  }
}
```

#### 4. Presentation Layer (`presentation/`)

**Purpose**: HTTP handlers and routing.

**Contains**:
- `http/`: HTTP handlers/controllers
- `middleware/`: Authentication, logging, rate limiting
- `routes/`: Route definitions

**Dependencies**: Application Layer (calls use cases).

**Example**:
```typescript
export function createUserHandler(createUserUseCase: CreateUserUseCase) {
  return async (req: Request, res: Response) => {
    const input = parseCreateUserDTO(req.body)
    await createUserUseCase.execute(input)
    res.status(201).json({ message: 'User created' })
  }
}
```

### Dependency Flow

```
Presentation → Application → Domain ← Infrastructure
                                ↑
                          (implements ports)
```

### Scaling Strategy

#### Node.js Cluster Mode

The backend uses Node.js cluster mode to leverage all CPU cores:

```typescript
if (cluster.isPrimary) {
  // Fork workers (one per CPU core)
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork()
  }
} else {
  // Workers share TCP connection
  startServer()
}
```

**Benefits**:
- Horizontal scaling within a single instance
- Automatic worker restart on crash
- Production: Uses all CPU cores
- Development: Single worker for easier debugging

#### Horizontal Scaling

For 100K+ users:
1. **Load Balancer** (e.g., NGINX, AWS ALB) distributes traffic
2. **Multiple API instances** (containers/VMs) run independently
3. **Redis** provides shared rate limiting and session state
4. **PostgreSQL + MongoDB** scale independently

## Database Strategy

### Hybrid Approach

1. **PostgreSQL (Prisma + pg-pool)**:
   - ACID transactions
   - Complex relational queries
   - ORM for migrations and simple queries
   - Raw SQL (pg-pool) for performance-critical queries

2. **MongoDB (Mongoose)**:
   - Document storage
   - Flexible schemas
   - High-write workloads

3. **Redis (ioredis)**:
   - Caching
   - Rate limiting
   - Session storage

### When to Use Each

| Use Case | Database |
|----------|----------|
| User accounts, authentication | PostgreSQL |
| Financial transactions | PostgreSQL |
| Analytics events, logs | MongoDB |
| User-generated content (flexible schema) | MongoDB |
| API rate limiting | Redis |
| Session storage | Redis |
| Caching expensive queries | Redis |

## Security Measures

### 1. Non-Root Containers
All Dockerfiles run as unprivileged users:
- Frontend: `USER node`
- Backend: `USER node`

### 2. SAST (Static Analysis)
- `eslint-plugin-security` scans code for vulnerabilities
- CI fails on security warnings

### 3. Secret Scanning
- Trufflehog scans git history for leaked credentials
- Runs on every PR and push

### 4. Dependency Auditing
- `pnpm audit` checks for known CVEs in dependencies
- CI fails on moderate+ severity vulnerabilities

### 5. HTTP Security Headers (Helmet)
```typescript
helmet({
  contentSecurityPolicy: true,
  hsts: { maxAge: 31536000 },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
})
```

### 6. Rate Limiting
- Redis-backed rate limiting: 100 requests per 15 minutes per IP
- Configurable per route

### 7. CORS
- Restrictive origin policy (environment-based)
- Credentials support for authenticated requests

### 8. Circuit Breaker
- `opossum` library wraps external service calls
- Opens circuit after 50% failure threshold
- Prevents cascading failures

## Testing Strategy

### Unit Tests
- Domain entities and use cases in isolation
- Mock repositories for fast execution
- Example: Test business rules without database

### Integration Tests
- Infrastructure adapters with real databases
- Use Testcontainers for isolated environments
- Example: Test PostgreSQL repository implementation

### E2E Tests
- Complete workflows via HTTP endpoints
- Test API → Use Case → Database flow
- Example: POST /users → verify in database

## Configuration Management

Environment variables are loaded from `.env` (local) or injected by orchestration platform (Kubernetes secrets).

**Required Variables**:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
MONGODB_URL=mongodb://host:27017/db
REDIS_URL=redis://host:6379
CORS_ORIGINS=http://localhost:3000,https://app.example.com
API_PORT=3101
NODE_ENV=production
```

## Deployment Architecture

### Recommended Setup

```
Internet
   ↓
Load Balancer (NGINX / AWS ALB)
   ↓
Frontend (Vercel / Cloudflare Pages)
   ↓ API Calls
Load Balancer
   ↓
Backend Instances (Render / Railway / K8s)
   ↓
PostgreSQL (Railway / Supabase)
MongoDB (MongoDB Atlas)
Redis (Upstash / Redis Labs)
```

### Health Checks

- `GET /health`: Returns 200 if server is running
- `GET /ready`: Returns 200 if all database connections are healthy

Load balancers should use `/ready` for routing decisions.

## Performance Optimizations

### Frontend
- Server Components for faster initial load
- React Query for automatic background refetching
- Zustand for minimal re-renders

### Backend
- Cluster mode for CPU-bound operations
- pg-pool for connection pooling
- Redis caching for expensive queries
- Circuit breaker to fail fast

## Future Enhancements

- [ ] Add authentication (JWT + refresh tokens)
- [ ] Implement event sourcing for audit trails
- [ ] Add GraphQL API layer
- [ ] Implement CQRS pattern for read-heavy workloads
- [ ] Add observability (OpenTelemetry, Datadog)
- [ ] Implement blue-green deployments
