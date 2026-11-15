import sys, pefile
pe = pefile.PE(sys.argv[1])
print("image base %#x  size %#x  entry %#x  relocs %s" % (pe.OPTIONAL_HEADER.ImageBase, pe.OPTIONAL_HEADER.SizeOfImage,
      pe.OPTIONAL_HEADER.AddressOfEntryPoint, hasattr(pe, 'DIRECTORY_ENTRY_BASERELOC')))
if hasattr(pe, 'DIRECTORY_ENTRY_EXPORT'):
    for e in pe.DIRECTORY_ENTRY_EXPORT.symbols: print("export", e.ordinal, e.name, hex(e.address))
for d in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', []):
    print(d.dll.decode(), [ (i.name or b'#%d' % i.ordinal).decode() for i in d.imports])
for s in pe.sections: print(s.Name.rstrip(b'\0'), hex(s.VirtualAddress), hex(s.Misc_VirtualSize))
