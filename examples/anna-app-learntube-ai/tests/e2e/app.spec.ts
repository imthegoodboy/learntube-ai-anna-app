import { expect, test } from "@playwright/test";

test("creates a learning workspace and supports core study actions", async ({ page }) => {
  await page.goto("/");
  const app = page.frameLocator("iframe").first();
  await expect(app.getByRole("heading", { name: "Watch less. Remember more." })).toBeVisible();

  await app.getByLabel("YouTube URL or playlist").fill("https://www.youtube.com/watch?v=binary-search-demo");
  await app.getByLabel("Goal").fill("DSA interview readiness");
  await app.getByText("Paste transcript or notes for stronger results").click();
  await app.locator("#manual-transcript").fill(
    "Binary search works on sorted arrays. Compare the target with the middle value. Discard the half that cannot contain the answer. Lower bound and upper bound are common variants.",
  );
  await app.getByRole("button", { name: "Learn" }).click();

  await expect(app.getByRole("heading", { name: "Binary Search Explained" })).toBeVisible();
  await expect(app.getByText("Smart notes")).not.toBeVisible();

  await app.getByRole("button", { name: "Notes" }).click();
  await expect(app.getByRole("heading", { name: "Smart notes" })).toBeVisible();

  await app.getByRole("button", { name: "Flashcards" }).click();
  await app.getByRole("button", { name: "Flip" }).first().click();
  await app.getByRole("button", { name: "Hard" }).first().click();
  await expect(app.locator(".tag", { hasText: "hard" }).first()).toBeVisible();

  await app.getByRole("button", { name: "Quiz" }).click();
  await app.getByRole("button", { name: /O\(log n\)/ }).first().click();
  await expect(app.getByText(/Score:/)).toBeVisible();

  await app.getByRole("button", { name: "Action Items" }).click();
  await app.getByRole("checkbox").first().check();
  await expect(app.getByText(/XP/)).toBeVisible();

  await app.getByRole("button", { name: "Roadmap" }).click();
  await app.getByRole("button", { name: "Mark done" }).first().click();
  await expect(app.getByText(/roadmap done/i)).toBeVisible();

  await app.getByLabel("Question").fill("Explain binary search like I am 10");
  await app.getByLabel("AI mentor").getByRole("button", { name: "Ask" }).click();
  await expect(app.getByRole("heading", { name: "Latest answer" })).toBeVisible();
});

test("mobile viewport has no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.setViewportSize({ width: 375, height: 844 });
  const app = page.frameLocator("iframe").first();
  await expect(app.getByRole("heading", { name: "Watch less. Remember more." })).toBeVisible();
  const frameHandle = await page.locator("iframe").first().elementHandle();
  const frame = await frameHandle?.contentFrame();
  if (!frame) throw new Error("Anna app iframe not available");
  const overflow = await frame.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
