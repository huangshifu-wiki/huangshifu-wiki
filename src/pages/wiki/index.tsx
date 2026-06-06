import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { RouteGuard } from '../../components/RouteGuard'
import WikiEditorComponent from '../../components/wiki/WikiEditor'
import WikiList from './WikiList'
import WikiTimeline from './WikiTimeline'
import WikiPageView from './WikiPageView'
import WikiBranchWorkspace from './WikiBranchWorkspace'
import WikiPullRequestList from './WikiPullRequestList'
import WikiPullRequestDetail from './WikiPullRequestDetail'
import WikiHistory from './WikiHistory'
import NotFound from '../NotFound'

const Wiki = () => {
  return (
    <Routes>
      <Route path="/" element={<WikiList />} />
      <Route
        path="/new"
        element={
          <RouteGuard
            title="创建百科前需要先登录"
            description="登录后可以新建百科页面、保存草稿并继续参与协作编辑。"
          >
            <WikiEditorComponent />
          </RouteGuard>
        }
      />
      <Route path="/timeline" element={<WikiTimeline />} />
      <Route path="/:slug" element={<WikiPageView />} />
      <Route
        path="/:slug/branches"
        element={
          <RouteGuard
            title="协作分支需要先登录"
            description="登录后才能创建和维护自己的百科协作分支，并提交 PR。"
          >
            <WikiBranchWorkspace />
          </RouteGuard>
        }
      />
      <Route
        path="/:slug/prs"
        element={
          <RouteGuard
            title="PR 列表需要先登录"
            description="登录后才可以查看与你相关的百科协作 PR 以及审核状态。"
          >
            <WikiPullRequestList />
          </RouteGuard>
        }
      />
      <Route
        path="/:slug/prs/:prId"
        element={
          <RouteGuard
            title="PR 详情需要先登录"
            description="登录后才能查看协作 PR 的具体差异、评论与处理结果。"
          >
            <WikiPullRequestDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/:slug/edit"
        element={
          <RouteGuard
            title="编辑百科前需要先登录"
            description="登录后才可以修改百科内容、保存更改并继续协作编辑。"
          >
            <WikiEditorComponent />
          </RouteGuard>
        }
      />
      <Route path="/:slug/history" element={<WikiHistory />} />
      <Route path="*" element={<NotFound homePath="/wiki" homeLabel="返回百科" />} />
    </Routes>
  )
}

export default Wiki
