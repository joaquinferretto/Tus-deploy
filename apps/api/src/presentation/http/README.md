# HTTP Controllers

HTTP request handlers go here.

Example:
```typescript
export class UserController {
  constructor(private createUserUseCase: CreateUserUseCase) {}

  async createUser(req: Request, res: Response): Promise<void> {
    try {
      // Validate input
      const input = createUserSchema.parse(req.body)

      // Execute use case
      const user = await this.createUserUseCase.execute(input)

      // Return response
      res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
      })
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.errors })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
}
```

**Important**: Keep controllers thin. All business logic belongs in use cases.
