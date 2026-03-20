const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in server/.env before starting the server.",
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Backend is using SUPABASE_KEY. If students are missing, set SUPABASE_SERVICE_ROLE_KEY to bypass RLS for trusted server-side access.",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Backend is API-only. Frontend is served by a separate React app.
app.get("/", (req, res) => {
  res.json({
    name: "RFID Attendance API",
    status: "ok",
    frontend: "Run the React app separately (default: http://localhost:5173)",
  });
});

// Paths to CSV files
const STUDENTS_CSV = path.join(__dirname, "data", "students.csv");
const ATTENDANCE_CSV = path.join(__dirname, "data", "attendance.csv");

// Store for SSE clients (real-time updates)
let sseClients = [];
let lastCapturedUid = null;
let lastCapturedAt = 0;
const recentScanAttemptByUid = new Map();
const SCAN_DEBOUNCE_MS = 2500;
let scannerModeEnabled = false;
const SCANNER_BRIDGE_KEY = String(process.env.SCANNER_BRIDGE_KEY || "").trim();

const ADMIN_SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 8);
const adminSessions = new Map();

// ===== SERIAL PORT SETUP =====
let serialPort = null;
let parser = null;
let reconnectTimer = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let preferredPortPath = process.env.ARDUINO_PORT || null;
const RECONNECT_DELAY = 1500; // 1.5 seconds
let scannerModeTeacherId = "";

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

function normalizeUid(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().toUpperCase().replace(/[-:]+/g, " ").replace(/\s+/g, " ");
}

function extractUidFromSerialData(trimmedData) {
  if (!trimmedData) return "";

  // Primary format from Arduino sketch: {"uid":"AA BB CC DD"}
  try {
    const parsed = JSON.parse(trimmedData);
    const candidate =
      parsed.uid ||
      parsed.card_uid ||
      parsed.cardUid ||
      parsed.UID ||
      parsed.rfid ||
      parsed.tag;
    return normalizeUid(candidate);
  } catch {
    // Fall through to text pattern extraction.
  }

  // Fallback for plain serial lines like:
  // "UID: AA BB CC DD" or "RFID: AA BB CC DD"
  const match = trimmedData.match(
    /(?:UID|RFID|CARD)\s*[:=]\s*([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2}){2,9})/,
  );
  if (match && match[1]) {
    return normalizeUid(match[1]);
  }

  // Generic fallback: detect any 3+ byte hex UID sequence in the line.
  const genericMatch = trimmedData.match(
    /\b([0-9A-Fa-f]{2}(?:[\s:-]+[0-9A-Fa-f]{2}){2,9})\b/,
  );
  if (genericMatch && genericMatch[1]) {
    return normalizeUid(genericMatch[1]);
  }

  return "";
}

function includesArduinoHint(value) {
  return (
    typeof value === "string" &&
    ARDUINO_HINTS.some((hint) => value.toLowerCase().includes(hint))
  );
}

function getNormalizedTeacherId(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function createAdminSession(admin) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000;

  adminSessions.set(token, {
    adminId: admin.id,
    fullname: admin.fullname,
    email: admin.email,
    expiresAt,
  });

  return token;
}

function getBearerToken(req) {
  const raw = String(req.headers.authorization || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}

function requireAdminSession(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Admin authorization is required" });
    return null;
  }

  const session = adminSessions.get(token);
  if (!session) {
    res.status(401).json({ error: "Invalid admin session" });
    return null;
  }

  if (Date.now() > Number(session.expiresAt || 0)) {
    adminSessions.delete(token);
    res.status(401).json({ error: "Admin session expired" });
    return null;
  }

  return { token, session };
}

function scorePort(port) {
  let score = 0;

  if (preferredPortPath && port.path === preferredPortPath) score += 100;
  if (includesArduinoHint(port.manufacturer)) score += 50;
  if (includesArduinoHint(port.friendlyName)) score += 40;
  if (includesArduinoHint(port.pnpId)) score += 35;
  if (
    port.vendorId &&
    ARDUINO_VENDOR_IDS.has(String(port.vendorId).toLowerCase())
  )
    score += 35;
  if (typeof port.path === "string" && port.path.startsWith("COM")) score += 5;

  return score;
}

