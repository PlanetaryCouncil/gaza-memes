# Image Rater Setup

## Files added

- `index.html` - static GitHub Pages UI
- `styles.css` - visual styling
- `app.js` - image loading, randomization, session flow, and Supabase inserts
- `data/images.txt` - generated list of image files in the repo
- `scripts/build-image-manifest.sh` - regenerates `data/images.txt`
- `supabase/schema.sql` - starter table and RLS policies
- `supabase-config.js` - runtime config loaded by the frontend
- `supabase-config.example.js` - example values
- `.nojekyll` - required because the repo still contains underscore-prefixed folders

## GitHub Pages

This app is static and can be hosted directly from the repo root on GitHub Pages.

## Supabase steps

1. Create a Supabase project.
2. In Supabase SQL editor, run `supabase/schema.sql`.
3. Enable anonymous auth.
4. Enable CAPTCHA protection if you want the session flow to require it.
5. Put your values into `supabase-config.js`:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - `turnstileSiteKey`
   - `requireCaptchaForAuth`

## CAPTCHA

The frontend is prepared for Cloudflare Turnstile.

If you enable CAPTCHA in Supabase auth, set:

- `turnstileSiteKey`
- `requireCaptchaForAuth: true`

## Regenerating the image list

When you add or remove images, run:

```bash
./scripts/build-image-manifest.sh
```

That will refresh `data/images.txt`.

## Fractional scores

The current UI stores scores in `0.5` steps from `0.0` to `10.0`.

If you already created the table with the earlier integer schema, run this once in Supabase:

```sql
alter table public.image_ratings
  alter column score type numeric(3,1) using score::numeric,
  drop constraint if exists image_ratings_score_check,
  add constraint image_ratings_score_check
    check (score between 0 and 10 and score * 2 = trunc(score * 2));
```
