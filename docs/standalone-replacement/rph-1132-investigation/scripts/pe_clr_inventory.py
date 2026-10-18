#!/usr/bin/env python3
"""PE / CLR inventory for one or more files.

Emits JSON with: sha256, size, PE machine/characteristics, sections (+entropy),
version resource, native imports/exports, CLR (COR20) header flags, metadata
version string, assembly identity, assembly references, module references,
manifest resources and table row counts.

Read-only; never executes the analysed binaries.
Usage: python3 -I pe_clr_inventory.py OUT.json FILE [FILE ...]
"""
import hashlib
import json
import math
import os
import sys

import dnfile
import pefile

COMIMAGE_FLAGS = {
    0x00000001: "ILONLY",
    0x00000002: "32BITREQUIRED",
    0x00000004: "IL_LIBRARY",
    0x00000008: "STRONGNAMESIGNED",
    0x00000010: "NATIVE_ENTRYPOINT",
    0x00010000: "TRACKDEBUGDATA",
    0x00020000: "32BITPREFERRED",
}


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    return -sum(c / n * math.log2(c / n) for c in counts if c)


def pkt(blob):
    """Public key token from a full public key blob (sha1, last 8 bytes reversed)."""
    if not blob:
        return None
    b = bytes(blob)
    if len(b) == 8:
        return b.hex()
    return hashlib.sha1(b).digest()[-8:][::-1].hex()


def ver(row):
    return f"{row.MajorVersion}.{row.MinorVersion}.{row.BuildNumber}.{row.RevisionNumber}"


def version_resource(pe):
    out = {}
    try:
        for fileinfo in getattr(pe, "FileInfo", []) or []:
            for entry in fileinfo:
                if getattr(entry, "Key", b"") == b"StringFileInfo":
                    for st in entry.StringTable:
                        for k, v in st.entries.items():
                            out[k.decode("utf-8", "replace")] = v.decode("utf-8", "replace")
        if hasattr(pe, "VS_FIXEDFILEINFO") and pe.VS_FIXEDFILEINFO:
            ffi = pe.VS_FIXEDFILEINFO[0]
            out["_FixedFileVersion"] = "%d.%d.%d.%d" % (
                ffi.FileVersionMS >> 16, ffi.FileVersionMS & 0xFFFF,
                ffi.FileVersionLS >> 16, ffi.FileVersionLS & 0xFFFF)
            out["_FixedProductVersion"] = "%d.%d.%d.%d" % (
                ffi.ProductVersionMS >> 16, ffi.ProductVersionMS & 0xFFFF,
                ffi.ProductVersionLS >> 16, ffi.ProductVersionLS & 0xFFFF)
    except Exception as e:  # pragma: no cover
        out["_error"] = repr(e)
    return out


