import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

async function availableLoopbackPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate an isolated smoke-test port.");
  await new Promise((resolve) => probe.close(resolve));
  return address.port;
}

const port = await availableLoopbackPort();
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const dataDirectory = await mkdtemp(
  path.join(os.tmpdir(), "control-center-smoke-"),
);
const server = spawn(
  process.execPath,
  [
    path.join("scripts", "launch.mjs"),
    "--no-open",
    `--port=${port}`,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONTROL_CENTER_DATA_DIR: dataDirectory,
      PORT: String(port),
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  },
);
let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
const exited = new Promise((resolve) =>
  server.once("exit", (code, signal) => resolve({ code, signal })),
);

async function waitForExit(timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      exited,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function forceStopServerTree() {
  if (!server.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(server.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    return;
  }
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGKILL");
  }
}

async function stopServerOnce() {
  if (server.exitCode !== null || server.signalCode !== null) return exited;
  if (server.connected) {
    await new Promise((resolve) => {
      server.send({ type: "shutdown" }, (error) => {
        if (error) server.kill("SIGTERM");
        resolve();
      });
    });
  } else {
    server.kill("SIGTERM");
  }
  let result = await waitForExit(10_000);
  if (result) return result;
  await forceStopServerTree();
  result = await waitForExit(5_000);
  if (!result)
    throw new Error(`Could not stop the smoke-test server.\n${output}`);
  return result;
}

let stopPromise;
function stopServer() {
  stopPromise ??= stopServerOnce();
  return stopPromise;
}

let dataCleanupPromise;
function removeDataDirectory() {
  dataCleanupPromise ??= rm(dataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
  return dataCleanupPromise;
}

let handlingSignal = false;
async function handleSignal(signal) {
  if (handlingSignal) return;
  handlingSignal = true;
  try {
    await stopServer();
    await removeDataDirectory();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void handleSignal(signal));

try {
  const deadline = Date.now() + 30_000;
  let response;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(null), 200)),
    ]);
    if (result)
      throw new Error(
        `Server exited before startup (${result.code ?? result.signal}).\n${output}`,
      );
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) break;
    } catch {
      // Keep polling until the startup deadline.
    }
  }
  if (!response?.ok)
    throw new Error(`Health endpoint did not become ready.\n${output}`);
  const health = await response.json();
  if (
    health.service !== "control-center" ||
    health.version !== packageMetadata.version
  )
    throw new Error("Health endpoint returned the wrong service identity.");
  const home = await fetch(`http://127.0.0.1:${port}/`);
  const homeText = await home.text();
  if (!home.ok || !homeText.includes("Daily Command Center"))
    throw new Error("The dashboard home page did not render.");
  const getJson = async (pathname) => {
    const result = await fetch(`http://127.0.0.1:${port}${pathname}`);
    if (!result.ok)
      throw new Error(`${pathname} returned HTTP ${result.status}.`);
    return result.json();
  };
  const settings = await getJson("/api/settings");
  if (
    settings.general?.workspaceName !== "Control Center" ||
    settings.industry?.sources?.length !== 0 ||
    settings.industry?.keywords?.length !== 0 ||
    settings.industry?.description !== "" ||
    settings.industry?.excludedTerms?.length !== 0 ||
    settings.industry?.dailyLimit !== 30 ||
    settings.mentions?.terms?.length !== 0 ||
    settings.mentions?.websites?.length !== 0 ||
    settings.mentions?.identityAnchors?.length !== 0 ||
    settings.mentions?.negativeTerms?.length !== 0 ||
    settings.mentions?.excludeOwnedSites !== true ||
    settings.audience?.accounts?.length !== 0 ||
    settings.newsletters?.connected !== false ||
    settings.dailyBrief?.sections?.industry !== 5 ||
    settings.dailyBrief?.sections?.mentions !== 5 ||
    settings.dailyBrief?.sections?.newsletters !== 5 ||
    settings.ai?.provider !== "none" ||
    "apiKeys" in (settings.ai || {})
  ) {
    throw new Error(
      "A fresh install exposed personalized or preconfigured settings.",
    );
  }
  const secretProbe = "smoke-key-must-never-return";
  const saveSecret = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...settings,
      ai: {
        provider: "openai",
        model: "gpt-5-mini-smoke-probe",
        apiKeys: { openai: secretProbe },
      },
    }),
  });
  if (!saveSecret.ok) throw new Error("The Settings API could not save an optional AI key.");
  const secretReadbackText = await (await fetch(`http://127.0.0.1:${port}/api/settings`)).text();
  const secretReadback = JSON.parse(secretReadbackText);
  if (
    secretReadbackText.includes(secretProbe) ||
    secretReadback.ai?.keySet?.openai !== true ||
    secretReadback.ai?.provider !== "openai" ||
    secretReadback.ai?.model !== "gpt-5-mini-smoke-probe"
  ) throw new Error("The Settings API did not keep the optional AI key server-side.");
  const settingsWithoutAi = structuredClone(secretReadback);
  delete settingsWithoutAi.ai;
  const preserveSecret = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settingsWithoutAi),
  });
  if (!preserveSecret.ok)
    throw new Error("The Settings API rejected a backward-compatible save without AI fields.");
  const preservedReadbackText = await (await fetch(`http://127.0.0.1:${port}/api/settings`)).text();
  const preservedReadback = JSON.parse(preservedReadbackText);
  if (
    preservedReadbackText.includes(secretProbe) ||
    preservedReadback.ai?.keySet?.openai !== true ||
    preservedReadback.ai?.provider !== "openai" ||
    preservedReadback.ai?.model !== "gpt-5-mini-smoke-probe"
  ) throw new Error("A Settings save without AI fields changed the saved AI configuration.");
  const clearSecret = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...secretReadback,
      ai: { provider: "none", model: "", clearKeys: ["openai"] },
    }),
  });
  if (!clearSecret.ok) throw new Error("The Settings API could not clear an optional AI key.");
  const clearedReadbackText = await (await fetch(`http://127.0.0.1:${port}/api/settings`)).text();
  const clearedReadback = JSON.parse(clearedReadbackText);
  if (
    clearedReadbackText.includes(secretProbe) ||
    clearedReadback.ai?.keySet?.openai !== false
  ) throw new Error("The Settings API did not clear the optional AI key.");
  const workspace = await getJson("/api/workspace");
  if (
    workspace.initialized !== false ||
    workspace.tasks?.length !== 0 ||
    workspace.reminders?.length !== 0
  ) {
    throw new Error("A fresh install did not start with an empty workspace.");
  }
  for (const pathname of [
    "/api/live/industry",
    "/api/live/mentions",
    "/api/live/audience",
    "/api/live/newsletters",
    "/api/brief",
  ]) {
    const live = await getJson(pathname);
    if (live.configured !== false || live.items?.length !== 0) {
      throw new Error(`${pathname} did not start in generic setup mode.`);
    }
    if (pathname === "/api/brief" &&
        (live.snapshot?.length !== 3 || live.snapshot.some((section) => section.items.length || section.configured))) {
      throw new Error("A fresh daily brief must contain only empty, unconfigured snapshot sections.");
    }
  }
  const saveBrief = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...clearedReadback,
      dailyBrief: { ...clearedReadback.dailyBrief, sections: { industry: 3, mentions: 0, newsletters: 2 } },
    }),
  });
  if (!saveBrief.ok) throw new Error("Daily brief preferences could not be saved.");
  const briefReadback = await getJson("/api/brief");
  if (JSON.stringify(briefReadback.snapshot?.map(({ category, requestedCount }) => [category, requestedCount])) !==
      JSON.stringify([["industry", 3], ["newsletters", 2]])) {
    throw new Error("Daily brief preferences did not control the saved snapshot.");
  }
  for (const invalid of [
    { ...clearedReadback, ai: { ...clearedReadback.ai, model: "someone@example.com" } },
    { ...clearedReadback, newsletters: { ...clearedReadback.newsletters, googleClientId: "someone@example.com" } },
  ]) {
    const rejected = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invalid),
    });
    if (rejected.status !== 400) throw new Error("Configuration fields accepted an autofilled email address.");
  }
  const blocked = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    headers: { Host: "attacker.example", Origin: "http://attacker.example" },
  });
  if (blocked.status !== 403)
    throw new Error(
      `Foreign Host probe returned HTTP ${blocked.status}, expected 403.`,
    );
  if (server.exitCode !== null || server.signalCode !== null)
    throw new Error(`The launcher exited during smoke verification.\n${output}`);
  console.log(
    "Golden-path launcher smoke passed: health, home page, generic empty first run, and localhost boundary.",
  );
} finally {
  await stopServer();
  await removeDataDirectory();
}
