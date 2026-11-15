# compare SaveData/pic16.fsh (gimme's output for F01) with ALLdrivr.fsh entry 4 (F01) through its palette
import struct
a = open('/mnt/c/Development/NFSPU/games/porsche/FEData/Art/ALLdrivr.fsh', 'rb').read()
p = open('/mnt/c/Development/NFSPU/games/porsche/SaveData/pic16.fsh', 'rb').read()
print('pic16 header', p[:48].hex(' '))
off = struct.unpack_from('<I', a, 16 + 8 * 4 + 4)[0]
print('src image hdr', a[off:off+16].hex(' '))
nxt = int.from_bytes(a[off+1:off+4], 'little'); w, h = struct.unpack_from('<HH', a, off + 4)
pal = off + nxt
print('pal hdr', a[pal:pal+16].hex(' '))
idx = a[off+16:off+16+w*h]
palv = struct.unpack_from('<256H', a, pal + 16)
dst = struct.unpack_from('<%dH' % (w*h), p, 48)
same = sum(1 for i in range(w*h) if palv[idx[i]] == dst[i])
print('w h', w, h, 'pixels equal to palette lookup:', same, 'of', w*h)
for i in range(0, 8): print(hex(palv[idx[i]]), hex(dst[i]))
