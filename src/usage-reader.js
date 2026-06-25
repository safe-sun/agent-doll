const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const MAX_SESSION_FILES = 80;
const READ_TAIL_BYTES = 1024 * 1024;

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectSessionFiles(root) {
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
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSION_FILES);
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

async function readPetImage() {
  const petsRoot = path.join(codexHome(), "pets");
  const preferred = [
    path.join(petsRoot, "capoo", "spritesheet.webp"),
    path.join(petsRoot, "frieren-5", "spritesheet.webp"),
    path.join(petsRoot, "aoi", "spritesheet.webp"),
  ];

  for (const imagePath of preferred) {
    if (await pathExists(imagePath)) {
      return {
        path: imagePath,
        url: pathToFileURL(imagePath).toString(),
      };
    }
  }

  return null;
}

async function readCodexUsage() {
  const [usage, petImage] = await Promise.all([readLatestRateLimit(), readPetImage()]);

  return {
    ...usage,
    petImage,
    codexHome: codexHome(),
    readAt: new Date().toISOString(),
  };
}

module.exports = {
  readCodexUsage,
};