function pickArduinoPort(ports) {
  if (!ports || ports.length === 0) return null;

  const scored = ports
    .map((port) => ({ port, score: scorePort(port) }))
    .sort((a, b) => b.score - a.score);

  // If there is only one serial device, treat it as the likely board.
  if (ports.length === 1) return ports[0];

  // Avoid attaching to random serial devices when multiple ports exist.
  if (scored[0].score <= 0) return null;

  return scored[0].port;
}

function autoResetArduino() {
  if (!serialPort || !serialPort.isOpen) return;

  serialPort.set({ dtr: false }, (err) => {
    if (err) {
      console.log(`DTR low failed: ${err.message}`);
      return;
    }

    setTimeout(() => {
      if (!serialPort || !serialPort.isOpen) return;
      serialPort.set({ dtr: true }, (setErr) => {
        if (setErr) {
          console.log(`DTR high failed: ${setErr.message}`);
          return;
        }
        console.log("✓ Arduino auto-reset triggered (DTR toggle)");
      });
    }, 200);
  });
}

// Function to list available ports
async function listPorts() {
  const ports = await SerialPort.list();
  console.log("\n=== Available Serial Ports ===");
  ports.forEach((port, index) => {
    console.log(
      `${index + 1}. ${port.path} - ${port.manufacturer || port.friendlyName || "Unknown"}`,
    );
  });
  return ports;
}

// Function to initialize serial port
async function initSerialPort() {
  if (isShuttingDown) return;
  if (serialPort && serialPort.isOpen) return;

  try {
    const ports = await listPorts();

    const arduinoPort = pickArduinoPort(ports);

    if (!arduinoPort) {
      console.log(
        "\n⚠️  Arduino serial port not found. Waiting for reconnect...",
      );
      attemptReconnect();
      return;
    }

    console.log(`\n✓ Connecting to: ${arduinoPort.path}`);
    preferredPortPath = arduinoPort.path;

    serialPort = new SerialPort({
      path: arduinoPort.path,
      baudRate: 9600,
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

    serialPort.on("open", () => {
      console.log("✓ Serial port opened successfully\n");
      autoResetArduino();
      reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      isReconnecting = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    });

    parser.on("data", (data) => {
      const trimmedData = data.trim();
      console.log("Received:", trimmedData);

      // Check if Arduino has been reset and is ready
      if (trimmedData.includes("Scanner ready")) {
        console.log("\u2713 Arduino initialized and ready to scan");
        return;
      }

      const scannedUid = extractUidFromSerialData(trimmedData);
      if (scannedUid) {
        handleRFIDScan(scannedUid);
        return;
      }

      // Not a card UID line, keep for debugging.
      if (trimmedData.length > 0 && !trimmedData.startsWith("RFID")) {
        console.log("Non-UID serial data:", trimmedData);
      }
    });

    serialPort.on("close", () => {
      console.log(
        "\n⚠️  Serial port closed (Arduino may have been disconnected or reset)",
      );
      if (parser) {
        parser.removeAllListeners("data");
      }
      parser = null;
      serialPort = null;

      // Attempt to reconnect
      console.log("Attempting to reconnect...");
      attemptReconnect();
    });

    serialPort.on("error", (err) => {
      console.error("Serial port error:", err.message);

      console.log("\n⚠️  Port unavailable. Will retry...");
      attemptReconnect();
    });
  } catch (error) {
    console.error("Error initializing serial port:", error);
    attemptReconnect();
  }
}

// Function to attempt reconnection
function attemptReconnect() {
  if (isShuttingDown) return;
  if (reconnectTimer) return;

  isReconnecting = true;
  reconnectAttempts++;

  console.log(
    `Reconnection attempt ${reconnectAttempts} in ${RECONNECT_DELAY / 1000} seconds...`,
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      // Close existing port if any
      if (serialPort && serialPort.isOpen) {
        await new Promise((resolve) => serialPort.close(() => resolve()));
      }
    } catch (err) {
      // Ignore close errors
    }

    serialPort = null;
    parser = null;

    await initSerialPort();
  }, RECONNECT_DELAY);
}

