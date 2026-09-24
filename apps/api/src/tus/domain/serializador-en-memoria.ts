// Cerrojo serial para adaptadores en memoria. WEB-08I: la composicion en memoria comparte una
// instancia entre las transacciones de Trabajo y de calendario para que vincular una reserva a un
// trabajo y cancelarla desde calendario nunca se intercalen (en PostgreSQL lo resuelve el lock de
// fila sobre `reservas` dentro de transacciones Serializable).
export class SerializadorEnMemoria {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
