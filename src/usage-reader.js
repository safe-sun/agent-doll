const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const MAX_SESSION_FILES = 120;
const READ_TAIL_BYTES = 1024 * 1024;
const APP_SERVER_TIMEOUT_MS = 8000;
const USAGE_CACHE_TTL_MS = 75_000;
const PREFERRED_LIMIT_ID = "codex";

let cachedUsage = null;
let pendingUsageRead = null;
let cachedCodexCommands;
let preferredCodexCommand = null;

function codexHome() {
  const configured = process.env.CODEX_HOME?.trim();

  if (!configured) {
    return path.join(os.homedir(), ".codex");
  }

  if (configured === "~") {
    return os.homedir();
  }

  if (configured.startsWith(`~${path.sep}`) || configured.startsWith("~/")) {
    return path.join(os.homedir(), configured.slice(2));
  }

  return path.resolve(configured);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function clampPercent(value) {
  const number = toNumber(value);

  if (number === null) {
    return null;
  }

  return Math.max(0, Math.min(100, number));
}

function formatEpochSeconds(epochSeconds) {
  const seconds = toNumber(epochSeconds);
  if (!seconds) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function normalizeWindow(window) {
  if (!window || typeof window !== "object") {
    return null;
  }

  const usedPercent = clampPercent(firstValue(window.used_percent, window.usedPercent));
  const remainingPercent = clampPercent(
    firstValue(window.remaining_percent, window.remainingPercent),
  );

  if (usedPercent === null && remainingPercent === null) {
    return null;
  }

  const normalizedRemaining = remainingPercent ?? Math.max(0, 100 - usedPercent);

  return {
    usedPercent: usedPercent ?? Math.max(0, 100 - normalizedRemaining),
    remainingPercent: normalizedRemaining,
    windowMinutes: toNumber(firstValue(window.window_minutes, window.windowDurationMins)),
    resetsAt: formatEpochSeconds(firstValue(window.resets_at, window.resetsAt)),
  };
}

function normalizeAppServerWindow(window) {
  if (!window || typeof window !== "object") {
    return null;
  }

  const usedPercent = clampPercent(firstValue(window.usedPercent, window.used_percent));
  const remainingPercent = clampPercent(
    firstValue(window.remainingPercent, window.remaining_percent),
  );

  if (usedPercent === null && remainingPercent === null) {
    return null;
  }

  const normalizedRemaining = remainingPercent ?? Math.max(0, 100 - usedPercent);

  return {
    usedPercent: usedPercent ?? Math.max(0, 100 - normalizedRemaining),
    remainingPercent: normalizedRemaining,
    windowMinutes: toNumber(firstValue(window.windowDurationMins, window.window_minutes)),
    resetsAt: formatEpochSeconds(firstValue(window.resetsAt, window.resets_at)),
  };
}

function normalizeAppServerRateLimit(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    found: true,
    source: "codex-app-server",
    timestamp: new Date().toISOString(),
    planType: firstValue(snapshot.planType, snapshot.plan_type) || null,
    limitId: firstValue(snapshot.limitId, snapshot.limit_id) || null,
    limitName: firstValue(snapshot.limitName, snapshot.limit_name) || null,
    primary: normalizeAppServerWindow(snapshot.primary),
    secondary: normalizeAppServerWindow(snapshot.secondary),
    rateLimitReachedType:
      firstValue(snapshot.rateLimitReachedType, snapshot.rate_limit_reached_type) || null,
    credits: firstValue(snapshot.credits, snapshot.creditInfo, snapshot.credit_info) || null,
  };
}

function pickAppServerRateLimit(result) {
  const byLimitId = firstValue(result?.rateLimitsByLimitId, result?.rate_limits_by_limit_id);

  if (byLimitId?.codex) {
    return byLimitId.codex;
  }

  return firstValue(result?.rateLimits, result?.rate_limits) || null;
}

function parseJsonLines(chunk, onMessage) {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      onMessage(JSON.parse(trimmed));
    } catch {
      // Ignore log fragments and partially-written JSON lines.
    }
  }
}

