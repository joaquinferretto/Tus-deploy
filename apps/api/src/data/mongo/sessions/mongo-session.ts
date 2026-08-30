export interface MongoSession {
  readonly id: string
  readonly supportsTransactions: boolean
}

export interface MongoSessionRunner {
  withSession<T>(operation: (session: MongoSession) => Promise<T>): Promise<T>
}
