import { test, expect } from "@playwright/test";

const supabaseStub = `
  window.supabase = {
    createClient() {
      const ratings = new Map();
      return {
        auth: {
          async getSession() {
            return { data: { session: { user: { id: "user-1" } } } };
          },
          async signInAnonymously() {
            return { data: { session: { user: { id: "user-1" } } }, error: null };
          },
          async getUser() {
            return { data: { user: { id: "user-1" } }, error: null };
          }
        },
        from() {
          return {
            async upsert(payload) {
              ratings.set(payload.image_path, payload);
              return { error: null };
            }
          };
        }
      };
    }
  };
`;

test.beforeEach(async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: supabaseStub
    });
  });

  await page.route("**/supabase-config.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.SUPABASE_CONFIG = {
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "public-anon-key",
          ratingsTable: "image_ratings",
          turnstileSiteKey: "",
          requireCaptchaForAuth: false
        };
      `
    });
  });
});

test("save then previous returns to the same rated image with data restored", async ({ page }) => {
  await page.goto("/");

  const title = page.locator("#image-title");
  const beforeSaveTitle = await title.textContent();

  await page.locator("#star-rating .star-button").nth(6).click();
  await page.locator("#positive").fill("Strong");
  await page.locator("#neutral").fill("Mixed");
  await page.locator("#negative").fill("Weak");
  await page.locator("#submit-button").click();

  await expect(title).not.toHaveText(beforeSaveTitle ?? "", { timeout: 10_000 });

  await page.locator("#previous-button").click();

  await expect(title).toHaveText(beforeSaveTitle ?? "");
  await expect(page.locator("#positive")).toHaveValue("Strong");
  await expect(page.locator("#neutral")).toHaveValue("Mixed");
  await expect(page.locator("#negative")).toHaveValue("Weak");
  await expect(page.locator("#score-value")).not.toHaveText("...");
});

test("skipped counter only increases when moving next from a new unrated image", async ({ page }) => {
  await page.goto("/");

  const skipped = page.locator("#skipped-count");
  await expect(skipped).toHaveText("0");

  await page.locator("#previous-button").click();
  await expect(skipped).toHaveText("0");

  await page.locator("#next-button").click();
  await expect(skipped).toHaveText("1");

  await page.locator("#previous-button").click();
  await expect(skipped).toHaveText("1");

  await page.locator("#next-button").click();
  await expect(skipped).toHaveText("1");
});
