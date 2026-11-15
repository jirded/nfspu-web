#!/bin/bash
# The server for browser checks, on an origin of its own: http://127.0.0.1:8081/ (its own saves, data
# cache and one-tab lock in the browser; the user plays at http://localhost:8080/, which this never touches).
#   testserver.sh start   in the background (PID in out/testserver.pid, output in out/testserver.log)
#   testserver.sh run     in the foreground
#   testserver.sh stop    by its PID only (never pkill: that would take the user's server too)
# The page's log goes to out/test-browser.log (tlog.sh shows the newest page's lines).
set -e
cd /mnt/c/Development/NFSPU/porsche-web
NODE=/mnt/c/Development/NFSPU/tools/node/bin/node
ARGS="web-porsche/server.mjs --data /mnt/c/Development/NFSPU/games/porsche --host 127.0.0.1 --port 8081 --log out/test-browser.log"
PIDF=out/testserver.pid
alive() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }
case "$1" in
  start)
    if alive; then echo "already running (pid $(cat "$PIDF"))"; exit 0; fi
    setsid nohup "$NODE" $ARGS > out/testserver.log 2>&1 < /dev/null &
    echo $! > "$PIDF"
    for i in 1 2 3 4 5 6 7 8 9 10; do
      if curl -s -o /dev/null http://127.0.0.1:8081/; then echo "started (pid $(cat "$PIDF")): http://127.0.0.1:8081/"; exit 0; fi
      sleep 0.3
    done
    echo "did not start:"; tail -5 out/testserver.log; exit 1 ;;
  run) exec "$NODE" $ARGS ;;
  stop)
    if alive; then kill "$(cat "$PIDF")"; rm -f "$PIDF"; echo stopped; else rm -f "$PIDF"; echo "was not running"; fi ;;
  *) echo "start | run | stop"; exit 2 ;;
esac
