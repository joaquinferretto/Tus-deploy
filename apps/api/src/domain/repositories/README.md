# Domain Repositories

Repository interfaces (ports) go here.

Example:
```typescript
export interface UserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  save(user: User): Promise<void>
  delete(id: string): Promise<void>
}
```

**Important**: These are interfaces only. Implementations go in `infrastructure/database/`.
