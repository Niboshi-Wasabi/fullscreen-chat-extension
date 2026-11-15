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
