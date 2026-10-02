import React, { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { FormModal } from '../components/Modal/FormModal'
import { RouteGuard } from '../components/RouteGuard'
import { useContentEditorNavigation } from '../hooks/useContentEditorNavigation'

const WikiEditor = lazy(() => import('../components/wiki/WikiEditor'))
const PostEditor = lazy(async () => {
  const module = await import('./Forum')
  return { default: module.PostEditor }
})
const GalleryEditor = lazy(() => import('./GalleryEdit'))
const TicketEditor = lazy(async () => {
  const module = await import('./Tickets')
  return { default: module.TicketEditorPage }
})
const AdminEventEditor = lazy(() => import('./Admin/AdminEventEdit'))

const EditorLoadingModal = () => {
  const { closeEditor } = useContentEditorNavigation()

  return (
    <FormModal open onClose={closeEditor} title="编辑器加载中...">
      <div role="status" className="py-10 text-center text-text-muted">
        编辑器加载中...
      </div>
    </FormModal>
  )
}

const AdminEventPermissionFallback = () => {
  const { closeEditor } = useContentEditorNavigation()

  return (
    <FormModal open onClose={closeEditor} title="访问受限">
      <p className="text-sm leading-7 text-text-secondary">当前账号没有权限访问此页面。</p>
    </FormModal>
  )
}

export const ContentEditorRoutes = () => {
  const location = useLocation()

  return (
    <Suspense fallback={<EditorLoadingModal />}>
      <Routes>
        <Route
          path="/wiki/new"
          element={
            <RouteGuard
              title="创建百科前需要先登录"
              description="登录后可以新建百科页面、保存草稿并继续参与协作编辑。"
            >
              <WikiEditor key={location.pathname} />
            </RouteGuard>
          }
        />
        <Route
          path="/wiki/:slug/edit"
          element={
            <RouteGuard
              title="编辑百科前需要先登录"
              description="登录后才可以修改百科内容、保存更改并继续协作编辑。"
            >
              <WikiEditor key={location.pathname} />
            </RouteGuard>
          }
        />
        <Route
          path="/forum/new"
          element={
            <RouteGuard
              title="发帖前需要先登录"
              description="登录后可以发布帖子、保存草稿，并在审核通过后参与社区讨论。"
            >
              <PostEditor key={location.pathname} />
            </RouteGuard>
          }
        />
        <Route
          path="/forum/:postId/edit"
          element={
            <RouteGuard
              title="编辑帖子前需要先登录"
              description="登录后才可以继续编辑你创建的帖子，未登录状态下不会开放编辑入口。"
            >
              <PostEditor key={location.pathname} />
            </RouteGuard>
          }
        />
        <Route path="/gallery/new" element={<GalleryEditor key={location.pathname} />} />
        <Route
          path="/gallery/:galleryId/edit"
          element={<GalleryEditor key={location.pathname} />}
        />
        <Route
          path="/tickets/new"
          element={
            <RouteGuard title="发布盘票需要先登录">
              <TicketEditor key={location.pathname} />
            </RouteGuard>
          }
        />
        <Route
          path="/tickets/:slug/edit"
          element={
            <RouteGuard title="编辑盘票需要先登录">
              <TicketEditor key={location.pathname} />
            </RouteGuard>
          }
        />
        <Route
          path="/admin/events/new"
          element={
            <RouteGuard requireAdmin forbiddenFallback={<AdminEventPermissionFallback />}>
              <AdminEventEditor key={location.pathname} />
            </RouteGuard>
          }
        />
      </Routes>
    </Suspense>
  )
}
