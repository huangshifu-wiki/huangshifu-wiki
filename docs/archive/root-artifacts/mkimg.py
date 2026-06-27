import struct, zlib

w, h = 20, 20
pixels = [
    (255, 0, 0) if 5 <= x < 15 and 5 <= y < 15 else (255, 255, 255)
    for y in range(h)
    for x in range(w)
]
raw = b""
for p in pixels:
    raw += struct.pack("!B", p[0]) + struct.pack("!B", p[1]) + struct.pack("!B", p[2])


def chunk(t, d):
    return (
        struct.pack(">I", len(d))
        + t
        + d
        + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    )


ihdr = struct.pack(">IIBB", w, h, 8, 2)
open("/tmp/test_red.png", "wb").write(
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", ihdr)
    + chunk(b"IDAT", zlib.compress(raw))
    + chunk(b"IEND", b"")
)
print("Image created")
