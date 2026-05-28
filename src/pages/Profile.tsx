import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Mail,
  Settings,
  Bookmark,
  FileText,
  MessageSquare,
  History,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { apiGet } from '../lib/apiClient';
import { Link, Navigate, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar';
import { getStatusClassName, getStatusText } from '../lib/contentUtils';
import { formatAdminRole } from '../lib/formatUtils';
import type { FavoriteItem, HistoryItem } from '../types/entities';

type FavoriteTargetType = 'wiki' | 'post' | 'music';

type PostItem = {
  id: string;
  title: string;
  section: string;
  status: string;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
};

type CommentItem = {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string | null;
  content: string;
  parentId: string | null;
  isDeleted: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdAt: string;
  post: { id: string; title: string; status: string } | null;
};

type ActiveTab = 'profile' | 'favorites' | 'posts' | 'comments' | 'history';

const PROFILE_TAB_SET = new Set<ActiveTab>(['profile', 'favorites', 'posts', 'comments', 'history']);

function resolveProfileTab(tab?: string): ActiveTab | null {
  if (!tab || tab === 'profile') {
    return 'profile';
  }

  return PROFILE_TAB_SET.has(tab as ActiveTab) ? (tab as ActiveTab) : null;
}

const PROFILE_TABS: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
  { id: 'profile', label: '个人资料', icon: <FileText size={14} /> },
  { id: 'posts', label: '我的帖子', icon: <FileText size={14} /> },
  { id: 'comments', label: '我的评论', icon: <MessageSquare size={14} /> },
  { id: 'history', label: '浏览历史', icon: <History size={14} /> },
  { id: 'favorites', label: '我的收藏', icon: <Bookmark size={14} /> },
];

function renderRoleIcon(role?: string | null) {
  if (role === 'super_admin') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center text-brand-gold drop-shadow-[0_2px_6px_color-mix(in_srgb,var(--color-brand-gold)_30%,transparent)]"
        title="超级管理员"
        aria-label="超级管理员"
      >
        <ShieldCheck size={18} strokeWidth={2.4} />
      </span>
    );
  }

  if (role === 'admin') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center text-[color-mix(in_srgb,var(--color-info-hover)_86%,var(--color-text-primary))]"
        title="管理员"
        aria-label="管理员"
      >
        <ShieldCheck size={18} strokeWidth={2.3} />
      </span>
    );
  }

  return null;
}

