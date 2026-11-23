import { test, expect, setSettings, readSettings } from "./fixtures";
import { exerciseSource } from "./source-module";

test("Twitch receives rows hydrated later and recycled for new messages", async ({
  page,
}) => {
  const result = await exerciseSource(
    page,
    "src/adapters/twitch/index.ts",
    `
    initial.twitch.thirdPartyEmotes=false;
    document.body.innerHTML='<div data-test-selector="chat-scrollable-area__message-container"></div>';
    const container=document.querySelector('div');const seen=[];
    const adapter=api.createTwitchAdapter();adapter.start(message=>seen.push({id:message.id,text:message.text}));
    const row=document.createElement('div');row.setAttribute('data-a-target','chat-line-message');row.dataset.id='one';container.append(row);
    await new Promise(resolve=>setTimeout(resolve,0));
    row.innerHTML='<span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">First hydrated</span>';
    row.firstElementChild.insertAdjacentHTML('afterend','<span class="chat-line__message"></span>');
    await new Promise(resolve=>setTimeout(resolve,0));
    row.dataset.id='two';row.querySelector('[data-a-target="chat-line-message-body"]').firstChild.data='Second recycled';
    await new Promise(resolve=>setTimeout(resolve,0));
    row.dataset.id='three';row.querySelector('[data-a-target="chat-line-message-body"]').textContent='Third recycled';
    await new Promise(resolve=>setTimeout(resolve,0));adapter.stop();return seen;
  `,
  );
  expect(result).toEqual([
    { id: "twitch-one", text: "First hydrated" },
    { id: "twitch-two", text: "Second recycled" },
    { id: "twitch-three", text: "Third recycled" },
  ]);
});

test("receiving messages does not reset a panel drag", async ({ page }) => {
  await exerciseSource(
    page,
    "src/views/overlay-panel/index.ts",
    `
    document.body.style.cssText='margin:0';const player=document.createElement('div');player.style.cssText='position:relative;width:1000px;height:700px';document.body.append(player);
    initial.panel.useNativeChat=false;const panel=api.createOverlayPanel({onSend:async()=>false});panel.mount(player);panel.applySettings(initial);
    window.receiveDuringDrag=()=>panel.applySettings(initial);
    window.acknowledgePosition=position=>panel.applySettings({...initial,panel:{...initial.panel,position}});return true;
  `,
  );
  const handle = page.locator(".fce-panel-handle");
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 25, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x - 150, box!.y + 80, { steps: 5 });
  const before = await page.locator(".fce-panel").boundingBox();
  await page.evaluate("window.receiveDuringDrag()");
  const after = await page.locator(".fce-panel").boundingBox();
  await page.mouse.up();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
  await page.evaluate("window.receiveDuringDrag()");
  const pendingSave = await page.locator(".fce-panel").boundingBox();
  expect(pendingSave!.x).toBeCloseTo(before!.x, 0);
  expect(pendingSave!.y).toBeCloseTo(before!.y, 0);
  // A second gesture can finish before the first storage notification arrives.
  const currentHandle = await handle.boundingBox();
  await page.mouse.move(currentHandle!.x + 20, currentHandle!.y + 10);
  await page.mouse.down();
  await page.mouse.move(currentHandle!.x - 60, currentHandle!.y + 35, {
    steps: 3,
  });
  await page.mouse.up();
  const second = await page.locator(".fce-panel").boundingBox();
  await page.evaluate(
    ({ x, y, w, h }) => {
      const player = document
        .querySelector(".fce-panel")!
        .parentElement!.parentElement!.getBoundingClientRect();
      (
        window as unknown as {
          acknowledgePosition: (position: unknown) => void;
        }
      ).acknowledgePosition({ x: x - player.left, y: y - player.top, w, h });
    },
    { x: before!.x, y: before!.y, w: before!.width, h: before!.height },
  );
  const afterEarlierSave = await page.locator(".fce-panel").boundingBox();
  expect(afterEarlierSave!.x).toBeCloseTo(second!.x, 0);
  expect(afterEarlierSave!.y).toBeCloseTo(second!.y, 0);
});

