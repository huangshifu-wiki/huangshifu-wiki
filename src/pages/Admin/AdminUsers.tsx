import React, { useEffect, useState } from 'react'
import {
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Pencil,
} from '@/src/components/icons'
import { clsx } from 'clsx'
import { CharacterCount } from '../../components/CharacterCount'
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPut,
  invalidateApiCacheByPrefix,
} from '../../lib/apiClient'
import { useDialog } from '../../components/Dialog'
import { useToast } from '../../components/Toast'
import { SmartImage } from '../../components/SmartImage'
import { useAuth } from '../../context/AuthContext'
import { DEFAULT_AVATAR } from '../../lib/defaultAvatar'
import { formatAdminRole } from '../../lib/formatUtils'
import { FormModal } from '../../components/Modal'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/passwordRules'
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_SIGNATURE_MAX_LENGTH,
  WIKI_MAX_CONTENT_SIZE,
} from '../../lib/contentLimits'
import type { AdminDataItem } from '../../types/entities'

const ADMIN_USERS_API_PREFIX = '/api/admin/users'

type AdminUserEditForm = {
  displayName: string
  email: string
  emailVerified: boolean
  signature: string
  bio: string
  newPassword: string
  confirmPassword: string
}

const EMPTY_EDIT_FORM: AdminUserEditForm = {
  displayName: '',
  email: '',
  emailVerified: false,
  signature: '',
  bio: '',
  newPassword: '',
  confirmPassword: '',
}

