import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE } from "../config";

function formatTimestamp(timestamp) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp || "N/A";
  }
  return parsed.toLocaleString();
}

function normalizeUid(uid) {
  return String(uid || "")
    .trim()
    .toUpperCase()
    .replace(/[-:]+/g, " ")
    .replace(/\s+/g, " ");
}

function getLocalDateIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function playTone() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.06;

    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.1);
  } catch {
    // no-op
  }
}

function getScannerSseUrl() {
  // Vite proxy can intermittently drop long-lived SSE streams in dev.
  if (import.meta.env.DEV) {
    return "http://localhost:3000/api/scan-events?mode=scanner";
  }
  return `${API_BASE}/scan-events?mode=scanner`;
}

function getScannerApiBase() {
  if (import.meta.env.DEV) {
    return "http://localhost:3000/api";
  }
  return API_BASE;
}

async function setScannerMode(enabled) {
  const apiBase = getScannerApiBase();
  const endpoint = enabled
    ? `${apiBase}/scanner/start`
    : `${apiBase}/scanner/stop`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error("Failed to update scanner mode");
  }
}

export default function ScannerPage() {
  const [isScanning, setIsScanning] = useState(false);
  const [connectionState, setConnectionState] = useState("idle");
  const [lastScan, setLastScan] = useState(null);
  const [todayScans, setTodayScans] = useState([]);
  const [pageError, setPageError] = useState("");
  const [isActivated, setIsActivated] = useState(false);

  const eventSourceRef = useRef(null);
  const todayScansRef = useRef([]);
  const clearScanStatusTimer = useRef(null);
  const fadeScanStatusTimer = useRef(null);
  const capturePollTimerRef = useRef(null);
  const scanningStateRef = useRef(false);
  const scanSessionStartedAtRef = useRef(0);
  const lastNotifiedScanKeyRef = useRef("");
  const lastShownDuplicateRef = useRef({ uid: "", at: 0 });
  const lastProcessedCaptureRef = useRef(null); // Track exact capture (uid + timestamp) to avoid reprocessing

  const toScanKey = (scan) =>
    `${scan?.student_id || ""}|${scan?.scanned_at || ""}|${scan?.card_uid || ""}`;

  const clearLastScanTimers = () => {
    if (clearScanStatusTimer.current) {
      clearTimeout(clearScanStatusTimer.current);
      clearScanStatusTimer.current = null;
    }
    if (fadeScanStatusTimer.current) {
      clearTimeout(fadeScanStatusTimer.current);
      fadeScanStatusTimer.current = null;
    }
  };

  const closeEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const stopCapturePolling = () => {
    if (capturePollTimerRef.current) {
      clearInterval(capturePollTimerRef.current);
      capturePollTimerRef.current = null;
    }
  };

  const findTodayScanByUid = (uid, source = todayScansRef.current) => {
    const normalizedUid = normalizeUid(uid);
    if (!normalizedUid) return null;
    return (
      source.find((scan) => normalizeUid(scan.card_uid) === normalizedUid) ||
      null
    );
  };

  const showDuplicateNotice = (scanRecord) => {
    if (!scanRecord) return;
    presentScanResult(
      {
        status: "duplicate",
        message: "Already scanned today",
        student: {
          student_id: scanRecord.student_id,
          fullname: scanRecord.fullname,
          grade: scanRecord.grade,
          section: scanRecord.section,
          card_uid: scanRecord.card_uid,
        },
        previous_scan: scanRecord.scanned_at,
        timestamp: new Date().toISOString(),
      },
      true, // skipSound = true for duplicates
    );
  };

  const refreshTodayAndFindUid = async (uid) => {
    const normalizedUid = normalizeUid(uid);
    if (!normalizedUid) return null;

    try {
      const apiBase = getScannerApiBase();
      const today = getLocalDateIso();
      const response = await fetch(
        `${apiBase}/attendance/filter?date=${today}`,
      );
      if (!response.ok) return null;

      const scans = await response.json();
      const scanList = Array.isArray(scans) ? scans : [];
      todayScansRef.current = scanList;
      setTodayScans(scanList);

      const matchingFromList = findTodayScanByUid(normalizedUid, scanList);
      if (matchingFromList) {
        return matchingFromList;
      }

      // Fallback: ask backend directly for today's latest scan by UID.
      const uidResponse = await fetch(
        `${apiBase}/attendance/today-by-uid/${encodeURIComponent(normalizedUid)}`,
      );

      if (uidResponse.ok) {
        const latestScan = await uidResponse.json();
        if (!latestScan || typeof latestScan !== "object") {
          return null;
        }

        const mergedScans = [latestScan, ...scanList].sort(
          (a, b) =>
            new Date(b?.scanned_at || 0).getTime() -
            new Date(a?.scanned_at || 0).getTime(),
        );
        todayScansRef.current = mergedScans;
        setTodayScans(mergedScans);

        return latestScan;
      }

      // Final fallback when /today-by-uid is unavailable (older backend build).
      const historyResponse = await fetch(`${apiBase}/attendance`);
      if (!historyResponse.ok) {
        return null;
      }

      const attendanceHistory = await historyResponse.json();
      const historyList = Array.isArray(attendanceHistory)
        ? attendanceHistory
        : [];

      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const historyMatch = historyList.find((record) => {
        if (normalizeUid(record?.card_uid) !== normalizedUid) return false;
        const scannedAt = record?.scanned_at
          ? new Date(record.scanned_at).getTime()
          : 0;
        return scannedAt >= dayStart.getTime() && scannedAt < dayEnd.getTime();
      });

      if (!historyMatch) {
        return null;
      }

      const mergedScans = [historyMatch, ...scanList]
        .filter(
          (scan, index, source) =>
            source.findIndex(
              (candidate) => toScanKey(candidate) === toScanKey(scan),
            ) === index,
        )
        .sort(
          (a, b) =>
            new Date(b?.scanned_at || 0).getTime() -
            new Date(a?.scanned_at || 0).getTime(),
        );
      todayScansRef.current = mergedScans;
      setTodayScans(mergedScans);

      return historyMatch;
    } catch {
      return null;
    }
  };

  const handleCapturedUid = async (uid, timestamp = "") => {
    // This function is no longer used. Duplicate detection is now
    // handled only by the backend's explicit success/duplicate events.
  };

  const startCapturePolling = () => {
    stopCapturePolling();

    capturePollTimerRef.current = setInterval(async () => {
      if (!scanningStateRef.current) return;

      try {
        const apiBase = getScannerApiBase();
        const response = await fetch(`${apiBase}/scanner/last-capture`, {
          cache: "no-store",
        });

        if (response.status === 204 || !response.ok) {
          return;
        }

        const payload = await response.json();
        if (!payload?.uid) return;

        const capturedAtMs = payload.timestamp
          ? new Date(payload.timestamp).getTime()
          : 0;
        if (
          capturedAtMs &&
          scanSessionStartedAtRef.current > 0 &&
          capturedAtMs < scanSessionStartedAtRef.current - 1000
        ) {
          return;
        }

        // Polling fallback: check if this UID is already in today's scans
        const normalizedUid = normalizeUid(payload.uid);

        // Check if this is the exact same capture we already processed (avoids reprocessing same hardware event)
        const captureKey = `${normalizedUid}|${payload.timestamp || 0}`;
        const lastCapture = lastProcessedCaptureRef.current;
        if (lastCapture === captureKey) {
          // Same capture we already handled, skip
          return;
        }
        // Mark this capture as processed
        lastProcessedCaptureRef.current = captureKey;

        const now = Date.now();

        const existingScan = findTodayScanByUid(normalizedUid);
        if (existingScan) {
          // Dedup: only show duplicate notice once per card (with 2s cooldown)
          const lastShown = lastShownDuplicateRef.current;
          if (lastShown.uid === normalizedUid && now - lastShown.at < 2000) {
            // Already shown this duplicate recently, skip
            return;
          }

          // Mark this duplicate as shown
          lastShownDuplicateRef.current = { uid: normalizedUid, at: now };

          showDuplicateNotice(existingScan);
          return;
        }

        // Polling is just a fallback for missed SSE messages.
        // The backend's success/duplicate event determines the outcome.
        // Don't do duplicate checking here.
      } catch {
        // Keep polling in background while scanning is active.
      }
    }, 700);
  };

  const presentScanResult = (data, skipSound = false) => {
    if (!skipSound) {
      playTone(); // Only play tone for new successful scans, not duplicates
    }
    setLastScan({ data, fading: false });

    clearLastScanTimers();

    fadeScanStatusTimer.current = setTimeout(() => {
      setLastScan((prev) => (prev ? { ...prev, fading: true } : prev));
    }, 2700);

    clearScanStatusTimer.current = setTimeout(() => {
      setLastScan(null);
    }, 3000);
  };

  const loadTodayScans = useCallback(async () => {
    try {
      const apiBase = getScannerApiBase();
      const today = getLocalDateIso();
      const response = await fetch(
        `${apiBase}/attendance/filter?date=${today}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load scans");
      }
      const scans = await response.json();
      const scanList = Array.isArray(scans) ? scans : [];
      todayScansRef.current = scanList;
      setTodayScans(scanList);
      setPageError("");

      if (scanList.length > 0) {
        const newest = scanList[0];
        const newestKey = toScanKey(newest);

        if (!scanningStateRef.current && newestKey) {
          // Keep baseline updated while scanner is not running.
          lastNotifiedScanKeyRef.current = newestKey;
        }

        if (scanningStateRef.current && scanSessionStartedAtRef.current > 0) {
          const newestTs = newest.scanned_at
            ? new Date(newest.scanned_at).getTime()
            : 0;
          const isNewThisSession = newestTs >= scanSessionStartedAtRef.current;
          const isUnseen =
            newestKey && newestKey !== lastNotifiedScanKeyRef.current;

          if (isNewThisSession && isUnseen) {
            lastNotifiedScanKeyRef.current = newestKey;
            presentScanResult({
              status: "success",
              message: "Attendance recorded",
              student: {
                student_id: newest.student_id,
                fullname: newest.fullname,
                grade: newest.grade,
                section: newest.section,
                card_uid: newest.card_uid,
              },
              timestamp: newest.scanned_at || new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      setPageError(
        "Failed to load today's attendance. Please check backend connection.",
      );
      setTodayScans([]);
    }
  }, []);

  useEffect(() => {
    loadTodayScans();
    const interval = setInterval(loadTodayScans, 10000);

    return () => {
      clearInterval(interval);
      const wasScanning = scanningStateRef.current;
      scanningStateRef.current = false;

      if (wasScanning) {
        fetch(`${getScannerApiBase()}/scanner/stop`, {
          method: "POST",
          keepalive: true,
        }).catch(() => {});
      }

      closeEventSource();
      stopCapturePolling();
      clearLastScanTimers();
    };
  }, [loadTodayScans]);

  const handleScanEvent = (data) => {
    if (!["success", "duplicate", "error"].includes(data?.status)) {
      return;
    }

    if (data.status === "success") {
      const successKey = `${data?.student?.student_id || ""}|${data?.timestamp || ""}|${data?.student?.card_uid || ""}`;
      if (successKey) {
        lastNotifiedScanKeyRef.current = successKey;
      }
    }

    // Skip sound for duplicates, play for success/error
    const skipSound = data.status === "duplicate";
    presentScanResult(data, skipSound);

    loadTodayScans();
  };

  const startScanning = async () => {
    if (scanningStateRef.current) return;

    scanningStateRef.current = true;
    scanSessionStartedAtRef.current = Date.now();
    setIsActivated(false);
    setIsScanning(true);
    setConnectionState("connecting");
    setPageError("");

    if (todayScans.length > 0) {
      lastNotifiedScanKeyRef.current = toScanKey(todayScans[0]);
    } else {
      lastNotifiedScanKeyRef.current = "";
    }

    try {
      await setScannerMode(true);
    } catch {
      setIsScanning(false);
      setConnectionState("disconnected");
      scanningStateRef.current = false;
      setPageError("Failed to enable scanner mode on backend.");
      return;
    }

    closeEventSource();
    startCapturePolling();
    const eventSource = new EventSource(getScannerSseUrl());
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnectionState("active");
      setIsActivated(true);
      setPageError("");
    };

    eventSource.onmessage = async (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.clientId) {
        // Handshake packet only; scanner mode already enabled by query param.
        return;
      }

      if (data.status === "capture") {
        // Capture events are just UID detection signals.
        // Let the backend's success/duplicate response determine the outcome.
        return;
      }

      handleScanEvent(data);
    };

    eventSource.onerror = async () => {
      closeEventSource();
      stopCapturePolling();
      if (!scanningStateRef.current) return;

      try {
        await setScannerMode(false);
      } catch {
        // Ignore stop errors; connection is already down.
      }

      setConnectionState("disconnected");
      setIsScanning(false);
      setIsActivated(false);
      scanningStateRef.current = false;
      scanSessionStartedAtRef.current = 0;
      setPageError(
        "Scanner connection lost. Click Start Scanning to reconnect.",
      );
    };
  };

  const stopScanning = async () => {
    scanningStateRef.current = false;
    scanSessionStartedAtRef.current = 0;
    lastShownDuplicateRef.current = { uid: "", at: 0 };
    setIsScanning(false);
    setIsActivated(false);
    setConnectionState("idle");
    closeEventSource();
    stopCapturePolling();
    setPageError("");

    try {
      await setScannerMode(false);
    } catch {
      // Keep UI responsive even if backend stop call fails.
    }
  };

  const toggleScanning = async () => {
    if (isScanning) {
      await stopScanning();
      return;
    }
    await startScanning();
  };

  return (
    <>
      <h1 className="page-title">RFID Scanner</h1>
      <p className="page-subtitle">Real-time attendance monitoring</p>

      <div className="card scanner-card">
        <div id="scannerStatus">
          <div
            className={`scan-icon ${connectionState === "active" ? "pulse" : ""}`}
          >
            RFID
          </div>

          {connectionState === "active" ? (
            <>
              <div className="scan-message secondary">Scanner Active</div>
              <div className="helper-text">
                {isActivated
                  ? "Ready to scan RFID cards."
                  : "Finalizing scanner activation..."}
              </div>
            </>
          ) : null}

          {connectionState === "connecting" ? (
            <>
              <div className="scan-message warning">Connecting Scanner...</div>
              <div className="helper-text">
                Preparing real-time scan channel.
              </div>
            </>
          ) : null}

          {connectionState === "idle" ? (
            <>
              <div className="scan-message light">Scanner Ready</div>
              <div className="helper-text">
                Click the button below to start scanning.
              </div>
            </>
          ) : null}

          {connectionState === "disconnected" ? (
            <>
              <div className="scan-message danger">Scanner Disconnected</div>
              <div className="helper-text">
                Click Start Scanning to reconnect.
              </div>
            </>
          ) : null}
        </div>

        <div className="scanner-actions">
          <button
            id="toggleScanBtn"
            className={`btn ${isScanning ? "btn-danger" : "btn-primary"}`}
            onClick={toggleScanning}
            type="button"
          >
            {isScanning ? "Stop Scanning" : "Start Scanning"}
          </button>
        </div>
      </div>

      {pageError ? <div className="alert alert-error">{pageError}</div> : null}

      {lastScan ? (
        <div className={`scan-status ${lastScan.fading ? "fade-out" : ""}`}>
          {lastScan.data.status === "success" ? (
            <>
              <div className="scan-message secondary">Attendance Recorded</div>
              <div className="scan-student-info">
                <div className="scan-student-name">
                  {lastScan.data.student?.fullname}
                </div>
                <div className="scan-grid">
                  <div>
                    <strong>ID:</strong> {lastScan.data.student?.student_id}
                  </div>
                  <div>
                    <strong>Grade:</strong> {lastScan.data.student?.grade}
                  </div>
                  <div>
                    <strong>Section:</strong> {lastScan.data.student?.section}
                  </div>
                </div>
                <div className="helper-text">
                  {formatTimestamp(lastScan.data.timestamp)}
                </div>
              </div>
            </>
          ) : null}

          {lastScan.data.status === "duplicate" ? (
            <>
              <div className="scan-message warning">Already Scanned Today</div>
              <div className="scan-student-info">
                <div className="scan-student-name">
                  {lastScan.data.student?.fullname}
                </div>
                <div className="scan-grid">
                  <div>
                    <strong>ID:</strong> {lastScan.data.student?.student_id}
                  </div>
                  <div>
                    <strong>Grade:</strong> {lastScan.data.student?.grade}
                  </div>
                  <div>
                    <strong>Section:</strong> {lastScan.data.student?.section}
                  </div>
                </div>
                <div className="duplicate-box">
                  <div>Previous scan:</div>
                  <div className="helper-text">
                    {lastScan.data.previous_scan
                      ? formatTimestamp(lastScan.data.previous_scan)
                      : "Earlier today"}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {lastScan.data.status === "error" ? (
            <>
              <div className="scan-message danger">
                {lastScan.data.message || "Scan failed"}
              </div>
              <div className="scan-details">
                {lastScan.data.uid ? (
                  <div className="duplicate-box">
                    <strong>Card UID:</strong> <code>{lastScan.data.uid}</code>
                  </div>
                ) : null}
                {lastScan.data.message === "Card not registered" ? (
                  <div className="scanner-actions">
                    <Link to="/register" className="btn btn-primary">
                      Register This Card
                    </Link>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <div className="card-row">
          <h2 className="card-title card-title-zero">Today&apos;s Scans</h2>
          <span className="badge badge-primary">{todayScans.length}</span>
        </div>

        {todayScans.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No scans yet today</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th className="hide-mobile">Grade</th>
                  <th className="hide-mobile">Section</th>
                </tr>
              </thead>
              <tbody>
                {todayScans.map((scan, index) => (
                  <tr key={`${scan.student_id}-${scan.scanned_at}-${index}`}>
                    <td>
                      <strong>
                        {scan.scanned_at
                          ? new Date(scan.scanned_at).toLocaleTimeString()
                          : "N/A"}
                      </strong>
                    </td>
                    <td>{scan.student_id || "N/A"}</td>
                    <td>{scan.fullname || "N/A"}</td>
                    <td className="hide-mobile">
                      <span className="badge badge-primary">
                        Grade {scan.grade || "N/A"}
                      </span>
                    </td>
                    <td className="hide-mobile">{scan.section || "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