test("Twitch official iframe disappears on OFF and restores only one panel", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/rainbow6jp";
  await context.route("https://www.twitch.tv/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        route.request().url() === url
          ? '<!doctype html><head><link rel="icon" href="data:,"></head><body><div class="video-player__container" style="position:relative;width:1000px;height:700px"><video></video></div><div data-test-selector="chat-scrollable-area__message-container"><div data-a-target="chat-line-message" data-id="one"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Initial live line</span></div></div></body>'
          : '<!doctype html><head><link rel="icon" href="data:,"></head><body><textarea data-a-target="chat-input"></textarea></body>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    panel: { ...settings.panel, useNativeChat: true },
    twitch: { ...settings.twitch, thirdPartyEmotes: false },
  });
  await page.goto(url);
  await expect(page.locator(".fce-panel-native")).toBeVisible();
  for (let round = 0; round < 2; round++) {
    await setSettings(extensionWorker, { enabled: false });
    await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
    await setSettings(extensionWorker, { enabled: true });
    await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(1);
    await expect(page.locator(".fce-panel-native")).toBeVisible();
  }
  await setSettings(extensionWorker, {
    panel: { ...settings.panel, useNativeChat: false },
  });
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Initial live line",
  );
  await page.evaluate(() => {
    document
      .querySelector(
        '[data-test-selector="chat-scrollable-area__message-container"]',
      )!
      .insertAdjacentHTML(
        "beforeend",
        '<div data-a-target="chat-line-message" id="hydrating"><span data-a-target="chat-message-username">Viewer</span><div class="chat-line__message"><span data-a-target="chat-line-message-body">Part</span></div></div>',
      );
  });
  await expect(page.locator(".fce-panel-row")).toHaveCount(2);
  await page.evaluate(() => {
    document.querySelector(
      '#hydrating [data-a-target="chat-line-message-body"]',
    )!.textContent = "Partial completed";
  });
  await expect(page.locator(".fce-panel-row")).toHaveCount(2);
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Partial completed",
  );
});

test("queued danmaku respects later text and NG updates", async ({ page }) => {
  const result = await exerciseSource(
    page,
    "src/views/danmaku/index.ts",
    `
    const player=document.createElement('div');player.style.cssText='position:relative;width:20px;height:20px';document.body.append(player);
    initial.displayMode='danmaku';initial.danmaku.enabled=true;
    const view=api.createDanmakuView();view.mount(player);view.applySettings(initial);
    const line={id:'queued',site:'twitch',text:'Old prefix',authorName:'Viewer',badges:[],role:'viewer',isCommand:false,timestampMs:0};
    view.push(line);view.update({...line,text:'Blocked final'},false);
    player.style.width='1000px';player.style.height='700px';await new Promise(resolve=>setTimeout(resolve,260));
    const blocked=document.querySelectorAll('.fce-danmaku-item').length;
    view.flush([{...line,id:'flush'}]);view.update({...line,id:'flush',text:'Blocked flush'},false);
    await new Promise(resolve=>setTimeout(resolve,100));const blockedFlush=document.querySelectorAll('.fce-danmaku-item').length;
    view.push({...line,id:'allowed'});view.update({...line,id:'allowed',text:'Completed while measuring'},true);
    await new Promise(resolve=>setTimeout(resolve,100));const latest=document.querySelector('.fce-danmaku-item')?.textContent;
    view.unmount();return {blocked,blockedFlush,latest};
  `,
  );
  expect(result).toEqual({
    blocked: 0,
    blockedFlush: 0,
    latest: "Completed while measuring",
  });
});

