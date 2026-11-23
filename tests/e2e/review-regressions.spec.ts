import fs from "node:fs";
declare const chrome: typeof import("wxt/browser").browser;
import {
  test,
  expect,
  fixtureUrl,
  readSettings,
  setSettings,
} from "./fixtures";
import { exerciseSource } from "./source-module";

test("site toggles preserve existing chat and navigation starts one runtime", async ({
  page,
  extensionWorker,
}) => {
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    youtubeLive: { ...initial.youtubeLive, enabled: false },
  });
  await page.goto(fixtureUrl);
  await expect(page.locator("#fce-player-toggle")).toBeVisible();
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
  await setSettings(extensionWorker, {
    youtubeLive: { ...initial.youtubeLive, enabled: true },
  });
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Synthetic hello message",
  );
  await setSettings(extensionWorker, { enabled: false });
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
  await setSettings(extensionWorker, { enabled: true });
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Synthetic hello message",
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("yt-navigate-finish"));
    window.dispatchEvent(new Event("yt-page-data-updated"));
  });
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(1);
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Synthetic hello message",
  );
  await setSettings(extensionWorker, {
    youtubeLive: { ...initial.youtubeLive, enabled: false },
  });
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
  await page.evaluate(() =>
    document.body.appendChild(document.createElement("div")),
  );
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
});

test("cached-page lifecycle restores one runtime with current settings", async ({
  page,
  extensionWorker,
}) => {
  await page.goto(fixtureUrl);
  await expect(page.locator(".fce-panel-list")).toContainText(
    "Synthetic hello message",
  );
  const settings = await readSettings(extensionWorker);
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
    await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
    await expect(page.locator("#fce-player-toggle")).toHaveCount(0);
    await setSettings(extensionWorker, {
      filter: { ...settings.filter, ngWords: round ? [] : ["hello message"] },
    });
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(1);
    await expect(page.locator("#fce-player-toggle")).toHaveCount(1);
    if (round) {
      await expect(page.locator(".fce-panel-list")).toContainText(
        "Synthetic hello message",
      );
    } else {
      await expect(page.locator(".fce-panel-list")).not.toContainText(
        "Synthetic hello message",
      );
    }
    await page.evaluate(() => {
      window.dispatchEvent(new Event("yt-navigate-finish"));
      window.dispatchEvent(new Event("yt-page-data-updated"));
    });
    await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(1);
  }
});

test("IME confirmation does not submit and failed sends keep the panel draft", async ({
  page,
  extensionWorker,
}) => {
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    compose: { ...settings.compose, enabled: true },
  });
  await page.goto(fixtureUrl);
  const input = page.locator(".fce-panel-input");
  await input.fill("Synthetic IME draft");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(input).toHaveValue("Synthetic IME draft");
  await input.press("Enter");
  await expect(page.locator(".fce-compose-status")).toBeVisible();
  await expect(input).toHaveValue("Synthetic IME draft");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("Synthetic IME draft\n");
  await input.evaluate((node) => node.blur());
  await expect(input).not.toBeFocused();
  await extensionWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    await chrome.tabs.sendMessage(tabs[0]!.id!, {
      type: "fce:command",
      command: "toggle-compose-focus",
    });
  });
  await expect(input).toBeFocused();
});

