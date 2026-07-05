import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { AdminLayout } from '../../components/admin/AdminLayout'
import { RouteGuard } from '../../components/RouteGuard'
import AdminDashboard from './AdminDashboard'
import AdminReviews from './AdminReviews'
import AdminReviewWorkbench from './AdminReviewWorkbench'
import AdminListPage from './AdminListPage'
import AdminUsers from './AdminUsers'
import AdminLocks from './AdminLocks'
import AdminLogs from './AdminLogs'
import AdminToolPage from './AdminToolPage'
import AdminEventEdit from './AdminEventEdit'
import AdminDiskMonitor from './AdminDiskMonitor'
import AdminVariantManager from './AdminVariantManager'
import AdminSettings from './AdminSettings'
import NotFound from '../NotFound'
import { usePublicFeatures } from '../../hooks/usePublicFeatures'

const AdminEmbeddingsRoute = () => {
  const { features, loading } = usePublicFeatures()

  if (loading) {
    return null
  }

  if (!features.semanticSearch) {
    return <NotFound homePath="/admin" homeLabel="返回后台首页" />
  }

  return <AdminToolPage type="embeddings" />
}

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
      <Route path="reviews/workbench" element={<AdminReviewWorkbench />} />
      <Route path="wiki" element={<AdminListPage type="wiki" />} />
      <Route path="wiki-categories" element={<AdminListPage type="wiki-categories" />} />
      <Route path="music" element={<AdminListPage type="music" />} />
      <Route path="posts" element={<AdminListPage type="posts" />} />
      <Route path="galleries" element={<AdminListPage type="galleries" />} />
      <Route path="events" element={<AdminListPage type="events" />} />
      <Route path="events/new" element={<AdminEventEdit />} />
      <Route path="events/:eventId/edit" element={<AdminEventEdit />} />
      <Route path="sections" element={<AdminListPage type="sections" />} />
      <Route path="announcements" element={<AdminListPage type="announcements" />} />
      <Route path="users" element={<AdminUsers />} />
      <Route path="locks" element={<AdminLocks />} />
      <Route path="moderation_logs" element={<AdminLogs type="moderation_logs" />} />
      <Route path="ban_logs" element={<AdminLogs type="ban_logs" />} />
      <Route path="embeddings" element={<AdminEmbeddingsRoute />} />
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
      <Route
        path="settings"
        element={
          <RouteGuard requireSuperAdmin>
            <AdminSettings />
          </RouteGuard>
        }
      />
      <Route path="*" element={<NotFound homePath="/admin" homeLabel="返回后台首页" />} />
    </Route>
  </Routes>
)

export default AdminRoutes
