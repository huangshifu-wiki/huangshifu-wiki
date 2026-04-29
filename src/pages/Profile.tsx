import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Edit3, Save, X, Camera, Bookmark, FileText, MessageSquare, History, Loader2 } from 'lucide-react';
import { apiGet, apiPatch } from '../lib/apiClient';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { AvatarCropModal } from '../components/AvatarCropModal';
import { useToast } from '../components/Toast';
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
  createdAt: string;
  post: { id: string; title: string; status: string } | null;
};

type ActiveTab = 'profile' | 'favorites' | 'posts' | 'comments' | 'history';

const Profile = () => {
  const { user, profile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('profile');
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteFilter, setFavoriteFilter] = useState<'all' | FavoriteTargetType>('all');
  const [myPosts, setMyPosts] = useState<PostItem[]>([]);
  const [myComments, setMyComments] = useState<CommentItem[]>([]);
  const [myHistory, setMyHistory] = useState<HistoryItem[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || user?.displayName || '',
    bio: profile?.bio || '',
    photoURL: profile?.photoURL || user?.photoURL || '',
  });
  const [loading, setLoading] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const { show } = useToast();

  useEffect(() => {
    if (!user) return;
    setFormData({
      displayName: profile?.displayName || user.displayName || '',
      bio: profile?.bio || '',
      photoURL: profile?.photoURL || user.photoURL || '',
    });
  }, [profile?.displayName, profile?.bio, profile?.photoURL, user?.displayName, user?.photoURL, user?.uid]);

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

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" style={{ backgroundColor: '#f7f5f0' }}>
        <p className="text-[#9e968e] italic">请先登录以查看个人资料</p>
      </div>
    );
  }

  const handleAvatarSuccess = (photoURL: string) => {
    setFormData((prev) => ({ ...prev, photoURL }));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await apiPatch('/api/users/me', {
        displayName: formData.displayName,
        bio: formData.bio,
      });
      setIsEditing(false);
      show('保存成功');
    } catch (e) {
      console.error('Error updating profile:', e);
      show('保存失败，请稍后重试', { variant: 'error' });
    }
    setLoading(false);
  };

  const tabs: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
    { id: 'profile', label: '个人资料', icon: <FileText size={14} /> },
    { id: 'posts', label: '我的帖子', icon: <FileText size={14} /> },
    { id: 'comments', label: '我的评论', icon: <MessageSquare size={14} /> },
    { id: 'history', label: '浏览历史', icon: <History size={14} /> },
    { id: 'favorites', label: '我的收藏', icon: <Bookmark size={14} /> },
  ];

  return (
    <div
      className="min-h-[calc(100vh-60px)]"
      style={{
        backgroundColor: '#f7f5f0',
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[900px] mx-auto px-6 py-12">
        {/* Profile Header */}
        <div className="bg-white border border-[#e0dcd3] rounded p-8 mb-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="relative shrink-0 group">
              <img
                src={formData.photoURL || 'https://picsum.photos/seed/user/200/200'}
                alt=""
                className="w-24 h-24 rounded-full border-2 border-[#e0dcd3] object-cover"
                referrerPolicy="no-referrer"
              />
              {isEditing && (
                <button
                  onClick={() => setAvatarModalOpen(true)}
                  className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Camera className="text-white" size={20} />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      value={formData.displayName}
                      onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                      className="text-2xl font-bold text-[#2c2c2c] bg-[#f7f5f0] px-3 py-1 rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none w-full max-w-sm"
                      placeholder="输入昵称..."
                    />
                  ) : (
                    <h1 className="text-2xl font-bold text-[#2c2c2c]">{profile?.displayName || user.displayName}</h1>
                  )}
                  <p className="text-sm text-[#9e968e] flex items-center gap-1.5 mt-1">
                    <Mail size={13} /> {user.email}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-3 py-1.5 border border-[#e0dcd3] text-[#6b6560] rounded text-sm hover:border-[#c8951e] hover:text-[#c8951e] transition-all flex items-center gap-1"
                      >
                        <X size={14} /> 取消
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-3 py-1.5 bg-[#c8951e] text-white rounded text-sm hover:bg-[#dca828] transition-all flex items-center gap-1 disabled:opacity-50"
                      >
                        <Save size={14} /> {loading ? '保存中...' : '保存'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setFormData({
                          displayName: profile?.displayName || user.displayName || '',
                          bio: profile?.bio || '',
                          photoURL: profile?.photoURL || user.photoURL || '',
                        });
                        setIsEditing(true);
                      }}
                      className="px-3 py-1.5 border border-[#e0dcd3] text-[#6b6560] rounded text-sm hover:border-[#c8951e] hover:text-[#c8951e] transition-all flex items-center gap-1"
                    >
                      <Edit3 size={14} /> 编辑资料
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="border border-[#e0dcd3] rounded p-3">
                  <p className="text-xs text-[#9e968e] mb-0.5">等级</p>
                  <p className="text-lg font-semibold text-[#2c2c2c]">Lv.{profile?.level || 1}</p>
                </div>
                <div className="border border-[#e0dcd3] rounded p-3">
                  <p className="text-xs text-[#9e968e] mb-0.5">身份</p>
                  <p className="text-lg font-semibold text-[#2c2c2c]">{profile?.role || 'User'}</p>
                </div>
                <div className="border border-[#e0dcd3] rounded p-3">
                  <p className="text-xs text-[#9e968e] mb-0.5">状态</p>
                  <p className={clsx(
                    'text-lg font-semibold',
                    profile?.status === 'banned' ? 'text-red-600' : 'text-[#2c2c2c]',
                  )}>
                    {profile?.status === 'banned' ? '已封禁' : '正常'}
                  </p>
                </div>
              </div>

              {isEditing ? (
                <textarea
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-sm text-[#6b6560] resize-none"
                  placeholder="写点什么介绍一下自己吧..."
                />
              ) : (
                <p className="text-sm text-[#6b6560] italic">
                  {profile?.bio || '这位粉丝很神秘，还没有写下任何简介...'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[#e0dcd3] mb-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 relative',
                activeTab === tab.id
                  ? 'text-[#c8951e]'
                  : 'text-[#6b6560] hover:text-[#c8951e]',
              )}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#c8951e] rounded-[1px]" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'profile' ? (
            <div className="bg-white border border-[#e0dcd3] rounded p-6">
              <h3 className="text-base font-semibold text-[#2c2c2c] mb-4 pb-2 border-b border-[#e0dcd3]">个人简介</h3>
              {isEditing ? (
                <textarea
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 bg-[#f7f5f0] rounded border border-[#e0dcd3] focus:border-[#c8951e] focus:outline-none text-sm text-[#6b6560] resize-none"
                  placeholder="写点什么介绍一下自己吧..."
                />
              ) : (
                <p className="text-sm text-[#6b6560] leading-relaxed">
                  {profile?.bio || '这位粉丝很神秘，还没有写下任何简介...'}
                </p>
              )}
            </div>
          ) : activeTab === 'posts' ? (
            <div className="space-y-3">
              {postsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-[#c8951e]" />
                </div>
              ) : myPosts.length > 0 ? (
                myPosts.map((post) => (
                  <Link
                    key={post.id}
                    to={`/forum/${post.id}`}
                    className="block p-4 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-medium',
                            post.status === 'published'
                              ? 'bg-green-50 text-green-700'
                              : post.status === 'pending'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-[#f7f5f0] text-[#9e968e]',
                          )}>
                            {post.status === 'published' ? '已发布' : post.status === 'pending' ? '待审核' : post.status}
                          </span>
                          <span className="text-xs text-[#9e968e]">{post.section}</span>
                        </div>
                        <p className="text-sm font-medium text-[#2c2c2c] truncate">{post.title}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-[#9e968e]">{format(new Date(post.createdAt), 'MM-dd HH:mm')}</p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-12 bg-white border border-dashed border-[#e0dcd3] rounded">
                  <p className="text-sm text-[#9e968e]">暂无帖子</p>
                </div>
              )}
            </div>
          ) : activeTab === 'comments' ? (
            <div className="space-y-3">
              {commentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-[#c8951e]" />
                </div>
              ) : myComments.length > 0 ? (
                myComments.map((comment) => (
                  <div key={comment.id} className="p-4 bg-white border border-[#e0dcd3] rounded">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-[#9e968e]">回复了</span>
                      {comment.post ? (
                        <Link to={`/forum/${comment.post.id}`} className="text-xs text-[#c8951e] hover:underline">
                          {comment.post.title}
                        </Link>
                      ) : (
                        <span className="text-xs text-[#9e968e]">原帖子已删除</span>
                      )}
                    </div>
                    <p className="text-sm text-[#6b6560] line-clamp-2">{comment.content}</p>
                    <p className="text-xs text-[#9e968e] mt-2">{format(new Date(comment.createdAt), 'MM-dd HH:mm')}</p>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-white border border-dashed border-[#e0dcd3] rounded">
                  <p className="text-sm text-[#9e968e]">暂无评论</p>
                </div>
              )}
            </div>
          ) : activeTab === 'history' ? (
            <div className="space-y-3">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-[#c8951e]" />
                </div>
              ) : myHistory.length > 0 ? (
                myHistory.map((item) => (
                  <Link
                    key={item.id}
                    to={item.targetType === 'wiki' ? `/wiki/${item.target?.slug || item.targetId}` : item.targetType === 'post' ? `/forum/${item.target?.id || item.targetId}` : '/music'}
                    className="block p-4 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-medium',
                            item.targetType === 'wiki'
                              ? 'bg-[#f7f5f0] text-[#c8951e]'
                              : item.targetType === 'post'
                                ? 'bg-[#fdf5d8] text-[#c8951e]'
                                : 'bg-[#f7f5f0] text-[#9e968e]',
                          )}>
                            {item.targetType === 'wiki' ? '百科' : item.targetType === 'post' ? '帖子' : '音乐'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-[#2c2c2c] truncate">{item.target?.title || item.targetId}</p>
                        <p className="text-xs text-[#9e968e] truncate">{item.target?.category || (item.targetType === 'post' ? '社区帖子' : '')}</p>
                      </div>
                      <p className="text-xs text-[#9e968e] whitespace-nowrap">{format(new Date(item.createdAt), 'MM-dd HH:mm')}</p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-12 bg-white border border-dashed border-[#e0dcd3] rounded">
                  <p className="text-sm text-[#9e968e]">暂无浏览历史</p>
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
                        ? 'bg-[#c8951e] text-white border-[#c8951e]'
                        : 'bg-white text-[#6b6560] border-[#e0dcd3] hover:border-[#c8951e] hover:text-[#c8951e]',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {favoritesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-[#c8951e]" />
                </div>
              ) : groupedFavorites.length > 0 ? (
                <div className="space-y-3">
                  {groupedFavorites.map((item) => (
                    <Link
                      key={item.id}
                      to={item.href}
                      className="block p-4 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={clsx(
                              'px-2 py-0.5 rounded text-[10px] font-medium',
                              item.targetType === 'wiki'
                                ? 'bg-[#f7f5f0] text-[#c8951e]'
                                : item.targetType === 'post'
                                  ? 'bg-[#fdf5d8] text-[#c8951e]'
                                  : 'bg-[#f7f5f0] text-[#9e968e]',
                            )}>
                              {item.targetType === 'wiki' ? '百科' : item.targetType === 'post' ? '帖子' : '音乐'}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-[#2c2c2c] truncate">{item.title}</p>
                          <p className="text-xs text-[#9e968e] truncate">{item.subtitle}</p>
                        </div>
                        <p className="text-[10px] text-[#9e968e] whitespace-nowrap">{item.createdAt?.slice(0, 10)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-white border border-dashed border-[#e0dcd3] rounded">
                  <p className="text-sm text-[#9e968e]">暂无收藏内容</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AvatarCropModal
        open={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
        onSuccess={handleAvatarSuccess}
      />
    </div>
  );
};

export default Profile;