test("YouTube accepts only the known chat frame and clears history after rewind", async ({
  page,
  context,
}) => {
  // Explicit live UI (not isLiveBroadcast meta alone) — ISS-021.
  // ライブ配信を明示する UI が必要。isLiveBroadcast のメタ情報だけでは判定しない（ISS-021）。
  const html = fs
    .readFileSync(
      new URL("../fixtures/youtube-live.html", import.meta.url),
      "utf8",
    )
    .replace(
      "</body>",
      '<script>document.querySelector("video").currentTime=10;</script></body>',
    );
  await context.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await context.route("https://www.youtube.com/live_chat?**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><yt-live-chat-text-message-renderer id="synthetic-timed" video-offset-time-msec="10000"><span id="author-name">Synthetic viewer</span><span id="message">Synthetic ten-second comment</span></yt-live-chat-text-message-renderer></body></html>',
    }),
  );
  await page.goto(fixtureUrl);
  const list = page.locator(".fce-panel-list");
  await expect(list).toContainText("Synthetic ten-second comment");
  await page.evaluate(() =>
    window.postMessage(
      {
        type: "fce:normalized-message",
        message: {
          id: "forged",
          site: "youtube-live",
          authorName: "Fake",
          text: "Forged marker",
          role: "viewer",
          badges: [],
          isCommand: false,
          timestampMs: 0,
        },
      },
      "*",
    ),
  );
  await expect(list).not.toContainText("Forged marker");
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "#fce-hidden-live-chat-frame",
    )!;
    const doc = frame.contentDocument!;
    const el = doc.createElement("yt-live-chat-text-message-renderer");
    el.id = "synthetic-after-forged";
    el.setAttribute("video-offset-time-msec", "10000");
    const author = doc.createElement("span");
    author.id = "author-name";
    author.textContent = "Trusted viewer";
    const msg = doc.createElement("span");
    msg.id = "message";
    msg.textContent = "Trusted after forged";
    el.append(author, msg);
    doc.body.appendChild(el);
  });
  await expect(list).toContainText("Trusted after forged");
  await expect(list).not.toContainText("Forged marker");
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "#fce-hidden-live-chat-frame",
    )!;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://www.youtube.com",
        data: {
          type: "fce:normalized-message",
          message: {
            id: "forged-event",
            site: "youtube-live",
            authorName: "Fake",
            text: "Forged event marker",
            role: "viewer",
            badges: [],
            isCommand: false,
            timestampMs: 0,
          },
        },
      }),
    );
  });
  await expect(list).not.toContainText("Forged event marker");
  await page.evaluate(() => {
    const video = document.querySelector("video")!;
    video.currentTime = 0;
    video.dispatchEvent(new Event("seeked"));
  });
  await expect(list.locator(".fce-panel-row")).toHaveCount(0);
});

test("native Twitch popout filters viewers, protects moderators, and restores on master OFF", async ({
  page,
  context,
  extensionWorker,
}) => {
  const url = "https://www.twitch.tv/popout/synthetic/chat?popout=";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><div data-a-target="chat-line-message" id="viewer"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">!command</span></div><div data-a-target="chat-line-message" id="mod"><span class="chat-badge" aria-label="Moderator"></span><span data-a-target="chat-message-username">Mod</span><span data-a-target="chat-line-message-body">!command</span></div><textarea data-a-target="chat-input"></textarea></body></html>',
    }),
  );
  await page.goto(url);
  await expect(page.locator("#viewer")).toHaveAttribute(
    "data-fce-ng-hidden",
    "1",
  );
  await expect(page.locator("#mod")).toBeVisible();
  await extensionWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({
      url: "https://www.twitch.tv/popout/*",
    });
    await chrome.tabs.sendMessage(tabs[0]!.id!, {
      type: "fce:command",
      command: "toggle-compose-focus",
    });
  });
  await expect(page.locator("textarea")).toBeFocused();
  await setSettings(extensionWorker, { enabled: false });
  await expect(page.locator("#viewer")).toBeVisible();
  await page.reload();
  await expect(page.locator("#viewer")).toBeVisible();
});

test("native Twitch NG checks all fragments, emote names and author login", async ({
  page,
  context,
  extensionWorker,
}) => {
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    filter: {
      ...initial.filter,
      ngWords: ["forbidden", "BlockedEmote"],
      blockedUsers: ["blocked_login"],
    },
  });
  const url = "https://www.twitch.tv/popout/synthetic/chat?review=ng";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body>
    <div data-a-target="chat-line-message" id="fragments"><span data-a-target="chat-message-username">Viewer</span><span class="text-fragment">safe </span><span class="text-fragment">forbidden</span></div>
    <div data-a-target="chat-line-message" id="login"><span data-a-target="chat-message-username">表示名</span><span class="chat-author__intl-login">(blocked_login)</span><span class="text-fragment">safe</span></div>
    <div data-a-target="chat-line-message" id="emote"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">safe <img alt="BlockedEmote"></span></div>
    <div data-a-target="chat-line-message" id="allowed"><span data-a-target="chat-message-username">Viewer</span><span class="text-fragment">safe</span></div>
    <div data-a-target="chat-line-message" id="body-precedence"><span class="video-chat__message">forbidden <span data-a-target="chat-line-message-body">safe</span></span></div>
    <div class="vod-message" id="vod-command"><span class="video-chat__message"><span>:</span><span class="text-fragment">!command</span></span></div>
  </body>`,
    }),
  );
  await page.goto(url);
  for (const id of ["fragments", "login", "emote", "vod-command"])
    await expect(page.locator(`#${id}`)).toHaveAttribute(
      "data-fce-ng-hidden",
      "1",
    );
  await expect(page.locator("#allowed")).toBeVisible();
  await expect(page.locator("#body-precedence")).toBeVisible();
  await setSettings(extensionWorker, {
    filter: {
      ...initial.filter,
      ngWords: ["forbidden"],
      blockedUsers: ["blocked_login"],
      applyToNativeChat: false,
    },
  });
  for (const id of ["fragments", "login", "emote", "vod-command"])
    await expect(page.locator(`#${id}`)).toBeVisible();
});

