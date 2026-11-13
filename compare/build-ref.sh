#!/bin/bash
# Builds mfm.js at a git ref and puts the bundle in compare/refs/<name>.mjs.
# Also makes <name>.budget.mjs, whose nest budget can be set by `globalThis.__mfmNestBudget` (see fuzz.mjs).
#
# usage: compare/build-ref.sh <path to a clone of mfm.js> <git ref> <name>
set -euo pipefail
repo=$(cd "$1" && pwd)
ref=$2
name=$3
out=$(cd "$(dirname "$0")" && pwd)/refs
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$out"
git -C "$repo" archive "$ref" | tar -x -C "$work"
(cd "$work" && pnpm install --frozen-lockfile --silent && pnpm build >/dev/null)
cp "$work/built/index.mjs" "$out/$name.mjs"

if ! grep -q 'nestBudget: input.length \* 20 + 1e3' "$out/$name.mjs"; then
	echo "the nest budget is not found in the bundle" >&2
	exit 1
fi
sed 's/nestBudget: input.length \* 20 + 1e3/nestBudget: globalThis.__mfmNestBudget ?? (input.length * 20 + 1e3)/' "$out/$name.mjs" > "$out/$name.budget.mjs"
echo "built $name ($(git -C "$repo" rev-parse --short "$ref"))"