// ===== GRACEFUL SHUTDOWN =====

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n\n🛑 Received ${signal}. Shutting down gracefully...`);

  // Clear reconnect interval if any
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Close all SSE connections
  console.log("Closing SSE connections...");
  sseClients.forEach((client) => {
    try {
      client.res.end();
    } catch (err) {
      // Ignore errors when closing
    }
  });
  sseClients = [];

  // Close serial port
  if (serialPort && serialPort.isOpen) {
    try {
      console.log("Closing serial port...");
      await serialPort.close();
      console.log("✓ Serial port closed");
    } catch (err) {
      console.error("Error closing serial port:", err.message);
    }
  }

  console.log("✓ Cleanup complete. Exiting...\n");
  process.exit(0);
}

// Handle termination signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGQUIT", () => gracefulShutdown("SIGQUIT"));

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("\n❌ Uncaught Exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// ===== CSV HELPER FUNCTIONS =====

function readCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  // Handle both Windows (CRLF) and Unix (LF) line endings
  const lines = content
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  return lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(",");
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = values[i] ? values[i].trim() : "";
      });
      return obj;
    })
    .filter((obj) => obj[headers[0]]); // Filter out objects with empty first field
}

function writeCSV(filePath, data, headers) {
  const csvContent = [
    headers.join(","),
    ...data.map((row) => headers.map((h) => row[h] || "").join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, csvContent + "\n", "utf-8");
}

function appendToCSV(filePath, row, headers) {
  const csvRow = headers.map((h) => row[h] || "").join(",");
  fs.appendFileSync(filePath, csvRow + "\n", "utf-8");
}

// ===== RFID SCAN HANDLER =====

function handleRFIDScan(uid) {
  console.log(`\n📡 RFID Scanned: ${uid}`);

  const normalizedUid = normalizeUid(uid);
  if (!normalizedUid) return;

  lastCapturedUid = normalizedUid;
  lastCapturedAt = Date.now();

  // Always broadcast UID for capture (for register page scan button)
  broadcastSSE({
    status: "capture",
    uid: normalizedUid,
    timestamp: new Date().toISOString(),
  });

  // Only record attendance when scanner mode is explicitly enabled.
  if (!scannerModeEnabled) {
    console.log(
      "ℹ️  Scan ignored for attendance because scanner mode is disabled",
    );
    return;
  }

  // Debounce very fast repeated card reads to avoid race-condition double inserts.
  const nowMs = Date.now();
  const lastAttemptMs = recentScanAttemptByUid.get(normalizedUid) || 0;
  if (nowMs - lastAttemptMs < SCAN_DEBOUNCE_MS) {
    return;
  }
  recentScanAttemptByUid.set(normalizedUid, nowMs);

  (async () => {
    const activeTeacherId = getNormalizedTeacherId(scannerModeTeacherId);
    if (!activeTeacherId) {
      broadcastSSE({
        status: "error",
        message: "No active teacher context for scanner.",
        uid: normalizedUid,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Find candidates by teacher, then match using normalized UID format.
    const { data: students, error: studentError } = await supabase
      .from("students")
      .select("*")
      .eq("teachers_id", activeTeacherId)
      .limit(1000);

    if (studentError) {
      console.log(`⚠️  Student lookup failed: ${studentError.message}`);
      broadcastSSE({
        status: "error",
        message: "Scanner lookup failed. Please try again.",
        uid: normalizedUid,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const student =
      students && students.length > 0
        ? students.find(
            (candidate) => normalizeUid(candidate?.card_uid) === normalizedUid,
          ) || null
        : null;

    if (!student) {
      console.log("⚠️  Unknown card - Not registered");
      const scanData = {
        status: "error",
        message: "Card not registered",
        uid: normalizedUid,
        timestamp: new Date().toISOString(),
      };
      broadcastSSE(scanData);
      return;
    }

    // Check for duplicate scan on the same local day.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const { data: attendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("*")
      .eq("teachers_id", activeTeacherId)
      .eq("card_uid", normalizedUid)
      .gte("scanned_at", dayStart.toISOString())
      .lt("scanned_at", dayEnd.toISOString())
      .order("scanned_at", { ascending: false })
      .limit(1);

    if (attendanceError) {
      console.log(
        `⚠️  Attendance duplicate-check failed: ${attendanceError.message}`,
      );
      broadcastSSE({
        status: "error",
        message: "Attendance check failed. Please try again.",
        uid: normalizedUid,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const alreadyScannedToday =
      attendance && attendance.length > 0 ? attendance[0] : null;

    if (alreadyScannedToday) {
      console.log(
        `⚠️  Duplicate scan prevented: ${student.fullname} already scanned today at ${alreadyScannedToday.scanned_at}`,
      );
      const scanData = {
        status: "duplicate",
        message: "Already scanned today",
        student: student,
        previous_scan: alreadyScannedToday.scanned_at,
        timestamp: new Date().toISOString(),
      };
      broadcastSSE(scanData);
      return;
    }

    // Record attendance in Supabase
    const timestamp = new Date().toISOString();
    const { error: insertError } = await supabase.from("attendance").insert([
      {
        student_id: student.student_id,
        card_uid: normalizedUid,
        fullname: student.fullname,
        grade: student.grade,
        section: student.section,
        teachers_id: activeTeacherId,
        scanned_at: timestamp,
      },
    ]);

    if (insertError) {
      console.log(`⚠️  Attendance insert failed: ${insertError.message}`);
      broadcastSSE({
        status: "error",
        message: "Failed to save attendance. Please rescan.",
        student,
        uid: normalizedUid,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    console.log(`✓ Attendance recorded for: ${student.fullname}`);

    const scanData = {
      status: "success",
      message: "Attendance recorded",
      student,
      timestamp,
    };
    broadcastSSE(scanData);
  })();
}

// ===== SERVER-SENT EVENTS (SSE) for Real-time Updates =====

function broadcastSSE(data) {
  sseClients.forEach((client) => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

app.get("/api/scan-events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const clientId = Date.now();
  const scannerMode = String(req.query.mode || "").toLowerCase() === "scanner";
  // Scanner page may opt-in immediately via query string mode=scanner.
  const newClient = { id: clientId, res, scanningActive: scannerMode };
  sseClients.push(newClient);

  console.log(
    `Client ${clientId} connected to SSE${scannerMode ? " (scanner mode)" : ""}`,
  );

  // Send clientId to frontend immediately
  newClient.res.write(`data: ${JSON.stringify({ clientId })}\n\n`);

  // Keep SSE alive across proxies/load balancers.
  const heartbeatTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: heartbeat\n\n`);
    }
  }, 15000);

  // If a card was just scanned before SSE connected, replay it for UID capture UX.
  if (lastCapturedUid && Date.now() - lastCapturedAt <= 10000) {
    newClient.res.write(
      `data: ${JSON.stringify({ status: "capture", uid: lastCapturedUid, timestamp: new Date(lastCapturedAt).toISOString() })}\n\n`,
    );
  }

  // Listen for scanning mode toggle from frontend
  req.on("data", (chunk) => {
    try {
      const msg = chunk.toString();
      if (msg.includes("scanning:true")) {
        newClient.scanningActive = true;
      } else if (msg.includes("scanning:false")) {
        newClient.scanningActive = false;
      }
    } catch (e) {}
  });

  req.on("close", () => {
    clearInterval(heartbeatTimer);
    sseClients = sseClients.filter((client) => client.id !== clientId);
    console.log(`Client ${clientId} disconnected from SSE`);
  });
});