test("two options pages save disjoint fields without restoring stale form values", async ({
  page,
  context,
  extensionId,
  extensionWorker,
}) => {
  const second = await context.newPage();
  await Promise.all([
    page.goto(`chrome-extension://${extensionId}/options.html`),
    second.goto(`chrome-extension://${extensionId}/options.html`),
  ]);
  await Promise.all([
    page.locator('[data-tab="display"]').click(),
    second.locator('[data-tab="display"]').click(),
  ]);
  await Promise.all([
    page.locator("#panelOpacity").evaluate((input) => {
      (input as HTMLInputElement).value = "0.4";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }),
    second.locator("#panelFont").evaluate((input) => {
      (input as HTMLInputElement).value = "20";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }),
  ]);
  await expect
    .poll(async () => (await readSettings(extensionWorker)).panel)
    .toMatchObject({ opacity: 0.4, fontSizePx: 20 });
});

test("invalid backup leaves stored settings and the options form usable", async ({
  page,
  extensionId,
  extensionWorker,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("#composeEnabled")).not.toBeChecked();
  const before = await readSettings(extensionWorker);
  await page.locator("#toolsImportFile").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        settings: { filter: { blockedUsers: null } },
      }),
    ),
  });
  await expect(page.locator("#status")).toContainText("Could not import");
  expect(await readSettings(extensionWorker)).toEqual(before);
  await page.locator('[data-tab="filter"]').click();
  await expect(page.locator("#blockedUsers")).toHaveValue("");
});

test("PiP shares IME-safe submission, preserves changed drafts and prevents concurrent sends", async ({
  page,
}) => {
  const result = await exerciseSource(
    page,
    "src/views/pip-chat/index.ts",
    `
    const frame=document.createElement('iframe');document.body.append(frame);
    Object.defineProperty(window,'documentPictureInPicture',{configurable:true,value:{requestWindow:async()=>frame.contentWindow}});
    let calls=0,release;const controller=api.createPipChatController({onSend:()=>{calls++;return new Promise(resolve=>release=resolve)}});
    await controller.open();const doc=frame.contentDocument;const input=doc.querySelector('textarea');const form=doc.querySelector('form');
    input.value='Draft';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));await Promise.resolve();const composingCalls=calls;
    form.requestSubmit();form.requestSubmit();await Promise.resolve();input.value='Edited while pending';release(true);await new Promise(r=>setTimeout(r,0));
    const edited=input.value;form.requestSubmit();await Promise.resolve();release(false);await new Promise(r=>setTimeout(r,0));
    const failed=input.value;const errorVisible=!doc.querySelector('.fce-compose-status').hidden;
    form.requestSubmit();await Promise.resolve();release(true);await new Promise(r=>setTimeout(r,0));
    return {composingCalls,calls,edited,failed,errorVisible,cleared:input.value};
  `,
  );
  expect(result).toEqual({
    composingCalls: 0,
    calls: 3,
    edited: "Edited while pending",
    failed: "Edited while pending",
    errorVisible: true,
    cleared: "",
  });
});

test("PiP closes a late window without replacing a newer open", async ({
  page,
}) => {
  const result = await exerciseSource(
    page,
    "src/views/pip-chat/index.ts",
    `
    const releases=[];let requests=0;
    Object.defineProperty(window,'documentPictureInPicture',{configurable:true,value:{requestWindow:()=>{requests++;return new Promise(resolve=>releases.push(resolve))}}});
    function fakeWindow(){const frame=document.createElement('iframe');document.body.append(frame);const win=new EventTarget();win.document=frame.contentDocument;win.closed=false;win.closes=0;win.close=()=>{win.closed=true;win.closes++;win.dispatchEvent(new Event('pagehide'));};return win;}
    const controller=api.createPipChatController({onSend:async()=>false});
    const stale=controller.open();const duplicate=controller.open();controller.close();const latest=controller.open();
    const currentWindow=fakeWindow();releases[1](currentWindow);const opened=await latest;
    const oldWindow=fakeWindow();releases[0](oldWindow);const obsolete=await stale;await duplicate;
    const stillOpen=controller.isOpen();controller.close();
    return {requests,opened,obsolete,stillOpen,oldClosed:oldWindow.closes,currentClosed:currentWindow.closes};
  `,
  );
  expect(result).toEqual({
    requests: 2,
    opened: true,
    obsolete: false,
    stillOpen: true,
    oldClosed: 1,
    currentClosed: 1,
  });
});

