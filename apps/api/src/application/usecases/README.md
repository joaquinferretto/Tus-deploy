# Application Use Cases

Business use cases go here.

Example:
```typescript
export class CreateUserUseCase {
  constructor(private userRepo: UserRepository) {}

  async execute(input: CreateUserDTO): Promise<User> {
    // Check if user already exists
    const existing = await this.userRepo.findByEmail(input.email)
    if (existing) {
      throw new Error('User with this email already exists')
    }

    // Create user entity
    const user = new User(
      generateUUID(),
      input.name,
      input.email
    )

    // Persist
    await this.userRepo.save(user)

    return user
  }
}
```
