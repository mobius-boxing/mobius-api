#!/usr/bin/env bash
# Usage: scripts/check-core-contract.sh <this_repo> <peer_repo>
# Compares every path in <this_repo>/core-contract.paths between the two working
# trees: files byte-for-byte, directories recursively (added/removed files count).
# Exit 0 identical, 1 differences (listed), 2 peer missing or unreadable.
set -u

this_repo="${1:-}"
peer_repo="${2:-}"

if [ -z "$this_repo" ] || [ -z "$peer_repo" ]; then
  echo "usage: $0 <this_repo> <peer_repo>" >&2
  exit 2
fi
if [ ! -d "$this_repo" ] || [ ! -r "$this_repo/core-contract.paths" ]; then
  echo "core-contract: $this_repo has no readable core-contract.paths" >&2
  exit 2
fi
if [ ! -d "$peer_repo" ] || [ ! -r "$peer_repo" ]; then
  echo "core-contract: peer repo missing or unreadable: $peer_repo" >&2
  exit 2
fi

this_repo="$(cd "$this_repo" && pwd)"
peer_repo="$(cd "$peer_repo" && pwd)"

diffs=0
report() {
  echo "DIFF  $1"
  diffs=$((diffs + 1))
}

while IFS= read -r line || [ -n "$line" ]; do
  path="${line%%#*}"
  path="$(echo "$path" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -z "$path" ] && continue
  path="${path%/}"
  mine="$this_repo/$path"
  theirs="$peer_repo/$path"

  if [ ! -e "$mine" ] && [ ! -e "$theirs" ]; then
    report "$path (missing in both)"
  elif [ ! -e "$mine" ]; then
    report "$path (missing here)"
  elif [ ! -e "$theirs" ]; then
    report "$path (missing in peer)"
  elif [ -d "$mine" ] && [ -d "$theirs" ]; then
    out="$(diff -rq "$mine" "$theirs" 2>&1)"
    if [ -n "$out" ]; then
      while IFS= read -r d; do
        d="${d//$this_repo\//}"
        echo "DIFF  ${d//$peer_repo\//peer:}"
      done <<< "$out"
      diffs=$((diffs + 1))
    fi
  elif [ -f "$mine" ] && [ -f "$theirs" ]; then
    cmp -s "$mine" "$theirs" || report "$path"
  else
    report "$path (file vs directory)"
  fi
done < "$this_repo/core-contract.paths"

if [ "$diffs" -gt 0 ]; then
  echo "core-contract: $diffs listed path(s) differ" >&2
  exit 1
fi
echo "core-contract: identical"
exit 0