test("Twitch parser distinguishes repeated posts and rereads existing DOM after restart", async ({
  page,
}) => {
  const result = (await exerciseSource(
    page,
    "src/adapters/twitch/index.ts",
    `
    initial.twitch.thirdPartyEmotes=false;
    document.body.innerHTML='<div data-test-selector="chat-scrollable-area__message-container"></div>';
    const container=document.querySelector('div');
    for(let i=0;i<2;i++)container.insertAdjacentHTML('beforeend','<div data-a-target="chat-line-message"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Repeated</span></div>');
    const first=[];const a=api.createTwitchAdapter();a.start(m=>first.push(m.id));a.stop();
    const second=[];const b=api.createTwitchAdapter();b.start(m=>second.push(m.id));b.stop();
    return {distinct:new Set(first).size,first,second};
  `,
  )) as { distinct: number; first: string[]; second: string[] };
  expect(result.distinct).toBe(2);
  expect(result.second).toEqual(result.first);
});

test("custom panel badge setting omits internal adapter markers", async ({
  page,
}) => {
  const result = await exerciseSource(
    page,
    "src/views/overlay-panel/index.ts",
    `
    const panel=api.createOverlayPanel({onSend:async()=>false});initial.panel.useNativeChat=false;
    panel.mount(document.body);panel.applySettings(initial);
    const line={id:'one',authorName:'Viewer',text:'Hello',badges:['VIP']};
    panel.setMessages([line]);const shown=document.querySelector('.fce-panel-badges').textContent;
    panel.applySettings({...initial,panel:{...initial.panel,showBadges:false}});
    const hidden=document.querySelectorAll('.fce-panel-badges').length;panel.unmount();return{shown,hidden};
  `,
  );
  expect(result).toEqual({ shown: "VIP", hidden: 0 });
});

test("native send checks the button before replacing input and stops with the adapter", async ({
  page,
}) => {
  const result = await exerciseSource(
    page,
    "src/adapters/twitch/index.ts",
    `
    initial.twitch.thirdPartyEmotes=false;
    document.body.innerHTML='<textarea data-a-target="chat-input">Existing native draft</textarea><button data-a-target="chat-send-button" disabled>Send</button>';
    let clicks=0;document.querySelector('button').onclick=()=>clicks++;
    const adapter=api.createTwitchAdapter();adapter.start(()=>{});
    const disabled=await adapter.sendMessage('Synthetic');const kept=document.querySelector('textarea').value;
    document.querySelector('button').disabled=false;
    const accepted=await adapter.sendMessage('Synthetic');const sent=document.querySelector('textarea').value;
    adapter.stop();const stopped=await adapter.sendMessage('After stop');return{disabled,kept,accepted,sent,stopped,clicks};
  `,
  );
  expect(result).toEqual({
    disabled: false,
    kept: "Existing native draft",
    accepted: true,
    sent: "Synthetic",
    stopped: false,
    clicks: 1,
  });
});

test("danmaku maximum lines changes the available measured tracks", async ({
  page,
}) => {
  const result = (await exerciseSource(
    page,
    "src/views/danmaku/index.ts",
    `
    const parent=document.createElement('div');parent.style.cssText='position:relative;width:1000px;height:700px';document.body.append(parent);
    const counts=[];
    for(const maxLines of [8,60]){
      const view=api.createDanmakuView();view.mount(parent);view.applySettings({...initial,displayMode:'danmaku',danmaku:{...initial.danmaku,enabled:true,fontSizePx:16,maxLines,speed:8}});
      view.flush(Array.from({length:20},(_,i)=>({id:String(i),text:'Synthetic '+i,badges:[],role:'viewer'})));
      await new Promise(r=>setTimeout(r,1600));counts.push(new Set([...parent.querySelectorAll('.fce-danmaku-item')].filter(n=>n.style.visibility==='visible').map(n=>n.style.top)).size);view.unmount();
    }return counts;
  `,
  )) as number[];
  expect(result[0]).toBeGreaterThan(1);
  expect(result[0]).toBeLessThanOrEqual(8);
  expect(result[1]).toBeGreaterThan(8);
});

