const fsp = require("fs").promises;
const path = require("path");
const {
  DEPENDENCIES,
  NPCI_DLL,
  STOP_THE_PED_DLL
} = require("./constants");
const {
  exists,
  timestampForFileName
} = require("./utils");

const ULTIMATE_BACKUP_DLL = "plugins/LSPDFR/UltimateBackup.dll";

async function scanRequirements(gtaPath, mode) {
  const dependencies = {};

  for (const [id, dependency] of Object.entries(DEPENDENCIES)) {
    const installed = await exists(
      path.join(gtaPath, dependency.relativePath)
    );

    dependencies[id] = {
      id,
      label: dependency.label,
      description: dependency.description,
      relativePath: dependency.relativePath,
      required: dependency.requiredFor.includes(mode),
      installed
    };
  }

  const npciPath = path.join(gtaPath, NPCI_DLL);
  const stopThePedPath = path.join(gtaPath, STOP_THE_PED_DLL);
  const ultimateBackupPath = path.join(gtaPath, ULTIMATE_BACKUP_DLL);

  const npciDetected = await exists(npciPath);
  const stopThePedDetected = await exists(stopThePedPath);
  const ultimateBackupDetected = await exists(ultimateBackupPath);

  const allRequiredInstalled = Object.values(dependencies)
    .filter((item) => item.required)
    .every((item) => item.installed);

  return {
    dependencies,
    conflicts: {
      npci: {
        id: "npci",
        label: "NPCAI",
        description: "Conflicts with LSA’s AI system.",
        detected: npciDetected,
        path: npciPath
      },
      stopThePed: {
        id: "stopThePed",
        label: "Stop The Ped",
        description: "Conflicts with LSA’s interaction system.",
        detected: stopThePedDetected,
        path: stopThePedPath
      },
      ultimateBackup: {
        id: "ultimateBackup",
        label: "Ultimate Backup",
        description: "Conflicts with LSA’s backup integration.",
        detected: ultimateBackupDetected,
        path: ultimateBackupPath
      }
    },
    allRequiredInstalled
  };
}

async function disableConflict(gtaPath, relativePath, fileLabel) {
  const source = path.join(gtaPath, relativePath);

  if (!(await exists(source))) {
    return {
      success: true,
      moved: false,
      message: `${fileLabel} is not present.`
    };
  }

  const destinationDir = path.join(
    gtaPath,
    "disabled",
    path.dirname(relativePath)
  );

  await fsp.mkdir(destinationDir, { recursive: true });

  let destination = path.join(destinationDir, path.basename(relativePath));

  if (await exists(destination)) {
    const parsed = path.parse(relativePath);
    destination = path.join(
      destinationDir,
      `${parsed.name}.disabled-${timestampForFileName()}${parsed.ext}`
    );
  }

  await fsp.rename(source, destination);

  return {
    success: true,
    moved: true,
    destination,
    message: `${fileLabel} moved to ${destination}`
  };
}

async function disableNpci(gtaPath) {
  return disableConflict(gtaPath, NPCI_DLL, "NPCI.dll");
}

async function disableStopThePed(gtaPath) {
  return disableConflict(gtaPath, STOP_THE_PED_DLL, "StopThePed.dll");
}

async function disableUltimateBackup(gtaPath) {
  return disableConflict(
    gtaPath,
    ULTIMATE_BACKUP_DLL,
    "UltimateBackup.dll"
  );
}

module.exports = {
  scanRequirements,
  disableConflict,
  disableNpci,
  disableStopThePed,
  disableUltimateBackup
};
