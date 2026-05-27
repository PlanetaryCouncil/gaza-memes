# Image Rater Changelog

## Current State

- Built a static image-rating interface hosted from the repo root.
- Wired image loading to `data/images.txt`.
- Added Supabase-backed save flow with anonymous auth support.
- Added Turnstile/CAPTCHA-ready client flow.

## UI simplification

- Removed hero/header marketing copy.
- Removed folder label and `Open original`.
- Removed skip/rotation controls.
- Reduced visual fluff and tightened layout around the image, rating, and feedback.

## Navigation

- Replaced old skip behavior with `Previous` and `Next`.
- Uses a shuffled deck so the session is random but navigable.
- Restored circular deck navigation after an intermediate history-only model proved to be the wrong UX.
- `save ➡️` now advances to the next image while still allowing `Previous` to return to the image just rated.
- Added URL-hash deep links so each image can be shared directly.

## Rating UX

- Replaced slider with a star-based half-step rating control.
- Added live hover preview.
- Removed default `5.0`; score now starts unset.
- Added disabled state for `save ➡️` until a score is selected.
- Stabilized score pill width so values do not shift layout.
- Trimmed visible filename suffixes like ` -w` and ` -t`.

## Feedback order

- Reordered feedback to:
  - `✅ Positive`
  - `🔄 Neutral`
  - `⛔️ Negative`

## Counting logic

- Added header counters for total, skipped, and rated.
- Skip count now tracks forward-only unrated skips.
- Rated count tracks unique rated images in the current session.

## Revisit/update behavior

- Rated images remain in the deck.
- Revisiting a rated image restores its form values.
- Saving an already rated image updates the existing Supabase row using upsert.

## Image manifest logic

- `scripts/build-image-manifest.sh` now builds `data/images.txt`.
- The script reads `data/folders_to_include.txt`.
- For folders with their own `readme.md`, only images referenced in that folder readme are included.
- For folders without a folder-level `readme.md`, the script falls back to the main `readme.md`.
- For the main `readme.md`, curation is taken from the section below:

```md
<!-- MEMES TO BE RATED BELOW THIS LINE -->
```

- Commented-out image references are ignored.
- URL-escaped paths are decoded.
- Non-existent files are excluded from the final manifest.
- Fixed a bug where the last folder in `data/folders_to_include.txt` could be skipped if the file had no trailing newline.

## Supporting docs

- Added `scripts/readme.md` with script usage instructions.
- Added `ACCEPTANCE_CRITERIA.md` for behavioral requirements.
- Added this `CHANGELOG-RATER.md` for practical project memory across toolchains.

## Sharing and metadata

- Added Open Graph metadata for page-level link previews.
- Added Twitter card metadata for page-level link previews.
- Set the default share image to `memes-homepage/ministry-of-memes.png`.
- Noted the limitation that hash-based image links are great for humans, but social crawlers still use page-level metadata.

## Test coverage

- Added Playwright E2E coverage.
- Current E2E checks cover:
  - save → next → previous restore flow
  - skipped counter behavior
  - hash-based deep linking to an exact image
  - circular `Previous` navigation through the shuffled deck