test("Twitch emote setting updates in place and ignores an older pending fetch", async ({
  page,
}) => {
  const result = (await exerciseSource(
    page,
    "src/adapters/twitch/index.ts",
    `
    const listeners=[];browser.storage.onChanged.addListener=cb=>listeners.push(cb);browser.storage.onChanged.removeListener=cb=>listeners.splice(listeners.indexOf(cb),1);
    let release;let held=true;let requests=0;
    window.fetch=async url=>{requests++;if(held&&String(url).includes('betterttv'))await new Promise(r=>release=r);return{ok:true,json:async()=>String(url).includes('betterttv')?[{id:'one',code:'Wave'}]:{}}};
    document.body.innerHTML='<div data-test-selector="chat-scrollable-area__message-container"></div>';
    const received=[];const adapter=api.createTwitchAdapter();adapter.start(m=>received.push(m));
    const settle=()=>new Promise(r=>setTimeout(r,30));await settle();
    const toggle=enabled=>{const old=structuredClone(initial);initial.twitch.thirdPartyEmotes=enabled;for(const cb of [...listeners])cb({settings:{oldValue:old,newValue:structuredClone(initial)}},'local')};
    const post=()=>document.querySelector('div').insertAdjacentHTML('beforeend','<div data-a-target="chat-line-message"><span data-a-target="chat-message-username">Viewer</span><span data-a-target="chat-line-message-body">Wave</span></div>');
    toggle(false);held=false;release();await settle();post();await settle();const staleImages=received.at(-1).segments.some(s=>s.type==='emoji');
    toggle(true);await settle();post();await settle();const enabledImages=received.at(-1).segments.some(s=>s.type==='emoji');
    toggle(false);post();await settle();const disabledImages=received.at(-1).segments.some(s=>s.type==='emoji');adapter.stop();
    return{staleImages,enabledImages,disabledImages,requests,listeners:listeners.length};
  `,
  )) as Record<string, unknown>;
  expect(result).toMatchObject({
    staleImages: false,
    enabledImages: true,
    disabledImages: false,
    listeners: 0,
  });
});

test("YouTube regular videos and Shorts do not mount overlay or player toggle", async ({
  page,
  context,
}) => {
  const regularHtml = `<!doctype html><html><body>
    <div id="movie_player" class="html5-video-player">
      <video aria-label="Regular video"></video>
      <div class="ytp-right-controls">
        <button class="ytp-fullscreen-button">Fullscreen</button>
      </div>
    </div>
    <ytd-comments id="comments">
      <ytd-comment-thread-renderer><span id="author-text">Viewer</span><span id="content-text">Normal comment</span></ytd-comment-thread-renderer>
    </ytd-comments>
  </body></html>`;
  for (const targetUrl of [
    "https://www.youtube.com/watch?v=regular-video",
    "https://www.youtube.com/shorts/short-video",
  ]) {
    await context.route(targetUrl, (route) =>
      route.fulfill({ contentType: "text/html", body: regularHtml }),
    );
    await page.goto(targetUrl);
    await page.waitForTimeout(400);
    await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
    await expect(page.locator("#fce-player-toggle")).toHaveCount(0);
  }
});

