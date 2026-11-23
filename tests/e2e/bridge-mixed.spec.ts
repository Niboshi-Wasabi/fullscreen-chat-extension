import fs from "node:fs";
import { test, expect, readSettings, setSettings } from "./fixtures";

const ytWatchUrl = "https://www.youtube.com/watch?v=bridgeYt1";
const twWatchUrl = "https://www.twitch.tv/shroud";

const ytWatchHtml = fs
  .readFileSync(
    new URL("../fixtures/youtube-live.html", import.meta.url),
    "utf8",
  )
  .replace(
    "<title>Synthetic YouTube Live fixture</title>",
    "<title>Synthetic YT Bridge Stream - YouTube</title>",
  )
  .replace(
    '<ytd-live-chat-frame id="chat"></ytd-live-chat-frame>',
    '<ytd-live-chat-frame id="chat" collapsed=""><iframe id="chatframe" src="https://www.youtube.com/live_chat?continuation=bridgeYt1Tok&dark_theme=1"></iframe></ytd-live-chat-frame>',
  )
  .replace(
    "</body>",
    `<script>(()=>{const v=document.querySelector("video");if(!v)return;const c=document.createElement("canvas");c.width=16;c.height=16;const x=c.getContext("2d");if(x){x.fillStyle="#111";x.fillRect(0,0,16,16);}v.muted=true;v.autoplay=true;v.playsInline=true;v.srcObject=c.captureStream(5);void v.play().catch(()=>{});})();</script></body>`,
  );

const ytChatHtml = `<!doctype html><html><head><link rel="icon" href="data:," /></head><body>
  <div id="items">
    <yt-live-chat-text-message-renderer id="yt-init">
      <span id="author-name">YT Init</span>
      <span id="message">YT initial hello</span>
    </yt-live-chat-text-message-renderer>
  </div>
</body></html>`;

const twWatchHtml = `<!doctype html><html><head><meta charset="utf-8" /><link rel="icon" href="data:," /><title>shroud - Twitch</title></head><body style="margin:0">
  <div class="video-player__container" style="position:relative;width:1000px;height:600px">
    <video style="width:100%;height:100%"></video>
  </div>
  <div data-test-selector="chat-scrollable-area__message-container">
    <div data-a-target="chat-line-message" data-id="tw-init">
      <span data-a-target="chat-message-username">TW Init</span>
      <span data-a-target="chat-line-message-body">TW initial hello</span>
    </div>
  </div>
  <script>(()=>{const v=document.querySelector("video");if(!v)return;const c=document.createElement("canvas");c.width=16;c.height=16;const x=c.getContext("2d");if(x){x.fillStyle="#111";x.fillRect(0,0,16,16);}v.muted=true;v.autoplay=true;v.playsInline=true;v.srcObject=c.captureStream(5);void v.play().catch(()=>{});})();</script>
</body></html>`;

const twEmbedHtml =
  '<!doctype html><html><head><link rel="icon" href="data:," /></head><body><textarea data-a-target="chat-input"></textarea></body></html>';

async function setupBothRoutes(
  context: import("@playwright/test").BrowserContext,
  options?: { ytTitle?: string },
) {
  const watchHtml = options?.ytTitle
    ? ytWatchHtml.replace(
        "<title>Synthetic YT Bridge Stream - YouTube</title>",
        `<title>${options.ytTitle}</title>`,
      )
    : ytWatchHtml;
  await context.route("https://www.youtube.com/watch?v=bridgeYt1**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: watchHtml,
    }),
  );
  await context.route("https://www.youtube.com/live_chat?**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: ytChatHtml,
    }),
  );
  await context.route("https://www.twitch.tv/**", (route) => {
    const url = route.request().url();
    if (url === twWatchUrl) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: twWatchHtml,
      });
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: twEmbedHtml,
    });
  });
}

