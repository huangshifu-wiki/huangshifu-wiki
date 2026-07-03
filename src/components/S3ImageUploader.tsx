import React, { useCallback, useRef, useState } from 'react'
import {
  Upload,
  Image as ImageIcon,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  X,
} from '@/src/components/icons'
import { useS3Upload } from '../hooks/useS3Upload'
import { apiGet } from '../lib/apiClient'
import { UPLOAD_MAX_FILE_SIZE_BYTES, formatUploadLimit } from '../lib/uploadLimits'

export interface S3ImageUploaderProps {
  onUpload?: (url: string, key: string, md5?: string) => void
  onError?: (error: Error) => void
  bucket?: 'public' | 'private'
  maxSize?: number
  accept?: string
  className?: string
  enableMd5Verification?: boolean
}

interface ValidationResult {
  valid: boolean
  error?: string
}

const DEFAULT_MAX_SIZE = UPLOAD_MAX_FILE_SIZE_BYTES
const DEFAULT_ACCEPT = 'image/*'

export const S3ImageUploader: React.FC<S3ImageUploaderProps> = ({
  onUpload,
  onError,
  bucket = 'public',
  maxSize = DEFAULT_MAX_SIZE,
  accept = DEFAULT_ACCEPT,
  className = '',
  enableMd5Verification = true,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { upload, uploading, progress, error, reset } = useS3Upload()

  const validateFile = useCallback(
    (file: File): ValidationResult => {
      if (!accept.includes('*')) {
        const acceptTypes = accept.split(',').map((t) => t.trim())
        const isAccepted = acceptTypes.some((type) => {
          if (type.startsWith('.')) return file.name.toLowerCase().endsWith(type.toLowerCase())
          if (type.endsWith('/*')) return file.type.startsWith(type.replace('/*', '/'))
          return file.type === type
        })
        if (!isAccepted)
          return { valid: false, error: `不支持的文件类型，请上传 ${accept} 格式的图片` }
      }
      if (file.size > maxSize) {
        return { valid: false, error: `文件大小超过限制，${formatUploadLimit(maxSize)}` }
      }
      return { valid: true }
    },
    [accept, maxSize]
  )

  const generatePreview = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleFile = useCallback(
    async (file: File) => {
      setValidationError(null)
      const validation = validateFile(file)
      if (!validation.valid) {
        setValidationError(validation.error || '文件验证失败')
        return
      }
      generatePreview(file)
      try {
        const { key, md5 } = await upload(file, { contentType: file.type, enableMd5Verification })
        const config = await apiGet<{
          enabled: boolean
          endpoint: string
          bucket: string
          publicDomain?: string
          region: string
        }>('/api/s3/config')
        const url = config.publicDomain
          ? `${config.publicDomain}/${key}`
          : `${config.endpoint}/${config.bucket}/${key}`
        setUploadedUrl(url)
        setUploadedKey(key)
        onUpload?.(url, key, md5)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        onError?.(e)
      }
    },
    [upload, validateFile, generatePreview, onUpload, onError, enableMd5Verification]
  )

  const handleRemove = useCallback(() => {
    setPreviewUrl(null)
    setUploadedUrl(null)
    setUploadedKey(null)
    setValidationError(null)
    reset()
    if (inputRef.current) inputRef.current.value = ''
  }, [reset])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  return (
    <div className={`space-y-3 ${className}`}>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-brand-gold bg-brand-gold/10'
            : 'border-border hover:border-brand-gold'
        } ${uploading ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        {previewUrl && !uploading && !error ? (
          <div className="relative">
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-56 mx-auto rounded object-contain"
            />
            {!uploadedUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemove()
                }}
                className="absolute top-2 right-2 p-1 theme-button-danger rounded"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : uploading ? (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded bg-brand-gold/10 flex items-center justify-center">
                <Upload size={28} className="text-brand-gold animate-pulse" />
              </div>
            </div>
            <div>
              <p className="text-sm text-text-secondary">上传中...</p>
              <div className="w-full bg-border rounded h-1.5 mt-2">
                <div
                  className="bg-[var(--color-theme-accent)] h-1.5 rounded transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-text-muted mt-1">{progress}%</p>
            </div>
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded theme-bg-error-soft flex items-center justify-center">
                <AlertCircle size={28} className="theme-text-error" />
              </div>
            </div>
            <div>
              <p className="text-sm theme-text-error font-medium">上传失败</p>
              <p className="text-xs theme-text-error mt-1">{error.message}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRemove()
              }}
              className="text-sm text-brand-gold hover:underline"
            >
              <RefreshCw size={13} className="inline mr-1" />
              重新上传
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded bg-surface-alt flex items-center justify-center">
                <ImageIcon size={28} className="text-text-muted" />
              </div>
            </div>
            <div>
              <p className="text-sm text-text-secondary">
                拖拽图片到此处，或 <span className="text-brand-gold font-medium">点击选择</span>
              </p>
              <p className="text-xs text-text-muted mt-1">
                支持 {accept === 'image/*' ? '图片' : accept}，{formatUploadLimit(maxSize)}
              </p>
            </div>
          </div>
        )}

        {validationError && (
          <div className="mt-3 p-2 theme-bg-error-soft rounded text-sm theme-text-error">
            {validationError}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {uploadedUrl && (
        <div className="p-3 theme-bg-success-soft rounded border theme-border-success-soft">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={15} className="theme-text-success" />
            <span className="text-sm font-medium theme-text-success">上传成功</span>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-text-muted break-all">Key: {uploadedKey}</p>
          </div>
          <button onClick={handleRemove} className="mt-2 text-sm text-brand-gold hover:underline">
            删除并重新上传
          </button>
        </div>
      )}
    </div>
  )
}