test("danmaku releases discarded and expired message state", async ({
  page,
}) => {
  const result = (await exerciseSource(
    page,
    "src/views/danmaku/index.ts",
    `
    const player=document.createElement('div');player.style.cssText='position:relative;width:1000px;height:700px';document.body.append(player);
    initial.displayMode='danmaku';initial.danmaku={...initial.danmaku,enabled:true,speed:2,density:'low'};
    const NativeMap=window.Map;const maps=[];
    window.Map=class extends NativeMap {constructor(...args){super(...args);maps.push(this)}};
    let view;try{view=api.createDanmakuView()}finally{window.Map=NativeMap}
    view.mount(player);view.applySettings(initial);
    for(let i=0;i<20;i++)view.push({id:'retention-'+i,site:'twitch',text:'Synthetic '+i,authorName:'Viewer',badges:[],role:'viewer',isCommand:false,timestampMs:0});
    await new Promise(resolve=>setTimeout(resolve,4100));
    const retained=maps.map(map=>map.size);const nodes=document.querySelectorAll('.fce-danmaku-item').length;view.unmount();return {retained,nodes};
  `,
  )) as { retained: number[]; nodes: number };
  expect(result.nodes).toBe(0);
  expect(result.retained.length).toBeGreaterThan(0);
  expect(result.retained.every((size) => size === 0)).toBe(true);
});

test("receiving messages does not reset a panel resize", async ({ page }) => {
  await exerciseSource(
    page,
    "src/views/overlay-panel/index.ts",
    `
    const player=document.createElement('div');player.style.cssText='position:relative;width:1000px;height:700px';document.body.append(player);
    initial.panel.useNativeChat=false;const panel=api.createOverlayPanel({onSend:async()=>false});panel.mount(player);panel.applySettings(initial);
    window.receiveDuringResize=()=>panel.applySettings(initial);return true;
  `,
  );
  const corner = await page.locator(".fce-panel-resize-se").boundingBox();
  expect(corner).not.toBeNull();
  await page.mouse.move(corner!.x + 6, corner!.y + 6);
  await page.mouse.down();
  await page.mouse.move(corner!.x + 75, corner!.y + 35, { steps: 5 });
  const before = await page.locator(".fce-panel").boundingBox();
  await page.evaluate("window.receiveDuringResize()");
  const after = await page.locator(".fce-panel").boundingBox();
  await page.mouse.up();
  expect(after!.width).toBeCloseTo(before!.width, 0);
  expect(after!.height).toBeCloseTo(before!.height, 0);
  await page.evaluate("window.receiveDuringResize()");
  const pendingSave = await page.locator(".fce-panel").boundingBox();
  expect(pendingSave!.width).toBeCloseTo(before!.width, 0);
  expect(pendingSave!.height).toBeCloseTo(before!.height, 0);
});

test("Twitch danmaku continues after the initial batch expires", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/rainbow6jp";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><head><link rel="icon" href="data:,"></head><body><div class="video-player__container" style="position:relative;width:1000px;height:700px"><video></video></div><div data-test-selector="chat-scrollable-area__message-container"><div data-a-target="chat-line-message" data-id="one"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Initial batch</span></div></div></body>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "danmaku",
    danmaku: { ...settings.danmaku, enabled: true, speed: 2, density: "high" },
    twitch: { ...settings.twitch, thirdPartyEmotes: false },
  });
  await page.goto(url);
  await expect(page.locator(".fce-danmaku-item")).toContainText(
    "Initial batch",
  );
  await expect(page.locator(".fce-danmaku-item")).toHaveCount(0);
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.className = "chat-line__message";
    row.dataset.id = "two";
    document
      .querySelector(
        '[data-test-selector="chat-scrollable-area__message-container"]',
      )!
      .append(row);
  });
  await page.evaluate(() => {
    document.querySelector('[data-id="two"]')!.innerHTML =
      '<span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Later batch</span>';
  });
  await expect(page.locator(".fce-danmaku-item")).toContainText("Later batch");
  await page.evaluate(() => {
    document.querySelector(
      '[data-id="two"] [data-a-target="chat-line-message-body"]',
    )!.textContent = "Part";
  });
  await page.evaluate(() => {
    document.querySelector(
      '[data-id="two"] [data-a-target="chat-line-message-body"]',
    )!.textContent = "Partial completed";
  });
  await expect(page.locator(".fce-danmaku-item")).toHaveCount(1);
  await expect(page.locator(".fce-danmaku-item")).toContainText(
    "Partial completed",
  );
  await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-id="two"]')!;
    row.dataset.id = "three";
    row.querySelector(
      '[data-a-target="chat-line-message-body"]',
    )!.firstChild!.textContent = "Recycled live batch";
  });
  await expect(
    page
      .locator(".fce-danmaku-item")
      .filter({ hasText: "Recycled live batch" }),
  ).toHaveCount(1);
});

