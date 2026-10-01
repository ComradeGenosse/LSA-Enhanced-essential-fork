const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const {
  exists,
  normalizeFsPath,
  uniqueBy
} = require("./utils");

const execFileAsync = promisify(execFile);

const STEAM_LEGACY_APP_ID = "271590";
const STEAM_ENHANCED_APP_ID = "3240220";

async function validateGtaDirectory(folderPath, source = {}) {
  const normalized = normalizeFsPath(folderPath);

  if (!normalized || !(await exists(normalized))) {
    return {
      valid: false,
      path: normalized,
      edition: null,
      platform: source.platform || "Manual",
      reason: "Folder does not exist."
    };
  }

  const stats = await fsp.stat(normalized).catch(() => null);
  if (!stats?.isDirectory()) {
    return {
      valid: false,
      path: normalized,
      edition: null,
      platform: source.platform || "Manual",
      reason: "Selected path is not a folder."
    };
  }

  const enhancedExe = path.join(normalized, "GTA5_Enhanced.exe");
  const legacyCandidates = [
    path.join(normalized, "GTA5.exe"),
    path.join(normalized, "GTAV.exe")
  ];

  const hasEnhancedExe = await exists(enhancedExe);
  let hasLegacyExe = false;

  for (const candidate of legacyCandidates) {
    if (await exists(candidate)) {
      hasLegacyExe = true;
      break;
    }
  }

  const hasGameContent =
    (await exists(path.join(normalized, "x64"))) ||
    (await exists(path.join(normalized, "update"))) ||
    (await exists(path.join(normalized, "x64a.rpf")));

  if (!hasEnhancedExe && !hasLegacyExe) {
    return {
      valid: false,
      path: normalized,
      edition: null,
      platform: source.platform || "Manual",
      reason: "No GTA V game executable was found in this folder."
    };
  }

  if (!hasGameContent) {
    return {
      valid: false,
      path: normalized,
      edition: null,
      platform: source.platform || "Manual",
      reason: "The folder contains a GTA executable but does not look like a complete GTA V installation."
    };
  }

  let edition;

  if (hasEnhancedExe && !hasLegacyExe) {
    edition = "Enhanced";
  } else if (hasLegacyExe && !hasEnhancedExe) {
    edition = "Legacy";
  } else {
    const hint = String(source.editionHint || source.displayName || "").toLowerCase();
    edition = hint.includes("enhanced") ? "Enhanced" : "Legacy";
  }

  return {
    valid: true,
    path: normalized,
    edition,
    platform: source.platform || "Manual",
    displayName:
      edition === "Legacy"
        ? "Grand Theft Auto V (Legacy)"
        : "Grand Theft Auto V Enhanced",
    reason: null
  };
}

async function queryRegistryValue(key, valueName, regView) {
  if (process.platform !== "win32") return null;

  const args = ["query", key, "/v", valueName];
  if (regView) args.push(`/reg:${regView}`);

  try {
    const { stdout } = await execFileAsync("reg.exe", args, {
      windowsHide: true
    });

    const pattern = new RegExp(
      `^\\s*${escapeRegExp(valueName)}\\s+REG_\\w+\\s+(.+)$`,
      "mi"
    );

    const match = stdout.match(pattern);
    return match ? normalizeFsPath(match[1]) : null;
  } catch {
    return null;
  }
}