function commandNeedsShell(command) {
  if (process.platform !== "win32") {
    return false;
  }

  return [".bat", ".cmd", ".ps1"].includes(path.extname(command).toLowerCase());
}

function isRunnableCodexCandidate(command) {
  if (process.platform !== "win32") {
    return true;
  }

  return [".bat", ".cmd", ".exe"].includes(path.extname(command).toLowerCase());
}

async function commandExists(command) {
  try {
    const stat = await fs.stat(command);
    return stat.isFile();
  } catch {
    return false;
  }
}

function runCapture(command, args, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";

    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const timer = setTimeout(() => finish(""), timeoutMs);

    function finish(value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        child.kill();
      }
      resolve(value);
    }

    child.on("error", () => finish(""));
    child.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
    });
    child.on("exit", () => finish(stdout));
  });
}

function appendUniqueCommand(commands, command) {
  const normalized = process.platform === "win32" ? command.toLowerCase() : command;

  if (!commands.some((existing) => existing.normalized === normalized)) {
    commands.push({ command, normalized });
  }
}

async function findCodexCommandsOnPath() {
  const output =
    process.platform === "win32"
      ? await runCapture("where.exe", ["codex"])
      : await runCapture("sh", ["-lc", "command -v codex"]);
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const commands = [];

  for (const candidate of candidates) {
    if (isRunnableCodexCandidate(candidate) && (await commandExists(candidate))) {
      appendUniqueCommand(commands, candidate);
    }
  }

  return commands.map((entry) => entry.command);
}

async function findCodexCommandsInCodexAppBin() {
  if (process.platform !== "win32") {
    return [];
  }

  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const codexBinRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  let entries;

  try {
    entries = await fs.readdir(codexBinRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const command = path.join(codexBinRoot, entry.name, "codex.exe");

    try {
      const stat = await fs.stat(command);
      if (stat.isFile()) {
        candidates.push({ command, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // 忽略 Codex 更新后残留的失效 bin 目录。
    }
  }

  return candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((candidate) => candidate.command);
}

async function findCodexCommandsInWindowsApps() {
  if (process.platform !== "win32") {
    return [];
  }

  const windowsApps = path.join(process.env.ProgramFiles || "C:\\Program Files", "WindowsApps");
  let entries;

  try {
    entries = await fs.readdir(windowsApps, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("OpenAI.Codex_"))
    .map((entry) => path.join(windowsApps, entry.name, "app", "resources", "codex.exe"));
  const commands = [];

  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      appendUniqueCommand(commands, candidate);
    }
  }

  return commands.map((entry) => entry.command).sort().reverse();
}

async function resolveCodexCommands() {
  if (cachedCodexCommands !== undefined) {
    return cachedCodexCommands;
  }

  const configured = process.env.CODEX_BIN?.trim() || process.env.CODEX_PATH?.trim();
  const commands = [];

  if (configured && (await commandExists(configured))) {
    appendUniqueCommand(commands, path.resolve(configured));
  }

  for (const command of await findCodexCommandsInCodexAppBin()) {
    appendUniqueCommand(commands, command);
  }

  for (const command of await findCodexCommandsOnPath()) {
    appendUniqueCommand(commands, command);
  }

  if (process.platform === "win32") {
    appendUniqueCommand(commands, "codex");
  }

  for (const command of await findCodexCommandsInWindowsApps()) {
    appendUniqueCommand(commands, command);
  }

  cachedCodexCommands = commands.map((entry) => ({
    command: entry.command,
    shell:
      process.platform === "win32" && entry.command === "codex"
        ? true
        : commandNeedsShell(entry.command),
  }));
  return cachedCodexCommands;
}

function readRateLimitsWithCommand(codexCommand) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutRemainder = "";
    let stderrText = "";

    const child = spawn(codexCommand.command, ["app-server", "--listen", "stdio://"], {
      cwd: process.cwd(),
      shell: codexCommand.shell,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      finish(null);
    }, APP_SERVER_TIMEOUT_MS);

    function finish(value, error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        child.kill();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    }

    child.on("error", (error) => finish(null, error));
    child.stderr.on("data", (data) => {
      stderrText += data.toString("utf8");
    });
    child.stdout.on("data", (data) => {
      stdoutRemainder += data.toString("utf8");
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() || "";

      parseJsonLines(lines.join("\n"), (message) => {
        if (message.id !== 2 || !message.result) {
          return;
        }

        const normalized = normalizeAppServerRateLimit(pickAppServerRateLimit(message.result));
        if (normalized) {
          finish(normalized);
        }
      });
    });
    child.on("exit", () => {
      if (!settled) {
        reject(new Error(stderrText || "Codex App 接口没有返回用量"));
      }
    });

    const initialize = {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex-ball",
          version: "1.0.0",
        },
        capabilities: null,
      },
    };
    const readRateLimits = {
      id: 2,
      method: "account/rateLimits/read",
      params: null,
    };

    child.stdin.write(`${JSON.stringify(initialize)}\n`);
    child.stdin.write(`${JSON.stringify(readRateLimits)}\n`);
  });
}

