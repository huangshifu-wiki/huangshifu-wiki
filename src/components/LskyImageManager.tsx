import React, { useState } from 'react'
import { useLskyUpload } from '../hooks/useLskyUpload'
import { useLskyPhotos } from '../hooks/useLskyPhotos'
import { useLskyAlbums } from '../hooks/useLskyAlbums'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

export function LskyImageManager() {
  const [activeTab, setActiveTab] = useState<'upload' | 'photos' | 'albums'>('upload')

  return (
    <div className="lsky-manager">
      <style>{`
        .lsky-manager {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        .lsky-tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          border-bottom: 2px solid var(--color-border);
        }
        .lsky-tab {
          padding: 10px 20px;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: var(--color-text-secondary);
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
        }
        .lsky-tab.active {
          color: var(--color-theme-accent);
          border-bottom-color: var(--color-theme-accent);
        }
        .lsky-upload-area {
          border: 2px dashed var(--color-border);
          border-radius: 8px;
          padding: 40px;
          text-align: center;
          background: var(--color-surface-form);
          cursor: pointer;
          transition: all 0.3s;
        }
        .lsky-upload-area:hover {
          border-color: var(--color-theme-accent);
          background: color-mix(in srgb, var(--color-theme-accent) 10%, var(--color-surface-form));
        }
        .lsky-upload-area.uploading {
          pointer-events: none;
          opacity: 0.6;
        }
        .lsky-progress {
          width: 100%;
          height: 8px;
          background: var(--color-surface-error);
          border-radius: 4px;
          margin-top: 10px;
          overflow: hidden;
        }
        .lsky-progress-bar {
          height: 100%;
          background: var(--color-theme-accent);
          transition: width 0.3s;
        }
        .lsky-error {
          color: var(--color-error);
          padding: 10px;
          background: color-mix(in srgb, var(--color-error) 10%, var(--color-surface));
          border-radius: 4px;
          margin-top: 10px;
        }
        .lsky-success {
          color: var(--color-success-hover);
          padding: 10px;
          background: color-mix(in srgb, var(--color-success) 10%, var(--color-surface));
          border-radius: 4px;
          margin-top: 10px;
        }
        .lsky-photos-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 16px;
        }
        .lsky-photo-card {
          border: 1px solid var(--color-border-light);
          border-radius: 8px;
          overflow: hidden;
          transition: all 0.3s;
          background: var(--color-surface);
        }
        .lsky-photo-card:hover {
          box-shadow: var(--shadow-theme-card);
        }
        .lsky-photo-card img {
          width: 100%;
          height: 150px;
          object-fit: cover;
        }
        .lsky-photo-info {
          padding: 10px;
        }
        .lsky-photo-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        .lsky-btn {
          padding: 6px 12px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          color: var(--color-text-secondary);
        }
        .lsky-btn:hover {
          color: var(--color-theme-accent);
          border-color: var(--color-theme-accent);
        }
        .lsky-btn.danger:hover {
          color: var(--color-error);
          border-color: var(--color-error);
        }
        .lsky-albums-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .lsky-album-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border: 1px solid var(--color-border-light);
          border-radius: 8px;
          background: var(--color-surface);
        }
        .lsky-album-info h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
        }
        .lsky-album-info p {
          margin: 0;
          color: var(--color-text-placeholder);
          font-size: 14px;
        }
        .lsky-empty {
          text-align: center;
          padding: 40px;
          color: var(--color-text-placeholder);
        }
        .lsky-loading {
          text-align: center;
          padding: 40px;
          color: var(--color-text-secondary);
        }
      `}</style>

      <h2>Lsky Pro+ 图床管理</h2>

      <div className="lsky-tabs">
        <button
          className={`lsky-tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          上传图片
        </button>
        <button
          className={`lsky-tab ${activeTab === 'photos' ? 'active' : ''}`}
          onClick={() => setActiveTab('photos')}
        >
          图片列表
        </button>
        <button
          className={`lsky-tab ${activeTab === 'albums' ? 'active' : ''}`}
          onClick={() => setActiveTab('albums')}
        >
          相册管理
        </button>
      </div>

      {activeTab === 'upload' && <UploadPanel />}
      {activeTab === 'photos' && <PhotosPanel />}
      {activeTab === 'albums' && <AlbumsPanel />}
    </div>
  )
}

function UploadPanel() {
  const { uploading, progress, error, data, upload, reset } = useLskyUpload()
  const { show } = useToast()
  const [imageUrl, setImageUrl] = useState<string>('')

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const result = await upload(file)
    if (result) {
      setImageUrl(result.url)
    }
  }

  const handleCopyUrl = () => {
    if (imageUrl) {
      navigator.clipboard.writeText(imageUrl)
      show('URL 已复制到剪贴板')
    }
  }

  return (
    <div>
      <div
        className={`lsky-upload-area ${uploading ? 'uploading' : ''}`}
        onClick={() => !uploading && document.getElementById('lsky-file-input')?.click()}
        onKeyDown={(event) => {
          if (!uploading && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            document.getElementById('lsky-file-input')?.click()
          }
        }}
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-disabled={uploading}
        data-press-feedback="state"
      >
        <input
          id="lsky-file-input"
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          disabled={uploading}
        />
        {uploading ? (
          <div>
            <p>上传中...</p>
            <div className="lsky-progress">
              <div className="lsky-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '18px', marginBottom: '8px' }}>点击或拖拽图片到此处上传</p>
            <p className="text-[var(--color-text-placeholder)]">支持 JPG, PNG, GIF, WebP 等格式</p>
          </div>
        )}
      </div>

      {error && <div className="lsky-error">❌ {error}</div>}

      {data && (
        <div className="lsky-success">
          <p>✅ 上传成功！</p>
          <p>
            <strong>文件名：</strong>
            {data.origin_name}
          </p>
          <p>
            <strong>大小：</strong>
            {(data.size / 1024).toFixed(2)} KB
          </p>
          <p>
            <strong>尺寸：</strong>
            {data.info.width} x {data.info.height}
          </p>
          <div style={{ marginTop: '10px' }}>
            <input
              type="text"
              value={data.url}
              readOnly
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
              }}
            />
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <button className="lsky-btn" onClick={handleCopyUrl}>
                复制 URL
              </button>
              <button className="lsky-btn" onClick={reset}>
                继续上传
              </button>
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <img
              src={data.url}
              alt="Uploaded"
              style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PhotosPanel() {
  const { loading, error, photos, pagination, fetchPhotos, deletePhoto } = useLskyPhotos()
  const dialog = useDialog()

  const handleDelete = async (id: number) => {
    const confirmed = await dialog.confirm({
      title: '删除图片',
      message: '确定要删除这张图片吗？',
      confirmText: '删除',
      variant: 'danger',
    })
    if (confirmed) await deletePhoto(id)
  }

  if (loading) {
    return <div className="lsky-loading">加载中...</div>
  }

  if (error) {
    return <div className="lsky-error">❌ {error}</div>
  }

  if (photos.length === 0) {
    return <div className="lsky-empty">暂无图片</div>
  }

  return (
    <div>
      <div className="lsky-photos-grid">
        {photos.map((photo) => (
          <div key={photo.id} className="lsky-photo-card">
            <img src={photo.url} alt={photo.filename} />
            <div className="lsky-photo-info">
              <p
                style={{
                  fontSize: '14px',
                  margin: '0 0 4px 0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {photo.origin_name}
              </p>
              <p className="text-xs text-[var(--color-text-placeholder)] m-0">
                {(photo.size / 1024).toFixed(2)} KB
              </p>
              <div className="lsky-photo-actions">
                <button
                  className="lsky-btn"
                  onClick={() => navigator.clipboard.writeText(photo.url)}
                >
                  复制
                </button>
                <button className="lsky-btn danger" onClick={() => handleDelete(photo.id)}>
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {pagination && pagination.last_page > 1 && (
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            className="lsky-btn"
            onClick={() => fetchPhotos({ page: pagination.current_page - 1 })}
            disabled={pagination.current_page === 1}
          >
            上一页
          </button>
          <span style={{ margin: '0 10px' }}>
            {pagination.current_page} / {pagination.last_page}
          </span>
          <button
            className="lsky-btn"
            onClick={() => fetchPhotos({ page: pagination.current_page + 1 })}
            disabled={pagination.current_page === pagination.last_page}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

function AlbumsPanel() {
  const { loading, error, albums, createAlbum, deleteAlbum } = useLskyAlbums()
  const dialog = useDialog()
  const { show } = useToast()
  const [showCreate, setShowCreate] = useState(false)
  const [newAlbumName, setNewAlbumName] = useState('')
  const [newAlbumDesc, setNewAlbumDesc] = useState('')

  const handleCreate = async () => {
    if (!newAlbumName.trim()) {
      show('请输入相册名称', { variant: 'error' })
      return
    }

    const result = await createAlbum({
      name: newAlbumName,
      description: newAlbumDesc,
    })

    if (result) {
      setShowCreate(false)
      setNewAlbumName('')
      setNewAlbumDesc('')
      show('相册创建成功')
    }
  }

  const handleDelete = async (id: number) => {
    const confirmed = await dialog.confirm({
      title: '删除相册',
      message: '确定要删除这个相册吗？',
      confirmText: '删除',
      variant: 'danger',
    })
    if (confirmed) await deleteAlbum(id)
  }

  if (loading) {
    return <div className="lsky-loading">加载中...</div>
  }

  if (error) {
    return <div className="lsky-error">❌ {error}</div>
  }

  return (
    <div>
      <button
        className="lsky-btn"
        onClick={() => setShowCreate(!showCreate)}
        style={{ marginBottom: '16px' }}
      >
        {showCreate ? '取消' : '+ 新建相册'}
      </button>

      {showCreate && (
        <div className="p-4 border border-[var(--color-surface-error)] rounded-lg mb-4 bg-[var(--color-surface-form)]">
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>相册名称 *</label>
            <input
              type="text"
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
              }}
              placeholder="输入相册名称"
            />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>相册描述</label>
            <textarea
              value={newAlbumDesc}
              onChange={(e) => setNewAlbumDesc(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                minHeight: '60px',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
              }}
              placeholder="输入相册描述（可选）"
            />
          </div>
          <button
            className="lsky-btn bg-[var(--color-theme-accent)] text-white border-none"
            onClick={handleCreate}
          >
            创建相册
          </button>
        </div>
      )}

      {albums.length === 0 ? (
        <div className="lsky-empty">暂无相册</div>
      ) : (
        <div className="lsky-albums-list">
          {albums.map((album) => (
            <div key={album.id} className="lsky-album-item">
              <div className="lsky-album-info">
                <h3>{album.name}</h3>
                <p>{album.description || '暂无描述'}</p>
                <p style={{ fontSize: '12px' }}>图片数量：{album.photo_count}</p>
              </div>
              <div>
                <button className="lsky-btn danger" onClick={() => handleDelete(album.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