async function connectPeerViaGear(
  page: import("@playwright/test").Page,
  expectedOptionText: string,
) {
  const gearBtn = page.locator(".fce-panel-gear");
  await gearBtn.click();
  const refreshBtn = page.locator(".fce-panel-bridge-refresh");
  await refreshBtn.click();
  const select = page.locator(".fce-panel-bridge-select");
  await expect(select).toContainText(expectedOptionText);
  const value = await select.evaluate((el, text) => {
    const opt = Array.from((el as HTMLSelectElement).options).find((item) =>
      item.textContent?.includes(text),
    );
    return opt?.value ?? "";
  }, expectedOptionText);
  expect(value).not.toBe("");
  await select.selectOption(value);
}

async function injectYtComment(
  page: import("@playwright/test").Page,
  id: string,
  text: string,
) {
  await page.evaluate(
    ({ id, text }) => {
      const frame =
        document.querySelector<HTMLIFrameElement>(
          "#fce-hidden-live-chat-frame",
        ) ??
        document.querySelector<HTMLIFrameElement>("#fce-native-chat-frame");
      const doc = frame?.contentDocument;
      const items = doc?.querySelector("#items");
      if (!doc || !items) {
        throw new Error("Missing YT chat frame items container");
      }
      const row = doc.createElement("yt-live-chat-text-message-renderer");
      row.id = id;
      const author = doc.createElement("span");
      author.id = "author-name";
      author.textContent = "YT Viewer";
      const body = doc.createElement("span");
      body.id = "message";
      body.textContent = text;
      row.append(author, body);
      items.append(row);
    },
    { id, text },
  );
}

async function injectTwComment(
  page: import("@playwright/test").Page,
  id: string,
  text: string,
) {
  await page.evaluate(
    ({ id, text }) => {
      const container = document.querySelector(
        '[data-test-selector="chat-scrollable-area__message-container"]',
      );
      if (!container) {
        throw new Error("Missing Twitch chat container");
      }
      const row = document.createElement("div");
      row.setAttribute("data-a-target", "chat-line-message");
      row.dataset.id = id;
      const user = document.createElement("span");
      user.setAttribute("data-a-target", "chat-message-username");
      user.textContent = "TW Viewer";
      const body = document.createElement("span");
      body.setAttribute("data-a-target", "chat-line-message-body");
      body.textContent = text;
      row.append(user, body);
      container.append(row);
    },
    { id, text },
  );
}

async function ensureVideoPlaying(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const v = document.querySelector("video");
    if (!v) {
      throw new Error("Missing video element");
    }
    if (!v.srcObject) {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      const x = c.getContext("2d");
      if (x) {
        x.fillStyle = "#111";
        x.fillRect(0, 0, 16, 16);
      }
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;
      v.srcObject = c.captureStream(5);
    }
    if (v.paused) {
      await v.play();
    }
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelector("video")?.paused))
    .toBe(false);
}

async function waitForHiddenYtReceiverReady(
  ytPage: import("@playwright/test").Page,
) {
  await ytPage.waitForSelector("#fce-hidden-live-chat-frame");
  await expect
    .poll(() =>
      ytPage.evaluate(() =>
        Boolean(
          document
            .querySelector<HTMLIFrameElement>("#fce-hidden-live-chat-frame")
            ?.contentDocument?.querySelector("#items"),
        ),
      ),
    )
    .toBe(true);
  await expect(
    ytPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT initial hello",
    }),
  ).toHaveCount(1);
}

