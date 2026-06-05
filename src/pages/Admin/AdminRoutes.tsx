import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { AdminLayout } from '../../components/admin/AdminLayout'
import { RouteGuard } from '../../components/RouteGuard'
import AdminDashboard from './AdminDashboard'
import AdminReviews from './AdminReviews'
import AdminListPage from './AdminListPage'
import AdminUsers from './AdminUsers'
import AdminLocks from './AdminLocks'
import AdminLogs from './AdminLogs'
import AdminToolPage from './AdminToolPage'
import AdminDiskMonitor from './AdminDiskMonitor'
import AdminVariantManager from './AdminVariantManager'

export const AdminRoutes = () => (
  <Routes>
    <Route
      path="/admin/*"
      element={
        <RouteGuard
          requireAdmin
          title="管理页面需要先登录"
          description="登录管理员账号后才可以进入后台，处理内容审核、站务配置和系统任务。"
        >
          <AdminLayout />
        </RouteGuard>
      }
    >
      <Route index element={<AdminDashboard />} />
      <Route path="reviews" element={<AdminReviews />} />
      <Route path="wiki" element={<AdminListPage type="wiki" />} />
      <Route path="music" element={<AdminListPage type="music" />} />
      <Route path="posts" element={<AdminListPage type="posts" />} />
      <Route path="galleries" element={<AdminListPage type="galleries" />} />
      <Route path="sections" element={<AdminListPage type="sections" />} />
      <Route path="announcements" element={<AdminListPage type="announcements" />} />
      <Route path="users" element={<AdminUsers />} />
      <Route path="locks" element={<AdminLocks />} />
      <Route path="moderation_logs" element={<AdminLogs type="moderation_logs" />} />
      <Route path="ban_logs" element={<AdminLogs type="ban_logs" />} />
      <Route path="embeddings" element={<AdminToolPage type="embeddings" />} />
      <Route
        path="backups"
        element={
          <RouteGuard requireSuperAdmin>
            <AdminToolPage type="backups" />
          </RouteGuard>
        }
      />
      <Route path="images" element={<AdminToolPage type="images" />} />
      <Route path="sensitive_check" element={<AdminToolPage type="sensitive_check" />} />
      <Route path="markdown_links" element={<AdminToolPage type="markdown_links" />} />
      <Route path="disk-monitor" element={<AdminDiskMonitor />} />
      <Route path="variant-manager" element={<AdminVariantManager />} />
    </Route>
  </Routes>
)

export default AdminRoutes
