const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { LSA_CONFIG, NPCI_INI } = require("./constants");
const { exists } = require("./utils");


const POLICING_REDEFINED_INTERACTION_SETTINGS = path.join(
  "plugins",
  "lspdfr",
  "PolicingRedefined",
  "Settings",
  "InteractionSettings.ini"
);

function getConfigValue(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Only allow horizontal whitespace around the assignment.
  // \s also matches CR/LF and can make a blank Key= consume the next line.
  const match = content.match(
    new RegExp(`^[ \\t]*${escaped}[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, "mi")
  );

  return match ? match[1].trim() : null;
}

function setConfigValue(content, key, value) {
  const normalizedValue = String(value ?? "").trim();
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // IMPORTANT: [ \t]* is intentional. \s* also consumes newlines, which
  // caused values such as ApiKey / Language to be written on the next line.
  const pattern = new RegExp(
    `^([ \\t]*${escaped}[ \\t]*=[ \\t]*).*$`,
    "mi"
  );

  if (pattern.test(content)) {
    // Function replacer avoids treating $ characters in values as replacement tokens.
    return content.replace(
      pattern,
      (_match, prefix) => `${prefix}${normalizedValue}`
    );
  }

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const trimmed = content.replace(/\s*$/, "");

  return trimmed
    ? `${trimmed}${newline}${key}=${normalizedValue}${newline}`
    : `${key}=${normalizedValue}${newline}`;
}

function normalizeImportedTalkKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const aliases = {
    xbutton1: "Mouse4",
    xbutton2: "Mouse5",
    mousebutton4: "Mouse4",
    mousebutton5: "Mouse5"
  };

  return aliases[raw.toLowerCase()] || raw;
}

async function readNpciTalkKey(gtaPath) {
  const npciPath = path.join(gtaPath, NPCI_INI);

  if (!(await exists(npciPath))) {
    return {
      found: false,
      path: npciPath,
      talkKey: null
    };
  }

  try {
    const content = await fsp.readFile(npciPath, "utf8");
    const talkKey = normalizeImportedTalkKey(
      getConfigValue(content, "Keybind")
    );

    return {
      found: Boolean(talkKey),
      path: npciPath,
      talkKey
    };
  } catch {
    return {
      found: false,
      path: npciPath,
      talkKey: null
    };
  }
}

async function loadConfig(gtaPath) {
  const configPath = path.join(gtaPath, LSA_CONFIG);
  const npci = await readNpciTalkKey(gtaPath);

  if (!(await exists(configPath))) {
    return {
      exists: false,
      path: configPath,
      talkKey: npci.talkKey || "Mouse4",
      talkKeySource: npci.talkKey ? "npci-ini" : "default",
      language: "English"
    };
  }

  const content = await fsp.readFile(configPath, "utf8");
  const lsaTalkKey = normalizeImportedTalkKey(
    getConfigValue(content, "TalkKey")
  );

  return {
    exists: true,
    path: configPath,
    talkKey: lsaTalkKey || npci.talkKey || "Mouse4",
    talkKeySource: lsaTalkKey
      ? "lsa-config"
      : (npci.talkKey ? "npci-ini" : "default"),
    language: getConfigValue(content, "Language") || "English"
  };
}

async function configureLspdfrKeys(gtaPath) {
  const keysPath = path.join(gtaPath, "lspdfr", "keys.ini");

  await fsp.mkdir(path.dirname(keysPath), {
    recursive: true
  });

  let content = "";

  if (await exists(keysPath)) {
    content = await fsp.readFile(keysPath, "utf8");
  }

  // Preserve the rest of keys.ini exactly, changing only these two bindings.
  content = setConfigValue(content, "BACKUP_MENU_Key", "None");
  content = setConfigValue(content, "STOP_PEDS_Key", "None");

  await fsp.writeFile(keysPath, content, "utf8");

  return {
    success: true,
    path: keysPath,
    backupMenuKey: "None",
    stopPedsKey: "None"
  };
}

async function configurePolicingRedefined(gtaPath) {
  const settingsPath = path.join(
    gtaPath,
    POLICING_REDEFINED_INTERACTION_SETTINGS
  );

  /*
   * Policing Redefined is optional outside the LSPDFR install mode.
   * If its settings file is not present, leave the user's installation alone.
   */
  if (!(await exists(settingsPath))) {
    return {
      success: true,
      configured: false,
      path: settingsPath,
      message: "Policing Redefined InteractionSettings.ini was not found; marker settings were left unchanged."
    };
  }

  let content = await fsp.readFile(settingsPath, "utf8");

  /*
   * LSA has its own NPC-selection indicator. Disable PR's stopped-ped and
   * traffic-stop occupant markers so the two systems do not draw competing
   * selection markers over NPCs.
   *
   * setConfigValue preserves the rest of InteractionSettings.ini and changes
   * only these two assignments.
   */
  content = setConfigValue(
    content,
    "EnableStoppedPedMarkers",
    "False"
  );

  content = setConfigValue(
    content,
    "EnableTrafficStopPedMarkers",
    "False"
  );

  await fsp.writeFile(settingsPath, content, "utf8");

  return {
    success: true,
    configured: true,
    path: settingsPath,
    enableStoppedPedMarkers: false,
    enableTrafficStopPedMarkers: false,
    message: "Disabled Policing Redefined stopped-ped and traffic-stop ped markers."
  };
}

async function saveConfig(gtaPath, talkKey, language, apiKey = null) {
  const configPath = path.join(gtaPath, LSA_CONFIG);

  await fsp.mkdir(path.dirname(configPath), {
    recursive: true
  });

  let content = "";

  if (await exists(configPath)) {
    content = await fsp.readFile(configPath, "utf8");
  }

  content = setConfigValue(content, "TalkKey", talkKey);
  content = setConfigValue(content, "Language", language);

  const normalizedApiKey = String(apiKey ?? "").trim();
  if (normalizedApiKey) {
    content = setConfigValue(content, "ApiKey", normalizedApiKey);
  }

  await fsp.writeFile(configPath, content, "utf8");

  return {
    success: true,
    path: configPath,
    talkKey: String(talkKey).trim(),
    language: String(language).trim(),
    apiKeyWritten: Boolean(String(apiKey ?? "").trim())
  };
}

module.exports = {
  getConfigValue,
  setConfigValue,
  normalizeImportedTalkKey,
  readNpciTalkKey,
  loadConfig,
  configureLspdfrKeys,
  configurePolicingRedefined,
  saveConfig
};
