-- Add actual reply target and persistent likes for post/gallery comments
ALTER TABLE "PostComment" ADD COLUMN "replyToId" TEXT;

CREATE TABLE "PostCommentLike" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userUid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostCommentLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostCommentLike_commentId_userUid_key" ON "PostCommentLike"("commentId", "userUid");
CREATE INDEX "PostCommentLike_userUid_commentId_idx" ON "PostCommentLike"("userUid", "commentId");
CREATE INDEX "PostCommentLike_userUid_createdAt_idx" ON "PostCommentLike"("userUid", "createdAt");
CREATE INDEX "PostComment_replyToId_idx" ON "PostComment"("replyToId");

ALTER TABLE "PostCommentLike" ADD CONSTRAINT "PostCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostCommentLike" ADD CONSTRAINT "PostCommentLike_userUid_fkey" FOREIGN KEY ("userUid") REFERENCES "User"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "PostComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
