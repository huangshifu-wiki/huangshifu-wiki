#!/usr/bin/env python3
"""酷狗音乐 ID 转换工具。

把酷狗的任意分享链接 / mixsong 链接 / hash 统一解析成 FileHash，
并能反查歌曲信息（歌名、歌手、时长、专辑图片等）。

支持输入：
  1. 分享链接   https://m.kugou.com/share/song.html?chain=xxx
               https://www.kugou.com/share/xxx.html
  2. 混音链接   https://www.kugou.com/mixsong/xxx.html
  3. hash 链接  https://www.kugou.com/song/#hash=xxx
  4. 裸 hash    32 位十六进制

用法：
  python3 scripts/kugou-id.py <链接或 hash> [更多...]      # 逐个输出
  cat urls.txt | python3 scripts/kugou-id.py -            # 从 stdin 批量
  python3 scripts/kugou-id.py <链接> --json               # JSON 输出
  python3 scripts/kugou-id.py <链接> --only-hash          # 只输出 hash

只依赖 Python 标准库。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

HASH_RE = re.compile(r"^[0-9a-fA-F]{32}$")
DATA_RE = re.compile(r"dataFrom\w*\s*=\s*(\[.*?\])\s*;", re.DOTALL)
UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)


def fetch(url: str) -> str:
    """抓取网页，跟随重定向。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", "replace")


def parse_data_from_smarty(html: str) -> list[dict] | None:
    """提取页面内嵌 dataFromSmarty JSON。

    页面里变量以 `}],//当前页面歌曲信息` 结尾而不是 `];`，
    因此不能用贪婪到分号的正则；改用 raw_decode 从 `[` 精确截断。
    """
    decoder = json.JSONDecoder()
    for m in re.finditer(r"dataFrom\w*\s*=\s*(\[)", html):
        try:
            # m.start(1) 才是 `[` 的位置，整个匹配起点在 dataFrom 的 `d` 上
            data, _ = decoder.raw_decode(html, m.start(1))
        except json.JSONDecodeError:
            continue
        return data if isinstance(data, list) else [data]
    return None


def resolve_by_share_chain(chain: str) -> dict | None:
    """分享链 -> 页面内嵌 hash 信息。"""
    html = fetch(f"https://www.kugou.com/share/{chain}.html")
    data = parse_data_from_smarty(html)
    return data[0] if data else None


def resolve_by_mixsong(mixsong_id: str) -> dict | None:
    """mixsong 短 id -> 页面内嵌 hash 信息。"""
    html = fetch(f"https://www.kugou.com/mixsong/{mixsong_id}.html")
    data = parse_data_from_smarty(html)
    return data[0] if data else None


def resolve_by_hash(hash_value: str) -> dict | None:
    """hash -> getSongInfo 接口反查歌曲信息。"""
    url = "https://m.kugou.com/app/i/getSongInfo.php?" + urllib.parse.urlencode(
        {"cmd": "playInfo", "hash": hash_value.upper()}
    )
    html = fetch(url)
    try:
        payload = json.loads(html)
    except json.JSONDecodeError:
        return None
    if payload.get("errcode") != 0 or not payload.get("hash"):
        return None
    return {
        "hash": payload["hash"].upper(),
        "song_name": payload.get("songName") or payload.get("song_name", ""),
        "author_name": payload.get("author_name") or payload.get("singerName", ""),
        "timelength": (
            payload.get("timeLength")
            or payload.get("timelength")
            or payload.get("duration")
        ),
        "album_name": payload.get("album_name") or "",
        "imgUrl": payload.get("imgUrl") or payload.get("img_url") or "",
    }


def normalize(fields: dict) -> dict:
    """统一字段名，hash 大写。"""
    out = dict(fields)
    if out.get("hash"):
        out["hash"] = str(out["hash"]).upper()
    return out


def resolve_one(input_text: str) -> dict:
    """把一个输入解析成统一结果。"""
    text = input_text.strip()
    if not text:
        return {"input": input_text, "ok": False, "error": "空输入"}

    result = {"input": text, "ok": True}

    # 1) 纯 hash
    if HASH_RE.match(text):
        info = resolve_by_hash(text)
        if info is None:
            return {**result, "ok": False, "error": "hash 反查失败"}
        return {**result, **normalize(info)}

    # 2) share 链接（两种形式：m.kugou.com/share/song.html?chain=xxx 和
    #    www.kugou.com/share/xxx.html）
    m = re.search(r"share/(?:song\.html\?chain=)?([A-Za-z0-9_-]+)", text)
    if m:
        info = resolve_by_share_chain(m.group(1))
        if info is None:
            return {**result, "ok": False, "error": "share 页解析失败"}
        return {**result, **normalize(info)}

    # 3) mixsong 链接
    m = re.search(r"mixsong/([A-Za-z0-9_-]+)", text)
    if m:
        info = resolve_by_mixsong(m.group(1))
        if info is None:
            return {**result, "ok": False, "error": "mixsong 页解析失败"}
        return {**result, **normalize(info)}

    # 4) song/#hash= 链接
    m = re.search(r"[?#&]hash=([0-9a-fA-F]{32})", text)
    if m:
        info = resolve_by_hash(m.group(1))
        if info is None:
            return {**result, "ok": False, "error": "hash 反查失败"}
        return {**result, **normalize(info)}

    return {**result, "ok": False, "error": "无法识别的输入格式"}


def format_seconds(timelength) -> str:
    """时长 -> mm:ss。页面 dataFromSmarty 用毫秒，getSongInfo 用秒，
    按数值量级自动识别（>1000 视为毫秒）。"""
    try:
        value = int(timelength)
    except (TypeError, ValueError):
        return ""
    total = value / 1000 if value > 1000 else float(value)
    return f"{int(total // 60)}:{int(total % 60):02d}"


def main() -> int:
    parser = argparse.ArgumentParser(description="酷狗音乐 ID 转换工具")
    parser.add_argument(
        "inputs",
        nargs="*",
        help="分享链接 / share 链接 / mixsong 链接 / hash；传 - 时从 stdin 逐行读取",
    )
    parser.add_argument("--json", action="store_true", help="输出 JSON 数组")
    parser.add_argument(
        "--only-hash", action="store_true", help="只输出 hash（每行一个），失败输出空行"
    )
    args = parser.parse_args()

    inputs: list[str] = list(args.inputs)
    if "-" in inputs:
        inputs.remove("-")
        inputs.extend(line for line in sys.stdin if line.strip())

    results = [resolve_one(t) for t in inputs]

    if args.only_hash:
        for r in results:
            print(r.get("hash", ""))
        return 0

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    for r in results:
        if not r.get("ok"):
            print(f"[失败] {r['input']} -> {r.get('error')}")
            continue
        print(f"[成功] {r['input']} -> {r['hash']}")
        if r.get("song_name"):
            duration = format_seconds(r.get("timelength"))
            suffix = f"（{duration}）" if duration else ""
            print(f"       歌名：{r['song_name']} - {r['author_name']}{suffix}")
            if r.get("album_name"):
                print(f"       专辑：{r['album_name']}")
            if r.get("imgUrl"):
                print(f"       封面：{r['imgUrl']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())