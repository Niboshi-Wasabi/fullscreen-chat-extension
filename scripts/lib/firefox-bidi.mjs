import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const EXTENSION_ID = "fullscreen-chat-extension@niboshi.dev";
const DEFAULT_FIREFOX = "C:/Program Files/Mozilla Firefox/firefox.exe";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve the installed Firefox binary / インストール済み Firefox を探す。 */
export function resolveFirefoxBinary(explicit) {
  const candidates = [
    explicit,
    process.env.FIREFOX_BINARY,
    DEFAULT_FIREFOX,
    "C:/Program Files (x86)/Mozilla Firefox/firefox.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  throw new Error(
    "Firefox binary not found. Install Firefox or set FIREFOX_BINARY.",
  );
}

/**
 * Launch Firefox Remote Agent (BiDi) with a dedicated temp profile.
 * 専用一時プロファイルで BiDi 付き Firefox を起動する。
 */
export async function launchFirefoxBidi(options) {
  const {
    artifactsDir,
    extensionId = EXTENSION_ID,
    headless = true,
    startupTimeoutMs = 20000,
  } = options;
  const firefoxBinary = options.firefoxBinary
    ? resolveFirefoxBinary(options.firefoxBinary)
    : resolveFirefoxBinary();

  fs.mkdirSync(artifactsDir, { recursive: true });
  const profilesRoot = path.join(artifactsDir, "profiles");
  fs.mkdirSync(profilesRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(profilesRoot, "profile-"));
  const uuid = randomUUID();

  fs.writeFileSync(
    path.join(profile, "user.js"),
    Object.entries({
      "browser.shell.checkDefaultBrowser": false,
      "browser.startup.homepage": "about:blank",
      "browser.startup.page": 0,
      "browser.aboutwelcome.enabled": false,
      "browser.newtabpage.enabled": false,
      "browser.startup.homepage_override.mstone": "ignore",
      // 1=BiDi, 2=CDP, 3=both — keep BiDi available for extension install.
      // BiDi を有効にする（拡張の一時インストールに必要）。
      "remote.active-protocols": 3,
      "extensions.webextensions.uuids": JSON.stringify({ [extensionId]: uuid }),
    })
      .map(
        ([key, value]) =>
          `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
      )
      .join("\n"),
  );

  const args = [
    ...(headless ? ["--headless"] : []),
    "--no-remote",
    "--profile",
    profile,
    "--remote-debugging-port",
    "0",
    "about:blank",
  ];
  const child = spawn(firefoxBinary, args, {
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let browserLog = "";
  child.stderr.on("data", (bytes) => {
    browserLog += bytes.toString();
  });
  child.stdout.on("data", (bytes) => {
    browserLog += bytes.toString();
  });

  const deadline = Date.now() + startupTimeoutMs;
  // On Windows the launcher stub can exit while the browser keeps running;
  // wait for the BiDi banner instead of treating an early exit as failure.
  // Windows ではランチャーが先に終了することがあるため、BiDi 表示を待つ。
  while (!/WebDriver BiDi listening on (ws:\/\/[^\s]+)/.test(browserLog)) {
    if (Date.now() > deadline) {
      await cleanupProcess(child);
      safeRemoveProfile(profile, profilesRoot);
      throw new Error(
        `Firefox BiDi startup timed out (exit=${child.exitCode}): ${browserLog.slice(-2000)}`,
      );
    }
    await delay(100);
  }
  const endpoint = browserLog.match(
    /WebDriver BiDi listening on (ws:\/\/[^\s]+)/,
  )[1];
  const sessionUrl = `${endpoint.replace(/\/$/, "")}/session`;
  const socket = new WebSocket(sessionUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const eventHandlers = new Map();

  socket.addEventListener("message", (event) => {
    const packet = JSON.parse(String(event.data));
    if (packet.id) {
      const request = pending.get(packet.id);
      if (!request) return;
      pending.delete(packet.id);
      clearTimeout(request.timer);
      if (packet.type === "error") {
        request.reject(
          new Error(`${packet.error}: ${packet.message ?? "unknown"}`),
        );
      } else {
        request.resolve(packet.result);
      }
      return;
    }
    if (packet.method) {
      const handlers = eventHandlers.get(packet.method) ?? [];
      for (const handler of handlers) {
        void Promise.resolve(handler(packet.params)).catch(() => undefined);
      }
    }
  });

  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const on = (method, handler) => {
    const list = eventHandlers.get(method) ?? [];
    list.push(handler);
    eventHandlers.set(method, list);
    return () => {
      const next = (eventHandlers.get(method) ?? []).filter(
        (entry) => entry !== handler,
      );
      eventHandlers.set(method, next);
    };
  };

  const getBrowserLog = () => browserLog;

  const close = async () => {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        await send("browser.close", {}, 5000);
      } catch {
        // Browser may already be shutting down.
      }
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    await cleanupProcess(child);
    await delay(300);
    try {
      safeRemoveProfile(profile, profilesRoot);
    } catch (error) {
      // Locked files must not flip a functional pass; retry once then leave.
      // 残ったロックは機能の合否に含めない。再試行しても消えなければ残す。
      await delay(500);
      try {
        safeRemoveProfile(profile, profilesRoot);
      } catch {
        console.warn(`Profile cleanup deferred: ${error.message}`);
      }
    }
  };

  return {
    send,
    on,
    getBrowserLog,
    close,
    profile,
    extensionUuid: uuid,
    extensionId,
    mozExtensionBase: `moz-extension://${uuid}`,
    firefoxBinary,
    child,
  };
}

async function cleanupProcess(child) {
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(1500),
  ]);
  // Always try to kill the tree: browser.close can exit the parent while
  // children still lock the profile directory on Windows.
  // 親プロセスだけを終了すると、子プロセスがプロファイルを使用し続ける場合がある。常にプロセスツリー全体の終了を試みる。
  if (child.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(1000),
    ]);
  }
}

function safeRemoveProfile(profile, profilesRoot) {
  if (path.dirname(path.resolve(profile)) !== path.resolve(profilesRoot)) {
    throw new Error("Unsafe profile cleanup path");
  }
  fs.rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

export async function evaluate(session, context, expression) {
  const result = await session.send("script.evaluate", {
    target: { context },
    expression: `(async()=>JSON.stringify(await (${expression})))()`,
    awaitPromise: true,
    userActivation: true,
  });
  if (result.type === "exception") {
    throw new Error(result.exceptionDetails?.text ?? "script exception");
  }
  return result.result.type === "undefined"
    ? undefined
    : JSON.parse(result.result.value);
}

export async function until(session, context, expression, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  let last;
  do {
    last = await evaluate(session, context, expression);
    if (last) return last;
    await delay(50);
  } while (Date.now() < end);
  throw new Error(
    `Condition failed: ${expression}; last=${JSON.stringify(last)}`,
  );
}

export async function navigate(session, context, url) {
  await session.send("browsingContext.navigate", {
    context,
    url,
    wait: "complete",
  });
}

export async function newTab(session, url) {
  const { context } = await session.send("browsingContext.create", {
    type: "tab",
  });
  if (url) await navigate(session, context, url);
  return context;
}

export async function closeTab(session, context) {
  try {
    await session.send("browsingContext.close", {
      context,
      promptUnload: false,
    });
  } catch {
    // Tab may already be gone.
  }
}

export { delay, EXTENSION_ID };
