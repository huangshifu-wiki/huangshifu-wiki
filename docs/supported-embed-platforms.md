# 支持的视频和音乐嵌入平台

## 概述

百科和论坛支持嵌入来自以下安全平台的视频和音乐播放器。所有嵌入内容都经过严格的域名白名单验证和安全过滤，防止 XSS 攻击。

## 支持的平台

### 视频平台

| 平台     | 域名                              | 嵌入说明     |
| -------- | --------------------------------- | ------------ |
| Bilibili | player. bilibili. com             | 支持视频嵌入 |
| YouTube  | youtube. com, www. youtube. com   | 支持视频嵌入 |
| 优酷     | player. youku. com                | 支持视频嵌入 |
| 爱奇艺   | open. iqiyi. com, www. iqiyi. com | 支持视频嵌入 |
| 微博视频 | weibo. com, www. weibo. com       | 支持视频嵌入 |
| Vimeo    | vimeo. com, player. vimeo. com    | 支持视频嵌入 |

### 音乐平台

| 平台       | 域名            | 嵌入说明       |
| ---------- | --------------- | -------------- |
| 网易云音乐 | music. 163. com | 支持音乐播放器 |
| QQ 音乐    | y. qq. com      | 支持音乐播放器 |

## 嵌入示例

### Bilibili 视频

```html
<iframe
  src="//player. bilibili. com/player. html?bvid=BV1xx411c7mD&page=1"
  width="100%"
  height="400"
  scrolling="no"
  frameborder="no"
  framespacing="0"
  allowfullscreen="true"
>
</iframe>
```

**获取方式：**

1. 打开 Bilibili 视频页面
2. 点击视频下方的「分享」按钮
3. 选择「嵌入代码」
4. 复制 iframe 代码

---

### 网易云音乐

```html
<iframe
  src="//music. 163. com/outchain/player?type=2&id=347230&auto=1&height=66"
  width="100%"
  height="86"
>
</iframe>
```

**获取方式：**

1. 打开网易云音乐歌曲页面
2. 点击「分享」-> 「生成外链播放器」
3. 复制 iframe 代码

---

### QQ 音乐

```html
<iframe
  src="https://y. qq. com/player. html?songmid=002R5xNn4B0UeM&type=2&auto=1&height=80"
  width="100%"
  height="80"
>
</iframe>
```

**获取方式：**

1. 打开 QQ 音乐歌曲页面
2. 点击「分享」-> 「复制外链」
3. 选择「iframe」格式

---

### YouTube 视频

```html
<iframe
  width="560"
  height="315"
  src="https://www. youtube. com/embed/dQw4w9WgXcQ"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
>
</iframe>
```

**获取方式：**

1. 打开 YouTube 视频页面
2. 点击「分享」-> 「嵌入」
3. 复制 iframe 代码

---

### 优酷视频

```html
<iframe src="https://player. youku. com/embed/XNTAwNDY4OTQ2NA==" width="100%" height="400">
</iframe>
```

**获取方式：**

1. 打开优酷视频页面
2. 点击「分享」-> 「嵌入代码」
3. 复制 iframe 代码

---

### 爱奇艺视频

```html
<iframe
  src="https://open. iqiyi. com/developer/player_js/ coopPlayerIndex. html?vid=123456789"
  width="100%"
  height="400"
>
</iframe>
```

---

### 微博视频

```html
<iframe
  src="https://weibo. com/tv/show/10 34:xxxxx"
  width="100%"
  height="400"
  frameborder="0"
  scrolling="no"
>
</iframe>
```

---

### Vimeo 视频

```html
<iframe
  src="https://player. vimeo. com/video/123456789"
  width="640"
  height="360"
  frameborder="0"
  allow="autoplay; fullscreen; picture-in-picture"
>
</iframe>
```

---

## 样式自定义

您可以使用 HTML 属性自定义嵌入播放器的样式：

```html
<iframe
  src="..."
  width="100%"
  height="400"
  style="border-radius: 12px; border: 1px solid #e5e7eb; margin: 32px 0;"
>
</iframe>
```

### 支持的样式属性

| 属性              | 说明     | 示例                            |
| ----------------- | -------- | ------------------------------- |
| `width`           | 宽度     | `width="100%"` 或 `width="640"` |
| `height`          | 高度     | `height="400"`                  |
| `style`           | 内联 CSS | `style="border-radius: 8px;"`   |
| `class`           | CSS 类名 | `class="my-video"`              |
| `frameborder`     | 边框     | `frameborder="0"`               |
| `allowfullscreen` | 全屏     | `allowfullscreen`               |
| `scrolling`       | 滚动条   | `scrolling="no"`                |

---

## 安全说明

### 为什么只支持部分平台？

为了保护用户安全，系统使用域名白名单机制：

- ❌ 不支持的平台嵌入将被**自动移除**
- ❌ 恶意脚本和危险 HTML 会被**自动过滤**
- ❌ 不支持 `javascript:`、`data:` 等危险协议
- ✅ 支持的平台经过安全审核，其嵌入代码可安全执行

### 域名验证规则

- 支持 `http://`、`https://` 和协议相对 URL `//`
- 支持子域名匹配（如 `api. music. 163. com` 匹配 `music. 163. com`）
- 自动去除 `www.` 前缀进行匹配

### 攻击防护示例

以下危险代码会被阻止：

```html
<!-- 脚本注入 - 会被阻止 -->
<script>
  alert('xss')
</script>

<!-- 事件处理器 - 会被阻止 -->
<div onclick="alert('xss')">点击</div>
<img src="x" onerror="alert('xss')" />

<!-- 危险协议 - 会被阻止 -->
<a href="javascript:alert('xss')">链接</a>
<iframe src="javascript:alert('xss')"> </iframe>

<!-- 未授权 iframe - 会被阻止 -->
<iframe src="https://evil. com/embed"> </iframe>
```

---

## 常见问题

### Q: 为什么我的视频无法显示？

请确认：

1. 您使用的平台是否在支持列表中
2. 嵌入代码使用了正确的域名
3. 视频未被原作者设置为「不可嵌入」

### Q: 可以嵌入其他平台的视频吗？

目前仅支持上表列出的平台。如需添加新平台请联系管理员。

### Q: 如何获取嵌入代码？

大多数平台在视频/音乐页面提供「分享」或「嵌入」按钮，点击即可获取标准嵌入代码。

### Q: 嵌入的播放器样式可以自定义吗？

可以。您可以使用 HTML 属性（`width`, `height`, `style`, `class`）自定义播放器外观。

---

## 技术实现

- **安全方案：** 基于 `rehype-sanitize` 和自定义域名白名单
- **域名验证：** 支持子域名匹配（如 `player. bilibili. com`）
- **协议支持：** 支持 `http://`、`https://` 和协议相对 URL `//`
- **前端组件：** Wiki 和 Forum 共用同一套安全过滤规则

---

## 相关文档

- [服务器部署与配置指南](./server-deployment. md) - 了解系统安全机制
- [Wiki 功能说明](./wiki-features. md) - 百科编辑器使用指南