test("YouTube native panel iframe hides the sidebar close button without hiding YouTube's own chatframe close button", async ({
  page,
  context,
  extensionWorker,
}) => {
  const html = fs
    .readFileSync(
      new URL("../fixtures/youtube-live.html", import.meta.url),
      "utf8",
    )
    .replace(
      "</body>",
      '<ytd-live-chat-frame id="chat"><iframe id="chatframe" src="https://www.youtube.com/live_chat?continuation=siteTok&dark_theme=1"></iframe></ytd-live-chat-frame></body>',
    );
  await context.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await context.route("https://www.youtube.com/live_chat?**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><html><body><yt-live-chat-header-renderer><div id="close-button"><button aria-label="閉じる">×</button></div></yt-live-chat-header-renderer></body></html>',
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "panel",
    panel: { ...settings.panel, useNativeChat: true },
  });
  await page.goto(fixtureUrl);
  await expect(
    page
      .frameLocator("#fce-native-chat-frame")
      .locator("yt-live-chat-header-renderer #close-button"),
  ).toBeHidden();
  await expect(
    page
      .frameLocator("#chatframe")
      .locator("yt-live-chat-header-renderer #close-button"),
  ).toBeVisible();

  await expect(page.locator(".fce-panel-handle-label")).toBeHidden();
  const panelBox = await page.locator(".fce-panel").boundingBox();
  const frameBox = await page.locator(".fce-panel-native").boundingBox();
  const handleBox = await page.locator(".fce-panel-handle").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(handleBox).not.toBeNull();
  expect(frameBox!.y).toBeCloseTo(panelBox!.y, 0);
  expect(handleBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
  expect(handleBox!.y + handleBox!.height).toBeLessThanOrEqual(
    panelBox!.y + 48,
  );
  const ytHeaderPaddingRight = await page
    .frameLocator("#fce-native-chat-frame")
    .locator("yt-live-chat-header-renderer")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingRight));
  expect(ytHeaderPaddingRight).toBeGreaterThanOrEqual(70);
  await page.locator(".fce-panel-gear").click();
  await expect(page.locator(".fce-panel-gear-menu")).toBeVisible();
  await page.locator(".fce-panel-gear").click();

  // Dragging YouTube's integrated handle and top drag-edge moves the panel without reaching #movie_player
  await page.evaluate(() => {
    (window as unknown as { __ytPlayerClicks: number }).__ytPlayerClicks = 0;
    document
      .querySelector("#movie_player")!
      .addEventListener("pointerdown", () => {
        (window as unknown as { __ytPlayerClicks: number }).__ytPlayerClicks +=
          1;
      });
  });
  const startBox = await page.locator(".fce-panel").boundingBox();
  const handleDragBox = await page.locator(".fce-panel-handle").boundingBox();
  await page.mouse.move(handleDragBox!.x + 12, handleDragBox!.y + 14);
  await page.mouse.down();
  await page.mouse.move(handleDragBox!.x - 90, handleDragBox!.y + 30, {
    steps: 5,
  });
  await page.mouse.up();
  const afterHandleDrag = await page.locator(".fce-panel").boundingBox();
  expect(afterHandleDrag!.x).toBeLessThan(startBox!.x - 50);

  const edgeBox = await page.locator(".fce-panel-drag-edge").boundingBox();
  expect(edgeBox).not.toBeNull();
  await page.mouse.move(edgeBox!.x + 30, edgeBox!.y + 4);
  await page.mouse.down();
  await page.mouse.move(edgeBox!.x + 70, edgeBox!.y + 24, { steps: 5 });
  await page.mouse.up();
  const afterEdgeDrag = await page.locator(".fce-panel").boundingBox();
  expect(afterEdgeDrag!.x).toBeGreaterThan(afterHandleDrag!.x + 20);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __ytPlayerClicks: number }).__ytPlayerClicks,
    ),
  ).toBe(0);
});

