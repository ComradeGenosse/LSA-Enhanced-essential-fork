const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { app } = require("electron");
const {
  copyFileSafe,
  exists,
  ensureInside
} = require("./utils");
const {
  configurePolicingRedefined
} = require("./config");

const PLACEHOLDER_NAMES = new Set([
  "PUT_LSA_FILES_HERE.txt"
]);

const CONFIG_RELATIVE_PATH = path.join(
  "plugins",
  "LosSantosAlive",
  "LosSantosAlive.config"
);

const SERVER_RELATIVE_PATH = path.join(
  "plugins",
  "LosSantosAliveServer"
);

const LSA_FOLDER_RELATIVE_PATH = path.join(
  "plugins",
  "LosSantosAlive"
);

/*
 * Known LSA-owned files that may live outside the two dedicated LSA folders.
 * These are safe to remove before copying a fresh payload.
 *
 * Add future standalone LSA DLLs here if their names/locations change.
 */
const KNOWN_LSA_FILES = [
  path.join("plugins", "LosSantosAlive.dll"),
  path.join("plugins", "LSPDFR", "LosSantosAlive.Interop.dll"),
  path.join("plugins", "LSPDFR", "LosSantosAlive.PRBridge.dll")
];

const INSTALL_MANIFEST_RELATIVE_PATH = path.join(
  "plugins",
  "LosSantosAlive",
  ".installer-manifest.json"
);

function payloadRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "payload")
    : path.join(__dirname, "..", "..", "payload");
}

async function listFilesRecursive(rootDir) {
  if (!(await exists(rootDir))) return [];

  const output = [];

  async function walk(current, relative = "") {
    const entries = await fsp.readdir(current, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.join(relative, entry.name);

      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (
        entry.isFile() &&
        !PLACEHOLDER_NAMES.has(entry.name)
      ) {
        output.push({
          source: full,
          relative: rel
        });
      }
    }
  }

  await walk(rootDir);
  return output;
}

async function copyPayloadGroup(
  groupDir,
  gtaPath
) {
  const files = await listFilesRecursive(groupDir);
  let copied = 0;

  for (const file of files) {
    const destination = ensureInside(
      gtaPath,
      path.join(gtaPath, file.relative)
    );

    await copyFileSafe(file.source, destination);
    copied += 1;
  }

  return copied;
}

async function removePathIfExists(targetPath) {
  if (!(await exists(targetPath))) return;

  await fsp.rm(targetPath, {
    recursive: true,
    force: true
  });
}

async function readPreservedConfig(gtaPath) {
  const configPath = ensureInside(
    gtaPath,
    path.join(gtaPath, CONFIG_RELATIVE_PATH)
  );

  if (!(await exists(configPath))) {
    return null;
  }

  return await fsp.readFile(configPath);
}

async function restorePreservedConfig(
  gtaPath,
  configBuffer
) {
  if (!configBuffer) return;

  const configPath = ensureInside(
    gtaPath,
    path.join(gtaPath, CONFIG_RELATIVE_PATH)
  );

  await fsp.mkdir(path.dirname(configPath), {
    recursive: true
  });

  await fsp.writeFile(configPath, configBuffer);
}

