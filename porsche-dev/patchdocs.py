import ast, glob, os, sys
for p in sorted(glob.glob(os.path.join(sys.argv[1], 'patch_rt*.py'))):
    d = ast.get_docstring(ast.parse(open(p).read())) or ''
    first = d.splitlines()[0] if d else ''
    if not first:
        src = open(p).read()
        first = 'path(s): ' + ', '.join(sorted(set(l.split('"')[1] for l in src.splitlines() if l.strip().startswith('path') and '"' in l)))
    print(os.path.basename(p) + ': ' + first[:160])
