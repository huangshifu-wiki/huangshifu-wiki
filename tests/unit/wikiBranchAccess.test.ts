import { describe, expect, it } from 'vitest';

import { canViewWikiBranchContent } from '../../src/server/wiki/wikiBranchAccess';

type BranchViewer = NonNullable<Parameters<typeof canViewWikiBranchContent>[1]>;

function createViewer(overrides?: Partial<BranchViewer>): BranchViewer {
  return {
    uid: 'viewer_uid',
    role: 'user',
    ...overrides,
  } as BranchViewer;
}

describe('wikiBranchAccess', () => {
  it('allows admins to view branch content', () => {
    const branch = { editorUid: 'author_uid' };

    expect(canViewWikiBranchContent(branch, createViewer({ role: 'admin' }))).toBe(true);
    expect(canViewWikiBranchContent(branch, createViewer({ role: 'super_admin' }))).toBe(true);
  });

  it('allows the branch editor to view branch content', () => {
    const branch = { editorUid: 'author_uid' };

    expect(canViewWikiBranchContent(branch, createViewer({ uid: 'author_uid' }))).toBe(true);
  });

  it('rejects unrelated users even when the branch is under review or conflicted', () => {
    const pendingReviewBranch = { editorUid: 'author_uid', status: 'pending_review' };
    const conflictedBranch = { editorUid: 'author_uid', status: 'conflict' };

    expect(canViewWikiBranchContent(pendingReviewBranch, createViewer({ uid: 'other_uid' }))).toBe(false);
    expect(canViewWikiBranchContent(conflictedBranch, createViewer({ uid: 'other_uid' }))).toBe(false);
  });

  it('rejects unauthenticated users', () => {
    expect(canViewWikiBranchContent({ editorUid: 'author_uid' }, null)).toBe(false);
  });
});
