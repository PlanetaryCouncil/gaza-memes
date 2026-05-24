#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output_file="$repo_root/data/images.txt"

mkdir -p "$(dirname "$output_file")"

find "$repo_root" -type f \
  \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \) \
  ! -path "$repo_root/.git/*" \
  ! -path "$repo_root/data/*" \
  | sed "s#^$repo_root/##" \
  | sort > "$output_file"

printf 'Wrote %s entries to %s\n' "$(wc -l < "$output_file")" "$output_file"
