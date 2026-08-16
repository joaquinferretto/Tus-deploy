export default function HomePage() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Production Turborepo Boilerplate</h1>
      <p>Next.js 15 + React 19 + Zustand + React Query</p>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>Stack Overview</h2>
        <ul>
          <li><strong>Frontend:</strong> Next.js 15 (App Router) + React 19</li>
          <li><strong>State Management:</strong> Zustand 5</li>
          <li><strong>Data Fetching:</strong> React Query (TanStack Query)</li>
          <li><strong>Backend:</strong> Express + TypeScript + Cluster mode</li>
          <li><strong>Database:</strong> PostgreSQL (Prisma + pg-pool) + MongoDB + Redis</li>
        </ul>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Quick Start</h2>
        <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px' }}>
{`pnpm install
make up
pnpm --filter web dev`}
        </pre>
      </div>
    </main>
  )
}