// Fallback endpoint for UID capture in case SSE messages are missed.
app.get("/api/scanner/last-capture", (req, res) => {
  if (!lastCapturedUid || !lastCapturedAt) {
    return res.status(204).end();
  }

  // Ignore stale captures older than 30 seconds.
  if (Date.now() - lastCapturedAt > 30000) {
    return res.status(204).end();
  }

  return res.json({
    uid: lastCapturedUid,
    timestamp: new Date(lastCapturedAt).toISOString(),
  });
});

// Endpoint to activate scanning mode for a client
app.post("/api/scanner/activate", (req, res) => {
  const { clientId } = req.body;
  const teachersId = getNormalizedTeacherId(req.body?.teachers_id);
  if (!clientId) {
    return res.status(400).json({ error: "clientId required" });
  }
  const normalizedId = Number(clientId);
  const client = sseClients.find((c) => Number(c.id) === normalizedId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  client.scanningActive = true;
  scannerModeEnabled = true;
  if (teachersId) {
    scannerModeTeacherId = teachersId;
  }
  res.json({
    message: "Scanning activated",
    teachers_id: scannerModeTeacherId,
  });
});

app.get("/api/scanner/state", (req, res) => {
  res.json({
    enabled: scannerModeEnabled,
    teachers_id: scannerModeTeacherId || null,
    activeClients: sseClients.length,
  });
});

app.post("/api/scanner/start", (req, res) => {
  const teachersId = getNormalizedTeacherId(req.body?.teachers_id);
  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  scannerModeEnabled = true;
  scannerModeTeacherId = teachersId;
  console.log("▶️ Scanner mode enabled");
  res.json({ enabled: true, teachers_id: scannerModeTeacherId });
});

app.post("/api/scanner/stop", (req, res) => {
  scannerModeEnabled = false;
  scannerModeTeacherId = "";
  console.log("⏹️ Scanner mode disabled");
  res.json({ enabled: false });
});

// Teacher sign in
app.post("/api/auth/signin", (req, res) => {
  const identifier = String(
    req.body?.identifier || req.body?.email || "",
  ).trim();
  const password = String(req.body?.password || "");

  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: "Email or Teacher ID and password are required" });
  }

  (async () => {
    const isEmailLogin = identifier.includes("@");
    const lookupValue = isEmailLogin ? identifier.toLowerCase() : identifier;

    let query = supabase
      .from("teachers")
      .select("id, teachers_id, fullname, email, password");

    query = isEmailLogin
      ? query.eq("email", lookupValue)
      : query.eq("teachers_id", lookupValue);

    const { data: teacher, error } = await query.maybeSingle();

    if (error) {
      return res.status(500).json({ error: "Failed to process sign in" });
    }

    if (!teacher) {
      return res
        .status(401)
        .json({ error: "Invalid email/teacher ID or password" });
    }

    if (String(teacher.password || "") !== password) {
      return res
        .status(401)
        .json({ error: "Invalid email/teacher ID or password" });
    }

    return res.json({
      message: "Sign in successful",
      teacher: {
        id: teacher.id,
        teachers_id: teacher.teachers_id,
        fullname: teacher.fullname,
        email: teacher.email,
      },
    });
  })();
});

