const path = require("path");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const ARDUINO_HINTS = [
  "arduino",
  "ch340",
  "wch",
  "cp210",
  "usb serial",
  "silicon labs",
  "usb2.0-serial",
];
const ARDUINO_VENDOR_IDS = new Set(["2341", "2a03", "1a86", "10c4"]);

const BRIDGE_API_BASE = String(
  process.env.BRIDGE_API_BASE || "http://localhost:3000/api",
)
  .trim()
  .replace(/\/+$/, "");
const BRIDGE_KEY = String(process.env.SCANNER_BRIDGE_KEY || "").trim();
const BRIDGE_ARDUINO_PORT = String(
  process.env.BRIDGE_ARDUINO_PORT || "",
).trim();
const BRIDGE_BAUD_RATE = Number(process.env.BRIDGE_BAUD_RATE || 9600);
const FORWARD_DEBOUNCE_MS = Number(
  process.env.BRIDGE_FORWARD_DEBOUNCE_MS || 2500,
);
const RECONNECT_DELAY_MS = Number(
  process.env.BRIDGE_RECONNECT_DELAY_MS || 1500,
);

if (typeof fetch !== "function") {
  console.error(
    "Node.js 18+ is required for local-scanner-bridge (global fetch).",
  );
  process.exit(1);
}

let serialPort = null;
let parser = null;
let reconnectTimer = null;
let isShuttingDown = false;
const recentForwardedByUid = new Map();

function normalizeUid(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().toUpperCase().replace(/[-:]+/g, " ").replace(/\s+/g, " ");
}

function extractUidFromSerialData(line) {
  if (!line) return "";
  const trimmed = String(line).trim();

  try {
    const parsed = JSON.parse(trimmed);
    const candidate =
      parsed.uid ||
      parsed.card_uid ||
      parsed.cardUid ||
      parsed.UID ||
      parsed.rfid ||
      parsed.tag;
    const normalized = normalizeUid(candidate);
    if (normalized) return normalized;
  } catch {
    // Fall through to regex extraction.
  }

  const explicit = trimmed.match(
    /(?:UID|RFID|CARD)\s*[:=]\s*([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2}){2,9})/,
  );
  if (explicit && explicit[1]) {
    return normalizeUid(explicit[1]);
  }

  const generic = trimmed.match(
    /\b([0-9A-Fa-f]{2}(?:[\s:-]+[0-9A-Fa-f]{2}){2,9})\b/,
  );
  if (generic && generic[1]) {
    return normalizeUid(generic[1]);
  }

  return "";
}

function includesArduinoHint(value) {
  return (
    typeof value === "string" &&
    ARDUINO_HINTS.some((hint) => value.toLowerCase().includes(hint))
  );
}

function scorePort(port) {
  let score = 0;

  if (BRIDGE_ARDUINO_PORT && port.path === BRIDGE_ARDUINO_PORT) score += 100;
  if (includesArduinoHint(port.manufacturer)) score += 25;
  if (includesArduinoHint(port.friendlyName)) score += 20;
  if (includesArduinoHint(port.pnpId)) score += 20;
  if (
    port.vendorId &&
    ARDUINO_VENDOR_IDS.has(String(port.vendorId).toLowerCase())
  ) {
    score += 35;
  }
  if (typeof port.path === "string" && port.path.startsWith("COM")) score += 5;

  return score;
}

function pickArduinoPort(ports) {
  if (!Array.isArray(ports) || ports.length === 0) return null;
  if (BRIDGE_ARDUINO_PORT) {
    const forced = ports.find((port) => port.path === BRIDGE_ARDUINO_PORT);
    return forced || null;
  }

  const ranked = ports
    .map((port) => ({ port, score: scorePort(port) }))
    .sort((a, b) => b.score - a.score);

  if (ports.length === 1) return ports[0];
  if (!ranked[0] || ranked[0].score <= 0) return null;
  return ranked[0].port;
}

async function forwardUidToCloud(uid) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (BRIDGE_KEY) {
    headers["x-scanner-bridge-key"] = BRIDGE_KEY;
  }

  const response = await fetch(`${BRIDGE_API_BASE}/test-scan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ uid }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloud API ${response.status}: ${text}`);
  }

  return response.json();
}

async function handleSerialLine(line) {
  const uid = extractUidFromSerialData(line);
  if (!uid) return;

  const now = Date.now();
  const lastForward = recentForwardedByUid.get(uid) || 0;
  if (now - lastForward < FORWARD_DEBOUNCE_MS) {
    return;
  }

  recentForwardedByUid.set(uid, now);

  try {
    console.log(`Forwarding UID: ${uid}`);
    await forwardUidToCloud(uid);
    console.log(`Forwarded UID successfully: ${uid}`);
  } catch (error) {
    console.error(`Failed to forward UID ${uid}:`, error.message);
  }
}

function closeCurrentSerial() {
  if (parser) {
    parser.removeAllListeners();
    parser = null;
  }

  if (serialPort) {
    try {
      serialPort.removeAllListeners();
      if (serialPort.isOpen) {
        serialPort.close();
      }
    } catch {
      // Ignore cleanup errors.
    }
    serialPort = null;
  }
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectSerial();
  }, RECONNECT_DELAY_MS);
}

async function connectSerial() {
  if (isShuttingDown) return;

  try {
    const ports = await SerialPort.list();
    if (!ports.length) {
      console.log("No serial ports found. Retrying...");
      scheduleReconnect();
      return;
    }

    const selected = pickArduinoPort(ports);
    if (!selected) {
      console.log("Arduino-like port not found. Retrying...");
      scheduleReconnect();
      return;
    }

    console.log(
      `Opening serial port ${selected.path} at ${BRIDGE_BAUD_RATE} baud...`,
    );

    closeCurrentSerial();

    serialPort = new SerialPort({
      path: selected.path,
      baudRate: BRIDGE_BAUD_RATE,
      autoOpen: false,
    });

    serialPort.on("error", (error) => {
      console.error("Serial port error:", error.message);
      closeCurrentSerial();
      scheduleReconnect();
    });

    serialPort.on("close", () => {
      if (!isShuttingDown) {
        console.warn("Serial port closed. Reconnecting...");
        closeCurrentSerial();
        scheduleReconnect();
      }
    });

    await new Promise((resolve, reject) => {
      serialPort.open((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line) => {
      handleSerialLine(line);
    });

    console.log("Local scanner bridge is ready.");
  } catch (error) {
    console.error("Failed to open serial port:", error.message);
    closeCurrentSerial();
    scheduleReconnect();
  }
}

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Shutting down scanner bridge...`);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  closeCurrentSerial();
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

console.log("=== Local Scanner Bridge ===");
console.log(`Bridge API Base: ${BRIDGE_API_BASE}`);
console.log(`Bridge Port Hint: ${BRIDGE_ARDUINO_PORT || "auto-detect"}`);
console.log(`Bridge Baud Rate: ${BRIDGE_BAUD_RATE}`);
console.log(`Bridge Security Key: ${BRIDGE_KEY ? "configured" : "not set"}`);

connectSerial();