test("simultaneous bidirectional mixed panel shows site badges, applies per-tab remote delay without echo loops, and restores local chat when peer closes", async ({
  page: ytPage,
  context,
  extensionWorker,
}) => {
  await setupBothRoutes(context);
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...initial.panel, useNativeChat: true },
  });

  await ytPage.goto(ytWatchUrl);
  await ensureVideoPlaying(ytPage);
  await expect(ytPage.locator(".fce-panel-native")).toBeVisible();

  const twPage = await context.newPage();
  await twPage.goto(twWatchUrl);
  await ensureVideoPlaying(twPage);
  await expect(twPage.locator(".fce-panel-native")).toBeVisible();

  // Connect both tabs simultaneously: YT subscribes to #shroud (+2s delay); TW subscribes to YT (+0s delay).
  await connectPeerViaGear(ytPage, "#shroud");
  await expect(ytPage.locator(".fce-panel-bridge-bar")).toBeVisible();
  await ytPage.locator('.fce-panel-bridge-step:has-text("+1")').click();
  await ytPage.locator('.fce-panel-bridge-step:has-text("+1")').click();
  await expect(ytPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");

  await connectPeerViaGear(twPage, "Synthetic YT Bridge Stream");
  await expect(twPage.locator(".fce-panel-bridge-bar")).toBeVisible();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+0s");

  // Wait for hidden YT chat receiver and initial local rows before injecting new messages.
  await waitForHiddenYtReceiverReady(ytPage);

  await injectYtComment(ytPage, "yt-live-1", "YT bidirectional line");
  await injectTwComment(twPage, "tw-live-1", "TW bidirectional line");

  // Twitch (+0s) receives YT line immediately alongside local TW line, once each.
  await expect(
    twPage.locator('.fce-panel-row[data-site="twitch"]', {
      hasText: "TW bidirectional line",
    }),
  ).toHaveCount(1);
  await expect(
    twPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT bidirectional line",
    }),
  ).toHaveCount(1);
  const ytPanelBadge = twPage
    .locator('.fce-panel-row[data-site="youtube-live"] .fce-panel-site-badge')
    .first();
  await expect(ytPanelBadge).toHaveAttribute("role", "img");
  await expect(ytPanelBadge).toHaveAttribute("aria-label", "YouTube");
  await expect(ytPanelBadge).toHaveAttribute("title", "YouTube");
  await expect(ytPanelBadge).toHaveText("");
  await expect(ytPanelBadge.locator("svg")).toBeVisible();
  await expect(ytPanelBadge.locator("svg path")).toHaveCount(2);

  const twPanelBadge = twPage
    .locator('.fce-panel-row[data-site="twitch"] .fce-panel-site-badge')
    .first();
  await expect(twPanelBadge).toHaveAttribute("role", "img");
  await expect(twPanelBadge).toHaveAttribute("aria-label", "Twitch");
  await expect(twPanelBadge).toHaveAttribute("title", "Twitch");
  await expect(twPanelBadge).toHaveText("");
  await expect(twPanelBadge.locator("svg")).toBeVisible();
  await expect(twPanelBadge.locator("svg path")).toHaveCount(3);

  // YouTube shows local YT immediately, then receives delayed TW line after ~2s, once each.
  await expect(
    ytPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT bidirectional line",
    }),
  ).toHaveCount(1);
  await expect(
    ytPage.locator('.fce-panel-row[data-site="twitch"]', {
      hasText: "TW bidirectional line",
    }),
  ).toHaveCount(1, { timeout: 5000 });

  // Wait briefly and ensure zero echoed duplicates on either tab.
  await ytPage.waitForTimeout(450);
  await expect(
    ytPage.locator(".fce-panel-row", { hasText: "YT bidirectional line" }),
  ).toHaveCount(1);
  await expect(
    twPage.locator(".fce-panel-row", { hasText: "TW bidirectional line" }),
  ).toHaveCount(1);

  // Close Twitch tab and confirm YouTube cleanly returns to local-only official chat.
  await twPage.close();
  await expect(ytPage.locator(".fce-panel-bridge-bar")).toBeHidden();
  await expect(ytPage.locator(".fce-panel-native")).toBeVisible();
});