// Admin sign in with email and password
app.post("/api/admin/auth/signin", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  (async () => {
    const { data: admin, error } = await supabase
      .from("admins")
      .select("id, fullname, email, contact_number, password")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: "Failed to process admin sign in" });
    }

    if (!admin || String(admin.password || "") !== password) {
      return res.status(401).json({ error: "Invalid admin email or password" });
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from("admins")
      .update({ updated_at: nowIso })
      .eq("id", admin.id);

    const token = createAdminSession(admin);

    return res.json({
      message: "Admin sign in successful",
      token,
      admin: {
        id: admin.id,
        fullname: admin.fullname,
        email: admin.email,
        contact_number: admin.contact_number,
      },
    });
  })();
});

app.post("/api/admin/auth/signout", (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    adminSessions.delete(token);
  }
  return res.json({ message: "Admin signed out" });
});

app.get("/api/admin/teachers", (req, res) => {
  const auth = requireAdminSession(req, res);
  if (!auth) return;

  (async () => {
    const { data: teachers, error } = await supabase
      .from("teachers")
      .select("id, teachers_id, fullname, email, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch teachers" });
    }

    return res.json({ teachers: teachers || [] });
  })();
});

app.get("/api/admin/teachers/:id", (req, res) => {
  const auth = requireAdminSession(req, res);
  if (!auth) return;

  const teacherRowId = String(req.params?.id || "").trim();
  if (!teacherRowId) {
    return res.status(400).json({ error: "Teacher id is required" });
  }

  (async () => {
    const { data: teacher, error } = await supabase
      .from("teachers")
      .select(
        "id, teachers_id, fullname, email, password, created_at, updated_at",
      )
      .eq("id", teacherRowId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: "Failed to fetch teacher details" });
    }

    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    return res.json({ teacher });
  })();
});

