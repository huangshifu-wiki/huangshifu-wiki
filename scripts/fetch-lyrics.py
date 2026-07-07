#!/usr/bin/env python3
"""Fetch lyrics for huangshifu-songs.json using QQ Music and Kugou APIs."""

import json
import sys
import urllib.request
from base64 import b64encode
from pathlib import Path
from zlib import decompress
from time import sleep
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = Path(__file__).resolve().parent.parent
SONGS_FILE = ROOT / 'huangshifu-songs.json'
OUTPUT_FILE = ROOT / 'huangshifu-lyrics.json'

CONCURRENCY = 3
REQUEST_DELAY = 0.5
RETRY_COUNT = 2

# ─── Custom DES (from LDDC) ───

SBOX = (
    (14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13),
    (15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9),
    (10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12),
    (7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14),
    (2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3),
    (12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13),
    (4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12),
    (13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11),
)

def bitnum(a, b, c):
    return ((a[(b // 32) * 4 + 3 - (b % 32) // 8] >> (7 - b % 8)) & 1) << c

def bitnum_intr(a, b, c):
    return ((a >> (31 - b)) & 1) << c

def bitnum_intl(a, b, c):
    return ((a << b) & 0x80000000) >> c

def sbox_bit(a):
    return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4)

def initial_permutation(input_data):
    return ((bitnum(input_data, 57, 31) | bitnum(input_data, 49, 30) | bitnum(input_data, 41, 29) | bitnum(input_data, 33, 28) |
             bitnum(input_data, 25, 27) | bitnum(input_data, 17, 26) | bitnum(input_data, 9, 25) | bitnum(input_data, 1, 24) |
             bitnum(input_data, 59, 23) | bitnum(input_data, 51, 22) | bitnum(input_data, 43, 21) | bitnum(input_data, 35, 20) |
             bitnum(input_data, 27, 19) | bitnum(input_data, 19, 18) | bitnum(input_data, 11, 17) | bitnum(input_data, 3, 16) |
             bitnum(input_data, 61, 15) | bitnum(input_data, 53, 14) | bitnum(input_data, 45, 13) | bitnum(input_data, 37, 12) |
             bitnum(input_data, 29, 11) | bitnum(input_data, 21, 10) | bitnum(input_data, 13, 9) | bitnum(input_data, 5, 8) |
             bitnum(input_data, 63, 7) | bitnum(input_data, 55, 6) | bitnum(input_data, 47, 5) | bitnum(input_data, 39, 4) |
             bitnum(input_data, 31, 3) | bitnum(input_data, 23, 2) | bitnum(input_data, 15, 1) | bitnum(input_data, 7, 0)),
            (bitnum(input_data, 56, 31) | bitnum(input_data, 48, 30) | bitnum(input_data, 40, 29) | bitnum(input_data, 32, 28) |
             bitnum(input_data, 24, 27) | bitnum(input_data, 16, 26) | bitnum(input_data, 8, 25) | bitnum(input_data, 0, 24) |
             bitnum(input_data, 58, 23) | bitnum(input_data, 50, 22) | bitnum(input_data, 42, 21) | bitnum(input_data, 34, 20) |
             bitnum(input_data, 26, 19) | bitnum(input_data, 18, 18) | bitnum(input_data, 10, 17) | bitnum(input_data, 2, 16) |
             bitnum(input_data, 60, 15) | bitnum(input_data, 52, 14) | bitnum(input_data, 44, 13) | bitnum(input_data, 36, 12) |
             bitnum(input_data, 28, 11) | bitnum(input_data, 20, 10) | bitnum(input_data, 12, 9) | bitnum(input_data, 4, 8) |
             bitnum(input_data, 62, 7) | bitnum(input_data, 54, 6) | bitnum(input_data, 46, 5) | bitnum(input_data, 38, 4) |
             bitnum(input_data, 30, 3) | bitnum(input_data, 22, 2) | bitnum(input_data, 14, 1) | bitnum(input_data, 6, 0)))

def inverse_permutation(s0, s1):
    data = bytearray(8)
    data[3] = (bitnum_intr(s1,7,7)|bitnum_intr(s0,7,6)|bitnum_intr(s1,15,5)|bitnum_intr(s0,15,4)|bitnum_intr(s1,23,3)|bitnum_intr(s0,23,2)|bitnum_intr(s1,31,1)|bitnum_intr(s0,31,0))
    data[2] = (bitnum_intr(s1,6,7)|bitnum_intr(s0,6,6)|bitnum_intr(s1,14,5)|bitnum_intr(s0,14,4)|bitnum_intr(s1,22,3)|bitnum_intr(s0,22,2)|bitnum_intr(s1,30,1)|bitnum_intr(s0,30,0))
    data[1] = (bitnum_intr(s1,5,7)|bitnum_intr(s0,5,6)|bitnum_intr(s1,13,5)|bitnum_intr(s0,13,4)|bitnum_intr(s1,21,3)|bitnum_intr(s0,21,2)|bitnum_intr(s1,29,1)|bitnum_intr(s0,29,0))
    data[0] = (bitnum_intr(s1,4,7)|bitnum_intr(s0,4,6)|bitnum_intr(s1,12,5)|bitnum_intr(s0,12,4)|bitnum_intr(s1,20,3)|bitnum_intr(s0,20,2)|bitnum_intr(s1,28,1)|bitnum_intr(s0,28,0))
    data[7] = (bitnum_intr(s1,3,7)|bitnum_intr(s0,3,6)|bitnum_intr(s1,11,5)|bitnum_intr(s0,11,4)|bitnum_intr(s1,19,3)|bitnum_intr(s0,19,2)|bitnum_intr(s1,27,1)|bitnum_intr(s0,27,0))
    data[6] = (bitnum_intr(s1,2,7)|bitnum_intr(s0,2,6)|bitnum_intr(s1,10,5)|bitnum_intr(s0,10,4)|bitnum_intr(s1,18,3)|bitnum_intr(s0,18,2)|bitnum_intr(s1,26,1)|bitnum_intr(s0,26,0))
    data[5] = (bitnum_intr(s1,1,7)|bitnum_intr(s0,1,6)|bitnum_intr(s1,9,5)|bitnum_intr(s0,9,4)|bitnum_intr(s1,17,3)|bitnum_intr(s0,17,2)|bitnum_intr(s1,25,1)|bitnum_intr(s0,25,0))
    data[4] = (bitnum_intr(s1,0,7)|bitnum_intr(s0,0,6)|bitnum_intr(s1,8,5)|bitnum_intr(s0,8,4)|bitnum_intr(s1,16,3)|bitnum_intr(s0,16,2)|bitnum_intr(s1,24,1)|bitnum_intr(s0,24,0))
    return data

def des_f(state, key):
    t1 = (bitnum_intl(state, 31, 0) | ((state & 0xf0000000) >> 1) | bitnum_intl(state, 4, 5) |
          bitnum_intl(state, 3, 6) | ((state & 0x0f000000) >> 3) | bitnum_intl(state, 8, 11) |
          bitnum_intl(state, 7, 12) | ((state & 0x00f00000) >> 5) | bitnum_intl(state, 12, 17) |
          bitnum_intl(state, 11, 18) | ((state & 0x000f0000) >> 7) | bitnum_intl(state, 16, 23))
    t2 = (bitnum_intl(state, 15, 0) | ((state & 0x0000f000) << 15) | bitnum_intl(state, 20, 5) |
          bitnum_intl(state, 19, 6) | ((state & 0x00000f00) << 13) | bitnum_intl(state, 24, 11) |
          bitnum_intl(state, 23, 12) | ((state & 0x000000f0) << 11) | bitnum_intl(state, 28, 17) |
          bitnum_intl(state, 27, 18) | ((state & 0x0000000f) << 9) | bitnum_intl(state, 0, 23))
    lrgstate = [(t1>>24)&0xff, (t1>>16)&0xff, (t1>>8)&0xff, (t2>>24)&0xff, (t2>>16)&0xff, (t2>>8)&0xff]
    lrgstate = [lrgstate[i] ^ key[i] for i in range(6)]
    state = ((SBOX[0][sbox_bit(lrgstate[0]>>2)]<<28)|
             (SBOX[1][sbox_bit(((lrgstate[0]&0x03)<<4)|(lrgstate[1]>>4))]<<24)|
             (SBOX[2][sbox_bit(((lrgstate[1]&0x0f)<<2)|(lrgstate[2]>>6))]<<20)|
             (SBOX[3][sbox_bit(lrgstate[2]&0x3f)]<<16)|
             (SBOX[4][sbox_bit(lrgstate[3]>>2)]<<12)|
             (SBOX[5][sbox_bit(((lrgstate[3]&0x03)<<4)|(lrgstate[4]>>4))]<<8)|
             (SBOX[6][sbox_bit(((lrgstate[4]&0x0f)<<2)|(lrgstate[5]>>6))]<<4)|
             SBOX[7][sbox_bit(lrgstate[5]&0x3f)])
    return (bitnum_intl(state,15,0)|bitnum_intl(state,6,1)|bitnum_intl(state,19,2)|bitnum_intl(state,20,3)|
            bitnum_intl(state,28,4)|bitnum_intl(state,11,5)|bitnum_intl(state,27,6)|bitnum_intl(state,16,7)|
            bitnum_intl(state,0,8)|bitnum_intl(state,14,9)|bitnum_intl(state,22,10)|bitnum_intl(state,25,11)|
            bitnum_intl(state,4,12)|bitnum_intl(state,17,13)|bitnum_intl(state,30,14)|bitnum_intl(state,9,15)|
            bitnum_intl(state,1,16)|bitnum_intl(state,7,17)|bitnum_intl(state,23,18)|bitnum_intl(state,13,19)|
            bitnum_intl(state,31,20)|bitnum_intl(state,26,21)|bitnum_intl(state,2,22)|bitnum_intl(state,8,23)|
            bitnum_intl(state,18,24)|bitnum_intl(state,12,25)|bitnum_intl(state,29,26)|bitnum_intl(state,5,27)|
            bitnum_intl(state,21,28)|bitnum_intl(state,10,29)|bitnum_intl(state,3,30)|bitnum_intl(state,24,31))

def des_crypt(input_data, key):
    s0, s1 = initial_permutation(input_data)
    for idx in range(15):
        previous_s1 = s1
        s1 = des_f(s1, key[idx]) ^ s0
        s0 = previous_s1
    s0 = des_f(s1, key[15]) ^ s0
    return inverse_permutation(s0, s1)

def key_schedule(key, mode):
    schedule = [[0]*6 for _ in range(16)]
    key_rnd_shift = (1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1)
    key_perm_c = (56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35)
    key_perm_d = (62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3)
    key_compression = (13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,40,51,30,36,
                       46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31)
    c = sum(bitnum(key, key_perm_c[i], 31-i) for i in range(28))
    d = sum(bitnum(key, key_perm_d[i], 31-i) for i in range(28))
    for i in range(16):
        c = ((c << key_rnd_shift[i]) | (c >> (28 - key_rnd_shift[i]))) & 0xfffffff0
        d = ((d << key_rnd_shift[i]) | (d >> (28 - key_rnd_shift[i]))) & 0xfffffff0
        togen = 15-i if mode == 0 else i
        schedule[togen] = [0]*6
        for j in range(24):
            schedule[togen][j//8] |= bitnum_intr(c, key_compression[j], 7-(j%8))
        for j in range(24, 48):
            schedule[togen][j//8] |= bitnum_intr(d, key_compression[j]-27, 7-(j%8))
    return schedule

QRC_KEY = b"!@#)(*$%123ZXC!@!@#)(NHL"
KRC_KEY = b"@Gaw^2tGQ61-\xce\xd2ni"

def tripledes_key_setup(key, mode):
    if mode == 1:
        return [key_schedule(key[0:], 1), key_schedule(key[8:], 0), key_schedule(key[16:], 1)]
    return [key_schedule(key[16:], 0), key_schedule(key[8:], 1), key_schedule(key[0:], 0)]

def tripledes_crypt(data, key):
    for i in range(3):
        data = des_crypt(data, key[i])
    return data

def qrc_decrypt(encrypted_hex):
    encrypted = bytearray.fromhex(encrypted_hex)
    data = bytearray()
    schedule = tripledes_key_setup(QRC_KEY, 0)
    for i in range(0, len(encrypted), 8):
        data += tripledes_crypt(encrypted[i:], schedule)
    return decompress(data).decode('utf-8')

def krc_decrypt(content_bytes):
    encrypted = content_bytes[4:]
    decrypted = bytearray(b ^ KRC_KEY[i % len(KRC_KEY)] for i, b in enumerate(encrypted))
    return decompress(decrypted).decode('utf-8')

# ─── QQ Music API ───

_qm_session = None

def qm_request(method, module, param):
    global _qm_session
    if not _qm_session:
        raw = qm_request_raw('GetSession', 'music.getSession.session', {'caller': 0, 'uid': '0', 'vkey': 0})
        _qm_session = {'uid': str(raw['session']['uid']), 'sid': raw['session']['sid'], 'userip': raw['session']['userip']}
    
    comm = {'ct': 11, 'cv': '1003006', 'v': '1003006', 'os_ver': '15', 'phonetype': '24122RKC7C',
            'tmeAppID': 'qqmusiclight', 'nettype': 'NETWORK_WIFI', 'udid': '0',
            'uid': _qm_session['uid'], 'sid': _qm_session['sid'], 'userip': _qm_session['userip']}
    body = json.dumps({'comm': comm, 'request': {'method': method, 'module': module, 'param': param}}).encode()
    req = urllib.request.Request('https://u.y.qq.com/cgi-bin/musicu.fcg', data=body,
                                headers={'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.14.9'})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if data['code'] != 0 or data['request']['code'] != 0:
        raise Exception(f"QM API error: {data['code']}/{data['request']['code']}")
    return data['request']['data']

def qm_request_raw(method, module, param):
    comm = {'ct': 11, 'cv': '1003006', 'v': '1003006', 'os_ver': '15', 'phonetype': '24122RKC7C',
            'tmeAppID': 'qqmusiclight', 'nettype': 'NETWORK_WIFI', 'udid': '0'}
    body = json.dumps({'comm': comm, 'request': {'method': method, 'module': module, 'param': param}}).encode()
    req = urllib.request.Request('https://u.y.qq.com/cgi-bin/musicu.fcg', data=body,
                                headers={'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.14.9'})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if data['code'] != 0 or data['request']['code'] != 0:
        raise Exception(f"QM API error: {data['code']}/{data['request']['code']}")
    return data['request']['data']

def fetch_qq_lyric(song_mid, song_name, album_name, artist_name, duration_ms):
    param = {
        'albumName': b64encode((album_name or '').encode()).decode(),
        'crypt': 1, 'ct': 19, 'cv': 2111,
        'interval': duration_ms // 1000,
        'lrc_t': 0, 'qrc': 1, 'qrc_t': 0, 'roma': 1, 'roma_t': 0,
        'singerName': b64encode((artist_name or '').encode()).decode(),
        'songID': 0, 'songMid': song_mid,
        'songName': b64encode((song_name or '').encode()).decode(),
        'trans': 1, 'trans_t': 0, 'type': 0,
    }
    try:
        data = qm_request('GetPlayLyricInfo', 'music.musichallSong.PlayLyricInfo', param)
        qrc_t = data.get('qrc_t', 0)
        lrc_t = data.get('lrc_t', 0)
        lyric = data.get('lyric', '')
        
        if lyric and qrc_t != 0:
            try:
                decrypted = qrc_decrypt(lyric)
                if decrypted and '<Lyric_1' in decrypted:
                    return decrypted
            except:
                pass
        
        if lyric and lrc_t != 0:
            try:
                import base64
                decoded = base64.b64decode(lyric).decode('utf-8')
                if decoded and '[' in decoded:
                    return decoded
            except:
                pass
    except Exception as e:
        pass
    return None

# ─── Kugou API ───

def fetch_kugou_lyric(hash_val, title, artists, duration_ms):
    keyword = f"{'、'.join(artists)} - {title}"
    params = urllib.parse.urlencode({
        'album_audio_id': '0', 'duration': str(duration_ms), 'hash': hash_val, 'keyword': keyword,
        'lrctxt': '1', 'man': 'no', 'ver': '1', 'client': 'mobi', 'appid': '3116', 'clientver': '11070',
    })
    try:
        req = urllib.request.Request(f'https://lyrics.kugou.com/v1/search?{params}',
                                    headers={'User-Agent': 'Android14-1070-11070-201-0-Lyric-wifi'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        
        candidates = data.get('candidates', [])
        if not candidates:
            return None
        
        best = min(candidates, key=lambda c: abs((c.get('duration', 0) * 1000) - duration_ms))
        
        dl_params = urllib.parse.urlencode({
            'accesskey': best['accesskey'], 'charset': 'utf8', 'client': 'mobi', 'fmt': 'krc',
            'id': str(best['id']), 'ver': '1', 'appid': '3116', 'clientver': '11070',
        })
        req = urllib.request.Request(f'http://lyrics.kugou.com/download?{dl_params}',
                                    headers={'User-Agent': 'Android14-1070-11070-201-0-Lyric-wifi'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            dl_data = json.loads(resp.read())
        
        content = dl_data.get('content')
        if not content:
            return None
        
        import base64
        content_bytes = base64.b64decode(content)
        
        if dl_data.get('contenttype') == 2:
            return content_bytes.decode('utf-8')
        
        try:
            return krc_decrypt(content_bytes)
        except:
            pass
    except:
        pass
    return None

# ─── Lyrics Parsing ───

import re

def is_qrc(text):
    return '<Lyric_1' in text and 'LyricContent=' in text

def is_krc(text):
    return bool(re.search(r'\[\d+,\d+\]<\d+,\d+,\d+>', text))

def is_lrc(text):
    return bool(re.search(r'\[\d{2}:\d{2}\.\d{2,3}\]', text))

def parse_qrc_to_timed(qrc):
    m = re.search(r'<Lyric_1 LyricType="1" LyricContent="([\s\S]*?)"\s*/>', qrc)
    if not m:
        return qrc
    content = m.group(1)
    lines = []
    for raw_line in content.split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        lm = re.match(r'^\[(\d+),(\d+)\](.*)$', line)
        if not lm:
            continue
        start_ms = int(lm.group(1))
        line_content = lm.group(3)
        start_sec = start_ms / 1000
        mm = f"{int(start_sec // 60):02d}"
        ss = f"{start_sec % 60:05.2f}"
        
        word_matches = re.findall(r'(?:\[.*?\])?((?:(?!\(\d+,\d+\)).)*)\((\d+),(\d+)\)', line_content)
        if word_matches:
            qrc_line = f"[{mm}:{ss}]"
            for text, start, dur in word_matches:
                if text:
                    qrc_line += f"<{start},{dur}>{text}"
            lines.append(qrc_line)
        else:
            plain = re.sub(r'\(\d+,\d+\)', '', line_content).strip()
            if plain:
                lines.append(f"[{mm}:{ss}]{plain}")
    return '\n'.join(lines)

def parse_krc_to_timed(krc):
    lines = []
    for raw_line in krc.split('\n'):
        line = raw_line.strip()
        if not line or not line.startswith('['):
            continue
        lm = re.match(r'^\[(\d+),(\d+)\](.*)$', line)
        if not lm:
            continue
        start_ms = int(lm.group(1))
        line_content = lm.group(3)
        start_sec = start_ms / 1000
        mm = f"{int(start_sec // 60):02d}"
        ss = f"{start_sec % 60:05.2f}"
        
        words = re.findall(r'<(\d+),(\d+),\d+>([^<]*)', line_content)
        if words:
            krc_line = f"[{mm}:{ss}]"
            for start, dur, text in words:
                krc_line += f"<{start},{dur}>{text}"
            lines.append(krc_line)
        else:
            plain = re.sub(r'<\d+,\d+,\d+>', '', line_content).strip()
            if plain:
                lines.append(f"[{mm}:{ss}]{plain}")
    return '\n'.join(lines)

def parse_lrc_to_timed(lrc):
    lines = []
    for raw_line in lrc.split('\n'):
        line = raw_line.strip()
        if line and re.match(r'^\[\d{2}:\d{2}\.\d{2,3}\]', line):
            lines.append(line)
    return '\n'.join(lines)

def extract_plain(raw_lyric, lyric_type):
    lines = []
    if lyric_type == 'qrc':
        m = re.search(r'<Lyric_1 LyricType="1" LyricContent="([\s\S]*?)"\s*/>', raw_lyric)
        source_lines = m.group(1).split('\n') if m else raw_lyric.split('\n')
    else:
        source_lines = raw_lyric.split('\n')
    
    for raw_line in source_lines:
        line = raw_line.strip()
        if not line:
            continue
        # Skip metadata tags like [ti:xxx], [ar:xxx], etc.
        if re.match(r'^\[(?:ti|ar|al|by|offset|la|mu|re|ve|km|man|rev|con|phs):', line):
            continue
        if lyric_type == 'qrc':
            lm = re.match(r'^\[\d+,\d+\](.*)$', line)
            text = re.sub(r'\(\d+,\d+\)', '', lm.group(1)).strip() if lm else re.sub(r'\[\d+:\d+\.\d+\]|<\d+,\d+(?:,\d+)?>|\(\d+,\d+\)', '', line).strip()
        elif lyric_type == 'krc':
            text = re.sub(r'^\[\d+,\d+\]|<\d+,\d+,\d+>', '', line).strip()
        else:
            text = re.sub(r'^\[\d{2}:\d{2}\.\d{2,3}\]', '', line).strip()
        if text:
            lines.append(text)
    return '\n'.join(lines)

def process_lyric(raw):
    if is_qrc(raw):
        return parse_qrc_to_timed(raw), extract_plain(raw, 'qrc'), 'word'
    if is_krc(raw):
        return parse_krc_to_timed(raw), extract_plain(raw, 'krc'), 'word'
    if is_lrc(raw):
        return parse_lrc_to_timed(raw), extract_plain(raw, 'lrc'), 'line'
    return raw, raw, 'line'

# ─── Main ───

def get_platform_record(song, platform):
    for r in song.get('platformRecords', []):
        if r['platform'] == platform:
            return r
    return None

def fetch_for_song(song, index, total):
    title = song['title']
    artists = song['artists']
    print(f"[{index+1}/{total}] {title} - {'/'.join(artists)}", flush=True)
    
    tr = get_platform_record(song, 'tencent')
    kr = get_platform_record(song, 'kugou')
    nr = get_platform_record(song, 'netease')
    wr = get_platform_record(song, 'kuwo')
    
    # Strategy 1: QQ Music
    if tr:
        try:
            raw = fetch_qq_lyric(tr['platformId'], title, song.get('albumName', ''), ','.join(artists), tr.get('durationMs', 0))
            if raw:
                timed, plain, ltype = process_lyric(raw)
                if ltype == 'word' and plain:
                    print(f"  ✓ QQ Music 逐字歌词", flush=True)
                    return {'title': title, 'artists': artists, 'lyricType': 'word', 'source': 'tencent', 'lyricTimed': timed, 'lyricPlain': plain}
                if plain:
                    print(f"  ✓ QQ Music 逐行歌词", flush=True)
                    return {'title': title, 'artists': artists, 'lyricType': 'line', 'source': 'tencent', 'lyricTimed': timed, 'lyricPlain': plain}
        except Exception as e:
            print(f"  ✗ QQ Music: {e}", flush=True)
    
    # Strategy 2: Kugou
    if kr:
        try:
            raw = fetch_kugou_lyric(kr['platformId'], title, artists, kr.get('durationMs', 0))
            if raw:
                timed, plain, ltype = process_lyric(raw)
                if ltype == 'word' and plain:
                    print(f"  ✓ Kugou 逐字歌词", flush=True)
                    return {'title': title, 'artists': artists, 'lyricType': 'word', 'source': 'kugou', 'lyricTimed': timed, 'lyricPlain': plain}
                if plain:
                    print(f"  ✓ Kugou 逐行歌词", flush=True)
                    return {'title': title, 'artists': artists, 'lyricType': 'line', 'source': 'kugou', 'lyricTimed': timed, 'lyricPlain': plain}
        except Exception as e:
            print(f"  ✗ Kugou: {e}", flush=True)
    
    # Strategy 3: Netease/Kuwo via simple API
    for pr in ([nr, wr] if nr else [wr]):
        if not pr:
            continue
        try:
            url = f"http://music.163.com/api/song/lyric?id={pr['platformId']}&lv=1&tv=1"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            lrc_text = data.get('lrc', {}).get('lyric', '')
            if lrc_text:
                timed, plain, ltype = process_lyric(lrc_text)
                if plain:
                    print(f"  ✓ Netease 逐行歌词", flush=True)
                    return {'title': title, 'artists': artists, 'lyricType': 'line', 'source': 'netease', 'lyricTimed': timed, 'lyricPlain': plain}
        except:
            pass
    
    print(f"  ✗ 无歌词", flush=True)
    return {'title': title, 'artists': artists, 'lyricType': 'none', 'source': None, 'lyricTimed': None, 'lyricPlain': None, 'error': '所有来源均未获取到歌词'}

def main():
    print("=== 黄诗扶 Wiki 歌词收集工具 ===\n", flush=True)
    
    with open(SONGS_FILE, 'r') as f:
        data = json.load(f)
    
    songs = data['songs']
    print(f"共 {len(songs)} 首歌曲\n", flush=True)
    
    results = [None] * len(songs)
    
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {}
        for i, song in enumerate(songs):
            future = executor.submit(fetch_for_song, song, i, len(songs))
            futures[future] = i
            if i > 0 and i % CONCURRENCY == 0:
                sleep(REQUEST_DELAY)
        
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                results[idx] = {
                    'title': songs[idx]['title'], 'artists': songs[idx]['artists'],
                    'lyricType': 'none', 'source': None, 'lyricTimed': None, 'lyricPlain': None,
                    'error': str(e)
                }
    
    word_count = sum(1 for r in results if r['lyricType'] == 'word')
    line_count = sum(1 for r in results if r['lyricType'] == 'line')
    fail_count = sum(1 for r in results if r['lyricType'] == 'none')
    
    print(f"\n=== 完成 ===", flush=True)
    print(f"逐字歌词: {word_count}", flush=True)
    print(f"逐行歌词: {line_count}", flush=True)
    print(f"失败: {fail_count}", flush=True)
    
    import datetime
    output = {
        'generatedAt': datetime.datetime.now().isoformat(),
        'stats': {'total': len(songs), 'wordLevel': word_count, 'lineLevel': line_count, 'failed': fail_count},
        'songs': results,
    }
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\n已保存到 {OUTPUT_FILE}", flush=True)

if __name__ == '__main__':
    main()
