import React from 'react'

import {
  Edit3,
  Image as ImageIcon,
  List,
  RefreshCw,
  RotateCcw,
  Trash2,
} from '@/src/components/icons'
import {
  DANGER_BUTTON_CLASSES,
  SUCCESS_BUTTON_CLASSES,
  WARNING_BUTTON_CLASSES,
} from '@/src/lib/buttonClasses'

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
      <button
        type="button"
        disabled
        className={pendingAction === 'restore' ? SUCCESS_BUTTON_CLASSES : DANGER_BUTTON_CLASSES}
      >
        <RefreshCw size={14} className="animate-spin" />
        {pendingAction === 'delete'
          ? '删除中...'
          : pendingAction === 'restore'
            ? '恢复中...'
            : '永久删除中...'}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isDeleted && onEdit && (
        <button type="button" onClick={onEdit} className={WARNING_BUTTON_CLASSES}>
          <Edit3 size={14} />
          编辑
        </button>
      )}
      {!isDeleted && onManage && (
        <button type="button" onClick={onManage} className={WARNING_BUTTON_CLASSES}>
          <List size={14} />
          管理
        </button>
      )}
      {!isDeleted && onCover && (
        <button type="button" onClick={onCover} className={WARNING_BUTTON_CLASSES}>
          <ImageIcon size={14} />
          封面
        </button>
      )}
      {isDeleted ? (
        <>
          <button type="button" onClick={onRestore} className={SUCCESS_BUTTON_CLASSES}>
            <RotateCcw size={14} />
            恢复
          </button>
          <button type="button" onClick={onPermanentDelete} className={DANGER_BUTTON_CLASSES}>
            <Trash2 size={14} />
            永久删除
          </button>
        </>
      ) : (
        <button type="button" onClick={onDelete} className={DANGER_BUTTON_CLASSES}>
          <Trash2 size={14} />
          删除
        </button>
      )}
    </div>
  )
}

export default AdminResourceActions
