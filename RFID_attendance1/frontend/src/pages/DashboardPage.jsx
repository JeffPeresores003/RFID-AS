import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE } from "../config";
import { getTeacherSession } from "../auth";

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return date.toLocaleString();
}

export default function DashboardPage() {
  const teacher = getTeacherSession();
  const teacherId = String(teacher?.teachers_id || "").trim();

  const [stats, setStats] = useState({
    totalStudents: 0,
    todayScans: 0,
    totalScans: 0,
  });
  const [attendance, setAttendance] = useState([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!teacherId) {
      setStats({ totalStudents: 0, todayScans: 0, totalScans: 0 });
      setAttendance([]);
      setLoadError("No teacher session found. Please sign in again.");
      return;
    }

    let mounted = true;
    const query = new URLSearchParams({ teachers_id: teacherId }).toString();

    const loadStats = async () => {
      try {
        const response = await fetch(`${API_BASE}/stats?${query}`);
        if (!response.ok) throw new Error("Failed to load stats");
        const payload = await response.json();
        if (mounted) {
          setStats({
            totalStudents: payload.totalStudents || 0,
            todayScans: payload.todayScans || 0,
            totalScans: payload.totalScans || 0,
          });
        }
      } catch {
        if (mounted) setLoadError("Failed to load dashboard statistics.");
      }
    };

    const loadRecentScans = async () => {
      try {
        const response = await fetch(`${API_BASE}/attendance?${query}`);
        if (!response.ok) throw new Error("Failed to load attendance");
        const payload = await response.json();
        if (mounted) {
          setAttendance(Array.isArray(payload) ? payload : []);
          setLoadError("");
        }
      } catch {
        if (mounted) {
          setLoadError(
            "Failed to load recent scans. Make sure backend is running.",
          );
        }
      }
    };

    const loadAll = async () => {
      await Promise.all([loadStats(), loadRecentScans()]);
    };

    loadAll();
    const timer = setInterval(loadAll, 5000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [teacherId]);

  const recentScans = useMemo(() => attendance.slice(0, 5), [attendance]);

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const currentDateLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div className="card dashboard-welcome-card">
        <div className="dashboard-welcome-row">
          <div>
            <div className="dashboard-welcome-greeting">
              {greeting}, {teacher?.fullname || "Teacher"}
            </div>
            <p className="dashboard-welcome-intro">
              Welcome to the RFID Attendance System
            </p>
          </div>
          <div className="dashboard-welcome-meta">
            <div className="dashboard-welcome-id">
              TEACHER ID: {teacher?.teachers_id || "N/A"}
            </div>
            <div className="dashboard-welcome-date">{currentDateLabel}</div>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Students</div>
          <div className="stat-value">{stats.totalStudents}</div>
        </div>
        <div className="stat-card stat-secondary">
          <div className="stat-label">Today&apos;s Scans</div>
          <div className="stat-value">{stats.todayScans}</div>
        </div>
        <div className="stat-card stat-warning">
          <div className="stat-label">Total Scans</div>
          <div className="stat-value">{stats.totalScans}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Quick Actions</h2>
        <div className="form-grid">
          <Link to="/register" className="btn btn-primary btn-center">
            Register New Student
          </Link>
          <Link to="/scanner" className="btn btn-secondary btn-center">
            Start Scanning
          </Link>
          <Link to="/history" className="btn btn-outline btn-center">
            View History
          </Link>
          <button
            type="button"
            onClick={() => {
              const exportQuery = new URLSearchParams({
                teachers_id: teacherId,
              }).toString();
              window.location.href = `${API_BASE}/attendance/export?${exportQuery}`;
            }}
            className="btn btn-outline"
          >
            Export Data
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Recent Scans</h2>

        {loadError ? (
          <div className="alert alert-error">{loadError}</div>
        ) : null}

        {!loadError && recentScans.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No scans yet</div>
          </div>
        ) : null}

        {!loadError && recentScans.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th className="hide-mobile">Grade</th>
                  <th className="hide-mobile">Section</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentScans.map((scan, index) => (
                  <tr key={`${scan.student_id}-${scan.scanned_at}-${index}`}>
                    <td>{scan.student_id}</td>
                    <td>
                      <strong>{scan.fullname}</strong>
                    </td>
                    <td className="hide-mobile">{scan.grade}</td>
                    <td className="hide-mobile">{scan.section}</td>
                    <td>{formatTimestamp(scan.scanned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}