test("YouTube replay danmaku clears on rapid seek, skips in-between flood, and replays visited scenes", async ({
  page,
  context,
  extensionWorker,
}) => {
  const html = fs
    .readFileSync(
      new URL("../fixtures/youtube-live.html", import.meta.url),
      "utf8",
    )
    .replace(
      "</body>",
      '<ytd-live-chat-frame id="chat"><iframe id="chatframe" src="https://www.youtube.com/live_chat_replay?continuation=replayTok&dark_theme=1"></iframe></ytd-live-chat-frame></body>',
    );
  await context.route(fixtureUrl, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await context.route("https://www.youtube.com/live_chat_replay?**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body>
        <yt-live-chat-text-message-renderer id="m-pre-far"><span id="timestamp">-28:41</span><span id="author-name">Pre</span><span id="message">Prestream flood</span></yt-live-chat-text-message-renderer>
        <yt-live-chat-text-message-renderer id="m10"><span id="timestamp">0:10</span><span id="author-name">A</span><span id="message">Scene ten</span></yt-live-chat-text-message-renderer>
        <yt-live-chat-text-message-renderer id="m120"><span id="timestamp">2:00</span><span id="author-name">B</span><span id="message">Skipped middle</span></yt-live-chat-text-message-renderer>
        <yt-live-chat-text-message-renderer id="m300"><span id="timestamp">5:00</span><span id="author-name">C</span><span id="message">Scene three hundred</span></yt-live-chat-text-message-renderer>
      </body></html>`,
    }),
  );
  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "danmaku",
    danmaku: { ...settings.danmaku, enabled: true, density: "high", speed: 6 },
  });
  await page.goto(fixtureUrl);
  await page.waitForSelector("#fce-hidden-live-chat-frame");
  await page.waitForTimeout(300);
  await expect(page.locator(".fce-danmaku-item")).toHaveCount(0);

  // Seek to 0:10 -> Scene ten plays (Prestream flood never plays)
  await page.evaluate(() => {
    const v = document.querySelector("video")!;
    v.currentTime = 10;
    v.dispatchEvent(new Event("seeked"));
  });
  await expect(page.locator(".fce-danmaku-item")).toContainText("Scene ten");
  await expect(page.locator(".fce-danmaku-item")).not.toContainText(
    "Prestream flood",
  );

  // Rapid forward jump to 5:00 -> Scene ten is cleared, Skipped middle does NOT appear, Scene three hundred plays
  await page.evaluate(() => {
    const v = document.querySelector("video")!;
    v.currentTime = 300;
    v.dispatchEvent(new Event("seeked"));
  });
  await expect(page.locator(".fce-danmaku-item")).toContainText(
    "Scene three hundred",
  );
  await expect(page.locator(".fce-danmaku-item")).not.toContainText(
    "Scene ten",
  );
  await expect(page.locator(".fce-danmaku-item")).not.toContainText(
    "Skipped middle",
  );

  // Rewind back to already-visited 0:10 -> Scene three hundred clears, Scene ten replays!
  await page.evaluate(() => {
    const v = document.querySelector("video")!;
    v.currentTime = 10;
    v.dispatchEvent(new Event("seeked"));
  });
  await expect(page.locator(".fce-danmaku-item")).toContainText("Scene ten");
  await expect(page.locator(".fce-danmaku-item")).not.toContainText(
    "Scene three hundred",
  );
});

test("YouTube live danmaku caps initial backlog flood and isolates stale chatframes across SPA switches", async ({
  page,
  context,
  extensionWorker,
}) => {
  const html = fs.readFileSync(
    new URL("../fixtures/youtube-live.html", import.meta.url),
    "utf8",
  );
  await context.route("https://www.youtube.com/watch?v=streamA**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await context.route("https://www.youtube.com/watch?v=streamB**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await context.route("https://www.youtube.com/live_chat?**", (route) => {
    const url = route.request().url();
    const isB = url.includes("v=streamB") || url.includes("contB");
    const rows = Array.from(
      { length: 20 },
      (_, i) =>
        `<yt-live-chat-text-message-renderer id="${isB ? "b" : "a"}-${i}"><span id="author-name">${isB ? "UserB" : "UserA"}</span><span id="message">${isB ? "Stream B msg" : "Stream A msg"} ${i}</span></yt-live-chat-text-message-renderer>`,
    ).join("");
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body>${rows}</body></html>`,
    });
  });

  const settings = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    displayMode: "danmaku",
    danmaku: { ...settings.danmaku, enabled: true, density: "high", speed: 6 },
  });

  await page.goto("https://www.youtube.com/watch?v=streamA");
  await expect
    .poll(() => page.locator(".fce-danmaku-item").count())
    .toBeGreaterThan(0);
  // 20 initial backlog rows must be burst-capped (<= 3), not flooded
  expect(await page.locator(".fce-danmaku-item").count()).toBeLessThanOrEqual(
    3,
  );
  await expect(page.locator(".fce-danmaku-item").first()).toContainText(
    "Stream A msg",
  );

  // Simulate YouTube SPA navigation to streamB while a stale chatframe pointing to contA lingers
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "chatframe";
    frame.src =
      "https://www.youtube.com/live_chat?continuation=contA&dark_theme=1";
    document.body.appendChild(frame);
    history.pushState({}, "", "/watch?v=streamB");
    window.dispatchEvent(new Event("yt-navigate-finish"));
  });

  await expect
    .poll(() => page.locator(".fce-danmaku-item").count())
    .toBeGreaterThan(0);
  const bTexts = await page.locator(".fce-danmaku-item").allTextContents();
  expect(bTexts.every((t) => !t.includes("Stream A msg"))).toBe(true);
  expect(bTexts.some((t) => t.includes("Stream B msg"))).toBe(true);
});

