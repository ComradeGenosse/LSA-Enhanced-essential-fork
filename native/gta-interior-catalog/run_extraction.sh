#!/usr/bin/env bash
# Reproduces the interior catalog from an installed GTA V Enhanced + CodeWalker 30_dev48 (read-only on both).
# usage: run_extraction.sh <GTA_DIR> <CODEWALKER_DIR> <WORK_DIR>
# Needs: .NET 8 SDK, python3. Each stage stays well under 3 minutes; ymap stage runs 4 shards in parallel.
set -euo pipefail
GTA="$1"; CW="$2"; WORK="$3"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
mkdir -p "$WORK/raw" "$WORK/bin" "$WORK/run"
cp "$CW"/CodeWalker.Core.dll "$CW"/SharpDX*.dll "$CW"/ShadersGen9Conversion.xml "$WORK/bin/"
dotnet build "$HERE/extractor/extractor.csproj" -c Release -o "$WORK/bin" -p:CodeWalkerDir="$WORK/bin" >/dev/null
# CodeWalker builds Windows-style paths; on Linux the key loader needs a literal file named 'g\GTA5_Enhanced.exe' in the cwd.
cd "$WORK/run"
ln -sf "$GTA/GTA5_Enhanced.exe" 'g\GTA5_Enhanced.exe'; ln -sf "$GTA/GTA5_Enhanced.exe" 'g\gta5_enhanced.exe'
RAW="$WORK/raw"
dotnet "$WORK/bin/extractor.dll" g "$RAW" "$GTA" ytyp 0 2 &
dotnet "$WORK/bin/extractor.dll" g "$RAW" "$GTA" ytyp 1 2 &
wait
for s in 0 1 2 3; do dotnet "$WORK/bin/extractor.dll" g "$RAW" "$GTA" ymap $s 4 & done
wait
echo "raw extraction done: $RAW"
echo "next: python3 collect_provenance.py --game <GTA_DIR> --codewalker <CW_DIR> --raw $RAW --extractor extractor --out provenance.json"
echo "      python3 interior_catalog.py build --raw $RAW --out catalog --provenance provenance.json"