app.put("/api/admin/teachers/:id", (req, res) => {
  const auth = requireAdminSession(req, res);
  if (!auth) return;

  const teacherRowId = String(req.params?.id || "").trim();
  const teachersId = String(req.body?.teachers_id || "").trim();
  const fullname = String(req.body?.fullname || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!teacherRowId) {
    return res.status(400).json({ error: "Teacher id is required" });
  }

  if (!teachersId || !fullname || !email || !password) {
    return res.status(400).json({ error: "All teacher fields are required" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Teacher password must be at least 6 characters" });
  }

  (async () => {
    const nowIso = new Date().toISOString();

    const { data: teacher, error } = await supabase
      .from("teachers")
      .update({
        teachers_id: teachersId,
        fullname,
        email,
        password,
        updated_at: nowIso,
      })
      .eq("id", teacherRowId)
      .select(
        "id, teachers_id, fullname, email, password, created_at, updated_at",
      )
      .maybeSingle();

    if (error) {
      const isConflict =
        String(error.code || "") === "23505" ||
        String(error.message || "")
          .toLowerCase()
          .includes("duplicate");
      if (isConflict) {
        return res.status(409).json({
          error: "Teacher ID or email already exists",
        });
      }
      return res
        .status(500)
        .json({ error: "Failed to update teacher account" });
    }

    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    return res.json({
      message: "Teacher account updated",
      teacher,
    });
  })();
});

app.post("/api/admin/teachers", (req, res) => {
  const auth = requireAdminSession(req, res);
  if (!auth) return;

  const teachersId = String(req.body?.teachers_id || "").trim();
  const fullname = String(req.body?.fullname || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!teachersId || !fullname || !email || !password) {
    return res.status(400).json({ error: "All teacher fields are required" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Teacher password must be at least 6 characters" });
  }

  (async () => {
    const nowIso = new Date().toISOString();

    const { data: teacher, error } = await supabase
      .from("teachers")
      .insert([
        {
          teachers_id: teachersId,
          fullname,
          email,
          password,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ])
      .select("id, teachers_id, fullname, email, created_at, updated_at")
      .maybeSingle();

    if (error) {
      const isConflict =
        String(error.code || "") === "23505" ||
        String(error.message || "")
          .toLowerCase()
          .includes("duplicate");
      if (isConflict) {
        return res.status(409).json({
          error: "Teacher ID or email already exists",
        });
      }
      return res
        .status(500)
        .json({ error: "Failed to create teacher account" });
    }

    return res.status(201).json({
      message: "Teacher account created",
      teacher,
    });
  })();
});

// Update teacher profile
app.put("/api/teachers/profile", (req, res) => {
  const teachersId = getNormalizedTeacherId(req.body?.teachers_id);
  const fullname = String(req.body?.fullname || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  if (!teachersId || !fullname || !email) {
    return res
      .status(400)
      .json({ error: "Teacher ID, full name, and email are required" });
  }

  (async () => {
    try {
      const { data: teacher, error } = await supabase
        .from("teachers")
        .update({ fullname, email })
        .eq("teachers_id", teachersId)
        .select("id, teachers_id, fullname, email")
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: "Failed to update profile" });
      }

      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      return res.json({
        message: "Profile updated successfully",
        teacher: {
          id: teacher.id,
          teachers_id: teacher.teachers_id,
          fullname: teacher.fullname,
          email: teacher.email,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to update profile" });
    }
  })();
});

// Change teacher password
app.put("/api/teachers/change-password", (req, res) => {
  const teachersId = getNormalizedTeacherId(req.body?.teachers_id);
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  if (!teachersId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "All password fields are required" });
  }

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "New password must be at least 6 characters" });
  }

  (async () => {
    try {
      const { data: teacher, error } = await supabase
        .from("teachers")
        .select("id, teachers_id, password")
        .eq("teachers_id", teachersId)
        .maybeSingle();

      if (error) {
        return res
          .status(500)
          .json({ error: "Failed to process password change" });
      }

      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      if (String(teacher.password || "") !== currentPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      const { error: updateError } = await supabase
        .from("teachers")
        .update({ password: newPassword })
        .eq("teachers_id", teachersId);

      if (updateError) {
        return res.status(500).json({ error: "Failed to update password" });
      }

      return res.json({ message: "Password changed successfully" });
    } catch (err) {
      return res
        .status(500)
        .json({ error: "Failed to process password change" });
    }
  })();
});

// ===== API ROUTES =====

// Get all students
app.get("/api/students", (req, res) => {
  const teachersId = getNormalizedTeacherId(req.query?.teachers_id);

  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  (async () => {
    const { data: students, error } = await supabase
      .from("students")
      .select("*")
      .eq("teachers_id", teachersId);
    if (error) {
      return res.status(500).json({ error: "Failed to fetch students" });
    }
    res.json(students);
  })();
});

// Register new student
app.post("/api/students", (req, res) => {
  const { student_id, card_uid, fullname, grade, section } = req.body;
  const teachersId = getNormalizedTeacherId(req.body?.teachers_id);
  const normalizedCardUid = normalizeUid(card_uid);

  // Validation
  if (
    !student_id ||
    !normalizedCardUid ||
    !fullname ||
    !grade ||
    !section ||
    !teachersId
  ) {
    return res.status(400).json({ error: "All fields are required" });
  }

  (async () => {
    // Check for duplicate student ID or card UID in Supabase
    const { data: students, error } = await supabase
      .from("students")
      .select("*")
      .eq("teachers_id", teachersId)
      .or(`student_id.eq.${student_id}`);

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to validate student record" });
    }

    if (students && students.find((s) => s.student_id === student_id)) {
      return res.status(409).json({ error: "Student ID already exists" });
    }
    if (
      students &&
      students.find((s) => normalizeUid(s.card_uid) === normalizedCardUid)
    ) {
      return res.status(409).json({ error: "Card UID already registered" });
    }

    // Add new student to Supabase
    const now = new Date();
    const isoDate = now.toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from("students")
      .insert([
        {
          student_id,
          card_uid: normalizedCardUid,
          fullname,
          grade,
          section,
          teachers_id: teachersId,
          registered_date: isoDate,
        },
      ])
      .select("*");

    if (insertError) {
      return res.status(500).json({ error: "Failed to register student" });
    }
    // Respond with the new student, including registered_date
    res.status(201).json({
      message: "Student registered successfully",
      student: inserted && inserted.length > 0 ? inserted[0] : null,
    });
  })();
});

// Get attendance history
app.get("/api/attendance", (req, res) => {
  const teachersId = getNormalizedTeacherId(req.query?.teachers_id);

  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  (async () => {
    let query = supabase.from("attendance").select("*");

    query = query.eq("teachers_id", teachersId);

    const { data: attendance, error } = await query.order("scanned_at", {
      ascending: false,
    });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch attendance" });
    }

    res.json(attendance || []);
  })();
});

