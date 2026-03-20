import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../config";

const initialForm = {
  student_id: "",
  card_uid: "",
  fullname: "",
  grade: "",
  section: "",
};

export default function RegisterPage() {
  const [formData, setFormData] = useState(initialForm);
  const [students, setStudents] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [alert, setAlert] = useState({ type: "", message: "" });
  const eventSourceRef = useRef(null);
  const fallbackPollRef = useRef(null);
  const captureStartedAtRef = useRef(0);
  const lastAppliedUidRef = useRef("");

  useEffect(() => {
    let mounted = true;

    const loadStudents = async () => {
      try {
        const response = await fetch(`${API_BASE}/students`);
        if (!response.ok) throw new Error("Failed to load students");
        const payload = await response.json();
        if (mounted) setStudents(Array.isArray(payload) ? payload : []);
      } catch {
        if (mounted) {
          setAlert({
            type: "error",
            message:
              "Failed to load students. Please make sure backend is running.",
          });
        }
      }
    };

    loadStudents();
    const timer = setInterval(loadStudents, 10000);

    return () => {
      mounted = false;
      clearInterval(timer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fallbackPollRef.current) {
        clearInterval(fallbackPollRef.current);
        fallbackPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!alert.message) return undefined;
    const timer = setTimeout(() => {
      setAlert({ type: "", message: "" });
    }, 5000);
    return () => clearTimeout(timer);
  }, [alert]);

  const stopUIDCapture = () => {
    setIsCapturing(false);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (fallbackPollRef.current) {
      clearInterval(fallbackPollRef.current);
      fallbackPollRef.current = null;
    }
  };

  const applyCapturedUid = (uid) => {
    const normalizedUid = String(uid || "")
      .trim()
      .toUpperCase();
    if (!normalizedUid) return;
    if (lastAppliedUidRef.current === normalizedUid) return;

    lastAppliedUidRef.current = normalizedUid;
    setFormData((prev) => ({ ...prev, card_uid: normalizedUid }));
    setAlert({
      type: "success",
      message: `Card UID captured: ${normalizedUid}`,
    });
    stopUIDCapture();
  };

  const startUIDCapture = () => {
    if (isCapturing) {
      stopUIDCapture();
      return;
    }

    setIsCapturing(true);
    captureStartedAtRef.current = Date.now();
    lastAppliedUidRef.current = "";
    setAlert({ type: "info", message: "Ready to scan. Tap your RFID card." });

    const eventSource = new EventSource(`${API_BASE}/scan-events`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      const capturedUid =
        data?.uid ||
        data?.card_uid ||
        data?.cardUid ||
        data?.UID ||
        data?.student?.card_uid;

      if (capturedUid) {
        applyCapturedUid(capturedUid);
      }
    };

    eventSource.onerror = () => {
      setAlert({
        type: "error",
        message: "Connection to scanner lost. Please try again.",
      });
    };

    // Fallback polling path when SSE delivery is flaky behind proxy/network.
    fallbackPollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/scanner/last-capture`, {
          cache: "no-store",
        });

        if (response.status === 204) return;
        if (!response.ok) return;

        const payload = await response.json();
        if (!payload?.uid) return;

        const capturedAt = payload.timestamp
          ? new Date(payload.timestamp).getTime()
          : 0;

        // Ignore captures that happened well before the current scan session.
        if (capturedAt && capturedAt < captureStartedAtRef.current - 1000) {
          return;
        }

        applyCapturedUid(payload.uid);
      } catch {
        // Keep polling while capture mode is active.
      }
    }, 700);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok) {
        setAlert({
          type: "error",
          message: result.error || "Failed to register student",
        });
        return;
      }

      setAlert({
        type: "success",
        message: `${formData.fullname} has been registered successfully!`,
      });
      setFormData(initialForm);
      stopUIDCapture();

      const studentsResponse = await fetch(`${API_BASE}/students`);
      const studentsPayload = await studentsResponse.json();
      setStudents(Array.isArray(studentsPayload) ? studentsPayload : []);
    } catch {
      setAlert({
        type: "error",
        message: "Failed to connect to backend server.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Register Student</h1>
      <p className="page-subtitle">
        Add a new student to the RFID attendance system
      </p>

      {alert.message ? (
        <div className={`alert alert-${alert.type}`}>{alert.message}</div>
      ) : null}

      <div className="card">
        <h2 className="card-title">Student Information</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="studentId">
                Student ID *
              </label>
              <input
                id="studentId"
                className="form-input"
                required
                value={formData.student_id}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    student_id: e.target.value.trimStart(),
                  }))
                }
                placeholder="e.g., 2024-001"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="cardUid">
                Card UID *
              </label>
              <div className="inline-row">
                <input
                  id="cardUid"
                  className={`form-input ${isCapturing ? "pulse" : ""}`}
                  required
                  value={formData.card_uid}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      card_uid: e.target.value.trimStart(),
                    }))
                  }
                  placeholder={
                    isCapturing
                      ? "Waiting for card scan..."
                      : "e.g., 61 64 96 17"
                  }
                />
                <button
                  type="button"
                  onClick={startUIDCapture}
                  className={`btn ${isCapturing ? "btn-danger" : "btn-secondary"}`}
                >
                  {isCapturing ? "Stop" : "Scan"}
                </button>
              </div>
              <small className="form-help">
                Click scan to capture UID from RFID card.
              </small>
            </div>

            <div className="form-group form-grid-full">
              <label className="form-label" htmlFor="fullname">
                Full Name *
              </label>
              <input
                id="fullname"
                className="form-input"
                required
                value={formData.fullname}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    fullname: e.target.value.trimStart(),
                  }))
                }
                placeholder="e.g., Juan Dela Cruz"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="grade">
                Grade *
              </label>
              <select
                id="grade"
                className="form-input"
                required
                value={formData.grade}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, grade: e.target.value }))
                }
              >
                <option value="">Select Grade</option>
                <option value="7">Grade 7</option>
                <option value="8">Grade 8</option>
                <option value="9">Grade 9</option>
                <option value="10">Grade 10</option>
                <option value="11">Grade 11</option>
                <option value="12">Grade 12</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="section">
                Section *
              </label>
              <input
                id="section"
                className="form-input"
                required
                value={formData.section}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    section: e.target.value.trimStart(),
                  }))
                }
                placeholder="e.g., A, B, Einstein"
              />
            </div>
          </div>

          <div className="actions-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Registering..." : "Register Student"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setFormData(initialForm);
                stopUIDCapture();
              }}
            >
              Clear Form
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card-title">Registered Students</h2>

        {students.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No students registered yet</div>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th className="hide-mobile">Card UID</th>
                    <th>Grade</th>
                    <th className="hide-mobile">Section</th>
                    <th className="hide-mobile">Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={`${student.student_id}-${student.card_uid}`}>
                      <td>
                        <strong>{student.student_id}</strong>
                      </td>
                      <td>{student.fullname}</td>
                      <td className="hide-mobile">
                        <code>{student.card_uid}</code>
                      </td>
                      <td>
                        <span className="badge badge-primary">
                          Grade {student.grade}
                        </span>
                      </td>
                      <td className="hide-mobile">{student.section}</td>
                      <td className="hide-mobile">
                        {student.registered_date
                          ? new Date(
                              student.registered_date,
                            ).toLocaleDateString()
                          : "N/A"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-summary">
              Total: {students.length} student{students.length !== 1 ? "s" : ""}
            </div>
          </>
        )}
      </div>
    </>
  );
}
