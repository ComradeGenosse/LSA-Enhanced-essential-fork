const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

async function exists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    return (await fsp.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function normalizeFsPath(value) {
  if (!value || typeof value !== "string") return "";
  return path.normalize(value.trim().replace(/^"(.*)"$/, "$1"));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function ensureInside(basePath, candidatePath) {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(base, candidate);

  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return candidate;
  }

  throw new Error("Refusing to write outside the GTA V directory.");
}

async function copyFileSafe(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

async function copyDirectoryContents(sourceDir, destinationDir, shouldInclude) {
  let copied = 0;

  async function walk(currentSource, relative = "") {
    const entries = await fsp.readdir(currentSource, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name);
      const relativePath = path.join(relative, entry.name);

      if (entry.isDirectory()) {
        await walk(sourcePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldInclude && !shouldInclude(relativePath)) continue;

      const destinationPath = ensureInside(
        destinationDir,
        path.join(destinationDir, relativePath)
      );

      await copyFileSafe(sourcePath, destinationPath);
      copied += 1;
    }
  }

  await walk(sourceDir);
  return copied;
}

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

module.exports = {
  exists,
  isDirectory,
  normalizeFsPath,
  uniqueBy,
  ensureInside,
  copyFileSafe,
  copyDirectoryContents,
  timestampForFileName
};