async function readRateLimitsFromAppServer() {
  const commands = await resolveCodexCommands();
  const orderedCommands = preferredCodexCommand
    ? [
        preferredCodexCommand,
        ...commands.filter((command) => command.command !== preferredCodexCommand.command),
      ]
    : commands;

  for (const codexCommand of orderedCommands) {
    try {
      const usage = await readRateLimitsWithCommand(codexCommand);
      if (usage) {
        preferredCodexCommand = codexCommand;
        return usage;
      }
    } catch {
      // 继续尝试下一个候选命令，最后再回退到本地记录。
    }
  }

  return null;
}

function normalizeUsage(record) {
  const rateLimits = record?.payload?.rate_limits;
  const info = record?.payload?.info;

  if (!rateLimits) {
    return null;
  }

  return {
    found: true,
    timestamp: record.timestamp || null,
    planType: rateLimits.plan_type || null,
    limitId: rateLimits.limit_id || null,
    primary: normalizeWindow(rateLimits.primary),
    secondary: normalizeWindow(rateLimits.secondary),
    rateLimitReachedType: rateLimits.rate_limit_reached_type || null,
    credits: rateLimits.credits || null,
    lastTokenUsage: info?.last_token_usage || null,
    totalTokenUsage: info?.total_token_usage || null,
    modelContextWindow: info?.model_context_window || null,
  };
}

async function collectSessionFiles(root, limit = MAX_SESSION_FILES) {
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }

        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
          return;
        }

        const stat = await fs.stat(fullPath);
        files.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
      }),
    );
  }

  await walk(root);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