async function readPreviousManifest(gtaPath) {
  const manifestPath = ensureInside(
    gtaPath,
    path.join(gtaPath, INSTALL_MANIFEST_RELATIVE_PATH)
  );

  if (!(await exists(manifestPath))) {
    return [];
  }

  try {
    const raw = await fsp.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.files)) {
      return [];
    }

    return parsed.files
      .filter(value => typeof value === "string")
      .map(value => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function removePreviouslyManagedFiles(
  gtaPath,
  previousManifest
) {
  for (const relative of previousManifest) {
    const normalized = path.normalize(relative);

    /*
     * The user's config is the one file we never remove as part of an update.
     * The whole LosSantosAlive folder is recreated separately after preserving
     * the config in memory.
     */
    if (
      normalized.toLowerCase() ===
      path.normalize(CONFIG_RELATIVE_PATH).toLowerCase()
    ) {
      continue;
    }

    const target = ensureInside(
      gtaPath,
      path.join(gtaPath, normalized)
    );

    try {
      await removePathIfExists(target);
    } catch {
      /*
       * Continue cleanup. A later copy will still overwrite matching files,
       * and install errors will surface if a required destination cannot be
       * written.
       */
    }
  }
}

async function cleanExistingLsaInstall(
  gtaPath,
  previousManifest
) {
  /*
   * First remove files recorded by previous installer versions. This handles
   * stale files that used to be shipped but are no longer in today's payload.
   */
  await removePreviouslyManagedFiles(
    gtaPath,
    previousManifest
  );

  /*
   * LosSantosAliveServer must ALWAYS be a clean replacement. Never merge a
   * new server payload over an old folder.
   */
  const serverPath = ensureInside(
    gtaPath,
    path.join(gtaPath, SERVER_RELATIVE_PATH)
  );

  await removePathIfExists(serverPath);

  /*
   * The local LSA plugin folder is also recreated from scratch. The config is
   * preserved separately in memory and restored after the new payload copy.
   */
  const lsaFolderPath = ensureInside(
    gtaPath,
    path.join(gtaPath, LSA_FOLDER_RELATIVE_PATH)
  );

  await removePathIfExists(lsaFolderPath);

  /*
   * Handle installs made before the manifest existed, and guarantee bridge /
   * core DLL replacement even if an old payload contained them but the current
   * payload no longer does.
   */
  for (const relative of KNOWN_LSA_FILES) {
    const target = ensureInside(
      gtaPath,
      path.join(gtaPath, relative)
    );

    await removePathIfExists(target);
  }
}

async function writeInstallManifest(
  gtaPath,
  files
) {
  const manifestPath = ensureInside(
    gtaPath,
    path.join(gtaPath, INSTALL_MANIFEST_RELATIVE_PATH)
  );

  await fsp.mkdir(path.dirname(manifestPath), {
    recursive: true
  });

  const uniqueFiles = Array.from(
    new Set(
      files
        .map(file => path.normalize(file.relative))
        .filter(relative =>
          relative.toLowerCase() !==
          path.normalize(CONFIG_RELATIVE_PATH).toLowerCase()
        )
    )
  ).sort((a, b) => a.localeCompare(b));

  await fsp.writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        files: uniqueFiles
      },
      null,
      2
    ),
    "utf8"
  );
}

async function installLsa(gtaPath, mode) {
  const root = payloadRoot();
  const commonDir = path.join(root, "common");
  const modeDir = path.join(
    root,
    mode === "lspdfr" ? "lspdfr" : "story"
  );

  const commonFiles = await listFilesRecursive(commonDir);
  const modeFiles = await listFilesRecursive(modeDir);

  if (commonFiles.length + modeFiles.length === 0) {
    throw new Error(
      "No Los Santos Alive payload files were found. Put the release files in payload/common and optional mode-specific files in payload/story or payload/lspdfr before building the installer."
    );
  }

  /*
   * Preserve the ONLY user-owned update state before touching the existing
   * installation.
   */
  const preservedConfig = await readPreservedConfig(gtaPath);
  const previousManifest = await readPreviousManifest(gtaPath);

  /*
   * Important: clean BEFORE copying. This prevents legacy server files,
   * obsolete bridge files, old JS, old node_modules, etc. from surviving an
   * upgrade just because the new payload no longer contains them.
   */
  await cleanExistingLsaInstall(
    gtaPath,
    previousManifest
  );

  const copiedCommon = await copyPayloadGroup(
    commonDir,
    gtaPath
  );

  const copiedMode = await copyPayloadGroup(
    modeDir,
    gtaPath
  );

  /*
   * Restore the user's existing config after the fresh payload has been laid
   * down. This intentionally overrides any default config shipped in payload.
   */
  await restorePreservedConfig(
    gtaPath,
    preservedConfig
  );

  /*
   * Policing Redefined draws its own orange ped-selection markers.
   * LSA provides its own selection indicator, so disable PR's overlapping
   * stopped-ped / traffic-stop occupant markers when PR is installed.
   *
   * The helper is intentionally non-destructive when PR is absent.
   */
  const policingRedefinedConfig =
    await configurePolicingRedefined(gtaPath);

  /*
   * Record exactly what this installer owns so the next update can remove
   * files that disappear from future releases instead of leaving stale junk.
   */
  await writeInstallManifest(
    gtaPath,
    commonFiles.concat(modeFiles)
  );

  return {
    success: true,
    copiedFiles: copiedCommon + copiedMode,
    commonFiles: copiedCommon,
    modeFiles: copiedMode,
    preservedConfig: Boolean(preservedConfig),
    policingRedefinedConfigured:
      Boolean(policingRedefinedConfig?.configured),
    message:
      `Installed ${copiedCommon + copiedMode} Los Santos Alive file(s). ` +
      "Existing LosSantosAliveServer content was replaced with a clean copy."
  };
}

module.exports = {
  installLsa,
  payloadRoot,
  listFilesRecursive
};
