const fsp = require("fs").promises;
const path = require("path");
const {
  NPCI_INI,
  LSA_SERVER_ENV
} = require("./constants");
const { exists } = require("./utils");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractAssignmentValue(content, key) {
  const escaped = escapeRegExp(key);
  const match = content.match(
    new RegExp(`^[ \t]*(?:export[ \t]+)?${escaped}[ \t]*=[ \t]*([^\r\n]*)$`, "mi")
  );

  if (!match) return null;

  let value = match[1].trim();

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return value || null;
}

function setAssignmentValue(content, key, value) {
  const escaped = escapeRegExp(key);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const pattern = new RegExp(
    `^([ \t]*(?:export[ \t]+)?${escaped}[ \t]*=[ \t]*).*?$`,
    "mi"
  );

  if (pattern.test(content)) {
    return content.replace(pattern, `$1${value}`);
  }

  const trimmed = content.replace(/\s*$/, "");
  return trimmed
    ? `${trimmed}${newline}${key}=${value}${newline}`
    : `${key}=${value}${newline}`;
}

async function readKeyFromFile(filePath, keyName) {
  if (!(await exists(filePath))) return null;

  try {
    const content = await fsp.readFile(filePath, "utf8");
    return extractAssignmentValue(content, keyName);
  } catch {
    return null;
  }
}

async function findExistingGeminiKey(gtaPath) {
  const lsaEnvPath = path.join(gtaPath, LSA_SERVER_ENV);
  const lsaKey = await readKeyFromFile(lsaEnvPath, "GEMINI_API_KEY");

  if (lsaKey) {
    return {
      found: true,
      key: lsaKey,
      source: lsaEnvPath,
      sourceType: "lsa-env"
    };
  }

  const npciIniPath = path.join(gtaPath, NPCI_INI);
  const npciKey = await readKeyFromFile(npciIniPath, "ApiKey");

  if (npciKey) {
    return {
      found: true,
      key: npciKey,
      source: npciIniPath,
      sourceType: "npci-ini"
    };
  }

  return {
    found: false,
    key: null,
    source: null,
    sourceType: null
  };
}

async function saveGeminiApiKey(gtaPath, apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Gemini API key cannot be empty.");

  const envPath = path.join(gtaPath, LSA_SERVER_ENV);
  await fsp.mkdir(path.dirname(envPath), { recursive: true });

  let content = "GEMINI_API_KEY=\n";

  if (await exists(envPath)) {
    content = await fsp.readFile(envPath, "utf8");
  }

  content = setAssignmentValue(content, "GEMINI_API_KEY", key);
  await fsp.writeFile(envPath, content, "utf8");

  return {
    success: true,
    path: envPath
  };
}

async function verifyGeminiKey(apiKey) {
  const key = String(apiKey || "").trim();

  if (!key) {
    return {
      valid: false,
      message: "Enter a Gemini API key."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        method: "GET",
        headers: {
          "x-goog-api-key": key
        },
        signal: controller.signal
      }
    );

    if (response.ok) {
      return {
        valid: true,
        message: "Gemini API key verified."
      };
    }

    let details = "";

    try {
      const body = await response.json();
      details = body?.error?.message || body?.message || "";
    } catch {
      // Ignore non-JSON error bodies.
    }

    return {
      valid: false,
      status: response.status,
      message:
        details ||
        `Gemini rejected the API key (HTTP ${response.status}).`
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        valid: false,
        message: "Gemini verification timed out. Check your internet connection and try again."
      };
    }

    return {
      valid: false,
      message:
        "Could not contact Gemini to verify the key. Check your internet connection and try again."
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  extractAssignmentValue,
  setAssignmentValue,
  findExistingGeminiKey,
  saveGeminiApiKey,
  verifyGeminiKey
};
