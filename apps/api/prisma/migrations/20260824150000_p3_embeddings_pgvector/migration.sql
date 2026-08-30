CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "RagEmbedding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "indexVersion" TEXT NOT NULL,
    "vector" vector(1024) NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "sourceUri" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "chunkerVersion" TEXT NOT NULL,
    "retentionUntil" TIMESTAMP(3),
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RagEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RagEmbedding_tenantId_sourceId_chunkIndex_embeddingVersion_indexVersion_key"
  ON "RagEmbedding"("tenantId", "sourceId", "chunkIndex", "embeddingVersion", "indexVersion");
CREATE INDEX "RagEmbedding_tenantId_indexVersion_idx"
  ON "RagEmbedding"("tenantId", "indexVersion");
CREATE INDEX "RagEmbedding_tenantId_sourceId_idx"
  ON "RagEmbedding"("tenantId", "sourceId");
CREATE INDEX "RagEmbedding_vector_cosine_idx"
  ON "RagEmbedding" USING hnsw ("vector" vector_cosine_ops);

INSERT INTO "OwnershipRecord" ("id", "dataClass", "owner", "rebuildStrategy", "updatedAt")
VALUES (
  'ownership-rag-embeddings',
  'vectors_and_retrieval_metadata',
  'postgresql',
  'rebuild-from-b2-lineage',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("dataClass") DO UPDATE SET
  "owner" = EXCLUDED."owner",
  "rebuildStrategy" = EXCLUDED."rebuildStrategy",
  "updatedAt" = EXCLUDED."updatedAt";
