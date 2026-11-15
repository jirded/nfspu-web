"""Linux ports of small macOS-only spots in the shared runtime (run from the repo root)."""
import sys

NL = chr(10)


def patch(path, old, new, count=1):
    s = open(path, encoding="latin-1").read()
    if new in s:
        print("already:", path)
        return
    n = s.count(old)
    assert n == count, (path, n, old[:60])
    open(path, "w", encoding="latin-1").write(s.replace(old, new))
    print("patched:", path)


# fileio.c GetFileTime: Linux has st_ctim/st_atim/st_mtim like WASI
patch("runtime/fileio.c",
      "#ifdef __wasm__" + NL + "            /* WASI has no birth time",
      "#if defined(__wasm__) || defined(__linux__)" + NL + "            /* WASI has no birth time")

# module.c: SHA-256 from runtime/web/sha256.c instead of CommonCrypto
patch("runtime/module.c",
      "#ifdef __wasm__" + NL + "void nfsu2_sha256(",
      "#if defined(__wasm__) || defined(__linux__)" + NL + "void nfsu2_sha256(")

# winsock.c: no AF_LINK headers on Linux
patch("runtime/winsock.c",
      "#include <net/if_dl.h>" + NL + "#include <net/route.h>" + NL,
      "#ifndef __linux__" + NL + "#include <net/if_dl.h>" + NL + "#include <net/route.h>" + NL + "#endif" + NL)
