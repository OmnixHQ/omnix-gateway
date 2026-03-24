#!/usr/bin/env bash
# Lint rule: no descriptive comments in TypeScript source files.
# Only JSDoc, TODO/FIXME/NOTE/HACK/WARNING/IMPORTANT, and "why" comments are allowed.

set -euo pipefail

violations=0

while IFS= read -r file; do
  while IFS= read -r match; do
    if [ -n "$match" ]; then
      echo "$match"
      violations=$((violations + 1))
    fi
  done < <(
    grep -n '^\s*// [A-Z][a-z]' "$file" \
      | grep -v -E '// (TODO|FIXME|NOTE|HACK|WARNING|IMPORTANT)' \
      | grep -v -i -E '(why|because|reason|workaround)' \
      | grep -v -E '^\s*\*|/\*\*' \
      | sed "s|^|${file}:|"
  )
done < <(
  find apps packages -name '*.ts' \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -path '*/__tests__/*' \
    -not -name '*.test.ts' \
    -not -name '*.spec.ts' \
    2>/dev/null
)

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "Found $violations descriptive comment(s). Replace with named functions or remove."
  exit 1
fi

echo "No descriptive comments found."
exit 0
