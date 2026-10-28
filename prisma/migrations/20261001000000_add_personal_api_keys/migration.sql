CREATE TABLE "UserApiKey" (
    "id" TEXT NOT NULL,
    "userUid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserApiKey_tokenHash_key" ON "UserApiKey"("tokenHash");
CREATE INDEX "UserApiKey_userUid_createdAt_idx" ON "UserApiKey"("userUid", "createdAt");

ALTER TABLE "UserApiKey"
ADD CONSTRAINT "UserApiKey_userUid_fkey"
FOREIGN KEY ("userUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
