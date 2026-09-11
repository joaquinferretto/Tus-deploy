-- Forward-only live schema conformance repair.
-- The launch and POS markers are prerequisites. Historical migrations are never replayed.

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20260909090000_tus_argentina_market_launch') <> 1
    OR (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20260911120000_tus_pos_index_constraint_repair') <> 1
  THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-prerequisite-marker-mismatch';
  END IF;
  IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "migration_name" = '20260911130000_tus_live_schema_conformance_repair') > 1 THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-marker-duplicate';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TusSubscriptionPlan') THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-table-missing';
  END IF;
  IF EXISTS (SELECT 1 FROM "TusSubscriptionPlan") THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-money-table-not-empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TusSubscriptionPlan' AND column_name = 'amountMinor'
  ) THEN
    ALTER TABLE "TusSubscriptionPlan" ADD COLUMN "amountMinor" BIGINT NOT NULL;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TusSubscriptionPlan' AND column_name = 'amountMinor'
      AND (udt_name <> 'int8' OR is_nullable <> 'NO' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-money-column-mismatch';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TusBillingRefund') THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-table-missing';
  END IF;
  IF EXISTS (SELECT 1 FROM "TusBillingRefund") THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-money-table-not-empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TusBillingRefund' AND column_name = 'amountMinor'
  ) THEN
    ALTER TABLE "TusBillingRefund" ADD COLUMN "amountMinor" BIGINT NOT NULL;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TusBillingRefund' AND column_name = 'amountMinor'
      AND (udt_name <> 'int8' OR is_nullable <> 'NO' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-money-column-mismatch';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TusBillingLedger') THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-table-missing';
  END IF;
  IF EXISTS (SELECT 1 FROM "TusBillingLedger") THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-money-table-not-empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TusBillingLedger' AND column_name = 'amountMinor'
  ) THEN
    ALTER TABLE "TusBillingLedger" ADD COLUMN "amountMinor" BIGINT NOT NULL;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TusBillingLedger' AND column_name = 'amountMinor'
      AND (udt_name <> 'int8' OR is_nullable <> 'NO' OR column_default IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'tus-live-schema-conformance-money-column-mismatch';
  END IF;
END $$;

DO $$
DECLARE
  definition RECORD;
  existing_primary_key TEXT[];
BEGIN
  FOR definition IN
    SELECT * FROM (VALUES
      ('TusBillingAccount', 'TusBillingAccount_pkey'),
      ('TusSubscriptionPlan', 'TusSubscriptionPlan_pkey'),
      ('TusBillingRefund', 'TusBillingRefund_pkey'),
      ('TusBillingLedger', 'TusBillingLedger_pkey'),
      ('TusBillingIdempotency', 'TusBillingIdempotency_pkey'),
      ('TusBillingAudit', 'TusBillingAudit_pkey'),
      ('TusBillingOutbox', 'TusBillingOutbox_pkey'),
      ('TusBillingDunning', 'TusBillingDunning_pkey'),
      ('TusBillingNumberSequence', 'TusBillingNumberSequence_pkey'),
      ('TusAccountingExport', 'TusAccountingExport_pkey')
    ) AS primary_key_definitions(table_name, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = definition.table_name
    ) THEN
      RAISE EXCEPTION 'tus-live-schema-conformance-table-missing';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = definition.table_name AND column_name = 'id'
    ) THEN
      RAISE EXCEPTION 'tus-live-schema-conformance-id-column-missing';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = definition.table_name AND column_name = 'id'
        AND (udt_name <> 'text' OR is_nullable <> 'NO' OR column_default IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'tus-live-schema-conformance-id-column-mismatch';
    END IF;
    EXECUTE format(
      'SELECT ARRAY[COUNT(*)::text, COUNT("id")::text, COUNT(DISTINCT "id")::text] FROM %I',
      definition.table_name
    ) INTO existing_primary_key;
    IF existing_primary_key[1] <> existing_primary_key[2] OR existing_primary_key[1] <> existing_primary_key[3] THEN
      RAISE EXCEPTION 'tus-live-schema-conformance-id-aggregate-mismatch';
    END IF;
    SELECT array_agg(kcu.column_name ORDER BY kcu.ordinal_position)
      INTO existing_primary_key
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_name = tc.table_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = definition.table_name
      AND tc.constraint_type = 'PRIMARY KEY';
    IF existing_primary_key IS NULL THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY ("id")', definition.table_name, definition.constraint_name);
    ELSIF existing_primary_key <> ARRAY['id']::TEXT[] THEN
      RAISE EXCEPTION 'tus-live-schema-conformance-primary-key-mismatch';
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  definition RECORD;
  canonical_exact BOOLEAN;
BEGIN
  FOR definition IN
    SELECT * FROM (VALUES
      ('TusDeliveryZone_tenantId_active_idx', 'TusDeliveryZone', ARRAY['tenantId', 'active']::TEXT[], 'tus_lscr_legacy_01'),
      ('TusDeliveryShift_tenantId_zoneId_status_idx', 'TusDeliveryShift', ARRAY['tenantId', 'zoneId', 'status']::TEXT[], 'tus_lscr_legacy_02'),
      ('TusDeliveryTask_tenantId_shiftId_status_idx', 'TusDeliveryTask', ARRAY['tenantId', 'shiftId', 'status']::TEXT[], 'tus_lscr_legacy_03'),
      ('TusDeliveryTask_tenantId_commitmentId_status_idx', 'TusDeliveryTask', ARRAY['tenantId', 'commitmentId', 'status']::TEXT[], 'tus_lscr_legacy_04'),
      ('TusDeliveryIncident_tenantId_taskId_status_idx', 'TusDeliveryIncident', ARRAY['tenantId', 'taskId', 'status']::TEXT[], 'tus_lscr_legacy_05'),
      ('TusPosOperation_tenantId_context_kind_idx', 'TusPosOperation', ARRAY['tenantId', 'context', 'kind']::TEXT[], 'tus_lscr_legacy_06'),
      ('TusPosDevice_tenantId_status_idx', 'TusPosDevice', ARRAY['tenantId', 'status']::TEXT[], 'tus_lscr_legacy_07'),
      ('TusPosSession_tenantId_deviceId_shiftId_status_idx', 'TusPosSession', ARRAY['tenantId', 'deviceId', 'shiftId', 'status']::TEXT[], 'tus_lscr_legacy_08'),
      ('TusPosConflict_tenantId_operationId_status_idx', 'TusPosConflict', ARRAY['tenantId', 'operationId', 'status']::TEXT[], 'tus_lscr_legacy_09'),
      ('TusPosConflict_tenantId_status_createdAt_idx', 'TusPosConflict', ARRAY['tenantId', 'status', 'createdAt']::TEXT[], 'tus_lscr_legacy_10'),
      ('TusPosVersion_tenantId_shiftId_version_idx', 'TusPosVersion', ARRAY['tenantId', 'shiftId', 'version']::TEXT[], 'tus_lscr_legacy_11'),
      ('TusDeliveryOutbox_tenantId_status_createdAt_idx', 'TusDeliveryOutbox', ARRAY['tenantId', 'status', 'createdAt']::TEXT[], 'tus_lscr_legacy_12'),
      ('TusPosOutbox_tenantId_status_createdAt_idx', 'TusPosOutbox', ARRAY['tenantId', 'status', 'createdAt']::TEXT[], 'tus_lscr_legacy_13'),
      ('TusPosOutbox_tenantId_aggregateId_status_idx', 'TusPosOutbox', ARRAY['tenantId', 'aggregateId', 'status']::TEXT[], 'tus_lscr_legacy_14')
    ) AS index_definitions(index_name, table_name, index_columns, legacy_alias)
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_class index_relation
      JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
      JOIN pg_index catalog_index ON catalog_index.indexrelid = index_relation.oid
      JOIN pg_class indexed_table ON indexed_table.oid = catalog_index.indrelid
      WHERE index_schema.nspname = 'public'
        AND indexed_table.relnamespace = index_schema.oid
        AND index_relation.relname = definition.index_name
        AND indexed_table.relname = definition.table_name
        AND catalog_index.indisunique = FALSE
        AND catalog_index.indpred IS NULL
        AND ARRAY(
          SELECT attribute.attname
          FROM unnest(catalog_index.indkey) WITH ORDINALITY AS key_columns(attnum, ordinal_position)
          JOIN pg_attribute attribute ON attribute.attrelid = catalog_index.indrelid AND attribute.attnum = key_columns.attnum
          ORDER BY key_columns.ordinal_position
        ) = definition.index_columns
    ) INTO canonical_exact;
    IF canonical_exact THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class relation
      JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
      WHERE relation_schema.nspname = 'public' AND relation.relname = definition.legacy_alias
    ) THEN
      RAISE EXCEPTION 'tus-live-schema-conformance-index-alias-collision';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class relation
      JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
      WHERE relation_schema.nspname = 'public' AND relation.relname = definition.index_name
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class relation
        JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
        JOIN pg_index catalog_index ON catalog_index.indexrelid = relation.oid
        JOIN pg_class indexed_table ON indexed_table.oid = catalog_index.indrelid
        WHERE relation_schema.nspname = 'public'
          AND relation.relname = definition.index_name
          AND indexed_table.relname = definition.table_name
      ) THEN
        RAISE EXCEPTION 'tus-live-schema-conformance-index-table-collision';
      END IF;
      EXECUTE format('ALTER INDEX %I RENAME TO %I', definition.index_name, definition.legacy_alias);
    END IF;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (%s)',
      definition.index_name,
      definition.table_name,
      (SELECT string_agg(format('%I', column_name), ', ') FROM unnest(definition.index_columns) AS column_name)
    );
  END LOOP;
END $$;

INSERT INTO "_prisma_migrations" (
  "id", "checksum", "finished_at", "migration_name", "logs",
  "rolled_back_at", "started_at", "applied_steps_count"
)
SELECT
  'tus-live-schema-conformance-repair-marker',
  'live-schema-conformance-repair-checksum',
  CURRENT_TIMESTAMP,
  '20260911130000_tus_live_schema_conformance_repair',
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE "migration_name" = '20260911130000_tus_live_schema_conformance_repair'
);
