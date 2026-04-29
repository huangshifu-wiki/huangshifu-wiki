import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AdminLayout } from '../../components/admin/AdminLayout';
import AdminDashboard from './AdminDashboard';
import AdminReviews from './AdminReviews';
import AdminListPage from './AdminListPage';
import AdminUsers from './AdminUsers';
import AdminLocks from './AdminLocks';
import AdminLogs from './AdminLogs';
import AdminToolPage from './AdminToolPage';

export const AdminRoutes = () => (
  <Routes>
    <Route path="/admin/*" element={<AdminLayout />}>
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
      <Route path="backups" element={<AdminToolPage type="backups" />} />
      <Route path="images" element={<AdminToolPage type="images" />} />
      <Route path="sensitive_check" element={<AdminToolPage type="sensitive_check" />} />
      <Route path="birthday" element={<AdminToolPage type="birthday" />} />
      <Route path="markdown_links" element={<AdminToolPage type="markdown_links" />} />
    </Route>
  </Routes>
);

export default AdminRoutes;
