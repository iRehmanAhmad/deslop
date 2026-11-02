#!/usr/bin/env bash
# deslop-hook.sh — Claude Code PostToolUse hook.
#
# After Claude edits or writes a UI file, run deslop on THAT file only and
# print any findings (compactly) so the agent sees them in the tool result
# and can fix them before calling the work done.
#
# Contract: this script NEVER blocks. Whatever happens — unparseable
# input, missing file, deslop not found, findings or none — it exits 0.
#
# Setup: see hooks/README.md. Point DESLOP_BIN at another deslop.js if
# this repo does not live next to the hook:
#   DESLOP_BIN=/path/to/deslop/bin/deslop.js
set -u

input="$(cat 2>/dev/null || true)"

# Extract tool_input.file_path from the hook's JSON stdin. Node does the
# parsing — deslop needs Node anyway, so no extra dependency is added.
file_path=""
if command -v node >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s);
        const p = (j.tool_input && j.tool_input.file_path) || "";
        process.stdout.write(typeof p === "string" ? p : "");
      } catch { /* unparseable input: print nothing, caller exits 0 */ }
    });
  ' 2>/dev/null || true)"
fi

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

# Only files deslop understands.
case "$file_path" in
  *.css|*.scss|*.html|*.jsx|*.tsx|*.vue|*.astro|*.svelte) ;;
  *) exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
DESLOP="${DESLOP_BIN:-$SCRIPT_DIR/../bin/deslop.js}"
[ -f "$DESLOP" ] || exit 0

out="$(node "$DESLOP" "$file_path" 2>/dev/null || true)"

# Clean file -> stay silent. Findings -> print the finding lines and the
# footer, trimmed of the blank separator line.
if printf '%s' "$out" | grep -q '\[FAIL\]\|\[warn\]'; then
  echo "deslop findings in $file_path (fix before calling this done):"
  printf '%s\n' "$out" | grep -v '^$'
fi

exit 0
