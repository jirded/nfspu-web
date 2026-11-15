#!/bin/bash
# stop the Porsche web server (the bracket keeps pkill from matching this script's own command line)
pkill -f 'node web-porsche/[s]erver.mjs' && echo stopped || echo "was not running"