test("mixed chat extends to danmaku and OS popout window across both YouTube and Twitch", async ({
  page: ytPage,
  context,
  extensionWorker,
}) => {
  await setupBothRoutes(context);
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...initial.panel, useNativeChat: false },
    danmakuOverlayOnPanel: true,
    danmaku: { ...initial.danmaku, enabled: true, speed: 5, density: "high" },
  });

  await ytPage.goto(ytWatchUrl);
  await ensureVideoPlaying(ytPage);
  const twPage = await context.newPage();
  await twPage.goto(twWatchUrl);
  await ensureVideoPlaying(twPage);

  await connectPeerViaGear(ytPage, "#shroud");
  await connectPeerViaGear(twPage, "Synthetic YT Bridge Stream");
  await waitForHiddenYtReceiverReady(ytPage);

  // Inject messages from both sides and verify site-tagged danmaku on both tabs.
  await injectYtComment(ytPage, "yt-dm-1", "YT mixed danmaku");
  await injectTwComment(twPage, "tw-dm-1", "TW mixed danmaku");

  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT mixed danmaku",
    }),
  ).toHaveCount(1);
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="twitch"]', {
      hasText: "TW mixed danmaku",
    }),
  ).toHaveCount(1);
  const ytDanmakuYtBadge = ytPage
    .locator('.fce-danmaku-item[data-site="youtube-live"] .fce-danmaku-site')
    .first();
  await expect(ytDanmakuYtBadge).toHaveAttribute("aria-label", "YouTube");
  await expect(ytDanmakuYtBadge).toHaveText("");
  await expect(ytDanmakuYtBadge.locator("svg")).toBeVisible();
  const ytDanmakuTwBadge = ytPage
    .locator('.fce-danmaku-item[data-site="twitch"] .fce-danmaku-site')
    .first();
  await expect(ytDanmakuTwBadge).toHaveAttribute("aria-label", "Twitch");
  await expect(ytDanmakuTwBadge).toHaveText("");
  await expect(ytDanmakuTwBadge.locator("svg")).toBeVisible();

  await expect(
    twPage.locator('.fce-danmaku-item[data-site="twitch"]', {
      hasText: "TW mixed danmaku",
    }),
  ).toHaveCount(1);
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT mixed danmaku",
    }),
  ).toHaveCount(1);
  const twDanmakuYtBadge = twPage
    .locator('.fce-danmaku-item[data-site="youtube-live"] .fce-danmaku-site')
    .first();
  await expect(twDanmakuYtBadge).toHaveAttribute("aria-label", "YouTube");
  await expect(twDanmakuYtBadge).toHaveText("");
  await expect(twDanmakuYtBadge.locator("svg")).toBeVisible();
  const twDanmakuTwBadge = twPage
    .locator('.fce-danmaku-item[data-site="twitch"] .fce-danmaku-site')
    .first();
  await expect(twDanmakuTwBadge).toHaveAttribute("aria-label", "Twitch");
  await expect(twDanmakuTwBadge).toHaveText("");
  await expect(twDanmakuTwBadge.locator("svg")).toBeVisible();

  // Switch to OS popout mode on Twitch (foreground) -> bridge-popout.html?site=twitch opens with mixed rows.
  await twPage.bringToFront();
  const popoutPromise = context.waitForEvent("page");
  await setSettings(extensionWorker, {
    displayMode: "popout",
    popout: { ...initial.popout, alwaysOnTop: false },
  });
  const popoutPage = await popoutPromise;
  await popoutPage.waitForLoadState("domcontentloaded");
  await expect
    .poll(() => popoutPage.url())
    .toContain("/bridge-popout.html?site=twitch");
  await expect(popoutPage.locator(".fce-popout-list")).toContainText(
    "TW mixed danmaku",
  );
  await expect(popoutPage.locator(".fce-popout-list")).toContainText(
    "YT mixed danmaku",
  );
  const popoutYtBadge = popoutPage
    .locator('.fce-popout-site-badge[data-site="youtube-live"]')
    .first();
  await expect(popoutYtBadge).toHaveAttribute("role", "img");
  await expect(popoutYtBadge).toHaveAttribute("aria-label", "YouTube");
  await expect(popoutYtBadge).toHaveText("");
  await expect(popoutYtBadge.locator("svg")).toBeVisible();

  const popoutTwBadge = popoutPage
    .locator('.fce-popout-site-badge[data-site="twitch"]')
    .first();
  await expect(popoutTwBadge).toHaveAttribute("role", "img");
  await expect(popoutTwBadge).toHaveAttribute("aria-label", "Twitch");
  await expect(popoutTwBadge).toHaveText("");
  await expect(popoutTwBadge.locator("svg")).toBeVisible();

  // Bring YouTube to front and focus so the shared popout switches to ?site=youtube with mixed rows.
  await ytPage.bringToFront();
  await ytPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => popoutPage.url())
    .toContain("/bridge-popout.html?site=youtube");
  await expect(popoutPage.locator(".fce-popout-list")).toContainText(
    "YT mixed danmaku",
  );
  await expect(popoutPage.locator(".fce-popout-list")).toContainText(
    "TW mixed danmaku",
  );

  // Return to panel mode so teardown closes the popout cleanly.
  await setSettings(extensionWorker, { displayMode: "panel" });
  await expect.poll(() => popoutPage.isClosed()).toBe(true);
  await twPage.close();
});

