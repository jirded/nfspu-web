# fsh_info.py FILE : the entries of an EA SHPI (.fsh) file
import sys, struct
b = open(sys.argv[1], 'rb').read()
print('magic', b[:4], 'size', struct.unpack_from('<I', b, 4)[0], 'file', len(b), 'count', struct.unpack_from('<I', b, 8)[0], 'dir', b[12:16])
n = struct.unpack_from('<I', b, 8)[0]
for i in range(n):
    name, off = struct.unpack_from('<4sI', b, 16 + 8 * i)
    p = off; blocks = []
    while True:
        code = b[p]; nxt = int.from_bytes(b[p+1:p+4], 'little'); w, h = struct.unpack_from('<HH', b, p + 4)
        blocks.append('code %#04x next %d %dx%d' % (code, nxt, w, h))
        if not nxt or len(blocks) > 6: break
        p += nxt
    print(i, name, off, ' | '.join(blocks))
