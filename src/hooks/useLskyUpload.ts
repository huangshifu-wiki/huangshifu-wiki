import { useState, useCallback } from 'react';
import { type UploadV2Data } from '../lib/lskyClient';
import { useLskyGeneric } from './useLskyGeneric';

interface UseLskyUploadOptions {
  baseUrl?: string;
  token?: string;
  autoLogin?: boolean;
  loginCredentials?: {
    email: string;
    password: string | number;
  };
}

interface UploadState {
  uploading: boolean;
  progress: number;
  error: string | null;
  data: UploadV2Data | null;
}

export function useLskyUpload(options: UseLskyUploadOptions = {}) {
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    error: null,
    data: null,
  });

  const { api, baseUrl, formatError } = useLskyGeneric({
    baseUrl: options.baseUrl,
    token: options.token,
  });

  const upload = useCallback(async (file: File | Blob, uploadOptions?: {
    album_id?: number | string;
    permission?: '0' | '1' | '2';
    strategy_id?: number | string;
  }) => {
    if (!baseUrl) {
      setState(prev => ({ ...prev, error: 'LSKY_BASE_URL 未配置' }));
      return null;
    }

    setState({ uploading: true, progress: 0, error: null, data: null });

    try {
      if (options.autoLogin && options.loginCredentials) {
        setState(prev => ({ ...prev, progress: 10 }));
        await api.auth.login(options.loginCredentials);
      }

      setState(prev => ({ ...prev, progress: 30 }));

      const result = await api.upload(file, uploadOptions);

      setState({
        uploading: false,
        progress: 100,
        error: null,
        data: result.data,
      });

      return result.data;
    } catch (err) {
      setState({
        uploading: false,
        progress: 0,
        error: formatError(err, '上传失败'),
        data: null,
      });

      return null;
    }
  }, [baseUrl, options.autoLogin, options.loginCredentials, api, formatError]);

  const reset = useCallback(() => {
    setState({ uploading: false, progress: 0, error: null, data: null });
  }, []);

  return {
    ...state,
    upload,
    reset,
    api,
  };
}
