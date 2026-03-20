import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../config";
import { getTeacherSession, setTeacherSession } from "../auth";

export default function TeacherProfilePage() {
  const navigate = useNavigate();
  const teacher = getTeacherSession();

  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("info"); // "info" or "password"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Info form state
  const [fullname, setFullname] = useState(teacher?.fullname || "");
  const [email, setEmail] = useState(teacher?.email || "");

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!teacher) {
      navigate("/signin", { replace: true });
    }
  }, [teacher, navigate]);

  const handleUpdateInfo = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!fullname.trim() || !email.trim()) {
      setError("Please fill in all fields");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/teachers/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teachers_id: teacher.teachers_id,
          fullname: fullname.trim(),
          email: email.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update profile");
      }

      const data = await response.json();

      // Update localStorage with new teacher info
      const updatedTeacher = {
        ...teacher,
        fullname: data.teacher.fullname,
        email: data.teacher.email,
      };
      setTeacherSession(updatedTeacher);

      setSuccessMessage("Profile updated successfully!");
      setIsEditing(false);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all password fields");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from current password");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/teachers/change-password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teachers_id: teacher.teachers_id,
          currentPassword: currentPassword,
          newPassword: newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to change password");
      }

      setSuccessMessage("Password changed successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  if (!teacher) {
    return null;
  }

  return (
    <div className="profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <h1>Teacher Profile</h1>
          <p className="profile-subtitle">Manage your profile information</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {successMessage && (
          <div className="alert alert-success">{successMessage}</div>
        )}

        <div className="profile-tabs">
          <button
            className={`tab-btn ${activeTab === "info" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("info");
              setIsEditing(false);
              setError("");
            }}
          >
            Personal Information
          </button>
          <button
            className={`tab-btn ${activeTab === "password" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("password");
              setError("");
            }}
          >
            Change Password
          </button>
        </div>

        <div className="profile-content">
          {activeTab === "info" && (
            <div className="profile-section">
              <div className="profile-info-grid">
                <div className="profile-field">
                  <label>Teacher ID</label>
                  <p className="profile-readonly">{teacher.teachers_id}</p>
                </div>

                {!isEditing ? (
                  <>
                    <div className="profile-field">
                      <label>Full Name</label>
                      <p className="profile-readonly">{teacher.fullname}</p>
                    </div>
                    <div className="profile-field">
                      <label>Email</label>
                      <p className="profile-readonly">{teacher.email}</p>
                    </div>
                    <div className="profile-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => setIsEditing(true)}
                      >
                        Edit Information
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="profile-field">
                      <label htmlFor="fullname">Full Name</label>
                      <input
                        id="fullname"
                        type="text"
                        value={fullname}
                        onChange={(e) => setFullname(e.target.value)}
                        placeholder="Enter your full name"
                        className="input-field"
                      />
                    </div>
                    <div className="profile-field">
                      <label htmlFor="email">Email</label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        className="input-field"
                      />
                    </div>
                    <div className="profile-actions">
                      <button
                        className="btn btn-primary"
                        onClick={handleUpdateInfo}
                        disabled={loading}
                      >
                        {loading ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        className="btn btn-outline"
                        onClick={() => {
                          setIsEditing(false);
                          setFullname(teacher.fullname);
                          setEmail(teacher.email);
                          setError("");
                        }}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === "password" && (
            <div className="profile-section">
              <form onSubmit={handleChangePassword} className="password-form">
                <div className="profile-field">
                  <label htmlFor="current-password">Current Password</label>
                  <input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="input-field"
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="new-password">New Password</label>
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)"
                    className="input-field"
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="confirm-password">Confirm New Password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="input-field"
                  />
                </div>

                <div className="profile-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                  >
                    {loading ? "Changing..." : "Change Password"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
