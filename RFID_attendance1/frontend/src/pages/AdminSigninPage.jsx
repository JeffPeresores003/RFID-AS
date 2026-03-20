import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE } from "../config";
import { getAdminSession, setAdminSession } from "../auth";
import logo from "../images/SJLOGO.png";

export default function AdminSigninPage() {
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const session = getAdminSession();
    if (session?.token) {
      navigate("/admin/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const email = String(credentials.email || "")
      .trim()
      .toLowerCase();
    const password = String(credentials.password || "");

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/admin/auth/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error || "Admin sign in failed.");
        return;
      }

      if (!payload?.token || !payload?.admin?.email) {
        setError("Invalid admin session response.");
        return;
      }

      setAdminSession({
        token: payload.token,
        admin: payload.admin,
      });

      navigate("/admin/dashboard", { replace: true });
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signin-shell">
      <div className="signin-layout admin-signin-layout">
        <section className="signin-panel admin-signin-panel">
          <Link
            to="/signin"
            className="signin-back-button"
            aria-label="Back to teacher sign in"
          >
            &larr;
          </Link>

          <img
            src={logo}
            alt="San Jose Elementary School logo"
            className="signin-logo"
          />

          <h1 className="signin-title">Admin Portal</h1>
          <p className="signin-subtitle">
            Sign in using admin email and password
          </p>

          {error ? <div className="alert alert-error">{error}</div> : null}

          <form onSubmit={handleSubmit} className="signin-form">
            <div className="form-group no-margin">
              <label htmlFor="adminEmail" className="form-label">
                Admin Email
              </label>
              <input
                id="adminEmail"
                type="email"
                className="form-input"
                value={credentials.email}
                onChange={(event) =>
                  setCredentials((prev) => ({
                    ...prev,
                    email: event.target.value,
                  }))
                }
                placeholder="admin@school.edu"
                autoComplete="username"
              />
            </div>

            <div className="form-group no-margin">
              <label htmlFor="adminPassword" className="form-label">
                Password
              </label>
              <input
                id="adminPassword"
                type="password"
                className="form-input"
                value={credentials.password}
                onChange={(event) =>
                  setCredentials((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
                placeholder="Enter admin password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary signin-btn"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
