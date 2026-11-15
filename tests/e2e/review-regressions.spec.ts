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

test("site toggles preserve existing comments and navigation starts one runtime", async ({
  page,
  extensionWorker,
}) => {
  const initial = await readSettings(extensionWorker);
  await setSettings(extensionWorker, {
    youtubeComments: { ...initial.youtubeComments, enabled: false },
  });
  await page.goto(fixtureUrl);
  await expect(page.locator("#fce-player-toggle")).toBeVisible();
  await expect(page.locator("#fce-overlay-panel-host")).toHaveCount(0);
  await setSettings(extensionWorker, {
    youtubeComments: { ...initial.youtubeComments, enabled: true },
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
    youtubeComments: { ...initial.youtubeComments, enabled: false },
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
  // ライブ明示 UI が必要（isLiveBroadcast meta だけでは不足）— ISS-021。
  const html = fs
    .readFileSync(
      new URL("../fixtures/youtube-comments.html", import.meta.url),
      "utf8",
    )
    .replace(
      '<div id="movie_player" class="html5-video-player">',
      '<div id="movie_player" class="html5-video-player ytp-live"><span class="badge-style-type-live-now">LIVE</span>',
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

test("reply failures never submit the top-level comment box", async ({
  page,
}) => {
  const result = await exerciseSource(
    page,
    "src/adapters/youtube-comments/index.ts",
    `
    document.body.innerHTML='<ytd-comment-simplebox-renderer><div id="contenteditable-root" contenteditable="true"></div><ytd-button-renderer id="submit-button"><button>Send</button></ytd-button-renderer></ytd-comment-simplebox-renderer><ytd-comment-thread-renderer><span id="author-text">Viewer</span><span id="content-text">Synthetic thread</span><div id="reply-button"><button>Reply</button></div></ytd-comment-thread-renderer>';
    let clicks=0;document.querySelector('#submit-button button').onclick=()=>clicks++;
    const adapter=api.createYouTubeCommentsAdapter();let id;adapter.start(line=>id=line.id);
    const missing=await adapter.replyTo('missing','Synthetic reply');
    const failed=await adapter.replyTo(id,'Synthetic reply');
    let replyClicks=0;const thread=document.querySelector('ytd-comment-thread-renderer');
    thread.querySelector('#reply-button button').onclick=()=>{thread.insertAdjacentHTML('beforeend','<ytd-comment-reply-dialog-renderer><div id="contenteditable-root" contenteditable="true"></div><ytd-button-renderer id="submit-button"><button>Send reply</button></ytd-button-renderer></ytd-comment-reply-dialog-renderer>');thread.querySelector('ytd-comment-reply-dialog-renderer button').onclick=()=>replyClicks++;};
    const accepted=await adapter.replyTo(id,'Synthetic reply');adapter.stop();
    return {missing,failed,clicks,accepted,replyClicks};
  `,
  );
  expect(result).toEqual({
    missing: false,
    failed: false,
    clicks: 0,
    accepted: true,
    replyClicks: 1,
  });
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
    const line={id:'one',authorName:'Viewer',text:'Hello',badges:['VIP','replyable'],canReply:true};
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
