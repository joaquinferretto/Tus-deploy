import {
  createSqlCommand,
  SQL_OPERATION,
  TENANT_AUTHORIZATION_PREDICATE,
  type SqlCommand,
  type SqlExecutor,
  type TenantSqlScope,
} from './contracts.js'
import type { HotPathRecord } from './fake.js'

export interface GeospatialInput {
  scope: TenantSqlScope
  latitude: number
  longitude: number
  radiusKm: number
}

export interface GeospatialResult extends HotPathRecord {
  distanceKm: number
}

export function buildGeospatialQuery(input: GeospatialInput): SqlCommand<GeospatialResult> {
  if (
    ![input.latitude, input.longitude, input.radiusKm].every(Number.isFinite) ||
    input.radiusKm <= 0
  ) {
    throw new Error('Geospatial coordinates and radius must be finite')
  }
  const text = `
    SELECT "id", "tenantId", "resourceId", "category", "text", "latitude", "longitude", "amount", "available", "updatedAt",
           ST_Distance(
             "location",
             ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
           ) / 1000 AS "distanceKm"
    FROM "Inventory"
    WHERE ${TENANT_AUTHORIZATION_PREDICATE}
      AND ST_DWithin("location", ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5 * 1000)
    ORDER BY "distanceKm" ASC, "id" ASC`
  return createSqlCommand(SQL_OPERATION.GEOSPATIAL, text, input.scope, [
    input.longitude,
    input.latitude,
    input.radiusKm,
  ])
}

export interface SqlGeospatialPort {
  nearby(input: GeospatialInput): Promise<readonly GeospatialResult[]>
}

export class PostgresGeospatialAdapter implements SqlGeospatialPort {
  constructor(private readonly executor: SqlExecutor) {}

  async nearby(input: GeospatialInput): Promise<readonly GeospatialResult[]> {
    const result = await this.executor.query<GeospatialResult>(buildGeospatialQuery(input))
    return result.rows
  }
}

export default { PostgresGeospatialAdapter, buildGeospatialQuery }