test("native YouTube NG checks emoji names, ignores timestamp/author on emoji-only rows, and protects moderator type", async ({
  page,
  context,
  extensionWorker,
}) => {
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    filter: {
      ...initial.filter,
      ngWords: ["BlockedEmoji", "BlockedAuthor"],
      hideCommands: true,
      protectRoles: true,
      applyToNativeChat: true,
    },
  });
  const url = "https://www.youtube.com/live_chat?v=review-ng";
  await context.route(url, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><body>
        <yt-live-chat-text-message-renderer id="emoji-ng"><span id="author-name">Viewer</span><span id="message">safe <img alt="BlockedEmoji"></span></yt-live-chat-text-message-renderer>
        <yt-live-chat-text-message-renderer id="emoji-only"><span id="timestamp">!12:00</span><span id="author-name">BlockedAuthor</span><span id="message"><img alt="Wave"></span></yt-live-chat-text-message-renderer>
        <yt-live-chat-text-message-renderer id="mod-type"><span id="author-name" type="moderator">Mod</span><span id="message">!command</span></yt-live-chat-text-message-renderer>
      </body>`,
    }),
  );
  await page.goto(url);
  await expect(page.locator("#emoji-ng")).toHaveAttribute(
    "data-fce-ng-hidden",
    "1",
  );
  await expect(page.locator("#emoji-only")).toBeVisible();
  await expect(page.locator("#mod-type")).toBeVisible();

  await setSettings(extensionWorker, {
    filter: {
      ...initial.filter,
      ngWords: ["BlockedEmoji", "BlockedAuthor"],
      applyToNativeChat: false,
    },
  });
  await expect(page.locator("#emoji-ng")).toBeVisible();
});

test("options shows a save error message without import text and clears error state on next save", async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.locator('[data-tab="filter"]').click();
  // Exceed the 1000-entry ngWords limit so saveSettings validation rejects it
  await page.locator("#ngWords").evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    area.value = Array.from({ length: 1001 }, (_, i) => `word-${i}`).join("\n");
    area.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const status = page.locator("#status");
  await expect(status).toContainText("Could not save settings.");
  await expect(status).toHaveAttribute("data-state", "error");

  // Restore a valid value and confirm error state clears when Saved. appears
  await page.locator("#ngWords").evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    area.value = "safe";
    area.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(status).toContainText("Saved.");
  await expect(status).not.toHaveAttribute("data-state", "error");
});

test("Danmaku clearSite removes active, pending, and flush-queued items only for the target site", async ({
  page,
}) => {
  const result = (await exerciseSource(
    page,
    "src/views/danmaku/index.ts",
    `
    const player=document.createElement('div');
    player.style.cssText='position:relative;width:800px;height:500px;';
    document.body.append(player);
    const view=api.createDanmakuView();
    view.mount(player);
    view.applySettings({...initial,displayMode:'danmaku',danmaku:{...initial.danmaku,enabled:true,speed:8,density:'high'}});
    view.setMixedMode(true);
    const mk=(id,site,text)=>({id,site,text,authorName:'Viewer',badges:[],role:'viewer',isCommand:false,timestampMs:0});
    // Spawn active item for both sites first.
    view.push(mk('act-tw','twitch','Active TW'));
    view.push(mk('act-yt','youtube-live','Active YT'));
    await new Promise(r=>setTimeout(r,80));
    const beforeTwActive=player.querySelectorAll('.fce-danmaku-item[data-site="twitch"]').length;
    const beforeYtActive=player.querySelectorAll('.fce-danmaku-item[data-site="youtube-live"]').length;
    // Queue pending layout items + staggered flush timers for both sites.
    view.push(mk('pend-tw','twitch','Pending TW'));
    view.push(mk('pend-yt','youtube-live','Pending YT'));
    view.flush([mk('q-tw-1','twitch','Queued TW 1'),mk('q-yt-1','youtube-live','Queued YT 1')]);
    view.clearSite('twitch');
    const rightAfterTw=player.querySelectorAll('.fce-danmaku-item[data-site="twitch"]').length;
    await new Promise(r=>setTimeout(r,200));
    const finalTw=player.querySelectorAll('.fce-danmaku-item[data-site="twitch"]').length;
    const finalYt=player.querySelectorAll('.fce-danmaku-item[data-site="youtube-live"]').length;
    view.unmount();
    return {beforeTwActive,beforeYtActive,rightAfterTw,finalTw,finalYt};
  `,
  )) as {
    beforeTwActive: number;
    beforeYtActive: number;
    rightAfterTw: number;
    finalTw: number;
    finalYt: number;
  };
  expect(result.beforeTwActive).toBe(1);
  expect(result.beforeYtActive).toBe(1);
  expect(result.rightAfterTw).toBe(0);
  expect(result.finalTw).toBe(0);
  expect(result.finalYt).toBe(3);
});
