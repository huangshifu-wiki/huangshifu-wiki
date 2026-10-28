export const formatTime = (time: number): string => {
  const mins = Math.floor(time / 60)
  const secs = Math.floor(time % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const formatAdminRole = (role?: string | null): string => {
  switch (role) {
    case 'admin':
      return '管理员'
    case 'super_admin':
      return '超级管理员'
    case 'user':
    case '':
    case null:
    case undefined:
      return '普通用户'
    default:
      return role
  }
}
