DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'EmbeddingStatus'
  ) THEN
    CREATE TYPE "EmbeddingStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "WikiImageEmbedding" (
  "id" TEXT NOT NULL,
  "wikiPageSlug" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "modelName" TEXT NOT NULL DEFAULT 'Xenova/clip-vit-base-patch32',
  "vectorSize" INTEGER NOT NULL DEFAULT 512,
  "status" "EmbeddingStatus" NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "embeddedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WikiImageEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PostImageEmbedding" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "modelName" TEXT NOT NULL DEFAULT 'Xenova/clip-vit-base-patch32',
  "vectorSize" INTEGER NOT NULL DEFAULT 512,
  "status" "EmbeddingStatus" NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "embeddedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PostImageEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TextEmbeddingChunk" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL DEFAULT 0,
  "chunkText" TEXT NOT NULL,
  "chunkPreview" TEXT,
  "modelName" TEXT NOT NULL DEFAULT 'OFA-Sys/chinese-clip-vit-base-patch16',
  "vectorSize" INTEGER NOT NULL DEFAULT 512,
  "status" "EmbeddingStatus" NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "qdrantPointId" TEXT,
  "embeddedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TextEmbeddingChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WikiImageEmbedding_wikiPageSlug_imageUrl_key"
  ON "WikiImageEmbedding"("wikiPageSlug", "imageUrl");

CREATE INDEX IF NOT EXISTS "WikiImageEmbedding_status_updatedAt_idx"
  ON "WikiImageEmbedding"("status", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PostImageEmbedding_postId_imageUrl_key"
  ON "PostImageEmbedding"("postId", "imageUrl");

CREATE INDEX IF NOT EXISTS "PostImageEmbedding_status_updatedAt_idx"
  ON "PostImageEmbedding"("status", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "TextEmbeddingChunk_sourceType_sourceId_chunkIndex_key"
  ON "TextEmbeddingChunk"("sourceType", "sourceId", "chunkIndex");

CREATE INDEX IF NOT EXISTS "TextEmbeddingChunk_sourceType_status_idx"
  ON "TextEmbeddingChunk"("sourceType", "status");
