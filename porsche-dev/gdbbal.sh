#!/bin/bash
# stack balance of a stdcall lifted function ($FN, $POP bytes of arguments): print the calls that do not return esp+4+POP
cd /mnt/c/Development/NFSPU/games/porsche
export NFSU2_REGFILE=/mnt/c/Development/NFSPU/games/porsche.registry PORSCHE_FPS=0
OUT=/mnt/c/Development/NFSPU/porsche-web/out/runs/bal_$(date +%H%M%S).txt
cat > /tmp/bal.py <<PY
import gdb
fn = "${FN:-sub_00a02ce0}"; pop = int("${POP:-8}"); hits = int("${HITS:-200}")
gdb.execute("set pagination off")
gdb.execute("handle SIGUSR1 SIGUSR2 SIGPIPE nostop noprint pass")
gdb.execute("break " + fn)
gdb.execute("run")
for i in range(hits):
    try:
        esp0 = int(gdb.parse_and_eval("c->esp")) & 0xffffffff
        a0 = int(gdb.parse_and_eval("*(unsigned*)(g_mem + c->esp + 4)")) & 0xffffffff
        a1 = int(gdb.parse_and_eval("*(unsigned*)(g_mem + c->esp + 8)")) & 0xffffffff
        gdb.execute("finish", to_string=True)
        esp1 = int(gdb.parse_and_eval("c->esp")) & 0xffffffff
        d = esp1 - esp0
        if d != 4 + pop:
            print("hit %d: args 0x%x 0x%x: esp %+d (expected %+d)" % (i, a0, a1, d, 4 + pop))
        gdb.execute("continue", to_string=True)
    except gdb.error as e:
        print("stop:", e); break
print("done")
PY
timeout ${T:-180} gdb -q -batch -x /tmp/bal.py --args /mnt/c/Development/NFSPU/porsche-web/out/native/porsche_boot /mnt/c/Development/NFSPU/games/porsche/Porsche.exe > "$OUT" 2>&1
grep -E "^hit|^stop|^done" "$OUT" | head -${N:-30}
