import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Settings,
  Bookmark,
  FileText,
  MessageSquare,
  History,
  Loader2,
} from 'lucide-react';
import { apiGet, apiPatch } from '../lib/apiClient';
import { Link, Navigate, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar';
import { getStatusClassName, getStatusText } from '../lib/contentUtils';
import { PROFILE_SIGNATURE_MAX_LENGTH } from '../lib/contentLimits';
import type { FavoriteItem, HistoryItem } from '../types/entities';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { useToast } from '../components/Toast';

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
type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

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

const TAB_PANEL_CLASS = 'pt-2';
const SIGNATURE_PLACEHOLDER = '这位粉丝很神秘，还没有写下任何签名...';
const SIGNATURE_TEXT_CLASS =
  'relative mt-3 block w-full max-w-[68ch] whitespace-pre-wrap break-words rounded-sm border-0 bg-transparent p-0 text-left font-[inherit] text-sm leading-7 text-text-muted';
const SIGNATURE_HOVER_FRAME_CLASS =
  'before:pointer-events-none before:absolute before:-inset-1 before:rounded-sm before:border before:border-dashed before:border-border before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100 focus-visible:before:opacity-100';
const SIGNATURE_VISIBLE_FRAME_CLASS =
  'before:pointer-events-none before:absolute before:-inset-1 before:rounded-sm before:border before:border-dashed before:border-border before:opacity-100';

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm text-text-muted italic">
      {message}
    </div>
  );
}

