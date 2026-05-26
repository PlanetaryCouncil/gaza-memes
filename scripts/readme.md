**TLDR:** just run `./build-image-manifest.sh`

# Scripts

This folder contains helper scripts for maintaining the image-rater site.

## `build-image-manifest.sh`

Builds `data/images.txt`, which is the list of images the website can show.

### How to run

From the repo root:

```bash
./scripts/build-image-manifest.sh
```

Or from inside the `scripts/` folder:

```bash
./build-image-manifest.sh
```

### What it does

- Reads `data/folders_to_include.txt`
- For each listed top-level folder:
  - if that folder has its own `readme.md`, it includes only images referenced in that folder readme
  - otherwise, it falls back to the main repo `readme.md`
- For the main repo `readme.md`, it only uses images below:

```md
<!-- MEMES TO BE RATED BELOW THIS LINE -->
```

- Ignores commented-out Markdown image references
- Decodes URL-escaped file names like `%20`
- Only writes paths that actually exist on disk
- Sorts and deduplicates the final list

### Output

The generated file is:

`data/images.txt`

### When to rerun

Run it whenever you:

- add or remove images
- edit a folder `readme.md`
- edit the main `readme.md`
- change `data/folders_to_include.txt`

### Quick verification

After running, you can inspect the result with:

```bash
wc -l data/images.txt
sed -n '1,40p' data/images.txt
```