async function assertPopoutHeaderLayout(
  popoutPage: import("@playwright/test").Page,
  expectedDelay: string,
  expectedPeerLabel: string,
) {
  await expect(popoutPage.locator("#popoutReadOnly")).toHaveText(
    "読み取り専用",
  );
  await expect(popoutPage.locator("#popoutDelay")).toHaveText(expectedDelay);
  await expect(popoutPage.locator("#popoutPeer")).toHaveText(expectedPeerLabel);
  for (const viewport of [
    { width: 280, height: 480 },
    { width: 264, height: 480 },
  ]) {
    await popoutPage.setViewportSize(viewport);
    const metrics = await popoutPage.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".fce-popout-header");
      const title = document.querySelector<HTMLElement>("#popoutTitle");
      const peer = document.querySelector<HTMLElement>("#popoutPeer");
      const readOnly = document.querySelector<HTMLElement>("#popoutReadOnly");
      const delay = document.querySelector<HTMLElement>("#popoutDelay");
      if (!header || !title || !peer || !readOnly || !delay) {
        throw new Error("Missing popout header elements");
      }
      const headerRect = header.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const peerRect = peer.getBoundingClientRect();
      const readOnlyRect = readOnly.getBoundingClientRect();
      const delayRect = delay.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        headerScrollWidth: header.scrollWidth,
        headerClientWidth: header.clientWidth,
        headerRight: headerRect.right,
        titleOverflow: getComputedStyle(title).textOverflow,
        titleRight: titleRect.right,
        peerScrollWidth: peer.scrollWidth,
        peerClientWidth: peer.clientWidth,
        peerOverflow: getComputedStyle(peer).textOverflow,
        peerTitle: peer.title,
        peerRight: peerRect.right,
        readOnlyLeft: readOnlyRect.left,
        readOnlyRight: readOnlyRect.right,
        readOnlyWidth: readOnlyRect.width,
        readOnlyHeight: readOnlyRect.height,
        delayLeft: delayRect.left,
        delayRight: delayRect.right,
        delayWidth: delayRect.width,
        delayHeight: delayRect.height,
      };
    });
    expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(
      metrics.bodyClientWidth,
    );
    expect(metrics.headerScrollWidth).toBeLessThanOrEqual(
      metrics.headerClientWidth,
    );
    expect(metrics.headerRight).toBeLessThanOrEqual(metrics.innerWidth + 0.5);
    expect(metrics.peerScrollWidth).toBeGreaterThan(metrics.peerClientWidth);
    expect(metrics.peerOverflow).toBe("ellipsis");
    expect(metrics.peerTitle).toBe(expectedPeerLabel);
    expect(metrics.peerRight).toBeLessThanOrEqual(metrics.readOnlyLeft + 0.5);
    expect(metrics.titleRight).toBeLessThanOrEqual(metrics.readOnlyLeft + 0.5);
    expect(metrics.readOnlyWidth).toBeGreaterThan(0);
    expect(metrics.readOnlyHeight).toBeLessThanOrEqual(24);
    expect(metrics.readOnlyLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.readOnlyRight).toBeLessThanOrEqual(metrics.delayLeft + 0.5);
    expect(metrics.delayWidth).toBeGreaterThan(0);
    expect(metrics.delayHeight).toBeLessThanOrEqual(24);
    expect(metrics.delayRight).toBeLessThanOrEqual(metrics.headerRight + 0.5);
    expect(metrics.delayRight).toBeLessThanOrEqual(metrics.innerWidth + 0.5);
  }
}

