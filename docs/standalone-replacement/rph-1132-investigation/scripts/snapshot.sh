#!/usr/bin/env bash
# Package the investigation for download: report, scripts, tool source, text evidence and a git bundle of the
# analysis branch. Refuses to package any PE file (no RPH / LSPDFR / GTA / plugin binaries).
# Usage: snapshot.sh <label>
set -euo pipefail
label="${1:-snapshot}"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
root=/home/claude/rph55
wt=/home/claude/wt-rph-opus55
branch=analysis/rph-1132-investigation-opus55
base=origin/feature/standalone-gta-typed-smoke-gate
docs=docs/standalone-replacement/rph-1132-investigation
out=/mnt/user-data/outputs
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
name="rph-1132-investigation-opus55-${label}-${ts}"
d="$stage/$name"; mkdir -p "$d"

# 1. The committed docs folder (report, curated evidence, scripts, tool source).
cp -r "$wt/$docs/." "$d/"

# 2. Bundle-only evidence: full log scan, SDK API listing, and per-method dumps of the LSA host builds and of the
#    user's own plugins (LSPDFR / Essential dumps are left out: third-party binaries, and Essential's is 20 MB).
mkdir -p "$d/evidence/methods"
cp "$root/evidence/log-scan.json" "$root/evidence/sdk124-api.tsv" "$d/evidence/"
for f in b5cd53f 5884d8b HEAD-9933290b SmartVehicleEntry LSA.PromotedCharacters LSA.PromotedCharacters.Runtime \
         LSA.PromotedCharacters.Bootstrap LSA.SessionIdentity; do
  cp "$root/evidence/methods/$f.jsonl" "$d/evidence/methods/"
done

# 3. Git bundle of the analysis branch (only the commits on top of the PR head).
if [ "$(git -C "$wt" rev-list --count "$base..$branch")" -gt 0 ]; then
  git -C "$wt" bundle create "$d/analysis-branch.bundle" "$base..$branch" >/dev/null 2>&1
  git -C "$wt" bundle verify "$d/analysis-branch.bundle" >/dev/null 2>&1 || { echo "bundle verify failed" >&2; exit 4; }
fi

# 4. Safety: no PE file may be included.
pe="$(find "$d" -type f -exec sh -c 'head -c 2 "$1" | grep -aq "^MZ" && printf "%s\n" "$1"' _ {} \;)"
if [ -n "$pe" ]; then echo "refusing: PE file(s) in snapshot:" >&2; printf '%s\n' "$pe" >&2; exit 3; fi

# 5. Manifest of everything in the package.
(cd "$d" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum) > "$d/MANIFEST.sha256"

mkdir -p "$out"
tar -C "$stage" -czf "$out/$name.tar.gz" "$name"
echo "$out/$name.tar.gz"
