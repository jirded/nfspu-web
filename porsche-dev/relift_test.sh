#!/bin/bash
# lift Porsche.exe again into gen/all_test (env as given) and compare with gen/all
cd /mnt/c/Development/NFSPU/porsche-web
rm -rf gen/all_test; mkdir -p gen/all_test
env GENOUT=gen/all_test ${LIFTENV} .venv/bin/python tools/genall.py /mnt/c/Development/NFSPU/games/porsche/Porsche.exe 64 > out/genall_test.log 2>&1 || { tail -5 out/genall_test.log; exit 1; }
tail -3 out/genall_test.log
diff -rq gen/all gen/all_test | head -20
echo "differing files: $(diff -rq gen/all gen/all_test | wc -l)"
