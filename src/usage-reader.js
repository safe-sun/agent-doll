const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const MAX_SESSION_FILES = 120;
const READ_TAIL_BYTES = 1024 * 1024;
const APP_SERVER_TIMEOUT_MS = 8000;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

  const usedPercent = Math.max(0, Math.min(100, toNumber(window.used_percent) ?? 0));

  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowMinutes: toNumber(window.window_minutes),
    resetsAt: formatEpochSeconds(window.resets_at),
  };
}

function normalizeAppServerWindow(window) {
  if (!window || typeof window !== "object") {
    return null;
  }

  const usedPercent = Math.max(0, Math.min(100, toNumber(window.usedPercent) ?? 0));

  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowMinutes: toNumber(window.windowDurationMins),
    resetsAt: formatEpochSeconds(window.resetsAt),
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
    planType: snapshot.planType || null,
    limitId: snapshot.limitId || null,
    limitName: snapshot.limitName || null,
    primary: normalizeAppServerWindow(snapshot.primary),
    secondary: normalizeAppServerWindow(snapshot.secondary),
    rateLimitReachedType: snapshot.rateLimitReachedType || null,
    credits: snapshot.credits || null,
  };
}

function pickAppServerRateLimit(result) {
  const byLimitId = result?.rateLimitsByLimitId;

  if (byLimitId?.codex) {
    return byLimitId.codex;
  }

  return result?.rateLimits || null;
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

function readRateLimitsFromAppServer() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutRemainder = "";
    let stderrText = "";

    const child = spawn("codex app-server --listen stdio://", {
      cwd: process.cwd(),
      shell: true,
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
          name: "agent-doll",
          version: "0.1.0",
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

function newestRateLimitFromText(text) {
  const lines = text.split(/\r?\n/).reverse();

  for (const line of lines) {
    if (!line.includes('"rate_limits"')) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeUsage(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      // A tail can start midway through a JSON line. Skip incomplete lines.
    }
  }

  return null;
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

  for (const file of files) {
    const text = await readFileTail(file);
    const usage = newestRateLimitFromText(text);

    if (usage) {
      return {
        ...usage,
        sourceFile: file.path,
      };
    }
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

async function readCodexUsage() {
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

module.exports = {
  readCodexUsage,
};
