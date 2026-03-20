import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../config";
import { getTeacherSession } from "../auth";

const initialForm = {
  student_id: "",
  card_uid: "",
  fullname: "",
  grade: "",
  section: "",
};

export default function RegisterPage() {
  const teacher = getTeacherSession();
  const teacherId = String(teacher?.teachers_id || "").trim();

  const [formData, setFormData] = useState(initialForm);
  const [students, setStudents] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [alert, setAlert] = useState({ type: "", message: "" });
  const [studentSearch, setStudentSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const eventSourceRef = useRef(null);
  const fallbackPollRef = useRef(null);
  const captureStartedAtRef = useRef(0);
  const lastAppliedUidRef = useRef("");

  const availableGrades = useMemo(() => {
    return Array.from(
      new Set(
        students
          .map((student) => String(student?.grade || "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => Number(a) - Number(b));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();

    return students.filter((student) => {
      const studentGrade = String(student?.grade || "").trim();
      const matchesGrade = !gradeFilter || studentGrade === gradeFilter;
      if (!matchesGrade) return false;

      if (!query) return true;

      const studentId = String(student?.student_id || "").toLowerCase();
      const fullName = String(student?.fullname || "").toLowerCase();
      const section = String(student?.section || "").toLowerCase();

      return (
        studentId.includes(query) ||
        fullName.includes(query) ||
        section.includes(query)
      );
    });
  }, [students, studentSearch, gradeFilter]);

  useEffect(() => {
    if (!teacherId) {
      setStudents([]);
      setAlert({
        type: "error",
        message: "No teacher session found. Please sign in again.",
      });
      return;
    }

    let mounted = true;

    const loadStudents = async () => {
      try {
        const query = new URLSearchParams({
          teachers_id: teacherId,
        }).toString();
        const response = await fetch(`${API_BASE}/students?${query}`);
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
  }, [teacherId]);

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

    if (!teacherId) {
      setAlert({
        type: "error",
        message: "No teacher session found. Please sign in again.",
      });
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, teachers_id: teacherId }),
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

      const query = new URLSearchParams({ teachers_id: teacherId }).toString();
      const studentsResponse = await fetch(`${API_BASE}/students?${query}`);
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
                <option value="1">Grade 1</option>
                <option value="2">Grade 2</option>
                <option value="3">Grade 3</option>
                <option value="4">Grade 4</option>
                <option value="5">Grade 5</option>
                <option value="6">Grade 6</option>
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

          <div className="actions-row register-form-actions">
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
        <div className="card-row wrap register-students-toolbar">
          <div className="register-students-left">
            <h2 className="card-title card-title-zero">Registered Students</h2>
            <input
              className="form-input register-students-search"
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search by ID, Name, or Section"
            />
          </div>

          <select
            className="form-input register-students-grade"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
          >
            <option value="">All Grades</option>
            {availableGrades.map((grade) => (
              <option key={grade} value={grade}>
                Grade {grade}
              </option>
            ))}
          </select>
        </div>

        {students.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No students registered yet</div>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">
              No matching students for the current search/filter
            </div>
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
                  {filteredStudents.map((student) => (
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
              Showing {filteredStudents.length} of {students.length} student
              {students.length !== 1 ? "s" : ""}
            </div>
          </>
        )}
      </div>
    </>
  );
}