const Profile = () => {
  const { user, profile } = useAuth();
  const { tab } = useParams<{ tab?: string }>();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | FavoriteTargetType>('all');
  const [myPosts, setMyPosts] = useState<PostItem[]>([]);
  const [myComments, setMyComments] = useState<CommentItem[]>([]);
  const [myHistory, setMyHistory] = useState<HistoryItem[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const activeTab = resolveProfileTab(tab)
  const currentRole = profile?.role ?? user?.role

  useEffect(() => {
    if (!user || activeTab !== 'favorites') return;
    const run = async () => {
      setFavoritesLoading(true);
      try {
        const data = await apiGet<{ favorites: FavoriteItem[] }>('/api/users/me/favorites', {
          type: favoriteFilter === 'all' ? undefined : favoriteFilter,
        });
        setFavorites(data.favorites || []);
      } catch (error) {
        console.error('Error fetching favorites:', error);
      } finally {
        setFavoritesLoading(false);
      }
    };
    run();
  }, [user, activeTab, favoriteFilter]);

  useEffect(() => {
    if (!user || activeTab !== 'posts') return;
    const run = async () => {
      setPostsLoading(true);
      try {
        const data = await apiGet<{ posts: PostItem[]; total: number }>(`/api/users/${user.uid}/posts`, { limit: 50 });
        setMyPosts(data.posts || []);
      } catch (error) {
        console.error('Error fetching user posts:', error);
      } finally {
        setPostsLoading(false);
      }
    };
    run();
  }, [user, activeTab]);

  useEffect(() => {
    if (!user || activeTab !== 'comments') return;
    const run = async () => {
      setCommentsLoading(true);
      try {
        const data = await apiGet<{ comments: CommentItem[]; total: number }>(`/api/users/${user.uid}/comments`, { limit: 50 });
        setMyComments(data.comments || []);
      } catch (error) {
        console.error('Error fetching user comments:', error);
      } finally {
        setCommentsLoading(false);
      }
    };
    run();
  }, [user, activeTab]);

  useEffect(() => {
    if (!user || activeTab !== 'history') return;
    const run = async () => {
      setHistoryLoading(true);
      try {
        const data = await apiGet<{ history: HistoryItem[]; total: number }>('/api/users/me/history', { limit: 50 });
        setMyHistory(data.history || []);
      } catch (error) {
        console.error('Error fetching browsing history:', error);
      } finally {
        setHistoryLoading(false);
      }
    };
    run();
  }, [user, activeTab]);

  const groupedFavorites = useMemo(() => {
    return favorites.map((item) => {
      if (item.targetType === 'wiki') {
        return {
          ...item,
          href: `/wiki/${item.target?.slug || item.targetId}`,
          title: item.target?.title || item.targetId,
          subtitle: item.target?.category ? `分类：${item.target.category}` : '百科页面',
        };
      }
      if (item.targetType === 'post') {
        return {
          ...item,
          href: `/forum/${item.target?.id || item.targetId}`,
          title: item.target?.title || item.targetId,
          subtitle: item.target?.section ? `板块：${item.target.section}` : '社区帖子',
        };
      }
      return {
        ...item,
        href: '/music',
        title: item.target?.title || item.targetId,
        subtitle: item.target?.artist ? `${item.target.artist} · ${item.target.album || ''}` : '音乐内容',
      };
    });
  }, [favorites]);

  if (!activeTab) {
    return <Navigate to="/profile" replace />
  }

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-bg-primary">
        <p className="text-text-muted italic">请先登录以查看个人资料</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[900px] mx-auto px-6 py-12">
        {/* Profile Header */}
        <div className="theme-panel rounded p-8 mb-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="relative shrink-0 group">
              <img
                src={profile?.photoURL || user.photoURL || DEFAULT_AVATAR}
                alt=""
                className="w-24 h-24 rounded-full border-2 border-border object-cover"
                referrerPolicy="no-referrer"
                onError={handleAvatarError}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold text-text-primary">
                    <span className="truncate">{profile?.displayName || user.displayName}</span>
                    {renderRoleIcon(currentRole)}
                  </h1>
                  <p className="text-sm text-text-muted flex items-center gap-1.5 mt-1">
                    <Mail size={13} /> {user.email}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    to="/settings/profile"
                    className="theme-button-secondary px-3 py-1.5 rounded text-sm transition-all flex items-center gap-1"
                  >
                    <Settings size={14} /> 设置
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="theme-panel-soft rounded p-3">
                  <p className="text-xs text-text-muted mb-0.5">等级</p>
                  <p className="text-lg font-semibold text-text-primary">Lv.{profile?.level || 1}</p>
                </div>
                <div className="theme-panel-soft rounded p-3">
                  <p className="text-xs text-text-muted mb-0.5">身份</p>
                  <p className="text-lg font-semibold text-text-primary">{formatAdminRole(currentRole)}</p>
                </div>
                <div className="theme-panel-soft rounded p-3">
                  <p className="text-xs text-text-muted mb-0.5">状态</p>
                  <p className={clsx(
                    'text-lg font-semibold',
                    profile?.status === 'banned' ? 'theme-text-error' : 'text-text-primary',
                  )}>
                    {profile?.status === 'banned' ? '已封禁' : '正常'}
                  </p>
                </div>
              </div>

              <p className="text-sm text-text-secondary italic">
                {profile?.bio || '这位粉丝很神秘，还没有写下任何简介...'}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
          {PROFILE_TABS.map((tab) => (
            <Link
              key={tab.id}
              to={tab.id === 'profile' ? '/profile' : `/profile/${tab.id}`}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 relative',
                activeTab === tab.id
                  ? 'text-brand-gold'
                  : 'text-text-secondary hover:text-brand-gold',
              )}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-theme-accent)] rounded-[1px]" />
              )}
            </Link>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'profile' ? (
            <div className="theme-panel rounded p-6">
              <h3 className="text-base font-semibold text-text-primary mb-4 pb-2 border-b border-border">个人简介</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {profile?.bio || '这位粉丝很神秘，还没有写下任何简介...'}
              </p>
            </div>
          ) : activeTab === 'posts' ? (
            <div className="space-y-3">
              {postsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-brand-gold" />
                </div>
              ) : myPosts.length > 0 ? (
                myPosts.map((post) => (
                  <Link
                    key={post.id}
                    to={`/forum/${post.id}`}
                    className="block p-4 theme-panel rounded hover:border-brand-gold transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-medium',
                            getStatusClassName(post.status as 'draft' | 'pending' | 'published' | 'rejected'),
                          )}>
                            {getStatusText(post.status as 'draft' | 'pending' | 'published' | 'rejected')}
                          </span>
                          <span className="text-xs text-text-muted">{post.section}</span>
                        </div>
                        <p className="text-sm font-medium text-text-primary truncate">{post.title}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-text-muted">{format(new Date(post.createdAt), 'MM-dd HH:mm')}</p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-12 bg-surface border border-dashed border-border rounded">
                  <p className="text-sm text-text-muted">暂无帖子</p>
                </div>
              )}
            </div>
          ) : activeTab === 'comments' ? (
            <div className="space-y-3">
              {commentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-brand-gold" />
                </div>
              ) : myComments.length > 0 ? (
                myComments.map((comment) => (
                  <div key={comment.id} className="p-4 theme-panel rounded">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-text-muted">回复了</span>
                      {comment.post ? (
                        <Link to={`/forum/${comment.post.id}`} className="text-xs text-brand-gold hover:underline">
                          {comment.post.title}
                        </Link>
                      ) : (
                        <span className="text-xs text-text-muted">原帖子已删除</span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary line-clamp-2">{comment.content}</p>
                    <p className="text-xs text-text-muted mt-2">{format(new Date(comment.createdAt), 'MM-dd HH:mm')}</p>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-surface border border-dashed border-border rounded">
                  <p className="text-sm text-text-muted">暂无评论</p>
                </div>
              )}
            </div>
          ) : activeTab === 'history' ? (
            <div className="space-y-3">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-brand-gold" />
                </div>
              ) : myHistory.length > 0 ? (
                myHistory.map((item) => (
                  <Link
                    key={item.id}
                    to={item.targetType === 'wiki' ? `/wiki/${item.target?.slug || item.targetId}` : item.targetType === 'post' ? `/forum/${item.target?.id || item.targetId}` : '/music'}
                    className="block p-4 theme-panel rounded hover:border-brand-gold transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-medium',
                            item.targetType === 'wiki'
                              ? 'theme-tag'
                              : item.targetType === 'post'
                                ? 'theme-tag'
                                : 'bg-surface-alt text-text-muted',
                          )}>
                            {item.targetType === 'wiki' ? '百科' : item.targetType === 'post' ? '帖子' : '音乐'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-text-primary truncate">{item.target?.title || item.targetId}</p>
                        <p className="text-xs text-text-muted truncate">{item.target?.category || (item.targetType === 'post' ? '社区帖子' : '')}</p>
                      </div>
                      <p className="text-xs text-text-muted whitespace-nowrap">{format(new Date(item.createdAt), 'MM-dd HH:mm')}</p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-12 bg-surface border border-dashed border-border rounded">
                  <p className="text-sm text-text-muted">暂无浏览历史</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'all', label: '全部' },
                  { id: 'wiki', label: '百科' },
                  { id: 'post', label: '帖子' },
                  { id: 'music', label: '音乐' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setFavoriteFilter(item.id as 'all' | FavoriteTargetType)}
                    className={clsx(
                      'px-3 py-1.5 text-xs rounded transition-all border',
                      favoriteFilter === item.id
                        ? 'theme-button-primary border-brand-gold'
                        : 'theme-button-secondary',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {favoritesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-brand-gold" />
                </div>
              ) : groupedFavorites.length > 0 ? (
                <div className="space-y-3">
                  {groupedFavorites.map((item) => (
                    <Link
                      key={item.id}
                      to={item.href}
                      className="block p-4 theme-panel rounded hover:border-brand-gold transition-all"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={clsx(
                              'px-2 py-0.5 rounded text-[10px] font-medium',
                              item.targetType === 'wiki'
                                ? 'theme-tag'
                                : item.targetType === 'post'
                                  ? 'theme-tag'
                                  : 'bg-surface-alt text-text-muted',
                            )}>
                              {item.targetType === 'wiki' ? '百科' : item.targetType === 'post' ? '帖子' : '音乐'}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-text-primary truncate">{item.title}</p>
                          <p className="text-xs text-text-muted truncate">{item.subtitle}</p>
                        </div>
                        <p className="text-[10px] text-text-muted whitespace-nowrap">{item.createdAt?.slice(0, 10)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-surface border border-dashed border-border rounded">
                  <p className="text-sm text-text-muted">暂无收藏内容</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;
