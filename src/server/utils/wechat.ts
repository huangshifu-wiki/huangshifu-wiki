// 微信小程序登录

import axios from 'axios';
import { prisma, WECHAT_MP_APPID, WECHAT_MP_APP_SECRET, WECHAT_LOGIN_MOCK } from './config';
import { enhancedCache, CACHE_KEYS } from './cache';
import type { WechatCodeSessionResponse } from '../types';

axios.defaults.timeout = 5000;

export function createWechatPlaceholderEmail(openId: string) {
  const safe = openId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  const fallback = safe || `wx_${Date.now().toString(36)}`;
  return `${fallback}@wechat.local`;
}

export function isWechatPlaceholderEmail(email?: string | null) {
  return Boolean(email?.trim().toLowerCase().endsWith('@wechat.local'));
}

export async function exchangeWechatLoginCode(rawCode: string): Promise<{ openId: string; unionId: string | null }> {
  const code = rawCode.trim();
  if (!code) {
    throw new Error('缺少 code');
  }

  if (WECHAT_LOGIN_MOCK) {
    const mockPayload = code.replace(/^mock:/, '');
    const [openIdPart, unionIdPart] = mockPayload.split(':');
    const openId = (openIdPart || `mock_openid_${Date.now().toString(36)}`).slice(0, 128);
    const unionId = unionIdPart ? unionIdPart.slice(0, 128) : null;
    return { openId, unionId };
  }

  const usedKey = `${CACHE_KEYS.AUTH_USER}:wechat_code:${code}`;
  if (enhancedCache.get(usedKey)) {
    throw new Error('该登录凭证已使用，请重新获取');
  }

  if (!WECHAT_MP_APPID || !WECHAT_MP_APP_SECRET) {
    throw new Error('服务器未配置微信登录参数');
  }

  const response = await axios.get<WechatCodeSessionResponse>('https://api.weixin.qq.com/sns/jscode2session', {
    params: {
      appid: WECHAT_MP_APPID,
      secret: WECHAT_MP_APP_SECRET,
      js_code: code,
      grant_type: 'authorization_code',
    },
    timeout: 10_000,
  });

  const data = response.data;
  if (typeof data?.errcode === 'number' && data.errcode !== 0) {
    throw new Error(`微信登录失败：${data.errmsg || `errcode=${data.errcode}`}`);
  }

  if (!data?.openid) {
    throw new Error('微信登录失败：未获取到 openid');
  }

  enhancedCache.set(usedKey, true, 300);

  return {
    openId: data.openid,
    unionId: data.unionid || null,
  };
}

export async function buildUniqueWechatEmail(openId: string): Promise<string> {
  const base = createWechatPlaceholderEmail(openId);
  const [name, domain] = base.split('@');
  let candidate = base;

  for (let i = 0; i < 8; i += 1) {
    const existing = await prisma.user.findUnique({
      where: { email: candidate },
      select: { uid: true },
    });
    if (!existing) {
      return candidate;
    }
    candidate = `${name}_${i + 1}@${domain || 'wechat.local'}`;
  }

  return `${name}_${Date.now().toString(36)}@${domain || 'wechat.local'}`;
}