const Profile = () => {
  const { user, profile, refreshAuth } = useAuth();
  const toast = useToast();
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
  const [signatureDraft, setSignatureDraft] = useState('');
  const [signatureEditing, setSignatureEditing] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const signatureInputRef = useRef<HTMLDivElement | null>(null);
  const signatureComposingRef = useRef(false);
  const signatureClickPointRef = useRef<{ x: number; y: number } | null>(null);
  const activeTab = resolveProfileTab(tab);
  const displayName = profile?.displayName || user.displayName;
  const avatarSrc = profile?.photoURL || user.photoURL || DEFAULT_AVATAR;
  const signature = profile?.signature || '';
  const displaySignature = signature.trim();
  const bio = profile?.bio?.trim() || '';
  const isBanned = profile?.status === 'banned';

  useEffect(() => {
    if (!signatureEditing) {
      setSignatureDraft(signature);
    }
  }, [signature, signatureEditing]);

  const setSignatureCaretToEnd = (input: HTMLDivElement) => {
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const setSignatureCaretFromPoint = (input: HTMLDivElement, point: { x: number; y: number }) => {
    input.focus();
    const caretDocument = document as CaretDocument;

    const range = (() => {
      if (caretDocument.caretPositionFromPoint) {
        const position = caretDocument.caretPositionFromPoint(point.x, point.y);
        if (!position) return null;

        const nextRange = document.createRange();
        nextRange.setStart(position.offsetNode, position.offset);
        nextRange.collapse(true);
        return nextRange;
      }

      if (caretDocument.caretRangeFromPoint) {
        return caretDocument.caretRangeFromPoint(point.x, point.y);
      }

      return null;
    })();

    if (!range || !input.contains(range.startContainer)) {
      setSignatureCaretToEnd(input);
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  useEffect(() => {
    if (!signatureEditing) return;

    const input = signatureInputRef.current;
    if (!input) return;

    const clickPoint = signatureClickPointRef.current;
    input.textContent = signatureDraft;
    input.focus();

    if (clickPoint) {
      setSignatureCaretFromPoint(input, clickPoint);
      signatureClickPointRef.current = null;
    } else {
      setSignatureCaretToEnd(input);
    }
    // 只在进入编辑时同步 DOM 文本，避免输入过程中重置光标位置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureEditing]);

  const handleSignatureInput = () => {
    const input = signatureInputRef.current;
    if (!input) return;

    const nextValue = input.innerText.replace(/\n+$/g, '').slice(0, PROFILE_SIGNATURE_MAX_LENGTH);
    if (nextValue !== input.innerText) {
      input.textContent = nextValue;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    setSignatureDraft(nextValue);
  };

  const saveSignature = async () => {
    if (signatureSaving) return;

    const nextSignature = signatureDraft;
    setSignatureEditing(false);

    if (nextSignature === signature) {
      return;
    }

    setSignatureSaving(true);
    try {
      await apiPatch('/api/users/me', { signature: nextSignature });
      await refreshAuth();
      toast.show('签名已保存');
    } catch (error) {
      console.error('Error updating signature:', error);
      setSignatureDraft(signature);
      toast.show(error instanceof Error ? error.message : '签名保存失败', { variant: 'error' });
    } finally {
      setSignatureSaving(false);
    }
  };

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
      <div className="max-w-[900px] mx-auto px-5 py-7 sm:px-6 sm:py-9">
        {isBanned && (
          <div className="mb-8 border border-[color-mix(in_srgb,var(--color-error)_26%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_10%,var(--color-surface))] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--color-error-hover)_82%,var(--color-text-primary))]">
            <p className="font-semibold">账号被封禁</p>
            <p className="mt-1 leading-7">
              {profile?.banReason ? `原因：${profile.banReason}` : '当前账号已被限制访问部分功能。'}
              {profile?.bannedAt ? ` 封禁时间：${format(new Date(profile.bannedAt), 'yyyy-MM-dd HH:mm')}` : ''}
            </p>
          </div>
        )}

        <section className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <img
                src={avatarSrc}
                alt=""
                className="h-20 w-20 shrink-0 rounded-full border border-border object-cover sm:h-24 sm:w-24"
                referrerPolicy="no-referrer"
                onError={handleAvatarError}
              />
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-semibold text-text-primary">
                  {displayName}
                </h1>
                {signatureEditing ? (
                  <div
                    ref={signatureInputRef}
                    contentEditable
                    suppressContentEditableWarning
                    aria-label="编辑签名"
                    role="textbox"
                    className={clsx(
                      SIGNATURE_TEXT_CLASS,
                      SIGNATURE_VISIBLE_FRAME_CLASS,
                      'min-h-[1.75rem] cursor-text outline-none'
                    )}
                    data-placeholder={SIGNATURE_PLACEHOLDER}
                    onInput={handleSignatureInput}
                    onBlur={() => {
                      void saveSignature();
                    }}
                    onCompositionStart={() => {
                      signatureComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      signatureComposingRef.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || signatureComposingRef.current) {
                        return;
                      }
                      event.preventDefault();
                      event.currentTarget.blur();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={clsx(
                      SIGNATURE_TEXT_CLASS,
                      SIGNATURE_HOVER_FRAME_CLASS,
                      'cursor-text outline-none'
                    )}
                    onClick={(event) => {
                      if (!signatureSaving) {
                        signatureClickPointRef.current = {
                          x: event.clientX,
                          y: event.clientY,
                        };
                        setSignatureEditing(true);
                      }
                    }}
                  >
                    {displaySignature || SIGNATURE_PLACEHOLDER}
                  </button>
                )}
              </div>
            </div>

            <Link
              to="/settings/profile"
              className="theme-button-secondary inline-flex shrink-0 items-center gap-1.5 self-start px-3 py-1.5 text-sm transition-all"
            >
              <Settings size={14} /> 设置
            </Link>
          </div>

        </section>

        <div className="mt-4">
          <div className="min-w-0">
            <nav className="flex flex-wrap items-center gap-1 border-b border-border">
              {PROFILE_TABS.map((profileTab) => (
                <Link
                  key={profileTab.id}
                  to={profileTab.id === 'profile' ? '/profile' : `/profile/${profileTab.id}`}
                  className={clsx(
                    'relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors whitespace-nowrap',
                    activeTab === profileTab.id
                      ? 'text-brand-gold'
                      : 'text-text-secondary hover:text-brand-gold',
                  )}
                >
                  {profileTab.icon}
                  {profileTab.label}
                  {activeTab === profileTab.id && (
                    <span className="absolute bottom-[-1px] left-3 right-3 h-px bg-[var(--color-theme-accent)]" />
                  )}
                </Link>
              ))}
            </nav>

            <div className="pt-2">
              {activeTab === 'profile' ? (
                <section className={TAB_PANEL_CLASS}>
                  {bio ? (
                    <div className="prose max-w-none text-sm leading-8 text-text-secondary">
                      <MarkdownRenderer content={bio} />
                    </div>
                  ) : (
                    <p className="max-w-[72ch] text-sm leading-8 text-text-secondary">
                      这位粉丝很神秘，还没有写下任何简介...
                    </p>
                  )}
                </section>
              ) : activeTab === 'posts' ? (
                <section className={TAB_PANEL_CLASS}>
                  {postsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-brand-gold" />
                    </div>
                  ) : myPosts.length > 0 ? (
                    <ul>
                      {myPosts.map((post) => (
                        <li key={post.id} className="border-b border-border last:border-b-0">
                          <Link
                            to={`/forum/${post.id}`}
                            className="group block py-3 transition-colors hover:text-brand-gold"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em]">
                                  <span
                                    className={clsx(
                                      'px-2 py-0.5 rounded border',
                                      getStatusClassName(
                                        post.status as 'draft' | 'pending' | 'published' | 'rejected',
                                      ),
                                    )}
                                  >
                                    {getStatusText(post.status as 'draft' | 'pending' | 'published' | 'rejected')}
                                  </span>
                                  <span className="text-text-muted">{post.section}</span>
                                </div>
                                <p className="mt-2 truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                                  {post.title}
                                </p>
                              </div>
                              <p className="shrink-0 whitespace-nowrap text-xs text-text-muted">
                                {format(new Date(post.createdAt), 'MM-dd HH:mm')}
                              </p>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState message="暂无帖子" />
                  )}
                </section>
              ) : activeTab === 'comments' ? (
                <section className={TAB_PANEL_CLASS}>
                  {commentsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-brand-gold" />
                    </div>
                  ) : myComments.length > 0 ? (
                    <ul>
                      {myComments.map((comment) => (
                        <li key={comment.id} className="border-b border-border last:border-b-0 py-3">
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                              <span>回复了</span>
                              {comment.post ? (
                                <Link to={`/forum/${comment.post.id}`} className="text-brand-gold hover:underline">
                                  {comment.post.title}
                                </Link>
                              ) : (
                                <span>原帖子已删除</span>
                              )}
                            </div>
                            <p className="max-w-[72ch] text-sm leading-7 text-text-secondary">
                              {comment.content}
                            </p>
                            <p className="text-xs text-text-muted">
                              {format(new Date(comment.createdAt), 'MM-dd HH:mm')}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState message="暂无评论" />
                  )}
                </section>
              ) : activeTab === 'history' ? (
                <section className={TAB_PANEL_CLASS}>
                  {historyLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-brand-gold" />
                    </div>
                  ) : myHistory.length > 0 ? (
                    <ul>
                      {myHistory.map((item) => (
                        <li key={item.id} className="border-b border-border last:border-b-0">
                          <Link
                            to={
                              item.targetType === 'wiki'
                                ? `/wiki/${item.target?.slug || item.targetId}`
                                : item.targetType === 'post'
                                  ? `/forum/${item.target?.id || item.targetId}`
                                  : '/music'
                            }
                            className="group block py-3 transition-colors hover:text-brand-gold"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em]">
                                  <span
                                    className={clsx(
                                      'px-2 py-0.5 rounded border',
                                      item.targetType === 'wiki'
                                        ? 'theme-tag'
                                        : item.targetType === 'post'
                                          ? 'theme-tag'
                                          : 'bg-surface-alt text-text-muted',
                                    )}
                                  >
                                    {item.targetType === 'wiki'
                                      ? '百科'
                                      : item.targetType === 'post'
                                        ? '帖子'
                                        : '音乐'}
                                  </span>
                                </div>
                                <p className="mt-2 truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                                  {item.target?.title || item.targetId}
                                </p>
                                <p className="mt-1 truncate text-xs text-text-muted">
                                  {item.target?.category || (item.targetType === 'post' ? '社区帖子' : '')}
                                </p>
                              </div>
                              <p className="shrink-0 whitespace-nowrap text-xs text-text-muted">
                                {format(new Date(item.createdAt), 'MM-dd HH:mm')}
                              </p>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState message="暂无浏览历史" />
                  )}
                </section>
              ) : (
                <section className={TAB_PANEL_CLASS}>
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
                          'px-3 py-1.5 text-xs transition-colors border',
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
                    <ul className="mt-4">
                      {groupedFavorites.map((item) => (
                        <li key={item.id} className="border-b border-border last:border-b-0">
                          <Link
                            to={item.href}
                            className="group block py-3 transition-colors hover:text-brand-gold"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em]">
                                  <span
                                    className={clsx(
                                      'px-2 py-0.5 rounded border',
                                      item.targetType === 'wiki'
                                        ? 'theme-tag'
                                        : item.targetType === 'post'
                                          ? 'theme-tag'
                                          : 'bg-surface-alt text-text-muted',
                                    )}
                                  >
                                    {item.targetType === 'wiki'
                                      ? '百科'
                                      : item.targetType === 'post'
                                        ? '帖子'
                                        : '音乐'}
                                  </span>
                                </div>
                                <p className="mt-2 truncate text-sm font-medium text-text-primary group-hover:text-brand-gold">
                                  {item.title}
                                </p>
                                <p className="mt-1 truncate text-xs text-text-muted">{item.subtitle}</p>
                              </div>
                              <p className="shrink-0 whitespace-nowrap text-xs text-text-muted">
                                {item.createdAt?.slice(0, 10)}
                              </p>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState message="暂无收藏内容" />
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