export const AdminUsers = () => {
  const { user: currentUser, profile } = useAuth()
  const isSuperAdmin = profile?.role === 'super_admin'
  const [data, setData] = useState<AdminDataItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editTarget, setEditTarget] = useState<AdminDataItem | null>(null)
  const [editForm, setEditForm] = useState<AdminUserEditForm>(EMPTY_EDIT_FORM)
  const [editLoading, setEditLoading] = useState(false)
  const dialog = useDialog()
  const { show } = useToast()

  const invalidateAdminUsersCache = () => invalidateApiCacheByPrefix(ADMIN_USERS_API_PREFIX)
  const isCurrentUser = (uid?: string) => Boolean(uid && uid === currentUser?.uid)

  const getNextRole = (role?: string) => (role === 'admin' ? 'user' : 'admin')
  const getRoleToggleTitle = (role?: string) =>
    getNextRole(role) === 'admin' ? '设为管理员' : '设为普通用户'

  const canManageUser = (target: AdminDataItem) => {
    if (!target.uid || isCurrentUser(target.uid)) {
      return false
    }

    if (isSuperAdmin) {
      return true
    }

    return target.role === 'user'
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await apiGet<{ data: AdminDataItem[] }>(ADMIN_USERS_API_PREFIX)
      setData(result.data || [])
    } catch (e) {
      console.error(e)
      setData([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const toggleBan = async (target: AdminDataItem) => {
    if (!canManageUser(target)) {
      show('当前权限不能管理该用户', { variant: 'error' })
      return
    }

    const shouldUnban = target.status === 'banned'
    const note = await dialog.prompt({
      title: shouldUnban ? '解封备注' : '封禁原因',
      message: shouldUnban ? '解封备注（可选）' : '封禁原因',
      defaultValue: shouldUnban ? '' : '违反社区规范',
      confirmText: '确认',
      variant: shouldUnban ? 'info' : 'warning',
      multiline: true,
    })
    if (note === null) return
    if (!shouldUnban && !note.trim()) {
      show('请输入封禁原因', { variant: 'error' })
      return
    }
    const confirmed = await dialog.confirm({
      title: shouldUnban ? '解封用户' : '封禁用户',
      message: `确定要${shouldUnban ? '解封' : '封禁'} ${target.displayName || target.uid} 吗？`,
      confirmText: shouldUnban ? '解封' : '封禁',
      variant: shouldUnban ? 'warning' : 'danger',
    })
    if (!confirmed) return
    try {
      const endpoint = shouldUnban
        ? `/api/users/${target.uid}/unban`
        : `/api/users/${target.uid}/ban`
      const result = await apiPut<{ user: AdminDataItem }>(
        endpoint,
        shouldUnban ? { note } : { reason: note, note }
      )
      invalidateAdminUsersCache()
      setData((prev) =>
        prev.map((item) => (item.uid === target.uid ? { ...item, ...result.user } : item))
      )
      show(shouldUnban ? '已解封' : '已封禁', { variant: 'success' })
    } catch (e) {
      show(shouldUnban ? '解封失败' : '封禁失败', { variant: 'error' })
    }
  }

  const toggleRole = async (target: AdminDataItem) => {
    if (!isSuperAdmin) {
      show('只有超级管理员可以更改权限', { variant: 'error' })
      return
    }
    const newRole = getNextRole(target.role)
    const confirmed = await dialog.confirm({
      title: '更改用户角色',
      message: `确定要将 ${target.displayName || target.uid} 的角色更改为 ${formatAdminRole(newRole)} 吗？`,
      confirmText: '更改',
      variant: 'warning',
    })
    if (!confirmed) return
    try {
      await apiPut(`/api/users/${target.uid}/role`, { role: newRole })
      invalidateAdminUsersCache()
      setData((prev) =>
        prev.map((item) => (item.uid === target.uid ? { ...item, role: newRole } : item))
      )
      show('角色已更新', { variant: 'success' })
    } catch (e) {
      show('更新角色失败', { variant: 'error' })
    }
  }

  const canEditUser = (target: AdminDataItem) => {
    return canManageUser(target)
  }

  const handleDeleteUser = async (target: AdminDataItem) => {
    if (!canManageUser(target)) {
      show('当前权限不能删除该用户', { variant: 'error' })
      return
    }

    const confirmed = await dialog.confirm({
      title: '删除用户',
      message: '确定删除此用户吗？',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!confirmed) {
      return
    }

    try {
      await apiDelete(`/api/admin/users/${target.uid}`)
      invalidateAdminUsersCache()
      setData((prev) => prev.filter((item) => item.uid !== target.uid))
      show('已删除', { variant: 'success' })
    } catch (error) {
      show(error instanceof Error ? error.message : '删除失败', { variant: 'error' })
    }
  }

  const closeEditModal = () => {
    if (editLoading) {
      return
    }

    setEditTarget(null)
    setEditForm(EMPTY_EDIT_FORM)
  }

  const openEditModal = (target: AdminDataItem) => {
    if (!canEditUser(target)) {
      show('当前权限不能编辑该用户', { variant: 'error' })
      return
    }

    setEditTarget(target)
    setEditForm({
      displayName: target.displayName || '',
      email: target.email || '',
      emailVerified: Boolean(target.emailVerified),
      signature: target.signature || '',
      bio: target.bio || '',
      newPassword: '',
      confirmPassword: '',
    })
  }

  const updateEditForm = <K extends keyof AdminUserEditForm>(
    field: K,
    value: AdminUserEditForm[K]
  ) => {
    setEditForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'email') {
        const originalEmail = (editTarget?.email || '').trim().toLowerCase()
        const nextEmail = String(value).trim().toLowerCase()
        next.emailVerified =
          nextEmail === originalEmail ? Boolean(editTarget?.emailVerified) : false
      }
      return next
    })
  }

  const handleUpdateUser = async () => {
    if (!editTarget?.uid) {
      return
    }

    if (editForm.displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      show(`昵称不能超过${PROFILE_DISPLAY_NAME_MAX_LENGTH}个字符`, { variant: 'error' })
      return
    }
    if (!editForm.email.trim()) {
      show('邮箱不能为空', { variant: 'error' })
      return
    }
    if (editForm.signature.length > PROFILE_SIGNATURE_MAX_LENGTH) {
      show(`签名不能超过${PROFILE_SIGNATURE_MAX_LENGTH}个字符`, { variant: 'error' })
      return
    }
    if (editForm.bio.length > WIKI_MAX_CONTENT_SIZE) {
      show('个人简介不能超过500KB', { variant: 'error' })
      return
    }
    if (editForm.newPassword || editForm.confirmPassword) {
      if (editForm.newPassword !== editForm.confirmPassword) {
        show('两次输入的新密码不一致', { variant: 'error' })
        return
      }
      if (editForm.newPassword.length < PASSWORD_MIN_LENGTH) {
        show(`新密码至少${PASSWORD_MIN_LENGTH}个字符`, { variant: 'error' })
        return
      }
      if (editForm.newPassword.length > PASSWORD_MAX_LENGTH) {
        show(`新密码最多${PASSWORD_MAX_LENGTH}个字符`, { variant: 'error' })
        return
      }
    }

    setEditLoading(true)
    try {
      const payload: {
        displayName: string
        email: string
        emailVerified: boolean
        signature: string
        bio: string
        newPassword?: string
      } = {
        displayName: editForm.displayName,
        email: editForm.email,
        emailVerified: editForm.emailVerified,
        signature: editForm.signature,
        bio: editForm.bio,
      }
      if (editForm.newPassword) {
        payload.newPassword = editForm.newPassword
      }

      const result = await apiPatch<{ user: AdminDataItem }>(
        `/api/users/${editTarget.uid}`,
        payload
      )
      invalidateAdminUsersCache()
      setData((prev) =>
        prev.map((item) => (item.uid === editTarget.uid ? { ...item, ...result.user } : item))
      )
      setEditTarget(null)
      setEditForm(EMPTY_EDIT_FORM)
      show(`已更新 ${result.user.displayName || editTarget.displayName || editTarget.uid} 的资料`, {
        variant: 'success',
      })
    } catch (error) {
      show(error instanceof Error ? error.message : '更新用户资料失败', { variant: 'error' })
    } finally {
      setEditLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary tracking-[0.12em]">用户管理</h1>
        <button
          onClick={fetchData}
          className="px-4 py-2 border border-border text-text-secondary hover:text-brand-gold hover:border-brand-gold rounded text-sm transition-all"
        >
          <RefreshCw size={14} className="inline mr-1" /> 刷新
        </button>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-alt border-b border-border">
                {['用户', '角色', '状态', '操作'].map((col) => (
                  <th
                    key={col}
                    className="px-5 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={4} className="px-5 py-4">
                      <div className="h-6 bg-surface-alt rounded" />
                    </td>
                  </tr>
                ))
              ) : data.length > 0 ? (
                data.map((item) => (
                  <tr key={item.uid} className="hover:bg-surface-alt transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <SmartImage
                          src={item.photoURL || DEFAULT_AVATAR}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover bg-surface-alt"
                        />
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {item.displayName || item.uid}
                          </p>
                          <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                            <span>{item.email}</span>
                            <span
                              className={clsx(
                                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                item.emailVerified
                                  ? 'theme-status-success'
                                  : 'bg-surface-alt text-text-muted'
                              )}
                            >
                              {item.emailVerified ? '已验证' : '未验证'}
                            </span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded text-[10px] font-medium',
                          item.role === 'super_admin'
                            ? 'bg-brand-gold/15 text-brand-gold'
                            : item.role === 'admin'
                              ? 'theme-status-error'
                              : 'bg-surface-alt text-brand-gold'
                        )}
                      >
                        {formatAdminRole(item.role)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded text-[10px] font-medium',
                          item.status === 'banned' ? 'theme-status-error' : 'theme-status-success'
                        )}
                      >
                        {item.status === 'banned' ? '已封禁' : '正常'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEditUser(item) && (
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 text-text-secondary hover:text-brand-gold hover:bg-surface-alt rounded transition-all"
                            title="编辑用户"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {isSuperAdmin && !isCurrentUser(item.uid) && (
                          <button
                            onClick={() => toggleRole(item)}
                            className="p-1.5 text-brand-gold hover:bg-surface-alt rounded transition-all"
                            title={getRoleToggleTitle(item.role)}
                          >
                            {getNextRole(item.role) === 'admin' ? (
                              <CheckCircle size={16} />
                            ) : (
                              <XCircle size={16} />
                            )}
                          </button>
                        )}
                        {canManageUser(item) && (
                          <button
                            onClick={() => toggleBan(item)}
                            className={clsx(
                              'p-1.5 rounded transition-all',
                              item.status === 'banned'
                                ? 'theme-text-success hover:bg-surface-alt'
                                : 'theme-icon-button-warning hover:bg-surface-alt'
                            )}
                            title={item.status === 'banned' ? '解封' : '封禁'}
                          >
                            {item.status === 'banned' ? (
                              <CheckCircle size={16} />
                            ) : (
                              <AlertTriangle size={16} />
                            )}
                          </button>
                        )}
                        {canManageUser(item) && (
                          <button
                            onClick={() => void handleDeleteUser(item)}
                            className="p-1.5 theme-icon-button-danger hover:bg-surface-alt rounded transition-all"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-5 py-16 text-center text-text-muted italic">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <FormModal
        open={Boolean(editTarget)}
        onClose={closeEditModal}
        title="编辑用户"
        subtitle={editTarget ? editTarget.displayName || editTarget.uid : undefined}
        onSubmit={(e) => {
          e.preventDefault()
          void handleUpdateUser()
        }}
        submitText="保存修改"
        loading={editLoading}
        maxWidth="max-w-2xl"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-text-secondary">
              昵称
              <CharacterCount
                current={editForm.displayName.length}
                max={PROFILE_DISPLAY_NAME_MAX_LENGTH}
              />
            </span>
            <input
              type="text"
              value={editForm.displayName}
              onChange={(e) => updateEditForm('displayName', e.target.value)}
              maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
              className="w-full rounded border border-border bg-bg-primary px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-gold"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-text-secondary">邮箱</span>
            <input
              type="email"
              value={editForm.email}
              onChange={(e) => updateEditForm('email', e.target.value)}
              className="w-full rounded border border-border bg-bg-primary px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-gold"
            />
          </label>

          <div className="flex items-center justify-between gap-4 rounded border border-border bg-surface-alt px-4 py-3 md:col-span-2">
            <label
              htmlFor="admin-edit-email-verified"
              className="text-sm font-medium text-text-primary"
            >
              邮箱验证状态
            </label>
            <button
              type="button"
              id="admin-edit-email-verified"
              role="switch"
              aria-checked={editForm.emailVerified}
              onClick={() => updateEditForm('emailVerified', !editForm.emailVerified)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2 ${
                editForm.emailVerified ? 'bg-[var(--color-theme-accent)]' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  editForm.emailVerified ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <label className="space-y-2 md:col-span-2">
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-text-secondary">
              签名
              <CharacterCount
                current={editForm.signature.length}
                max={PROFILE_SIGNATURE_MAX_LENGTH}
              />
            </span>
            <input
              type="text"
              value={editForm.signature}
              onChange={(e) => updateEditForm('signature', e.target.value)}
              maxLength={PROFILE_SIGNATURE_MAX_LENGTH}
              className="w-full rounded border border-border bg-bg-primary px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-gold"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-text-secondary">
              个人简介
              <CharacterCount current={editForm.bio.length} max={WIKI_MAX_CONTENT_SIZE} />
            </span>
            <textarea
              value={editForm.bio}
              onChange={(e) => updateEditForm('bio', e.target.value)}
              maxLength={WIKI_MAX_CONTENT_SIZE}
              rows={6}
              className="w-full resize-y rounded border border-border bg-bg-primary px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-gold"
            />
          </label>

          <label className="space-y-2">
            <span className="flex items-center justify-between gap-3 text-sm font-medium text-text-secondary">
              新密码（可选）
              <CharacterCount current={editForm.newPassword.length} max={PASSWORD_MAX_LENGTH} />
            </span>
            <input
              type="password"
              value={editForm.newPassword}
              onChange={(e) => updateEditForm('newPassword', e.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              className="w-full rounded border border-border bg-bg-primary px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-gold"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-text-secondary">确认新密码</span>
            <input
              type="password"
              value={editForm.confirmPassword}
              onChange={(e) => updateEditForm('confirmPassword', e.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              className="w-full rounded border border-border bg-bg-primary px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-gold"
            />
          </label>
        </div>
      </FormModal>
    </div>
  )
}

export default AdminUsers
