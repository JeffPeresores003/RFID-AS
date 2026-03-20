import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE } from "../config";
import { getTeacherSession, setTeacherSession } from "../auth";
import logo from "../images/SJLOGO.png";
import sj1 from "../images/sj1.jpg";
import sj2 from "../images/sj2.jpg";

const showcaseSlides = [sj1, sj2];

export default function SignInPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);
  const [showForgotModal, setShowForgotModal] = useState(false);

  useEffect(() => {
    const session = getTeacherSession();
    if (session) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % showcaseSlides.length);
    }, 4500);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setShowForgotModal(false);
      }
    }

    if (showForgotModal) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showForgotModal]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const identifier = form.email.trim();
    const password = form.password;

    if (!identifier || !password) {
      setError("Email or Teacher ID and password are required.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/auth/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error || "Sign in failed. Please try again.");
        return;
      }

      if (!payload?.teacher?.teachers_id) {
        setError("Invalid account response. Please contact administrator.");
        return;
      }

      setTeacherSession(payload.teacher);
      navigate("/loading", { replace: true });
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="signin-shell">
      <div className="signin-layout">
        <aside className="signin-showcase" aria-hidden="true">
          <Link
            to="/"
            className="signin-back-button"
            aria-label="Back to landing page"
          >
            &larr;
          </Link>
          {showcaseSlides.map((image, index) => (
            <div
              key={image}
              className={`signin-showcase-slide${index === activeSlide ? " active" : ""}`}
              style={{ backgroundImage: `url(${image})` }}
            />
          ))}
          <div className="signin-showcase-copy">
            <p className="signin-showcase-text">
              San Jose Elementary School embraces the ever-changing evolution of
              technology. By using RFID attendance system, as we ensure that
              education shouldnt be left behind.
            </p>
            <div className="signin-showcase-dots">
              {showcaseSlides.map((slide, index) => (
                <span
                  key={slide}
                  className={`signin-showcase-dot${index === activeSlide ? " active" : ""}`}
                />
              ))}
            </div>
          </div>
        </aside>

        <section className="signin-panel">
          <img
            src={logo}
            alt="San Jose Elementary School logo"
            className="signin-logo"
          />
          <h1 className="signin-title">Teacher's Portal</h1>
          <p className="signin-subtitle">
            San Jose Elementary School, San Miguel, Bohol
          </p>

          {error ? <div className="alert alert-error">{error}</div> : null}

          <form onSubmit={handleSubmit} className="signin-form">
            <div className="form-group no-margin">
              <label htmlFor="signinEmail" className="form-label">
                Email or Teacher ID
              </label>
              <input
                id="signinEmail"
                type="text"
                className="form-input"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="teacher@school.edu or TCH-0002"
                autoComplete="username"
              />
            </div>

            <div className="form-group no-margin">
              <label htmlFor="signinPassword" className="form-label">
                Password
              </label>
              <input
                id="signinPassword"
                type="password"
                className="form-input"
                value={form.password}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary signin-btn"
              disabled={submitting}
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>
            <p className="signin-forgot-wrap">
              <button
                type="button"
                className="signin-forgot-password"
                onClick={() => setShowForgotModal(true)}
              >
                Forgot your password?
              </button>
            </p>
            <p className="signin-admin-wrap">
              <Link to="/admin/signin" className="signin-admin-link">
                Sign in as Admin
              </Link>
            </p>
          </form>
        </section>
      </div>

      {showForgotModal ? (
        <div
          className="confirm-modal-overlay"
          onClick={() => setShowForgotModal(false)}
          role="presentation"
        >
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-password-title"
            aria-describedby="forgot-password-description"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="forgot-password-title"
              className="confirm-modal-title signin-forgot-title"
            >
              Do you really forget your password?
            </h2>
            <p
              id="forgot-password-description"
              className="confirm-modal-text signin-forgot-description"
            >
              Please contact your administrator!
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowForgotModal(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
