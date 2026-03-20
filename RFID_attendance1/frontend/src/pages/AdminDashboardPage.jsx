import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../config";
import { clearAdminSession, getAdminSession } from "../auth";

const initialTeacherForm = {
  teachers_id: "",
  fullname: "",
  email: "",
  password: "",
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const session = getAdminSession();
  const token = session?.token || "";

  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState(initialTeacherForm);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionTeacherId, setActionTeacherId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewTeacher, setViewTeacher] = useState(null);
  const [editTeacher, setEditTeacher] = useState(null);
  const [editForm, setEditForm] = useState(initialTeacherForm);

  useEffect(() => {
    if (!success) return undefined;

    const timeoutId = window.setTimeout(() => {
      setSuccess("");
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [success]);

  useEffect(() => {
    if (!token) {
      navigate("/admin/signin", { replace: true });
      return;
    }

    let mounted = true;

    const loadTeachers = async () => {
      setLoadingTeachers(true);
      setError("");

      try {
        const response = await fetch(`${API_BASE}/admin/teachers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const payload = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            clearAdminSession();
            navigate("/admin/signin", { replace: true });
            return;
          }
          throw new Error(payload?.error || "Failed to load teachers");
        }

        if (mounted) {
          setTeachers(Array.isArray(payload?.teachers) ? payload.teachers : []);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || "Failed to load teachers");
        }
      } finally {
        if (mounted) setLoadingTeachers(false);
      }
    };

    loadTeachers();

    return () => {
      mounted = false;
    };
  }, [navigate, token]);

  const handleSignOut = async () => {
    try {
      if (token) {
        await fetch(`${API_BASE}/admin/auth/signout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch {
      // Ignore sign-out API failures and clear local session.
    }

    clearAdminSession();
    navigate("/admin/signin", { replace: true });
  };

  const handleAddTeacher = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const payload = {
      teachers_id: String(form.teachers_id || "").trim(),
      fullname: String(form.fullname || "").trim(),
      email: String(form.email || "")
        .trim()
        .toLowerCase(),
      password: String(form.password || ""),
    };

    if (
      !payload.teachers_id ||
      !payload.fullname ||
      !payload.email ||
      !payload.password
    ) {
      setError("All teacher fields are required.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/admin/teachers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          clearAdminSession();
          navigate("/admin/signin", { replace: true });
          return;
        }
        throw new Error(body?.error || "Failed to add teacher");
      }

      setSuccess("Teacher account created successfully.");
      setForm(initialTeacherForm);
      setTeachers((prev) => [body.teacher, ...prev]);
    } catch (err) {
      setError(err.message || "Failed to add teacher");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenTeacherView = async (teacherId) => {
    setError("");
    setSuccess("");
    setActionTeacherId(String(teacherId));

    try {
      const response = await fetch(`${API_BASE}/admin/teachers/${teacherId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          clearAdminSession();
          navigate("/admin/signin", { replace: true });
          return;
        }
        throw new Error(payload?.error || "Failed to load teacher details");
      }

      setViewTeacher(payload.teacher || null);
    } catch (err) {
      setError(err.message || "Failed to load teacher details");
    } finally {
      setActionTeacherId("");
    }
  };

  const handleOpenTeacherEdit = async (teacherId) => {
    setError("");
    setSuccess("");
    setActionTeacherId(String(teacherId));

    try {
      const response = await fetch(`${API_BASE}/admin/teachers/${teacherId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          clearAdminSession();
          navigate("/admin/signin", { replace: true });
          return;
        }
        throw new Error(payload?.error || "Failed to load teacher details");
      }

      const teacher = payload.teacher || null;
      setEditTeacher(teacher);
      setEditForm({
        teachers_id: String(teacher?.teachers_id || ""),
        fullname: String(teacher?.fullname || ""),
        email: String(teacher?.email || ""),
        password: String(teacher?.password || ""),
      });
    } catch (err) {
      setError(err.message || "Failed to load teacher details");
    } finally {
      setActionTeacherId("");
    }
  };

  const handleSaveTeacherEdit = async (event) => {
    event.preventDefault();
    if (!editTeacher?.id) {
      setError("No teacher selected for edit.");
      return;
    }

    setError("");
    setSuccess("");

    const payload = {
      teachers_id: String(editForm.teachers_id || "").trim(),
      fullname: String(editForm.fullname || "").trim(),
      email: String(editForm.email || "")
        .trim()
        .toLowerCase(),
      password: String(editForm.password || ""),
    };

    if (
      !payload.teachers_id ||
      !payload.fullname ||
      !payload.email ||
      !payload.password
    ) {
      setError("All teacher fields are required.");
      return;
    }

    setSavingEdit(true);

    try {
      const response = await fetch(
        `${API_BASE}/admin/teachers/${editTeacher.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          clearAdminSession();
          navigate("/admin/signin", { replace: true });
          return;
        }
        throw new Error(body?.error || "Failed to update teacher");
      }

      setTeachers((prev) =>
        prev.map((teacher) =>
          teacher.id === body.teacher.id
            ? {
                ...teacher,
                teachers_id: body.teacher.teachers_id,
                fullname: body.teacher.fullname,
                email: body.teacher.email,
                updated_at: body.teacher.updated_at,
              }
            : teacher,
        ),
      );

      setSuccess("Teacher account updated successfully.");
      setEditTeacher(null);
      setEditForm(initialTeacherForm);
    } catch (err) {
      setError(err.message || "Failed to update teacher");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="container admin-dashboard-shell">
      <div className="admin-dashboard-top card">
        <div>
          <h2 className="card-title">Admin Dashboard</h2>
          <p className="admin-dashboard-meta">
            Signed in as{" "}
            {session?.admin?.fullname || session?.admin?.email || "Admin"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={handleSignOut}
        >
          Sign Out
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <section className="card">
        <h3 className="card-title">Add Teacher Credentials</h3>
        <form onSubmit={handleAddTeacher} className="form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="teacherId">
              Teacher ID
            </label>
            <input
              id="teacherId"
              className="form-input"
              type="text"
              placeholder="TCH-0003"
              value={form.teachers_id}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  teachers_id: event.target.value,
                }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="teacherName">
              Full Name
            </label>
            <input
              id="teacherName"
              className="form-input"
              type="text"
              placeholder="Teacher Name"
              value={form.fullname}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, fullname: event.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="teacherEmail">
              Email
            </label>
            <input
              id="teacherEmail"
              className="form-input"
              type="email"
              placeholder="teacher@school.edu"
              value={form.email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="teacherPassword">
              Password
            </label>
            <input
              id="teacherPassword"
              className="form-input"
              type="password"
              placeholder="Min. 6 characters"
              value={form.password}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, password: event.target.value }))
              }
            />
          </div>
          <div className="form-grid-full admin-add-teacher-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Adding..." : "Add Teacher"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3 className="card-title">All Teachers</h3>
        {loadingTeachers ? (
          <div className="alert alert-info">Loading teachers...</div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Teacher ID</th>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Created At</th>
                  <th>Updated At</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {teachers.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No teachers found.</td>
                  </tr>
                ) : (
                  teachers.map((teacher) => (
                    <tr key={teacher.id}>
                      <td>{teacher.teachers_id}</td>
                      <td>{teacher.fullname}</td>
                      <td>{teacher.email}</td>
                      <td>{formatDate(teacher.created_at)}</td>
                      <td>{formatDate(teacher.updated_at)}</td>
                      <td>
                        <div className="admin-table-actions">
                          <button
                            type="button"
                            className="action-icon-btn"
                            title="View teacher info"
                            aria-label={`View ${teacher.fullname}`}
                            onClick={() => handleOpenTeacherView(teacher.id)}
                            disabled={actionTeacherId === String(teacher.id)}
                          >
                            &#128065;
                          </button>
                          <button
                            type="button"
                            className="action-icon-btn"
                            title="Edit teacher info"
                            aria-label={`Edit ${teacher.fullname}`}
                            onClick={() => handleOpenTeacherEdit(teacher.id)}
                            disabled={actionTeacherId === String(teacher.id)}
                          >
                            &#9998;
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewTeacher ? (
        <div
          className="confirm-modal-overlay"
          onClick={() => setViewTeacher(null)}
          role="presentation"
        >
          <div
            className="confirm-modal admin-teacher-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-teacher-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="view-teacher-title" className="card-title card-title-zero">
              Teacher Information
            </h3>
            <div className="admin-modal-grid">
              <div className="admin-modal-field">
                <span>Teacher ID</span>
                <strong>{viewTeacher.teachers_id}</strong>
              </div>
              <div className="admin-modal-field">
                <span>Full Name</span>
                <strong>{viewTeacher.fullname}</strong>
              </div>
              <div className="admin-modal-field">
                <span>Email</span>
                <strong>{viewTeacher.email}</strong>
              </div>
              <div className="admin-modal-field">
                <span>Password</span>
                <strong>{viewTeacher.password || "-"}</strong>
              </div>
              <div className="admin-modal-field">
                <span>Created At</span>
                <strong>{formatDate(viewTeacher.created_at)}</strong>
              </div>
              <div className="admin-modal-field">
                <span>Updated At</span>
                <strong>{formatDate(viewTeacher.updated_at)}</strong>
              </div>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setViewTeacher(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editTeacher ? (
        <div
          className="confirm-modal-overlay"
          onClick={() => {
            if (!savingEdit) {
              setEditTeacher(null);
              setEditForm(initialTeacherForm);
            }
          }}
          role="presentation"
        >
          <div
            className="confirm-modal admin-teacher-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-teacher-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="edit-teacher-title" className="card-title card-title-zero">
              Edit Teacher Information
            </h3>
            <form className="form-grid" onSubmit={handleSaveTeacherEdit}>
              <div className="form-group no-margin">
                <label className="form-label" htmlFor="editTeacherId">
                  Teacher ID
                </label>
                <input
                  id="editTeacherId"
                  className="form-input"
                  type="text"
                  value={editForm.teachers_id}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      teachers_id: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-group no-margin">
                <label className="form-label" htmlFor="editTeacherFullname">
                  Full Name
                </label>
                <input
                  id="editTeacherFullname"
                  className="form-input"
                  type="text"
                  value={editForm.fullname}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      fullname: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-group no-margin">
                <label className="form-label" htmlFor="editTeacherEmail">
                  Email
                </label>
                <input
                  id="editTeacherEmail"
                  className="form-input"
                  type="email"
                  value={editForm.email}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-group no-margin">
                <label className="form-label" htmlFor="editTeacherPassword">
                  Password
                </label>
                <input
                  id="editTeacherPassword"
                  className="form-input"
                  type="text"
                  value={editForm.password}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-grid-full confirm-modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setEditTeacher(null);
                    setEditForm(initialTeacherForm);
                  }}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
