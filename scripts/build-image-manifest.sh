#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output_file="$repo_root/data/images.txt"
folders_file="$repo_root/data/folders_to_include.txt"
root_readme="$repo_root/readme.md"
marker='<!-- MEMES TO BE RATED BELOW THIS LINE -->'

mkdir -p "$(dirname "$output_file")"

if [[ ! -f "$folders_file" ]]; then
  printf 'Missing folders file: %s\n' "$folders_file" >&2
  exit 1
fi

if [[ ! -f "$root_readme" ]]; then
  printf 'Missing readme file: %s\n' "$root_readme" >&2
  exit 1
fi

extract_markdown_images() {
  perl -0ne '
    my $text = $_;
    $text =~ s/<!--.*?-->//gs;
    while ($text =~ /!\[[^\]]*\]\(([^)]+)\)/g) {
      print "$1\n";
    }
  ' "$1"
}

decode_uri() {
  perl -pe 's/%([0-9A-Fa-f]{2})/chr(hex($1))/eg'
}

resolve_folder_path() {
  local folder="$1"
  local raw_path="$2"
  local decoded_path="$3"
  local candidate=""

  if [[ "$decoded_path" == "$folder/"* ]] && [[ -f "$repo_root/$decoded_path" ]]; then
    printf '%s\n' "$decoded_path"
    return
  fi

  if [[ "$decoded_path" != */* ]]; then
    candidate="$folder/$decoded_path"
    if [[ -f "$repo_root/$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi

  if [[ -f "$repo_root/$decoded_path" ]]; then
    printf '%s\n' "$decoded_path"
    return
  fi

  local basename_path
  basename_path="${decoded_path##*/}"
  candidate="$folder/$basename_path"
  if [[ -f "$repo_root/$candidate" ]]; then
    printf '%s\n' "$candidate"
    return
  fi

  local raw_basename
  raw_basename="${raw_path##*/}"
  raw_basename="$(printf '%s\n' "$raw_basename" | decode_uri)"
  candidate="$folder/$raw_basename"
  if [[ -f "$repo_root/$candidate" ]]; then
    printf '%s\n' "$candidate"
    return
  fi

  return 1
}

build_from_folder_readme() {
  local folder="$1"
  local folder_readme="$repo_root/$folder/readme.md"

  if [[ ! -f "$folder_readme" ]]; then
    return 1
  fi

  extract_markdown_images "$folder_readme" \
    | while IFS= read -r raw_path; do
        [[ -z "$raw_path" ]] && continue
        local decoded_path
        decoded_path="$(printf '%s\n' "$raw_path" | decode_uri)"
        resolve_folder_path "$folder" "$raw_path" "$decoded_path" || true
      done
}

build_from_root_readme() {
  local folder="$1"

  awk -v marker="$marker" '
    found { print }
    $0 == marker { found = 1 }
  ' "$root_readme" \
    | perl -0ne '
        my $text = $_;
        $text =~ s/<!--.*?-->//gs;
        while ($text =~ /!\[[^\]]*\]\(([^)]+)\)/g) {
          print "$1\n";
        }
      ' \
    | decode_uri \
    | awk -v folder="$folder" -F/ '$1 == folder { print }' \
    | while IFS= read -r path; do
        [[ -f "$repo_root/$path" ]] && printf '%s\n' "$path"
      done
}

: > "$output_file"

while IFS= read -r folder || [[ -n "$folder" ]]; do
  [[ -z "$folder" ]] && continue
  if [[ -f "$repo_root/$folder/readme.md" ]]; then
    build_from_folder_readme "$folder" >> "$output_file"
  else
    build_from_root_readme "$folder" >> "$output_file"
  fi
done < "$folders_file"

sort -u -o "$output_file" "$output_file"
printf 'Wrote %s entries to %s\n' "$(wc -l < "$output_file")" "$output_file"
