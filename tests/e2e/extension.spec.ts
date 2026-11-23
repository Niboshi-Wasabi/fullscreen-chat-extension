import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  fixtureUrl,
  readSettings,
  setSettings,
} from "./fixtures";

test("popup changes persist through a new extension page and locale changes", async ({
  page,
  context,
  extensionId,
  extensionWorker,
}, testInfo) => {
  await page.setViewportSize({ width: 480, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("#enabled")).toBeChecked();
  const githubLink = page.locator("#githubLink");
  await expect(githubLink).toBeVisible();
  await expect(githubLink).toHaveAttribute(
    "href",
    "https://github.com/Niboshi-Wasabi/fullscreen-chat-extension",
  );
  await expect(githubLink).toHaveAttribute("target", "_blank");
  await expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(githubLink.locator('[data-i18n="githubRepo"]')).toHaveText(
    "GitHub",
  );
  await expect(githubLink).toHaveAttribute(
    "aria-label",
    "Open GitHub repository",
  );
  await expect(githubLink).toHaveAttribute("title", "Open GitHub repository");
  await page.locator("#enabled").focus();
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await readSettings(extensionWorker)).enabled)
    .toBe(false);
  await page.getByText("Danmaku", { exact: true }).click();
  await expect
    .poll(async () => (await readSettings(extensionWorker)).displayMode)
    .toBe("danmaku");
  await page.locator("#uiLocale").selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect
    .poll(async () => (await readSettings(extensionWorker)).uiLocale)
    .toBe("ja");
  const second = await context.newPage();
  await second.setViewportSize({ width: 480, height: 600 });
  await second.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(second.locator("#enabled")).not.toBeChecked();
  await expect(second.locator('input[value="danmaku"]')).toBeChecked();
  await expect(second.locator("#uiLocale")).toHaveValue("ja");
  const secondGithub = second.locator("#githubLink");
  await expect(secondGithub.locator('[data-i18n="githubRepo"]')).toHaveText(
    "GitHub",
  );
  await expect(secondGithub).toHaveAttribute(
    "aria-label",
    "GitHub リポジトリを開く",
  );
  await expect(secondGithub).toHaveAttribute(
    "title",
    "GitHub リポジトリを開く",
  );
  const popupLayout = await second.evaluate(() => {
    const optionsBtn = document.querySelector<HTMLElement>("#openOptions");
    const repoLink = document.querySelector<HTMLElement>("#githubLink");
    if (!optionsBtn || !repoLink) {
      throw new Error("Missing popup footer actions");
    }
    const optRect = optionsBtn.getBoundingClientRect();
    const repoRect = repoLink.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
      optionsRight: optRect.right,
      repoLeft: repoRect.left,
      repoRight: repoRect.right,
      verticalDelta: Math.abs(
        optRect.top + optRect.height / 2 - (repoRect.top + repoRect.height / 2),
      ),
    };
  });
  expect(popupLayout.docScrollWidth).toBeLessThanOrEqual(
    popupLayout.docClientWidth,
  );
  expect(popupLayout.docScrollHeight).toBeLessThanOrEqual(
    popupLayout.docClientHeight,
  );
  expect(popupLayout.optionsRight).toBeLessThanOrEqual(
    popupLayout.repoLeft + 0.5,
  );
  expect(popupLayout.repoRight).toBeLessThanOrEqual(
    popupLayout.innerWidth + 0.5,
  );
  expect(popupLayout.verticalDelta).toBeLessThanOrEqual(8);
  await second.screenshot({ path: testInfo.outputPath("popup-ja.png") });
});

test("options save filters and keyboard navigation reaches settings categories", async ({
  page,
  extensionId,
  extensionWorker,
}, testInfo) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const category = page.locator('[data-tab="filter"]');
  await category.focus();
  await page.keyboard.press("Enter");
  await expect(category).toHaveAttribute("aria-current", "page");
  await page.locator("#ngWords").fill("Synthetic blocked marker");
  await expect
    .poll(async () => (await readSettings(extensionWorker)).filter.ngWords)
    .toEqual(["Synthetic blocked marker"]);
  await page.reload();
  await page.locator('[data-tab="filter"]').click();
  await expect(page.locator("#ngWords")).toHaveValue(
    "Synthetic blocked marker",
  );
  await page.screenshot({
    path: testInfo.outputPath("options-filter.png"),
    fullPage: true,
  });
});

