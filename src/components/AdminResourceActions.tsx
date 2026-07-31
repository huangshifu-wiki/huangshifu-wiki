import { Edit3, Image as ImageIcon, List, RotateCcw, Trash2 } from '@/src/components/icons'
import { Button } from '@/src/components/ui'

export type AdminResourcePendingAction = 'delete' | 'restore' | 'permanentDelete' | null

export interface AdminResourceActionsProps {
  isDeleted: boolean
  pendingAction: AdminResourcePendingAction
  onEdit?: () => void
  onManage?: () => void
  onCover?: () => void
  onDelete: () => void
  onRestore: () => void
  onPermanentDelete: () => void
}

export const AdminResourceActions = ({
  isDeleted,
  pendingAction,
  onEdit,
  onManage,
  onCover,
  onDelete,
  onRestore,
  onPermanentDelete,
}: AdminResourceActionsProps) => {
  if (pendingAction) {
    return (
      <Button variant={pendingAction === 'restore' ? 'success' : 'danger'} soft size="sm" loading>
        {pendingAction === 'delete'
          ? '删除中...'
          : pendingAction === 'restore'
            ? '恢复中...'
            : '永久删除中...'}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isDeleted && onEdit && (
        <Button variant="warning" soft size="sm" onClick={onEdit} leftIcon={<Edit3 size={14} />}>
          编辑
        </Button>
      )}
      {!isDeleted && onManage && (
        <Button variant="warning" soft size="sm" onClick={onManage} leftIcon={<List size={14} />}>
          管理
        </Button>
      )}
      {!isDeleted && onCover && (
        <Button
          variant="warning"
          soft
          size="sm"
          onClick={onCover}
          leftIcon={<ImageIcon size={14} />}
        >
          封面
        </Button>
      )}
      {isDeleted ? (
        <>
          <Button
            variant="success"
            soft
            size="sm"
            onClick={onRestore}
            leftIcon={<RotateCcw size={14} />}
          >
            恢复
          </Button>
          <Button
            variant="danger"
            soft
            size="sm"
            onClick={onPermanentDelete}
            leftIcon={<Trash2 size={14} />}
          >
            永久删除
          </Button>
        </>
      ) : (
        <Button variant="danger" soft size="sm" onClick={onDelete} leftIcon={<Trash2 size={14} />}>
          删除
        </Button>
      )}
    </div>
  )
}

export default AdminResourceActions
