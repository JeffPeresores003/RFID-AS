import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../config";

export default function HistoryPage() {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(() => ({
    date: new Date().toISOString().split("T")[0],
    student_id: "",
    grade: "",
    section: "",
  }));

  const activeFilters = useMemo(() => {
    const cleaned = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value).trim()) cleaned[key] = value;
    });
    return cleaned;
  }, [filters]);

  const loadHistory = async (nextFilters = activeFilters) => {
    try {
      const params = new URLSearchParams(nextFilters);
      const url =
        Object.keys(nextFilters).length > 0
          ? `${API_BASE}/attendance/filter?${params.toString()}`
          : `${API_BASE}/attendance`;

      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to load history");
      const payload = await response.json();
      setRecords(Array.isArray(payload) ? payload : []);
      setError("");
    } catch {
      setError(
        "Failed to load attendance history. Please make sure backend is running.",
      );
      setRecords([]);
    }
  };

  useEffect(() => {
    loadHistory(activeFilters);
    const timer = setInterval(() => {
      loadHistory(activeFilters);
    }, 10000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedByDate = useMemo(() => {
    const grouped = {};
    for (const record of records) {
      const date = record.scanned_at?.split("T")[0];
      if (!date) continue;
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(record);
    }

    return Object.entries(grouped).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [records]);

  return (
    <>
      <h1 className="page-title">Attendance History</h1>
      <p className="page-subtitle">View and export attendance records</p>

      <div className="filters">
        <h3 className="filters-title">Filters</h3>

        <div className="filters-grid">
          <div className="form-group no-margin">
            <label className="form-label" htmlFor="filterDate">
              Date
            </label>
            <input
              id="filterDate"
              type="date"
              className="form-input"
              value={filters.date}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, date: e.target.value }))
              }
            />
          </div>

          <div className="form-group no-margin">
            <label className="form-label" htmlFor="filterStudentId">
              Student ID
            </label>
            <input
              id="filterStudentId"
              className="form-input"
              placeholder="e.g., 2024-001"
              value={filters.student_id}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  student_id: e.target.value.trimStart(),
                }))
              }
            />
          </div>

          <div className="form-group no-margin">
            <label className="form-label" htmlFor="filterGrade">
              Grade
            </label>
            <select
              id="filterGrade"
              className="form-input"
              value={filters.grade}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, grade: e.target.value }))
              }
            >
              <option value="">All Grades</option>
              <option value="7">Grade 7</option>
              <option value="8">Grade 8</option>
              <option value="9">Grade 9</option>
              <option value="10">Grade 10</option>
              <option value="11">Grade 11</option>
              <option value="12">Grade 12</option>
            </select>
          </div>

          <div className="form-group no-margin">
            <label className="form-label" htmlFor="filterSection">
              Section
            </label>
            <input
              id="filterSection"
              className="form-input"
              placeholder="e.g., A"
              value={filters.section}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  section: e.target.value.trimStart(),
                }))
              }
            />
          </div>
        </div>

        <div className="filter-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => loadHistory(activeFilters)}
          >
            Apply Filters
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              const reset = {
                date: "",
                student_id: "",
                grade: "",
                section: "",
              };
              setFilters(reset);
              loadHistory({});
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const params = new URLSearchParams(activeFilters);
              const url = `${API_BASE}/attendance/export${
                params.toString() ? `?${params.toString()}` : ""
              }`;
              window.location.href = url;
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-row wrap">
          <h2 className="card-title card-title-zero">Records</h2>
          <span className="badge badge-primary">
            {records.length} record{records.length !== 1 ? "s" : ""}
          </span>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        {!error && records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No attendance records found</div>
            {Object.keys(activeFilters).length > 0 ? (
              <p className="helper-text">Try adjusting your filters.</p>
            ) : null}
          </div>
        ) : null}

        {!error && groupedByDate.length > 0
          ? groupedByDate.map(([date, dateRecords]) => {
              const dateObj = new Date(`${date}T00:00:00`);
              const formattedDate = dateObj.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              });

              return (
                <div className="history-group" key={date}>
                  <h3 className="history-date">
                    {formattedDate}
                    <span className="badge badge-primary">
                      {dateRecords.length}
                    </span>
                  </h3>

                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Student ID</th>
                          <th>Name</th>
                          <th className="hide-mobile">Card UID</th>
                          <th>Grade</th>
                          <th className="hide-mobile">Section</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateRecords.map((record, index) => (
                          <tr
                            key={`${record.student_id}-${record.scanned_at}-${index}`}
                          >
                            <td>
                              <strong>
                                {record.scanned_at
                                  ? new Date(
                                      record.scanned_at,
                                    ).toLocaleTimeString()
                                  : "N/A"}
                              </strong>
                            </td>
                            <td>{record.student_id || "N/A"}</td>
                            <td>{record.fullname || "N/A"}</td>
                            <td className="hide-mobile">
                              <code className="small-code">
                                {record.card_uid || "N/A"}
                              </code>
                            </td>
                            <td>
                              <span className="badge badge-primary">
                                Grade {record.grade || "N/A"}
                              </span>
                            </td>
                            <td className="hide-mobile">
                              {record.section || "N/A"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </>
  );
}