test("regular bridge popout truncates long YouTube titles without horizontal overflow at minimum width for +0s, +5s, and +120s", async ({
  page: ytPage,
  context,
  extensionWorker,
}) => {
  const longPeerLabel =
    "【長時間コラボ配信】非常に長いYouTubeライブ配信タイトルが通常別窓のヘッダー右端にある読み取り専用バッジと遅延秒数を押し出さず横スクロールを起こさない確認";
  await setupBothRoutes(context, { ytTitle: `${longPeerLabel} - YouTube` });
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    uiLocale: "ja",
    displayMode: "panel",
    panel: { ...initial.panel, useNativeChat: false },
  });

  await ytPage.goto(ytWatchUrl);
  await ensureVideoPlaying(ytPage);
  const twPage = await context.newPage();
  await twPage.goto(twWatchUrl);
  await ensureVideoPlaying(twPage);

  await connectPeerViaGear(twPage, "非常に長いYouTubeライブ配信タイトル");
  await waitForHiddenYtReceiverReady(ytPage);

  const openRegularPopout = async () => {
    await twPage.bringToFront();
    const popoutPromise = context.waitForEvent("page");
    await setSettings(extensionWorker, {
      displayMode: "popout",
      popout: { ...initial.popout, alwaysOnTop: false },
    });
    const popoutPage = await popoutPromise;
    await popoutPage.waitForLoadState("domcontentloaded");
    await expect
      .poll(() => popoutPage.url())
      .toContain("/bridge-popout.html?site=twitch");
    return popoutPage;
  };

  const closeAndAssertPanelReturned = async (
    popoutPage: import("@playwright/test").Page,
  ) => {
    await popoutPage.close();
    await expect
      .poll(async () => (await readSettings(extensionWorker)).displayMode)
      .toBe("panel");
    await expect(twPage.locator("#fce-overlay-panel-host")).toBeVisible();
  };

  // +0s
  const popout0 = await openRegularPopout();
  await assertPopoutHeaderLayout(popout0, "+0s", longPeerLabel);
  await injectYtComment(ytPage, "yt-popout-layout-1", "YT layout hello");
  await injectTwComment(twPage, "tw-popout-layout-1", "TW layout hello");
  await expect(popout0.locator(".fce-popout-list")).toContainText(
    "YT layout hello",
  );
  await expect(popout0.locator(".fce-popout-list")).toContainText(
    "TW layout hello",
  );
  await closeAndAssertPanelReturned(popout0);

  // +5s
  const stepPlus5 = twPage.locator('.fce-panel-bridge-step:has-text("+5")');
  await stepPlus5.click();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+5s");
  const popout5 = await openRegularPopout();
  await assertPopoutHeaderLayout(popout5, "+5s", longPeerLabel);
  await closeAndAssertPanelReturned(popout5);

  // +120s
  for (let step = 0; step < 23; step += 1) {
    await stepPlus5.click();
  }
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+120s");
  const popout120 = await openRegularPopout();
  await assertPopoutHeaderLayout(popout120, "+120s", longPeerLabel);
  await closeAndAssertPanelReturned(popout120);

  await twPage.close();
});

