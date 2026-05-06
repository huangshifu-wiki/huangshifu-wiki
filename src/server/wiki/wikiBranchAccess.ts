import type { ApiUser } from '../types';

type WikiBranchAccessInput = {
  editorUid: string;
};

type WikiBranchViewer = Pick<ApiUser, 'uid' | 'role'>;

export function canViewWikiBranchContent(branch: WikiBranchAccessInput, authUser?: WikiBranchViewer | null) {
  if (!authUser) return false;
  if (authUser.role === 'admin' || authUser.role === 'super_admin') return true;
  return branch.editorUid === authUser.uid;
}