def analyse(path):
    data = open(path, "rb").read()
    rec = {
        "path": path,
        "file": os.path.basename(path),
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest().upper(),
    }
    try:
        pe = pefile.PE(data=data, fast_load=False)
    except Exception as e:
        rec["pe_error"] = repr(e)
        return rec
    fh = pe.FILE_HEADER
    oh = pe.OPTIONAL_HEADER
    rec["machine"] = hex(fh.Machine)
    rec["pe_kind"] = "PE32+" if oh.Magic == 0x20B else "PE32"
    rec["is_dll"] = bool(fh.Characteristics & 0x2000)
    rec["subsystem"] = oh.Subsystem
    rec["timedatestamp"] = fh.TimeDateStamp
    rec["entrypoint_rva"] = hex(oh.AddressOfEntryPoint)
    rec["sections"] = [
        {
            "name": s.Name.rstrip(b"\0").decode("latin1"),
            "vsize": s.Misc_VirtualSize,
            "rawsize": s.SizeOfRawData,
            "characteristics": hex(s.Characteristics),
            "entropy": round(entropy(s.get_data()), 3),
        }
        for s in pe.sections
    ]
    rec["version_resource"] = version_resource(pe)
    imps = []
    for d in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []) or []:
        imps.append({
            "dll": d.dll.decode("latin1"),
            "functions": [
                (i.name.decode("latin1") if i.name else f"ord#{i.ordinal}")
                for i in d.imports
            ],
        })
    rec["native_imports"] = imps
    exps = []
    if hasattr(pe, "DIRECTORY_ENTRY_EXPORT"):
        for s in pe.DIRECTORY_ENTRY_EXPORT.symbols:
            exps.append({"name": s.name.decode("latin1") if s.name else None,
                         "ordinal": s.ordinal, "rva": hex(s.address)})
    rec["native_exports"] = exps
    # Overlay (data appended after last section)
    try:
        ov = pe.get_overlay_data_start_offset()
        rec["overlay_offset"] = ov
        rec["overlay_size"] = (len(data) - ov) if ov else 0
        if ov:
            rec["overlay_entropy"] = round(entropy(data[ov:ov + 4 * 1024 * 1024]), 3)
            rec["overlay_head_hex"] = data[ov:ov + 32].hex()
    except Exception as e:
        rec["overlay_error"] = repr(e)

    clr_dir = oh.DATA_DIRECTORY[14]
    rec["has_clr_header"] = bool(clr_dir.VirtualAddress and clr_dir.Size)
    if not rec["has_clr_header"]:
        return rec
    try:
        dn = dnfile.dnPE(data=data)
    except Exception as e:
        rec["dnfile_error"] = repr(e)
        return rec
    cor = dn.net.struct
    flags = cor.Flags
    rec["cor20"] = {
        "runtime_version": f"{cor.MajorRuntimeVersion}.{cor.MinorRuntimeVersion}",
        "flags_raw": hex(flags),
        "flags": [n for b, n in COMIMAGE_FLAGS.items() if flags & b],
        "entrypoint_token_or_rva": hex(cor.EntryPointTokenOrRva),
        "resources_size": cor.Resources_Size if hasattr(cor, "Resources_Size") else None,
        "strong_name_sig_size": getattr(cor, "StrongNameSignature_Size", None),
        "vtable_fixups_size": getattr(cor, "VTableFixups_Size", None),
    }
    md = dn.net.metadata
    rec["metadata_version"] = md.struct.Version.rstrip(b"\0").decode("latin1") if md and md.struct else None
    rec["metadata_streams"] = [s.decode("latin1") if isinstance(s, bytes) else str(s)
                               for s in (dn.net.metadata.streams.keys() if dn.net.metadata else [])]
    mdt = dn.net.mdtables
    counts = {}
    for t in mdt.tables_list:
        counts[t.name] = t.num_rows
    rec["table_rows"] = counts
    if mdt.Assembly and mdt.Assembly.num_rows:
        a = mdt.Assembly.rows[0]
        rec["assembly"] = {
            "name": str(a.Name),
            "version": ver(a),
            "culture": str(a.Culture) if a.Culture else "",
            "public_key_token": pkt(a.PublicKey.value if a.PublicKey else None),
            "flags": hex(int(a.Flags.value)) if hasattr(a.Flags, "value") else str(a.Flags),
        }
    if mdt.Module and mdt.Module.num_rows:
        m = mdt.Module.rows[0]
        rec["module"] = {"name": str(m.Name), "mvid": str(m.Mvid)}
    refs = []
    if mdt.AssemblyRef:
        for r in mdt.AssemblyRef.rows:
            refs.append({
                "name": str(r.Name),
                "version": ver(r),
                "culture": str(r.Culture) if r.Culture else "",
                "public_key_or_token": pkt(r.PublicKey.value if r.PublicKey else None),
            })
    rec["assembly_refs"] = refs
    if mdt.ModuleRef:
        rec["module_refs"] = [str(r.Name) for r in mdt.ModuleRef.rows]
    res = []
    if mdt.ManifestResource:
        for r in mdt.ManifestResource.rows:
            impl = r.Implementation
            res.append({
                "name": str(r.Name),
                "offset": r.Offset,
                "flags": str(r.Flags),
                "implementation": None if (impl is None or getattr(impl, 'row_index', 0) == 0) else str(impl.table) + ":" + str(impl.row_index),
            })
    rec["manifest_resources"] = res
    if mdt.File:
        rec["file_table"] = [str(r.Name) for r in mdt.File.rows]
    if mdt.ExportedType:
        rec["exported_types"] = [
            (str(r.TypeNamespace) + "." + str(r.TypeName)) for r in mdt.ExportedType.rows]
    # Custom attributes on assembly (names only) - TargetFramework etc are resolved later.
    return rec


def main():
    out = sys.argv[1]
    files = sys.argv[2:]
    results = []
    for f in files:
        try:
            results.append(analyse(f))
        except Exception as e:
            results.append({"path": f, "error": repr(e)})
    with open(out, "w") as fh:
        json.dump(results, fh, indent=1, default=str)
    for r in results:
        a = r.get("assembly", {})
        print(f"{r.get('sha256','?')[:16]} {r.get('size',0):>10} {r.get('pe_kind','?'):5} "
              f"clr={r.get('has_clr_header')} flags={r.get('cor20',{}).get('flags')} "
              f"asm={a.get('name')}/{a.get('version')}/{a.get('public_key_token')} :: {r['path']}")


if __name__ == "__main__":
    main()