test("pausing YouTube clears only remote danmaku while keeping delay, and Twitch video ad suspends mixed playback", async ({
  page: ytPage,
  context,
  extensionWorker,
}) => {
  await setupBothRoutes(context);
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...initial.panel, useNativeChat: false },
    danmakuOverlayOnPanel: true,
    danmaku: { ...initial.danmaku, enabled: true, speed: 8, density: "high" },
  });

  await ytPage.goto(ytWatchUrl);
  await ensureVideoPlaying(ytPage);
  const twPage = await context.newPage();
  await twPage.goto(twWatchUrl);
  await ensureVideoPlaying(twPage);

  await connectPeerViaGear(ytPage, "#shroud");
  await ytPage.locator('.fce-panel-bridge-step:has-text("+1")').click();
  await ytPage.locator('.fce-panel-bridge-step:has-text("+1")').click();
  await expect(ytPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");

  await connectPeerViaGear(twPage, "Synthetic YT Bridge Stream");
  await twPage.locator('.fce-panel-bridge-step:has-text("+1")').click();
  await twPage.locator('.fce-panel-bridge-step:has-text("+1")').click();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");

  await waitForHiddenYtReceiverReady(ytPage);

  // Trigger both YT and TW danmaku on YT while YT delay is +2s.
  await injectTwComment(twPage, "tw-pause-1", "TW before YT pause");
  await injectYtComment(ytPage, "yt-pause-keep", "YT stays during pause");
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT stays during pause",
    }),
  ).toHaveCount(1);
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="twitch"]', {
      hasText: "TW before YT pause",
    }),
  ).toHaveCount(1, { timeout: 5000 });

  // Re-emit local YT row right before pausing so it is actively flying alongside TW danmaku.
  await injectYtComment(ytPage, "yt-pause-keep-2", "YT still flying");
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT still flying",
    }),
  ).toHaveCount(1);

  await ytPage.evaluate(() => {
    document.querySelector("video")?.pause();
  });

  await expect(ytPage.locator(".fce-panel-bridge-mask")).toBeVisible();
  await expect(ytPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="twitch"]'),
  ).toHaveCount(0);
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT still flying",
    }),
  ).toHaveCount(1);
  await expect(
    ytPage.locator('.fce-panel-row[data-site="twitch"]'),
  ).toHaveCount(0);
  await expect(
    ytPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT stays during pause",
    }),
  ).toHaveCount(1);

  await ensureVideoPlaying(ytPage);
  await ytPage.locator(".fce-panel-bridge-resume").click();
  await expect(ytPage.locator(".fce-panel-bridge-mask")).toBeHidden();
  await expect(ytPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");

  await injectTwComment(twPage, "tw-after-resume", "TW after YT resume");
  await expect(
    ytPage.locator('.fce-panel-row[data-site="twitch"]', {
      hasText: "TW after YT resume",
    }),
  ).toHaveCount(1, { timeout: 5000 });
  await expect(
    ytPage.locator('.fce-danmaku-item[data-site="twitch"]', {
      hasText: "TW after YT resume",
    }),
  ).toHaveCount(1);

  // Hidden Twitch ad markers inside CSS/hidden/aria-hidden parents must NOT interrupt mixed playback.
  await injectYtComment(ytPage, "yt-before-tw-ad", "YT before TW ad");
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT before TW ad",
    }),
  ).toHaveCount(1, { timeout: 6000 });

  await twPage.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ".tw-ad-hidden { display: none; }";
    document.head.append(style);
    const container = document.querySelector(".video-player__container");

    const cssParent = document.createElement("div");
    cssParent.id = "tw-ad-hidden-css";
    cssParent.className = "tw-ad-hidden";
    const cssLabel = document.createElement("div");
    cssLabel.setAttribute("data-a-target", "video-ad-label");
    cssLabel.textContent = "Ad";
    cssParent.append(cssLabel);

    const hiddenAttrParent = document.createElement("div");
    hiddenAttrParent.hidden = true;
    const countdown = document.createElement("div");
    countdown.setAttribute("data-a-target", "video-ad-countdown");
    countdown.textContent = "0:15";
    hiddenAttrParent.append(countdown);

    const ariaHiddenParent = document.createElement("div");
    ariaHiddenParent.setAttribute("aria-hidden", "true");
    const banner = document.createElement("div");
    banner.setAttribute("data-test-selector", "ad-banner-default-text");
    banner.textContent = "Ad 1 of 2";
    ariaHiddenParent.append(banner);

    container?.append(cssParent, hiddenAttrParent, ariaHiddenParent);
  });

  await twPage.waitForTimeout(700);
  await injectYtComment(ytPage, "yt-hidden-ad-ok", "YT passes hidden ad");
  await expect(
    twPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT passes hidden ad",
    }),
  ).toHaveCount(1, { timeout: 6000 });
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT passes hidden ad",
    }),
  ).toHaveCount(1);
  await expect(twPage.locator(".fce-panel-bridge-mask")).toBeHidden();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");

  // Re-emit local TW comment right before unhiding the ad so TW danmaku stays actively flying.
  await injectTwComment(twPage, "tw-local-ad", "TW stays on ad");
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="twitch"]', {
      hasText: "TW stays on ad",
    }),
  ).toHaveCount(1);

  // Unhiding the Twitch video ad suspends YouTube chat, clears YT danmaku, and blocks Resume during the ad.
  await twPage.evaluate(() => {
    document
      .querySelector("#tw-ad-hidden-css")
      ?.classList.remove("tw-ad-hidden");
  });

  await expect(twPage.locator(".fce-panel-bridge-mask")).toBeVisible();
  await expect(twPage.locator(".fce-panel-bridge-resume")).toBeVisible();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="youtube-live"]'),
  ).toHaveCount(0);
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="twitch"]', {
      hasText: "TW stays on ad",
    }),
  ).toHaveCount(1);

  await twPage.locator(".fce-panel-bridge-resume").click();
  await injectYtComment(ytPage, "yt-blocked-during-ad", "YT blocked during ad");
  await twPage.waitForTimeout(2500);
  await expect(twPage.locator(".fce-panel-bridge-mask")).toBeVisible();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");
  await expect(
    twPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT blocked during ad",
    }),
  ).toHaveCount(0);
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT blocked during ad",
    }),
  ).toHaveCount(0);

  // Hiding the ad marker again allows manual Resume while keeping +2s delay.
  await twPage.evaluate(() => {
    document.querySelector("#tw-ad-hidden-css")?.classList.add("tw-ad-hidden");
  });
  await twPage.locator(".fce-panel-bridge-resume").click();
  await expect(twPage.locator(".fce-panel-bridge-mask")).toBeHidden();
  await expect(twPage.locator(".fce-panel-bridge-delay")).toHaveText("+2s");

  await injectYtComment(ytPage, "yt-after-tw-ad", "YT after TW ad");
  await expect(
    twPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT after TW ad",
    }),
  ).toHaveCount(0);
  await expect(
    twPage.locator('.fce-panel-row[data-site="youtube-live"]', {
      hasText: "YT after TW ad",
    }),
  ).toHaveCount(1, { timeout: 6000 });
  await expect(
    twPage.locator('.fce-danmaku-item[data-site="youtube-live"]', {
      hasText: "YT after TW ad",
    }),
  ).toHaveCount(1);

  await twPage.close();
});
