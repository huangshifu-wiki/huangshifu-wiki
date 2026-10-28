import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { RouteGuard } from '../../components/RouteGuard'
import WikiList from './WikiList'
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
      <Route path="/:slug/history" element={<WikiHistory />} />
      <Route path="*" element={<NotFound homePath="/wiki" homeLabel="返回百科" />} />
    </Routes>
  )
}

export default Wiki
