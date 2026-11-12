import { Route } from 'react-router-dom'
import { RetainedRoutes } from '../../components/RetainedRoutes'
import { AdminLayout } from '../../components/admin/AdminLayout'
import { RouteGuard } from '../../components/RouteGuard'
import AdminDashboard from './AdminDashboard'
import AdminReviews from './AdminReviews'
import AdminReviewWorkbench from './AdminReviewWorkbench'
import AdminListPage from './AdminListPage'
import AdminMusicPage from './AdminMusicPage'
import AdminUsers from './AdminUsers'
import AdminLocks from './AdminLocks'
import AdminLogs from './AdminLogs'
import AdminToolPage from './AdminToolPage'
import AdminDiskMonitor from './AdminDiskMonitor'
import AdminVariantManager from './AdminVariantManager'
import AdminSettings from './AdminSettings'
import AdminMaintenance from './AdminMaintenance'
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

const adminRoutes = (
  <RetainedRoutes scope="admin">
    <Route path="/admin" element={<AdminDashboard />} />
    <Route path="/admin/reviews" element={<AdminReviews />} />
    <Route path="/admin/reviews/workbench" element={<AdminReviewWorkbench />} />
    <Route path="/admin/wiki" element={<AdminListPage type="wiki" />} />
    <Route path="/admin/wiki-categories" element={<AdminListPage type="wiki-categories" />} />
    <Route path="/admin/music" element={<AdminMusicPage />} />
    <Route path="/admin/posts" element={<AdminListPage type="posts" />} />
    <Route path="/admin/galleries" element={<AdminListPage type="galleries" />} />
    <Route path="/admin/ticket-listings" element={<AdminListPage type="ticket-listings" />} />
    <Route path="/admin/events" element={<AdminListPage type="events" />} />
    <Route path="/admin/sections" element={<AdminListPage type="sections" />} />
    <Route path="/admin/announcements" element={<AdminListPage type="announcements" />} />
    <Route path="/admin/users" element={<AdminUsers />} />
    <Route path="/admin/locks" element={<AdminLocks />} />
    <Route path="/admin/moderation_logs" element={<AdminLogs type="moderation_logs" />} />
    <Route path="/admin/ban_logs" element={<AdminLogs type="ban_logs" />} />
    <Route path="/admin/embeddings" element={<AdminEmbeddingsRoute />} />
    <Route
      path="/admin/backups"
      element={
        <RouteGuard requireSuperAdmin>
          <AdminToolPage type="backups" />
        </RouteGuard>
      }
    />
    <Route path="/admin/images" element={<AdminToolPage type="images" />} />
    <Route path="/admin/sensitive_check" element={<AdminToolPage type="sensitive_check" />} />
    <Route path="/admin/markdown_links" element={<AdminToolPage type="markdown_links" />} />
    <Route path="/admin/disk-monitor" element={<AdminDiskMonitor />} />
    <Route path="/admin/variant-manager" element={<AdminVariantManager />} />
    <Route path="/admin/maintenance" element={<AdminMaintenance />} />
    <Route
      path="/admin/settings"
      element={
        <RouteGuard requireSuperAdmin>
          <AdminSettings />
        </RouteGuard>
      }
    />
    <Route path="*" element={<NotFound homePath="/admin" homeLabel="返回后台首页" />} />
  </RetainedRoutes>
)

export const AdminRoutes = () => (
  <RouteGuard
    requireAdmin
    title="管理页面需要先登录"
    description="登录管理员账号后才可以进入后台，处理内容审核、站务配置和系统任务。"
  >
    <AdminLayout>{adminRoutes}</AdminLayout>
  </RouteGuard>
)

export default AdminRoutes
