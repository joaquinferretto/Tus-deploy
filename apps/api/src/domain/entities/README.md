# Domain Entities

Core business entities go here.

Example:
```typescript
export class User {
  constructor(
    public readonly id: string,
    public name: string,
    public email: string
  ) {}

  updateEmail(newEmail: string): void {
    // Business validation logic
    if (!this.isValidEmail(newEmail)) {
      throw new Error('Invalid email format')
    }
    this.email = newEmail
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
}
```
