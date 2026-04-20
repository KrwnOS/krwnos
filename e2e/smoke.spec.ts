import { test, expect } from "@playwright/test";

/**
 * Serial smoke: one empty DB → setup → invite URL → nexus (CLI token auth).
 * Then /setup redirects (already configured).
 */

test.describe.configure({ mode: "serial" });

let bootstrapToken = "";
let invitePageUrl = "";

test("setup wizard reaches success (step 4)", async ({ page }) => {
  await page.goto("/setup");

  await page.getByLabel(/state name/i).fill("E2E Playwright State");
  await page.getByRole("button", { name: "Next →" }).click();

  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();

  await page.getByLabel(/your @handle/i).fill("e2e_sovereign");
  await page.getByRole("button", { name: /crown the sovereign/i }).click();

  await expect(
    page.getByRole("heading", { name: /state created/i }),
  ).toBeVisible({ timeout: 60_000 });

  const tokenRow = page.locator("code").filter({ hasText: /^kt_/ }).first();
  await expect(tokenRow).toBeVisible();
  bootstrapToken = (await tokenRow.innerText()).trim();

  const inviteLink = page.locator("code").filter({ hasText: /\/invite\// }).first();
  await expect(inviteLink).toBeVisible();
  const raw = (await inviteLink.innerText()).trim();
  const m = raw.match(/\/invite\/([^/?#\s]+)/);
  if (!m?.[1]) {
    throw new Error(`Could not parse invite token from URL: ${raw}`);
  }
  invitePageUrl = `/invite/${m[1]}`;
});

test("invite page loads for token from setup", async ({ page }) => {
  await page.goto(invitePageUrl);
  await expect(page.getByRole("heading", { name: /invitation to/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /accept invitation/i })).toBeVisible();
});

test("/setup redirects when already initialised", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);
});

test("admin nexus: token prompt without session; dashboard with bootstrap token", async ({
  browser,
}) => {
  // Fresh context: setup wizard already persisted krwn.token in the default context.
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  try {
    await page.goto("/admin/nexus");
    await expect(page.getByRole("heading", { name: /enter nexus/i })).toBeVisible();

    await page.evaluate((token) => {
      window.localStorage.setItem("krwn.token", token);
    }, bootstrapToken);

    await page.goto("/admin/nexus");
    await expect(page.getByRole("heading", { name: "E2E Playwright State" })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
});

test("admin citizens: token prompt; list with bootstrap token", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  try {
    await page.goto("/admin/citizens");
    await expect(page.getByRole("heading", { name: /enter the citizens hall/i })).toBeVisible();

    await page.evaluate((token) => {
      window.localStorage.setItem("krwn.token", token);
    }, bootstrapToken);

    await page.goto("/admin/citizens");
    await expect(page.getByRole("heading", { name: /^citizens$/i })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
});

test("api/admin/nexus: 401 without token; 200 with bootstrap bearer", async ({
  request,
}) => {
  const unauth = await request.get("/api/admin/nexus");
  expect(unauth.status()).toBe(401);

  const ok = await request.get("/api/admin/nexus", {
    headers: { authorization: `Bearer ${bootstrapToken}` },
  });
  expect(ok.status()).toBe(200);
  const json = (await ok.json()) as { state?: { name?: string } };
  expect(json.state?.name).toBe("E2E Playwright State");
});

test("dashboard: no horizontal overflow at mobile width", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.evaluate((token) => {
      window.localStorage.setItem("krwn.token", token);
    }, bootstrapToken);

    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /E2E Playwright State/i }),
    ).toBeVisible({ timeout: 30_000 });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  } finally {
    await context.close();
  }
});