async function queryRegistryTree(key, regView) {
  if (process.platform !== "win32") return "";

  const args = ["query", key, "/s"];
  if (regView) args.push(`/reg:${regView}`);

  try {
    const { stdout } = await execFileAsync("reg.exe", args, {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return stdout;
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseVdfQuotedValue(content, key) {
  const pattern = new RegExp(
    `"${escapeRegExp(key)}"\\s*"((?:\\\\.|[^"])*)"`,
    "i"
  );

  const match = content.match(pattern);
  if (!match) return null;

  return match[1]
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"');
}

async function detectSteamRoot() {
  const candidates = [];

  for (const regView of ["64", "32"]) {
    for (const [key, value] of [
      ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
      ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"],
      ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"]
    ]) {
      const found = await queryRegistryValue(key, value, regView);
      if (found) candidates.push(found);
    }
  }

  if (process.env["ProgramFiles(x86)"]) {
    candidates.push(
      path.join(process.env["ProgramFiles(x86)"], "Steam")
    );
  }

  for (const candidate of uniqueBy(
    candidates,
    (value) => value.toLowerCase()
  )) {
    if (await exists(path.join(candidate, "steamapps"))) {
      return candidate;
    }
  }

  return null;
}

async function getSteamLibraries() {
  const steamRoot = await detectSteamRoot();
  if (!steamRoot) return [];

  const libraries = [steamRoot];
  const libraryFile = path.join(
    steamRoot,
    "steamapps",
    "libraryfolders.vdf"
  );

  if (await exists(libraryFile)) {
    const content = await fsp.readFile(libraryFile, "utf8");
    const pathMatches = content.matchAll(
      /"path"\s*"((?:\\.|[^"])*)"/gi
    );

    for (const match of pathMatches) {
      const libraryPath = match[1]
        .replace(/\\\\/g, "\\")
        .replace(/\\"/g, '"');

      if (libraryPath) libraries.push(path.normalize(libraryPath));
    }
  }

  return uniqueBy(
    libraries,
    (value) => path.resolve(value).toLowerCase()
  );
}

async function detectSteamInstallations() {
  const libraries = await getSteamLibraries();
  const results = [];

  for (const library of libraries) {
    const steamApps = path.join(library, "steamapps");
    if (!(await exists(steamApps))) continue;

    let manifests = [];

    try {
      manifests = (await fsp.readdir(steamApps))
        .filter((name) => /^appmanifest_\d+\.acf$/i.test(name));
    } catch {
      continue;
    }

    for (const manifestName of manifests) {
      const manifestPath = path.join(steamApps, manifestName);
      let content;

      try {
        content = await fsp.readFile(manifestPath, "utf8");
      } catch {
        continue;
      }

      const appId = parseVdfQuotedValue(content, "appid");
      const name = parseVdfQuotedValue(content, "name") || "";
      const installDir = parseVdfQuotedValue(content, "installdir");

      const isKnownGta =
        appId === STEAM_LEGACY_APP_ID ||
        appId === STEAM_ENHANCED_APP_ID ||
        /grand theft auto v/i.test(name);

      if (!isKnownGta || !installDir) continue;

      const candidate = path.join(
        steamApps,
        "common",
        installDir
      );

      results.push({
        path: candidate,
        platform: "Steam",
        displayName: name,
        editionHint:
          appId === STEAM_ENHANCED_APP_ID ||
          /enhanced/i.test(name)
            ? "Enhanced"
            : appId === STEAM_LEGACY_APP_ID
              ? "Legacy"
              : null
      });
    }
  }

  return results;
}

async function detectEpicInstallations() {
  const programData =
    process.env.ProgramData || "C:\\ProgramData";

  const manifestDir = path.join(
    programData,
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests"
  );

  if (!(await exists(manifestDir))) return [];

  let entries;

  try {
    entries = await fsp.readdir(manifestDir, {
      withFileTypes: true
    });
  } catch {
    return [];
  }

  const results = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".item")) {
      continue;
    }

    try {
      const content = await fsp.readFile(
        path.join(manifestDir, entry.name),
        "utf8"
      );

      const manifest = JSON.parse(content);
      const displayName = String(
        manifest.DisplayName ||
        manifest.AppName ||
        ""
      );

      const installLocation = manifest.InstallLocation;

      if (
        installLocation &&
        /grand theft auto v/i.test(displayName)
      ) {
        results.push({
          path: installLocation,
          platform: "Epic Games",
          displayName,
          editionHint: /enhanced/i.test(displayName)
            ? "Enhanced"
            : null
        });
      }
    } catch {
      // Ignore malformed/unrelated Epic manifests.
    }
  }

  return results;
}

function parseRockstarRegistryTree(output) {
  const results = [];
  let currentKey = "";

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (/^HKEY_/i.test(line.trim())) {
      currentKey = line.trim();
      continue;
    }

    if (!/grand theft auto v/i.test(currentKey)) continue;

    const match = line.match(
      /^\s*(InstallFolder|InstallLocation|InstallDir)\s+REG_\w+\s+(.+)$/i
    );

    if (!match) continue;

    results.push({
      path: normalizeFsPath(match[2]),
      platform: "Rockstar Games Launcher",
      displayName: currentKey,
      editionHint: /enhanced/i.test(currentKey)
        ? "Enhanced"
        : null
    });
  }

  return results;
}

async function detectRockstarInstallations() {
  const results = [];

  const roots = [
    "HKLM\\SOFTWARE\\Rockstar Games",
    "HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games",
    "HKCU\\SOFTWARE\\Rockstar Games"
  ];

  for (const root of roots) {
    for (const regView of ["64", "32"]) {
      const output = await queryRegistryTree(root, regView);
      if (output) {
        results.push(...parseRockstarRegistryTree(output));
      }
    }
  }

  return results;
}

function platformRank(platform) {
  switch (platform) {
    case "Steam":
      return 0;
    case "Epic Games":
      return 1;
    case "Rockstar Games Launcher":
      return 2;
    default:
      return 3;
  }
}

async function detectAllGtaInstallations() {
  const candidateGroups = await Promise.all([
    detectSteamInstallations(),
    detectEpicInstallations(),
    detectRockstarInstallations()
  ]);

  const rawCandidates = candidateGroups.flat();
  const validated = [];

  for (const candidate of rawCandidates) {
    const result = await validateGtaDirectory(
      candidate.path,
      candidate
    );

    if (result.valid) validated.push(result);
  }

  const unique = uniqueBy(
    validated,
    (item) => path.resolve(item.path).toLowerCase()
  );

  unique.sort((a, b) => {
    const editionDifference =
      (a.edition === "Legacy" ? 0 : 1) -
      (b.edition === "Legacy" ? 0 : 1);

    if (editionDifference !== 0) return editionDifference;

    return platformRank(a.platform) - platformRank(b.platform);
  });

  return {
    installations: unique,
    selected: unique[0] || null
  };
}

module.exports = {
  validateGtaDirectory,
  detectAllGtaInstallations,
  parseVdfQuotedValue,
  parseRockstarRegistryTree
};
