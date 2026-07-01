# 批量导入歌曲

项目提供 `songs:import` 命令，用于从 JSON 文件批量导入歌曲资料。该命令会读取 `.env.local` 和 `.env`，连接 `DATABASE_URL` 指向的数据库。

## 基本用法

先预览，不写入数据库：

```bash
npm run songs:import -- huangshifu-songs.json --dry-run
```

确认预览结果后执行导入：

```bash
npm run songs:import -- huangshifu-songs.json
```

如果要在服务器或脚本中跳过交互，必须显式指定重复项策略：

```bash
npm run songs:import -- huangshifu-songs.json --yes --duplicates=fill
```

如果要把预览结果复制到 issue、PR 或文档中，可以输出 Markdown 表格：

```bash
npm run songs:import -- huangshifu-songs.json --dry-run --markdown
```

等价写法：

```bash
npm run songs:import -- huangshifu-songs.json --dry-run --preview-format=markdown
```

`--duplicates` 可选值：

- `fill`：只补全已有歌曲的空字段，默认推荐。
- `overwrite`：用 JSON 内容覆盖已有歌曲字段。
- `skip`：遇到已有歌曲直接跳过。

`--preview-format` 可选值：

- `table`：默认终端表格。
- `markdown`：Markdown 表格。

不传 `--duplicates` 时，命令会在发现重复歌曲后询问批量策略，也可以选择 `review` 逐条决定。

## 支持的 JSON 格式

顶层可以是数组，也可以是包含 `songs` 数组的对象：

```json
{
  "songs": [
    {
      "title": "歌曲名",
      "artists": ["歌手"],
      "lyricists": ["作词"],
      "composers": ["作曲"],
      "arrangers": ["编曲"],
      "vocals": ["演唱"],
      "album": "专辑名",
      "audioUrl": "https://example.com/song.mp3",
      "coverUrl": "https://example.com/cover.jpg",
      "lyric": "[00:00]歌词",
      "description": "歌曲说明",
      "releaseDate": "2026-01-01",
      "durationMs": 180000,
      "sources": [
        {
          "platform": "netease",
          "sourceId": "123",
          "sourceUrl": "https://music.163.com/#/song?id=123",
          "isPrimary": true
        }
      ],
      "customPlatformLinks": [{ "label": "其他平台", "url": "https://example.com/song" }]
    }
  ]
}
```

必填字段：

- `title`
- `artists`

可用平台：

- `netease`
- `tencent`
- `kugou`
- `baidu`
- `kuwo`

## huangshifu-songs.json 兼容格式

命令也兼容当前 `huangshifu-songs.json` 的字段：

- `albumName` 会作为 `album` 使用。
- `platformRecords[].platformId` 会作为 `sources[].sourceId` 使用。
- `platformRecords[].url` 会作为 `sources[].sourceUrl` 使用。
- 主字段缺失时，会从第一条 `platformRecords` 补充歌手、制作名单、发行日期和时长。

示例：

```json
{
  "songs": [
    {
      "title": "归来",
      "artists": ["黄诗扶"],
      "albumName": "俱往矣",
      "releaseDate": "2017-12-17",
      "durationMs": 226032,
      "platformRecords": [
        {
          "platform": "netease",
          "platformId": "524782504",
          "url": "https://music.163.com/#/song?id=524782504"
        }
      ]
    }
  ]
}
```

## 匹配与重复处理

导入前会先预览每首歌的状态：

- 优先按平台来源匹配：`platform + sourceId`。
- 没有来源匹配时，再按 `title + artists` 匹配未删除歌曲。
- 如果来源 ID 已属于其他歌曲，会标记为来源冲突，不会自动挪动来源。

重复歌曲处理策略：

- `fill` 只写入已有歌曲为空的字段，并追加缺失的平台来源。
- `overwrite` 覆盖歌曲字段，并用 JSON 中的来源替换该歌曲现有来源。
- `skip` 不修改已有歌曲。

封面处理：

- 只有 JSON 提供 `coverUrl`，且目标歌曲没有歌曲封面、也没有继承专辑封面时，才会新增默认歌曲封面。
- 导入不会联网调用 Meting 补全播放地址、歌词或封面。

## 建议流程

1. 确认 `.env.local` 或 `.env` 中的 `DATABASE_URL` 指向目标数据库。
2. 运行 dry-run：

   ```bash
   npm run songs:import -- huangshifu-songs.json --dry-run
   ```

3. 检查统计中的新建、重复、校验失败和来源冲突数量。
4. 少量重复时直接交互执行：

   ```bash
   npm run songs:import -- huangshifu-songs.json
   ```

5. 明确策略后可无人值守执行：

   ```bash
   npm run songs:import -- huangshifu-songs.json --yes --duplicates=fill
   ```

## 常见问题

### 提示 `JSON 顶层必须是数组，或包含 songs 数组`

检查 JSON 顶层结构，必须是：

```json
[{ "title": "..." }]
```

或：

```json
{ "songs": [{ "title": "..." }] }
```

### 提示缺少歌曲标题或歌手

每条歌曲至少要有 `title` 和非空 `artists`。`artists` 可以是数组，也可以是项目通用的字符串列表输入格式。

### dry-run 查询了数据库，是不是会写入？

不会。dry-run 会读取数据库用于判断重复和来源冲突，但不会创建或更新歌曲。

### 如何避免误覆盖人工编辑？

使用默认的 `fill` 策略。它只补空字段，不覆盖已有非空字段。

### 导入后前台列表没有立即更新怎么办？

导入执行成功后会失效 `music_list:` 缓存。刷新页面后应能看到新数据。
