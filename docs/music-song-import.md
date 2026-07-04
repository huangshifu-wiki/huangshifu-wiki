# 批量导入歌曲

项目提供 `songs:import` 命令，用于从 JSON 文件批量导入歌曲资料。该命令会读取 `.env.local` 和 `.env`，连接 `DATABASE_URL` 指向的数据库，并按 `UPLOADS_PATH` 决定封面文件落盘目录。

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

如果要按平台 ID 解析封面并保存到本地上传目录，正式导入时加 `--resolve-covers`：

```bash
npm run songs:import -- huangshifu-songs.json --yes --duplicates=fill --resolve-covers
```

如果要把预览结果复制到 issue、PR 或文档中，可以输出 Markdown 表格：

```bash
npm run songs:import -- huangshifu-songs.json --dry-run --markdown
```

等价写法：

```bash
npm run songs:import -- huangshifu-songs.json --dry-run --preview-format=markdown
```

检查歌曲封面最终会写入哪个目录，不读取 JSON、不连接数据库：

```bash
npm run songs:import -- --print-output-path
```

`--duplicates` 可选值：

- `fill`：只补全已有歌曲的空字段，默认推荐。
- `overwrite`：用 JSON 内容覆盖已有歌曲字段。
- `skip`：遇到已有歌曲直接跳过。

`--preview-format` 可选值：

- `table`：默认终端表格。
- `markdown`：Markdown 表格。

不传 `--duplicates` 时，命令会在发现重复歌曲后询问批量策略，也可以选择 `review` 逐条决定。

## 参数说明

| 参数                        | 说明                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| `--dry-run`                 | 只预览，不写入数据库。dry-run 仍会查询数据库，用于判断重复和来源冲突。 |
| `--yes`                     | 跳过确认，必须配合 `--duplicates=<action>`。                           |
| `--duplicates=<action>`     | 重复歌曲策略：`fill`、`overwrite`、`skip`。                            |
| `--resolve-covers`          | 正式导入时按平台 ID 解析封面并本地保存，dry-run 不解析。               |
| `--preview-format=<format>` | 预览表格格式：`table` 或 `markdown`。                                  |
| `--markdown`                | 等同于 `--preview-format=markdown`。                                   |
| `--print-output-path`       | 只输出歌曲封面落盘目录和公开 URL 形态，不读取 JSON、不连接数据库。     |

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
- 带 `--resolve-covers` 正式导入时，会按平台 ID 尝试解析封面并保存到本地上传目录。
- dry-run 不会解析或保存封面。

## 上传目录与 Docker 自动修正

脚本会在启动时读取 `.env.local` 和 `.env`。封面文件的上传根目录按下面规则决定：

1. 如果 `UPLOADS_PATH` 有值，使用 `UPLOADS_PATH`。
2. 如果 `UPLOADS_PATH` 为空，使用项目根目录下的 `uploads/`。

歌曲封面会写入：

```text
<上传根目录>/music-covers/songs/<年>/<月>/<uuid>.<ext>
```

公开 URL 形态是：

```text
/uploads/music-covers/songs/<年>/<月>/<uuid>.<ext>
```

Docker 部署常见 `.env` 会设置：

```env
UPLOADS_PATH="/app/uploads"
DATABASE_URL="postgresql://...@postgres:5432/huangshifu_wiki"
```

这两个值在容器内是正确的，但在宿主机直接执行脚本时容易写错位置或连不上数据库。脚本会自动识别这种场景：

- 如果宿主机执行时发现 `UPLOADS_PATH=/app/uploads`，自动改为项目根目录的 `uploads/`。
- 如果宿主机执行时发现 `DATABASE_URL` 使用 `postgres:5432`，且本机 `127.0.0.1:5432` 可连接，自动改为 `127.0.0.1:5432`。
- 如果本机 `127.0.0.1:5432` 不可连接，会提前报错，提示先暴露 PostgreSQL 端口或改到容器内执行。
- 自动修正只影响当前脚本进程，不会修改 `.env` 文件。

如需禁用自动修正，可设置：

```bash
SONGS_IMPORT_DISABLE_DOCKER_HOST_ENV_FIX=1 npm run songs:import -- --print-output-path
```

Docker 宿主机执行导入前，建议先检查落盘目录：

```bash
npm run songs:import -- --print-output-path
```

输出中的 `歌曲封面目录` 应该指向部署目录下的 `uploads/music-covers/...`，例如：

```text
/opt/docker/huangshifu-wiki/uploads/music-covers/songs/2026/07
```

## 建议流程

1. 确认 `.env.local` 或 `.env` 中的 `DATABASE_URL` 指向目标数据库。
2. 如需导入封面，先检查歌曲封面落盘目录：

   ```bash
   npm run songs:import -- --print-output-path
   ```

3. 运行 dry-run：

   ```bash
   npm run songs:import -- huangshifu-songs.json --dry-run
   ```

4. 检查统计中的新建、重复、校验失败和来源冲突数量。
5. 少量重复时直接交互执行：

   ```bash
   npm run songs:import -- huangshifu-songs.json
   ```

6. 明确策略后可无人值守执行：

   ```bash
   npm run songs:import -- huangshifu-songs.json --yes --duplicates=fill
   ```

7. 如果需要解析并保存平台封面：

   ```bash
   npm run songs:import -- huangshifu-songs.json --yes --duplicates=fill --resolve-covers
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

### `--dry-run --resolve-covers` 会保存封面吗？

不会。`--resolve-covers` 只在正式写入时生效，dry-run 不会下载或保存封面。

### 页面封面 404 怎么排查？

先查看脚本当前会写入哪里：

```bash
npm run songs:import -- --print-output-path
```

再检查数据库 URL 对应的公开路径文件是否存在于应用实际服务的上传目录。Docker 部署中，容器内 `/app/uploads` 应该对应宿主机项目目录下的 `./uploads`。

如果曾在宿主机直接用 `UPLOADS_PATH=/app/uploads` 导入，封面可能误写到了宿主机自己的 `/app/uploads`。修复方式是把误写的 `music-covers` 同步到项目 `./uploads/music-covers`，并修正权限。

### 宿主机执行时仍提示 `postgres:5432` 不可达怎么办？

Docker 部署中，`postgres` 是 Compose 网络内服务名。宿主机执行脚本时，脚本会尝试自动改用 `127.0.0.1:5432`。如果仍失败，说明 PostgreSQL 没有暴露到宿主机本地端口。

在 `docker-compose.yml` 的 `postgres` 服务下加入：

```yaml
ports:
  - '127.0.0.1:5432:5432'
```

然后执行：

```bash
docker compose up -d postgres
```

### 如何避免误覆盖人工编辑？

使用默认的 `fill` 策略。它只补空字段，不覆盖已有非空字段。

### 导入后前台列表没有立即更新怎么办？

导入执行成功后会失效 `music_list:` 缓存。刷新页面后应能看到新数据。