// Get attendance history with filters
app.get("/api/attendance/filter", (req, res) => {
  const { date, student_id, grade, section } = req.query;
  const teachersId = getNormalizedTeacherId(req.query?.teachers_id);

  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  (async () => {
    let query = supabase
      .from("attendance")
      .select("*")
      .eq("teachers_id", teachersId);

    if (date) {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      query = query
        .gte("scanned_at", dayStart.toISOString())
        .lt("scanned_at", dayEnd.toISOString());
    }

    if (student_id) {
      query = query.eq("student_id", student_id);
    }
    if (grade) {
      query = query.eq("grade", grade);
    }
    if (section) {
      query = query.eq("section", section);
    }

    const { data: attendance, error } = await query.order("scanned_at", {
      ascending: false,
    });

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to fetch filtered attendance" });
    }

    res.json(attendance || []);
  })();
});

// Get today's latest attendance record by card UID
app.get("/api/attendance/today-by-uid/:uid", (req, res) => {
  const normalizedUid = normalizeUid(req.params.uid);
  const teachersId = getNormalizedTeacherId(req.query?.teachers_id);

  if (!normalizedUid) {
    return res.status(400).json({ error: "Valid UID is required" });
  }

  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  (async () => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const { data: attendance, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("teachers_id", teachersId)
      .eq("card_uid", normalizedUid)
      .gte("scanned_at", dayStart.toISOString())
      .lt("scanned_at", dayEnd.toISOString())
      .order("scanned_at", { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch attendance" });
    }

    const latest = attendance && attendance.length > 0 ? attendance[0] : null;
    if (!latest) {
      return res
        .status(404)
        .json({ error: "No attendance found for UID today" });
    }

    res.json(latest);
  })();
});

// Export attendance as CSV
app.get("/api/attendance/export", (req, res) => {
  const { date, student_id, grade, section } = req.query;
  const teachersId = getNormalizedTeacherId(req.query?.teachers_id);

  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  (async () => {
    let query = supabase
      .from("attendance")
      .select("*")
      .eq("teachers_id", teachersId);

    if (date) {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      query = query
        .gte("scanned_at", dayStart.toISOString())
        .lt("scanned_at", dayEnd.toISOString());
    }
    if (student_id) {
      query = query.eq("student_id", student_id);
    }
    if (grade) {
      query = query.eq("grade", grade);
    }
    if (section) {
      query = query.eq("section", section);
    }

    const { data: attendance, error } = await query.order("scanned_at", {
      ascending: false,
    });

    if (error) {
      return res.status(500).json({ error: "Failed to export attendance" });
    }

    // Format timestamps to local time with AM/PM
    const formattedAttendance = (attendance || []).map((record) => {
      const newRecord = { ...record };
      if (record.scanned_at) {
        const dateObj = new Date(record.scanned_at);
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, "0");
        const day = String(dateObj.getDate()).padStart(2, "0");
        let hours = dateObj.getHours();
        const minutes = String(dateObj.getMinutes()).padStart(2, "0");
        const seconds = String(dateObj.getSeconds()).padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12 || 12;
        const hoursStr = String(hours).padStart(2, "0");
        newRecord.scanned_at = `${year}-${month}-${day}T${hoursStr}:${minutes}:${seconds} ${ampm}`;
      }
      return newRecord;
    });

    const headers = [
      "id",
      "student_id",
      "card_uid",
      "fullname",
      "grade",
      "section",
      "scanned_at",
    ];
    const csvContent = [
      headers.join(","),
      ...formattedAttendance.map((row) =>
        headers.map((h) => row[h] || "").join(","),
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=attendance_${Date.now()}.csv`,
    );
    res.send(csvContent);
  })();
});

// Test endpoint to simulate RFID scan (for testing without Arduino)
app.post("/api/test-scan", (req, res) => {
  const bridgeKeyFromHeader = String(
    req.headers["x-scanner-bridge-key"] || "",
  ).trim();
  const bridgeKeyFromBody = String(req.body?.bridge_key || "").trim();
  const providedBridgeKey = bridgeKeyFromHeader || bridgeKeyFromBody;

  if (SCANNER_BRIDGE_KEY && providedBridgeKey !== SCANNER_BRIDGE_KEY) {
    return res.status(401).json({ error: "Invalid scanner bridge key" });
  }

  const { uid } = req.body;
  if (!uid) {
    return res.status(400).json({ error: "UID required" });
  }
  handleRFIDScan(uid);
  res.json({ message: "Scan simulated" });
});

// Get stats
app.get("/api/stats", (req, res) => {
  const teachersId = getNormalizedTeacherId(req.query?.teachers_id);

  if (!teachersId) {
    return res.status(400).json({ error: "teachers_id is required" });
  }

  (async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let studentsQuery = supabase.from("students").select("id");
    let scansQuery = supabase.from("attendance").select("scanned_at");

    studentsQuery = studentsQuery.eq("teachers_id", teachersId);
    scansQuery = scansQuery.eq("teachers_id", teachersId);

    const [studentsResult, scansResult] = await Promise.all([
      studentsQuery,
      scansQuery,
    ]);

    if (studentsResult.error || scansResult.error) {
      return res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }

    const students = studentsResult.data || [];
    const attendance = scansResult.data || [];
    const todayScans = attendance.filter(
      (scan) => scan.scanned_at && new Date(scan.scanned_at) >= todayStart,
    );

    res.json({
      totalStudents: students.length,
      totalScans: attendance.length,
      todayScans: todayScans.length,
    });
  })();
});

// ===== START SERVER =====

app.listen(PORT, async () => {
  console.log("\n========================================");
  console.log("🎓 RFID Attendance System");
  console.log("========================================");
  console.log(`\n✓ Server running at http://localhost:${PORT}`);
  console.log("\nInitializing serial connection...");

  await initSerialPort();

  console.log("\n========================================");
  console.log("Ready to accept RFID scans!");
  console.log("========================================\n");
});