async function readFileTail(file) {
  const handle = await fs.open(file.path, "r");
  try {
    const length = Math.min(file.size, READ_TAIL_BYTES);
    const start = Math.max(0, file.size - length);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function isNewerUsage(candidate, current) {
  const candidateTime = new Date(candidate?.timestamp || 0).getTime();
  const currentTime = new Date(current?.timestamp || 0).getTime();

  return candidateTime > currentTime;
}

function newestRateLimitCandidatesFromText(text) {
  const lines = text.split(/\r?\n/).reverse();
  let fallback = null;
  let preferred = null;

  for (const line of lines) {
    if (!line.includes('"rate_limits"')) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeUsage(parsed);
      if (normalized) {
        if (normalized.limitId === PREFERRED_LIMIT_ID) {
          preferred ??= normalized;
        } else {
          fallback ??= normalized;
        }

        if (preferred && fallback) {
          break;
        }
      }
    } catch {
      // A tail can start midway through a JSON line. Skip incomplete lines.
    }
  }

  return { fallback, preferred };
}

async function readLatestRateLimit() {
  try {
    const appServerUsage = await readRateLimitsFromAppServer();
    if (appServerUsage) {
      return appServerUsage;
    }
  } catch {
    // Fall back to local session records when the Codex App interface is unavailable.
  }

  const sessionsRoot = path.join(codexHome(), "sessions");
  const files = await collectSessionFiles(sessionsRoot);
  let preferredUsage = null;
  let fallbackUsage = null;

  for (const file of files) {
    const text = await readFileTail(file);
    const candidates = newestRateLimitCandidatesFromText(text);

    for (const usage of [candidates.preferred, candidates.fallback]) {
      if (!usage) {
        continue;
      }

      const usageWithSource = {
        ...usage,
        sourceFile: file.path,
      };

      if (usage.limitId === PREFERRED_LIMIT_ID) {
        if (!preferredUsage || isNewerUsage(usageWithSource, preferredUsage)) {
          preferredUsage = usageWithSource;
        }
        continue;
      }

      if (!fallbackUsage || isNewerUsage(usageWithSource, fallbackUsage)) {
        fallbackUsage = usageWithSource;
      }
    }
  }

  if (preferredUsage || fallbackUsage) {
    return preferredUsage || fallbackUsage;
  }

  return {
    found: false,
    message: "未检测到 Codex 用量记录",
  };
}

function emptyTokenUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    events: 0,
  };
}

function addTokenUsage(total, usage) {
  if (!usage || typeof usage !== "object") {
    return;
  }

  for (const key of [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ]) {
    total[key] += toNumber(usage[key]) ?? 0;
  }

  total.events += 1;
}

function localDayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

async function readTodayTokenUsage() {
  const sessionsRoot = path.join(codexHome(), "sessions");
  const files = await collectSessionFiles(sessionsRoot, 240);
  const { startMs, endMs } = localDayBounds();
  const total = emptyTokenUsage();

  for (const file of files) {
    if (file.mtimeMs < startMs - 60 * 60 * 1000) {
      continue;
    }

    let text;
    try {
      text = await fs.readFile(file.path, "utf8");
    } catch {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('"type":"token_count"') || !line.includes('"last_token_usage"')) {
        continue;
      }

      try {
        const parsed = JSON.parse(line);
        const timestampMs = new Date(parsed.timestamp).getTime();
        if (timestampMs >= startMs && timestampMs < endMs) {
          addTokenUsage(total, parsed.payload?.info?.last_token_usage);
        }
      } catch {
        // Ignore partially-written JSONL lines.
      }
    }
  }

  return total;
}

async function readCodexUsageFresh() {
  const [usage, todayTokenUsage] = await Promise.all([
    readLatestRateLimit(),
    readTodayTokenUsage(),
  ]);

  return {
    ...usage,
    todayTokenUsage,
    codexHome: codexHome(),
    readAt: new Date().toISOString(),
  };
}

async function readCodexUsage(options = {}) {
  const force = Boolean(options?.force);
  const now = Date.now();

  if (
    !force &&
    cachedUsage &&
    now - cachedUsage.cachedAt < USAGE_CACHE_TTL_MS
  ) {
    return {
      ...cachedUsage.value,
      readAt: new Date().toISOString(),
    };
  }

  if (!force && pendingUsageRead) {
    return pendingUsageRead;
  }

  const readPromise = readCodexUsageFresh()
    .then((usage) => {
      cachedUsage = {
        cachedAt: Date.now(),
        value: usage,
      };
      return usage;
    })
    .finally(() => {
      if (pendingUsageRead === readPromise) {
        pendingUsageRead = null;
      }
    });

  pendingUsageRead = readPromise;
  return readPromise;
}

module.exports = {
  readCodexUsage,
};
