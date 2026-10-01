const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const AdmZip = require("adm-zip");
const { DEPENDENCIES } = require("./constants");
const {
  exists,
  isDirectory,
  ensureInside,
  copyFileSafe
} = require("./utils");

const FILE_NAME_DESTINATIONS = new Map(
  Object.values(DEPENDENCIES).map((dependency) => [
    path.basename(dependency.relativePath).toLowerCase(),
    dependency.relativePath
  ])
);

const MARKERS = Object.entries(DEPENDENCIES).map(
  ([id, dependency]) => ({
    id,
    label: dependency.label,
    normalizedRelative: dependency.relativePath
      .replace(/\\/g, "/")
      .toLowerCase()
  })
);

function normalizeArchivePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function isSafeArchiveRelative(value) {
  const normalized = normalizeArchivePath(value);

  if (!normalized) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;

  const segments = normalized.split("/");
  return !segments.some((segment) => segment === "..");
}

function findMarkerInNormalizedPath(normalizedLowerPath) {
  for (const marker of MARKERS) {
    if (
      normalizedLowerPath === marker.normalizedRelative ||
      normalizedLowerPath.endsWith(
        `/${marker.normalizedRelative}`
      )
    ) {
      return marker;
    }
  }

  return null;
}

function packageBaseForMarker(entryPath, marker) {
  const normalized = normalizeArchivePath(entryPath);
  const lower = normalized.toLowerCase();
  const markerLower = marker.normalizedRelative;
  const index = lower.lastIndexOf(markerLower);

  if (index < 0) return "";

  return normalized.slice(0, index);
}

function relativeFromPackageBase(entryPath, packageBase) {
  const normalized = normalizeArchivePath(entryPath);

  if (!packageBase) return normalized;

  const normalizedBase = normalizeArchivePath(packageBase);
  if (!normalized.startsWith(normalizedBase)) return null;

  return normalized.slice(normalizedBase.length).replace(/^\/+/, "");
}

function choosePackageBase(markerHits) {
  if (!markerHits.length) return null;

  const sorted = markerHits
    .map((hit) => hit.base)
    .sort((a, b) => {
      const aSegments = normalizeArchivePath(a)
        .split("/")
        .filter(Boolean).length;
      const bSegments = normalizeArchivePath(b)
        .split("/")
        .filter(Boolean).length;
      return aSegments - bSegments;
    });

  return sorted[0];
}

async function installSingleDependencyFile(gtaPath, sourcePath) {
  const fileName = path.basename(sourcePath).toLowerCase();
  const relativeDestination = FILE_NAME_DESTINATIONS.get(fileName);

  if (!relativeDestination) {
    return {
      success: false,
      source: sourcePath,
      message: `${path.basename(sourcePath)} is not a recognized dependency file.`
    };
  }

  const destination = ensureInside(
    gtaPath,
    path.join(gtaPath, relativeDestination)
  );

  await copyFileSafe(sourcePath, destination);

  return {
    success: true,
    source: sourcePath,
    copied: 1,
    destination,
    message: `${path.basename(sourcePath)} installed.`
  };
}

async function installZipPackage(gtaPath, zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const markerHits = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const normalized = normalizeArchivePath(entry.entryName);
    const marker = findMarkerInNormalizedPath(
      normalized.toLowerCase()
    );

    if (marker) {
      markerHits.push({
        marker,
        entry: normalized,
        base: packageBaseForMarker(normalized, marker)
      });
    }
  }

  if (!markerHits.length) {
    return {
      success: false,
      source: zipPath,
      message: "ZIP does not contain a recognized GTA V dependency marker."
    };
  }

  const packageBase = choosePackageBase(markerHits);
  let copied = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const archivePath = normalizeArchivePath(entry.entryName);
    if (!isSafeArchiveRelative(archivePath)) continue;

    const relative = relativeFromPackageBase(
      archivePath,
      packageBase
    );

    if (!relative || !isSafeArchiveRelative(relative)) continue;

    const destination = ensureInside(
      gtaPath,
      path.join(gtaPath, ...relative.split("/"))
    );

    await fsp.mkdir(path.dirname(destination), {
      recursive: true
    });

    await fsp.writeFile(destination, entry.getData());
    copied += 1;
  }

  return {
    success: true,
    source: zipPath,
    copied,
    detectedDependencies: [
      ...new Set(markerHits.map((hit) => hit.marker.label))
    ],
    message: `Installed ${copied} file(s) from ${path.basename(zipPath)}.`
  };
}

async function walkDirectory(rootDir) {
  const files = [];

  async function walk(current) {
    const entries = await fsp.readdir(current, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

function packageRootForDirectoryFile(filePath, marker) {
  const normalized = filePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const markerLower = marker.normalizedRelative;
  const index = lower.lastIndexOf(markerLower);

  if (index < 0) return null;

  return normalized.slice(0, index).replace(/\/$/, "");
}

async function installDirectoryPackage(gtaPath, sourceDir) {
  const packageFiles = await walkDirectory(sourceDir);
  const markerHits = [];

  for (const filePath of packageFiles) {
    const normalizedLower = filePath
      .replace(/\\/g, "/")
      .toLowerCase();

    const marker = findMarkerInNormalizedPath(normalizedLower);

    if (marker) {
      markerHits.push({
        marker,
        filePath,
        root: packageRootForDirectoryFile(
          filePath,
          marker
        )
      });
    }
  }

  if (!markerHits.length) {
    return {
      success: false,
      source: sourceDir,
      message: "Folder does not contain a recognized GTA V dependency marker."
    };
  }

  const roots = markerHits
    .map((hit) => hit.root)
    .filter(Boolean)
    .sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length);

  const packageRoot = roots[0] || sourceDir;
  let copied = 0;

  for (const sourcePath of packageFiles) {
    const relative = path.relative(packageRoot, sourcePath);

    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      continue;
    }

    const destination = ensureInside(
      gtaPath,
      path.join(gtaPath, relative)
    );

    await copyFileSafe(sourcePath, destination);
    copied += 1;
  }

  return {
    success: true,
    source: sourceDir,
    copied,
    detectedDependencies: [
      ...new Set(markerHits.map((hit) => hit.marker.label))
    ],
    message: `Installed ${copied} file(s) from ${path.basename(sourceDir)}.`
  };
}

async function installDependencyPaths(gtaPath, sourcePaths) {
  const results = [];

  for (const sourcePath of sourcePaths || []) {
    try {
      if (!(await exists(sourcePath))) {
        results.push({
          success: false,
          source: sourcePath,
          message: "Source path no longer exists."
        });
        continue;
      }

      if (await isDirectory(sourcePath)) {
        results.push(
          await installDirectoryPackage(gtaPath, sourcePath)
        );
        continue;
      }

      if (path.extname(sourcePath).toLowerCase() === ".zip") {
        results.push(
          await installZipPackage(gtaPath, sourcePath)
        );
        continue;
      }

      results.push(
        await installSingleDependencyFile(gtaPath, sourcePath)
      );
    } catch (error) {
      results.push({
        success: false,
        source: sourcePath,
        message: error.message
      });
    }
  }

  return {
    results,
    success:
      results.length > 0 &&
      results.some((item) => item.success)
  };
}

module.exports = {
  installDependencyPaths,
  normalizeArchivePath,
  isSafeArchiveRelative,
  findMarkerInNormalizedPath
};