test("content script renders filtered live chat, follows fullscreen and can be re-enabled", async ({
  page,
  context,
  extensionWorker,
}, testInfo) => {
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    filter: { ...initial.filter, ngWords: ["blocked marker"] },
  });
  await page.goto(fixtureUrl);
  const panel = page.locator("#fce-overlay-panel-host");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Synthetic hello message");
  await expect(panel).not.toContainText("Synthetic blocked marker");
  await expect(page.locator("#fce-danmaku-host")).toHaveCount(0);
  await page.locator("#fixture-fullscreen").click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id))
    .toBe("movie_player");
  await expect(
    page.locator("#movie_player #fce-overlay-panel-host"),
  ).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await setSettings(extensionWorker, { enabled: false });
  await expect(panel).toHaveCount(0);
  await page.locator("#fce-player-toggle").click();
  await expect
    .poll(async () => (await readSettings(extensionWorker)).enabled)
    .toBe(true);
  await expect(panel).toBeVisible();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  const beforeMetrics = await session.send("Performance.getMetrics");
  const startedAt = await page.evaluate(() => {
    const started = performance.now();
    const frame = document.querySelector<HTMLIFrameElement>(
      "#fce-hidden-live-chat-frame",
    );
    const frameDoc = frame?.contentDocument;
    const items = frameDoc?.querySelector("#items");
    if (!frameDoc || !items) {
      throw new Error("Missing synthetic live chat container");
    }
    for (let index = 0; index < 100; index += 1) {
      const row = frameDoc.createElement("yt-live-chat-text-message-renderer");
      row.id = `burst-${index}`;
      const author = frameDoc.createElement("span");
      author.id = "author-name";
      author.textContent = "Synthetic burst viewer";
      const text = frameDoc.createElement("span");
      text.id = "message";
      text.textContent = `Synthetic burst ${index}`;
      row.append(author, text);
      items.append(row);
    }
    return started;
  });
  await expect(panel).toContainText("Synthetic burst 99");
  await expect(panel.locator(".fce-panel-row")).toHaveCount(
    initial.filter.maxVisible,
  );
  const metrics = await session.send("Performance.getMetrics");
  await session.detach();
  await testInfo.attach("synthetic-burst-observation", {
    body: JSON.stringify(
      {
        inserted: 100,
        observedAfterMs: await page.evaluate(
          (started) => performance.now() - started,
          startedAt,
        ),
        visibleRows: await panel.locator(".fce-panel-row").count(),
        metrics: metrics.metrics,
        beforeMetrics: beforeMetrics.metrics,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("synthetic-overlay.png"),
    fullPage: true,
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`popup and options have no automatically detected accessibility violations (${colorScheme})`, async ({
    page,
    extensionId,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    for (const entry of ["popup", "options"]) {
      await page.goto(`chrome-extension://${extensionId}/${entry}.html`);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      const tabs =
        entry === "options"
          ? ["general", "display", "filter", "archive", "legal"]
          : [null];
      for (const tab of tabs) {
        if (tab) await page.locator(`[data-tab="${tab}"]`).click();
        await page.evaluate(() => document.fonts.ready);
        const overflowingIcons = await page
          .locator(".ms")
          .evaluateAll((icons) =>
            icons
              .filter(
                (icon) =>
                  Math.max(
                    icon.scrollWidth,
                    icon.getBoundingClientRect().width,
                  ) >
                  2 * parseFloat(getComputedStyle(icon).fontSize),
              )
              .map((icon) => icon.textContent?.trim()),
          );
        expect(
          overflowingIcons,
          "Bundled icon ligatures must not render as overflowing words",
        ).toEqual([]);
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        await testInfo.attach(`axe-${entry}-${tab ?? "popup"}-${colorScheme}`, {
          body: JSON.stringify(result.violations, null, 2),
          contentType: "application/json",
        });
        expect(
          result.violations,
          `${entry}/${tab ?? "popup"} ${colorScheme}`,
        ).toEqual([]);
      }
    }
  });
}
