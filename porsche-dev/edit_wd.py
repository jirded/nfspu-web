import sys
p=sys.argv[1]; s=open(p,encoding='latin-1').read()
old="        { void vclock_tick(void); vclock_tick(); }\n        glb_swap(); g_frames++;\n"
new=("        { void vclock_tick(void); vclock_tick(); }\n"
     "        /* the stall watchdog (watchdog.c) counts presents: no frame for a while, a report of every guest thread */\n"
     "        { void watchdog_on_present(void); watchdog_on_present(); }\n"
     "        glb_swap(); g_frames++;\n")
assert s.count(old)==1
open(p,'w',encoding='latin-1').write(s.replace(old,new)); print('ok')
