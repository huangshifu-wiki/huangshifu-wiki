import { useState, useEffect, useCallback } from 'react';
import { LskyProAPIError, type Photo, type PaginatedResponse } from '../lib/lskyClient';
import { useLskyGeneric } from './useLskyGeneric';

interface UseLskyPhotosOptions {
  baseUrl?: string;
  token?: string;
  autoFetch?: boolean;
  initialPage?: number;
  initialPerPage?: number;
}

interface PhotosState {
  loading: boolean;
  error: string | null;
  photos: Photo[];
  pagination: PaginatedResponse<Photo>['meta']['pagination'] | null;
}

export function useLskyPhotos(options: UseLskyPhotosOptions = {}) {
  const [state, setState] = useState<PhotosState>({
    loading: false,
    error: null,
    photos: [],
    pagination: null,
  });

  const { api, baseUrl, formatError } = useLskyGeneric({
    baseUrl: options.baseUrl,
    token: options.token,
  });

  const fetchPhotos = useCallback(async (params?: {
    page?: number;
    per_page?: number;
    keyword?: string;
    album_id?: number;
  }) => {
    if (!baseUrl) {
      setState(prev => ({ ...prev, error: 'LSKY_BASE_URL 未配置' }));
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await api.photos.list({
        page: params?.page ?? options.initialPage ?? 1,
        per_page: params?.per_page ?? options.initialPerPage ?? 20,
        keyword: params?.keyword,
        album_id: params?.album_id,
      });

      setState({
        loading: false,
        error: null,
        photos: result.data.data,
        pagination: result.data.meta.pagination,
      });
    } catch (err) {
      setState(prev => ({ ...prev, loading: false, error: formatError(err, '获取图片列表失败') }));
    }
  }, [baseUrl, options.initialPage, options.initialPerPage, api, formatError]);

  const deletePhoto = useCallback(async (id: number) => {
    try {
      await api.photos.delete(id);
      setState(prev => ({
        ...prev,
        photos: prev.photos.filter(p => p.id !== id),
      }));
      return true;
    } catch (err) {
      setState(prev => ({ ...prev, error: formatError(err, '删除失败') }));
      return false;
    }
  }, [api, formatError]);

  const updatePhoto = useCallback(async (id: number, data: {
    album_id?: number | null;
    permission?: number;
    key?: string;
  }) => {
    try {
      const result = await api.photos.update(id, data);
      setState(prev => ({
        ...prev,
        photos: prev.photos.map(p => p.id === id ? result.data : p),
      }));
      return result.data;
    } catch (err) {
      setState(prev => ({ ...prev, error: formatError(err, '更新失败') }));
      return null;
    }
  }, [api, formatError]);

  useEffect(() => {
    if (options.autoFetch !== false) {
      fetchPhotos();
    }
  }, [options.autoFetch, fetchPhotos]);

  return {
    ...state,
    fetchPhotos,
    deletePhoto,
    updatePhoto,
    api,
  };
}
