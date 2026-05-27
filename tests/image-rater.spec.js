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

test("current image is reflected in the hash and can be restored from a shared URL", async ({ page }) => {
  await page.goto("/");

  const currentImage = page.locator("#image-view");
  const initialSrc = await currentImage.getAttribute("src");
  const currentHash = await page.evaluate(() => window.location.hash);

  expect(currentHash).toBeTruthy();
  expect(decodeURIComponent(currentHash.slice(1))).toBe(decodeURIComponent(initialSrc ?? ""));

  await page.locator("#next-button").click();
  const nextHash = await page.evaluate(() => window.location.hash);
  expect(nextHash).not.toBe(currentHash);

  await page.goto(`/${nextHash}`);
  await expect
    .poll(async () => {
      const src = await page.locator("#image-view").getAttribute("src");
      return decodeURIComponent(src ?? "");
    })
    .toBe(decodeURIComponent(nextHash.slice(1)));
});

test("previous wraps through the shuffled deck instead of stopping at visit history", async ({ page }) => {
  await page.goto("/");

  const initialHash = await page.evaluate(() => window.location.hash);

  await page.locator("#previous-button").click();
  const previousHash = await page.evaluate(() => window.location.hash);
  expect(previousHash).not.toBe(initialHash);

  await page.locator("#next-button").click();
  await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe(initialHash);
});

test("mobile keeps all ten stars on a single row", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");

  const starButtons = page.locator("#star-rating .star-button");
  await expect(starButtons).toHaveCount(10);

  const tops = await starButtons.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top))
  );

  expect(new Set(tops).size).toBe(1);
});