test("Twitch VOD deduplicates nested video-chat__message, strips decorative colon, and syncs header timestamps", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/videos/987654321";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body>
        <div class="video-player__container" style="position:relative;width:1000px;height:700px"><video style="width:640px;height:360px"></video></div>
        <div class="video-chat__message-list-wrapper">
          <div class="vod-message">
            <div class="vod-message__header"><button><p>0:00</p></button></div>
            <span class="chat-author__display-name" data-a-target="chat-message-username" style="color: rgb(0, 204, 153)">Display Name</span><span class="chat-author__intl-login"> (viewera)</span>
            <div class="video-chat__message"><span>:</span><span><span class="text-fragment" data-a-target="chat-message-text">Due line</span></span></div>
          </div>
          <div class="vod-message">
            <div class="vod-message__header"><button><p>0:20</p></button></div>
            <span class="chat-author__display-name" data-a-target="chat-message-username">ViewerB</span>
            <div class="video-chat__message"><span>:</span><span><span class="text-fragment" data-a-target="chat-message-text">Future line</span></span></div>
          </div>
        </div>
      </body>`,
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...settings.panel, useNativeChat: true },
    twitch: { ...settings.twitch, thirdPartyEmotes: false },
    archive: { ...settings.archive, syncOffsetSec: 0 },
  });
  await page.goto(url);
  await expect(page.locator(".fce-panel-row")).toHaveCount(1);
  await expect(page.locator(".fce-panel-compose")).toBeHidden();
  await expect(page.locator(".fce-panel-time").first()).toHaveText("0:00");
  await expect(page.locator(".fce-panel-row").first()).toContainText(
    "Display Name (viewera)",
  );
  await expect(page.locator(".fce-panel-author").first()).toHaveCSS(
    "color",
    "rgb(0, 204, 153)",
  );
  await expect(page.locator(".fce-panel-sep").first()).toHaveText(": ");
  await expect(page.locator(".fce-panel-row").first()).toContainText(
    "Due line",
  );
  expect(
    await page.locator(".fce-panel-row .fce-panel-text").first().textContent(),
  ).toBe("Due line");

  await setSettings(extensionWorker, {
    archive: { ...settings.archive, syncOffsetSec: 25 },
  });
  await expect(page.locator(".fce-panel-row")).toHaveCount(2);
  await expect(page.locator(".fce-panel-time").nth(1)).toHaveText("0:20");
  await expect(page.locator(".fce-panel-row").nth(1)).toContainText("ViewerB");
  await expect(page.locator(".fce-panel-row").nth(1)).toContainText(
    "Future line",
  );
});

test("Twitch live panel reparents into a late-mounted player and stays bounded when dragged", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/lilsimsie";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><head><link rel="icon" href="data:,"></head><body style="margin:0;width:1366px;height:860px;"><div data-test-selector="chat-scrollable-area__message-container"><div data-a-target="chat-line-message" data-id="m1"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Live line</span></div></div></body>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: {
      ...settings.panel,
      useNativeChat: false,
      position: { x: 1050, y: 120, w: 300, h: 600 },
    },
  });
  await page.goto(url);
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(1);

  await page.evaluate(() => {
    const outer = document.createElement("div");
    outer.setAttribute("data-a-target", "video-player");
    outer.style.position = "static";
    const container = document.createElement("div");
    container.className = "video-player__container";
    container.style.cssText =
      "position:absolute;left:240px;top:50px;width:786px;height:442px;";
    const video = document.createElement("video");
    container.append(video);
    outer.append(container);
    document.body.append(outer);
  });

  await expect(
    page.locator(".video-player__container #fce-overlay-panel-host"),
  ).toHaveCount(1);

  const playerBox = await page
    .locator(".video-player__container")
    .boundingBox();
  expect(playerBox).not.toBeNull();
  const afterMountBox = await page.locator(".fce-panel").boundingBox();
  expect(afterMountBox).not.toBeNull();
  expect(afterMountBox!.x).toBeGreaterThanOrEqual(playerBox!.x - 1);
  expect(afterMountBox!.y).toBeGreaterThanOrEqual(playerBox!.y - 1);
  expect(afterMountBox!.x + afterMountBox!.width).toBeLessThanOrEqual(
    playerBox!.x + playerBox!.width + 1,
  );
  expect(afterMountBox!.y + afterMountBox!.height).toBeLessThanOrEqual(
    playerBox!.y + playerBox!.height + 1,
  );

  const handleBox = await page.locator(".fce-panel-handle").boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + 12, handleBox!.y + 12);
  await page.mouse.down();
  await page.mouse.move(
    playerBox!.x + playerBox!.width + 300,
    playerBox!.y + playerBox!.height + 300,
    { steps: 5 },
  );
  await page.mouse.up();

  const afterDragBox = await page.locator(".fce-panel").boundingBox();
  expect(afterDragBox).not.toBeNull();
  expect(afterDragBox!.x).toBeGreaterThanOrEqual(playerBox!.x - 1);
  expect(afterDragBox!.y).toBeGreaterThanOrEqual(playerBox!.y - 1);
  expect(afterDragBox!.x + afterDragBox!.width).toBeLessThanOrEqual(
    playerBox!.x + playerBox!.width + 1,
  );
  expect(afterDragBox!.y + afterDragBox!.height).toBeLessThanOrEqual(
    playerBox!.y + playerBox!.height + 1,
  );
});

test("Twitch native panel integrates drag handle and gear into the official chat header row", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/rainbow6jp";
  await context.route("https://www.twitch.tv/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        route.request().url() === url
          ? '<!doctype html><head><link rel="icon" href="data:,"></head><body style="margin:0"><div class="video-player__container" style="position:relative;width:1280px;height:720px"><video></video></div><div data-test-selector="chat-scrollable-area__message-container"><div data-a-target="chat-line-message" data-id="one"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Live row</span></div></div></body>'
          : '<!doctype html><head><link rel="icon" href="data:,"></head><body style="margin:0"><div class="stream-chat-header" style="display:flex;justify-content:center;align-items:center;height:40px;position:relative;"><div class="stream-chat-header-title">Stream Chat</div><div style="position:absolute;right:0;"><button aria-label="Users in Chat" style="width:32px;height:32px;">U</button></div></div><textarea data-a-target="chat-input"></textarea></body>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...settings.panel, useNativeChat: true },
    twitch: { ...settings.twitch, thirdPartyEmotes: false },
  });
  await page.goto(url);
  await expect(page.locator(".fce-panel-native")).toBeVisible();
  await expect(page.locator(".fce-panel-handle-label")).toBeHidden();

  const panelBox = await page.locator(".fce-panel").boundingBox();
  const frameBox = await page.locator(".fce-panel-native").boundingBox();
  const handleBox = await page.locator(".fce-panel-handle").boundingBox();
  const usersButtonBox = await page
    .frameLocator("#fce-native-chat-frame")
    .locator('button[aria-label="Users in Chat"]')
    .boundingBox();
  expect(panelBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(handleBox).not.toBeNull();
  expect(usersButtonBox).not.toBeNull();

  // Official chat iframe fills from top of panel (accounting for 1px panel border); handle sits in the 40px header row
  expect(Math.abs(frameBox!.y - panelBox!.y)).toBeLessThanOrEqual(2);
  expect(handleBox!.y).toBeLessThanOrEqual(panelBox!.y + 8);
  expect(handleBox!.y + handleBox!.height).toBeLessThanOrEqual(
    panelBox!.y + 40,
  );
  expect(usersButtonBox!.x + usersButtonBox!.width).toBeLessThanOrEqual(
    handleBox!.x + 1,
  );

  // Dragging the compact native handle moves the panel
  await page.mouse.move(handleBox!.x + 12, handleBox!.y + 12);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 80, handleBox!.y + 40, { steps: 5 });
  await page.mouse.up();
  const movedBox = await page.locator(".fce-panel").boundingBox();
  expect(movedBox!.x).toBeLessThan(panelBox!.x - 40);

  // Switching to custom list restores the full header bar with "Chat" label
  await setSettings(extensionWorker, {
    panel: { ...settings.panel, useNativeChat: false },
  });
  await expect(page.locator(".fce-panel-handle-label")).toBeVisible();
});

test("switching to danmaku mode does not replay previously received comments", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/rainbow6jp";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><head><link rel="icon" href="data:,"></head><body><div class="video-player__container" style="position:relative;width:1000px;height:700px"><video></video></div><div data-test-selector="chat-scrollable-area__message-container"><div data-a-target="chat-line-message" data-id="old-1"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Old comment one</span></div><div data-a-target="chat-line-message" data-id="old-2"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Old comment two</span></div></div></body>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...settings.panel, useNativeChat: false },
    danmaku: { ...settings.danmaku, enabled: true, speed: 2, density: "high" },
    twitch: { ...settings.twitch, thirdPartyEmotes: false },
  });
  await page.goto(url);
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Old comment two",
  );
  await expect(page.locator("#fce-danmaku-host")).toHaveCount(0);

  await setSettings(extensionWorker, {
    displayMode: "danmaku",
    danmaku: { ...settings.danmaku, enabled: true, speed: 2, density: "high" },
  });
  await expect(page.locator("#fce-danmaku-host")).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.locator(".fce-danmaku-item")).toHaveCount(0);

  await page.evaluate(() => {
    document
      .querySelector(
        '[data-test-selector="chat-scrollable-area__message-container"]',
      )!
      .insertAdjacentHTML(
        "beforeend",
        '<div data-a-target="chat-line-message" data-id="new-3"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Fresh after switch</span></div>',
      );
  });
  await expect(page.locator(".fce-danmaku-item")).toHaveCount(1);
  await expect(page.locator(".fce-danmaku-item")).toContainText(
    "Fresh after switch",
  );
});

test("Twitch collapsed chat with official panel stays mounted without toggling the page column", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/k4sen";
  await context.route("https://www.twitch.tv/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        route.request().url() === url
          ? `<!doctype html><head><link rel="icon" href="data:,"></head><body style="margin:0">
              <div class="video-player__container" style="position:relative;width:1000px;height:700px"><video></video></div>
              <button data-a-target="right-column__toggle-collapse-btn" aria-label="Expand Chat" onclick="window.__toggleClicks=(window.__toggleClicks||0)+1;this.setAttribute('aria-label',this.getAttribute('aria-label')==='Expand Chat'?'Collapse Chat':'Expand Chat')">Toggle</button>
            </body>`
          : '<!doctype html><head><link rel="icon" href="data:,"></head><body><div class="stream-chat-header">Stream Chat</div></body>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...settings.panel, useNativeChat: true },
    danmakuOverlayOnPanel: false,
    twitch: { ...settings.twitch, thirdPartyEmotes: false },
  });
  await page.goto(url);
  await expect(page.locator("#fce-native-chat-frame")).toBeVisible();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __toggleClicks?: number }).__toggleClicks ?? 0,
    ),
  ).toBe(0);
  await expect(page.locator("#fce-native-chat-frame")).toHaveCount(1);
});

test("custom panel preserves existing row DOM nodes on unchanged applySettings and setNativeChatUrl", async ({
  page,
}) => {
  const sameNode = await exerciseSource(
    page,
    "src/views/overlay-panel/index.ts",
    `
    initial.panel.useNativeChat=false;
    const panel=api.createOverlayPanel({onSend:async()=>false});
    panel.mount(document.body);
    panel.applySettings(initial);
    panel.setMessages([{id:'m1',site:'twitch',authorName:'Viewer',text:'First',badges:[],role:'viewer',isCommand:false,timestampMs:0}]);
    const rowBefore=document.querySelector('.fce-panel-row');
    panel.applySettings({...initial});
    panel.setNativeChatUrl(null);
    const rowAfter=document.querySelector('.fce-panel-row');
    panel.unmount();
    return rowBefore!==null && rowBefore===rowAfter;
  `,
  );
  expect(sameNode).toBe(true);
});
