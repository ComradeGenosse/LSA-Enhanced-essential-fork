# Headless CodeWalker.Core probe (read-only)

Used for the 2026-10-23 X9 survey. Reads the installed game archives only; writes nothing into the game folder. CodeWalker binaries are NOT in this repo (copy your local CodeWalker30_dev48 DLLs to `../cw/`).

Linux notes (why it looks odd): CodeWalker.Core builds paths with `\`, so on Linux a "link farm" of symlinks named literally `g\<relative\path>` next to a work dir was created for the key loader (`GTA5Keys.LoadFromPath(g, true, "")` needs `g\gta5_enhanced.exe`), while RPFs were enumerated from the real mount. Copy `ShadersGen9Conversion.xml` next to the built dll to open gen9 YFT/YDR.

Usage: `dotnet run -- <linkfarm g> <outdir> <real gta dir> <mode> <shard> <nshards>` with mode `arch|ydr|ymap|info|ytyp` and `X9NAMES=name1,name2` for names. A mount call is limited (~170 s), so `ymap` is sharded (`10` shards, ~1.0k ymaps each after the ~90 s archive scan).
