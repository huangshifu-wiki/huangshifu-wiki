export type ContentStatus = 'draft' | 'pending' | 'published' | 'rejected';

export const getStatusClassName = (status?: ContentStatus): string => {
  if (status === 'published') return 'theme-status-success';
  if (status === 'pending') return 'theme-status-warning';
  if (status === 'rejected') return 'theme-status-error';
  return 'bg-surface-alt text-text-muted';
};

export const splitTagsInput = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const getStatusText = (status?: ContentStatus): string => {
  if (status === 'pending') return '待审核';
  if (status === 'rejected') return '已驳回';
  if (status === 'draft') return '草稿';
  return '已发布';
};
