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

async function dismissIntro(page) {
  const proceed = page.locator("#intro-proceed");
  if (await proceed.isVisible()) {
    await proceed.click();
  }
}

test("defaults to positive mode and can toggle to doom mode", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  const modeToggle = page.locator("#mode-toggle");
  const positiveLabel = page.locator("#mode-label-positive");
  const negativeLabel = page.locator("#mode-label-negative");

  await expect(modeToggle).toHaveAttribute("aria-checked", "true");
  await expect(positiveLabel).toHaveClass(/is-active/);
  await expect(negativeLabel).not.toHaveClass(/is-active/);
  await expect(page).not.toHaveURL(/mode=negative/);

  await modeToggle.click();

  await expect(modeToggle).toHaveAttribute("aria-checked", "false");
  await expect(negativeLabel).toHaveClass(/is-active/);
  await expect(positiveLabel).not.toHaveClass(/is-active/);
  await expect(page).toHaveURL(/mode=negative/);
});

test("doom mode URL restores doom mode on reload", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  await page.locator("#mode-toggle").click();
  await expect(page).toHaveURL(/mode=negative/);

  await page.reload();

  await expect(page.locator("#mode-toggle")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#mode-label-negative")).toHaveClass(/is-active/);
  await expect(page).toHaveURL(/mode=negative/);
  await expect(page.locator("#intro-overlay")).toBeHidden();
});

test("reloading the page keeps the current image but resets it to the first session item", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  await page.locator("#next-button").click();
  await page.locator("#next-button").click();
  await expect.poll(async () => await page.locator("#image-view").getAttribute("src")).not.toBeNull();
  const titleBeforeReload = await page.locator("#image-title").textContent();
  const imageBeforeReload = await page.locator("#image-view").getAttribute("src");
  await expect(page.locator("#image-title")).toHaveText(/^3\.\s/);

  await page.reload();
  await dismissIntro(page);

  await expect(page.locator("#image-view")).toHaveAttribute("src", imageBeforeReload ?? "");
  await expect(page.locator("#image-title")).not.toHaveText(titleBeforeReload ?? "");
  await expect(page.locator("#image-title")).toHaveText(/^1\.\s/);
});

test("reaching the end stops navigation and shows confetti", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  const nextButton = page.locator("#next-button");
  for (let index = 0; index < 30; index += 1) {
    if (await nextButton.isDisabled()) {
      break;
    }
    await nextButton.click();
  }

  await expect(nextButton).toBeDisabled();
  await expect(page.locator("#completion-confetti .completion-confetti-piece")).toHaveCount(28);
});

test("finishing a mode counts the last skipped image and offers switching mode", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  const total = Number(await page.locator("#total-count").textContent());
  const nextButton = page.locator("#next-button");

  for (let index = 0; index < total; index += 1) {
    await nextButton.click();
  }

  await expect(page.locator("#skipped-count")).toHaveText(String(total));
  await expect(page.locator("#completion-status")).toContainText("You have seen all the memes");
  await expect(page.locator("#completion-status")).toContainText("switch to doom");
});

test("save then previous returns to the same rated image with data restored", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

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
  await dismissIntro(page);

  const skipped = page.locator("#skipped-count");
  const previousButton = page.locator("#previous-button");
  await expect(skipped).toHaveText("0");
  await expect(previousButton).toBeDisabled();

  await expect(skipped).toHaveText("0");

  await page.locator("#next-button").click();
  await expect(skipped).toHaveText("1");

  await previousButton.click();
  await expect(skipped).toHaveText("1");

  await page.locator("#next-button").click();
  await expect(skipped).toHaveText("1");
});

test("current image is reflected in the hash and can be restored from a shared URL", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  const currentImage = page.locator("#image-view");
  await expect.poll(async () => await currentImage.getAttribute("src")).not.toBeNull();
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

test("previous stops at the first item instead of wrapping around", async ({ page }) => {
  await page.goto("/");
  await dismissIntro(page);

  const title = page.locator("#image-title");
  const previousButton = page.locator("#previous-button");

  await expect(title).toHaveText(/^\d+\.\s/);
  await expect(title).toHaveText(/^1\.\s/);
  await expect(previousButton).toBeDisabled();

  await page.locator("#next-button").click();
  await expect(title).toHaveText(/^2\.\s/);
  await expect(previousButton).toBeEnabled();

  await previousButton.click();
  const firstHash = await page.evaluate(() => window.location.hash);
  const firstTitle = await title.textContent();

  expect(firstTitle ?? "").toMatch(/^1\.\s/);

  await previousButton.click({ force: true });
  await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe(firstHash);
  await expect(title).toHaveText(firstTitle ?? "");
});

test("mobile keeps all ten stars on a single row", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await dismissIntro(page);

  const starButtons = page.locator("#star-rating .star-button");
  await expect(starButtons).toHaveCount(10);

  const tops = await starButtons.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top))
  );

  expect(new Set(tops).size).toBe(1);
});
