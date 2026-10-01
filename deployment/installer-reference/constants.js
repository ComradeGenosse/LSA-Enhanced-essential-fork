const path = require("path");

const MODES = Object.freeze({
  STORY: "story",
  LSPDFR: "lspdfr"
});

const DEPENDENCIES = Object.freeze({
  ragePluginHook: {
    label: "RAGE Plugin Hook",
    description: "Essential for all RPH mods.",
    relativePath: "RAGEPluginHook.exe",
    requiredFor: [MODES.STORY, MODES.LSPDFR]
  },
  damageTrackingFramework: {
    label: "Damage Tracking Framework",
    description: "Required for LSA features.",
    relativePath: path.join("plugins", "DamageTrackingFramework.dll"),
    requiredFor: [MODES.STORY, MODES.LSPDFR]
  },
  lspdfr: {
    label: "LSPDFR",
    description: "Base framework for law enforcement.",
    relativePath: path.join("plugins", "LSPD First Response.dll"),
    requiredFor: [MODES.LSPDFR]
  },
  policingRedefined: {
    label: "Policing Redefined",
    description: "Core plugin for LSA functionality.",
    relativePath: path.join("plugins", "lspdfr", "PolicingRedefined.dll"),
    requiredFor: [MODES.LSPDFR]
  }
});

const NPCI_DLL = path.join("plugins", "lspdfr", "NPCI.dll");
const NPCI_INI = path.join("plugins", "lspdfr", "NPCI.ini");
const STOP_THE_PED_DLL = path.join("plugins", "lspdfr", "StopThePed.dll");

const LSA_CONFIG = path.join(
  "plugins",
  "lossantosalive",
  "LosSantosAlive.config"
);

const LSA_SERVER_ENV = path.join(
  "plugins",
  "lossantosaliveserver",
  ".env"
);

module.exports = {
  MODES,
  DEPENDENCIES,
  NPCI_DLL,
  NPCI_INI,
  STOP_THE_PED_DLL,
  LSA_CONFIG,
  LSA_SERVER_ENV
};
