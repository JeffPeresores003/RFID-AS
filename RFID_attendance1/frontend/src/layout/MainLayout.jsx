import { Link, NavLink, useNavigate } from "react-router-dom";
import { useRef, useEffect, useState } from "react";
import logo from "../images/SJLOGO.png";
import { clearTeacherSession, getTeacherSession } from "../auth";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/register", label: "Register" },
  { to: "/scanner", label: "Scanner" },
  { to: "/history", label: "History" },
];

function getNameAcronym(fullname) {
  if (!fullname) return "T";
  const parts = fullname.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return fullname.charAt(0).toUpperCase();
}

export default function MainLayout({ children }) {
  const navigate = useNavigate();
  const teacher = getTeacherSession();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setShowSignOutModal(false);
      }
    }

    if (showSignOutModal) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showSignOutModal]);

  const openSignOutModal = () => {
    setShowDropdown(false);
    setShowSignOutModal(true);
  };

  const confirmSignOut = () => {
    clearTeacherSession();
    navigate("/", { replace: true });
  };

  return (
    <>
      <header className="header">
        <div className="header-content">
          <div className="header-brand">
            <Link
              to="/"
              className="header-logo-link"
              aria-label="Go to landing page"
            >
              <img
                src={logo}
                alt="San Jose Elementary School logo"
                className="header-logo"
              />
            </Link>
            <div>
              <h1 className="header-title">RFID Attendance</h1>
              <p className="header-subtitle">
                San Jose Elementary School, San Miguel, Bohol
              </p>
            </div>
          </div>
          <nav className="header-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/dashboard"}
                className={({ isActive }) =>
                  `nav-btn${isActive ? " active" : ""}`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {teacher?.teachers_id ? (
              <div className="teacher-chip-container" ref={dropdownRef}>
                <button
                  type="button"
                  className="teacher-avatar-btn"
                  onClick={() => setShowDropdown(!showDropdown)}
                  title={teacher.fullname || "Teacher"}
                  aria-label="Teacher menu"
                  aria-expanded={showDropdown}
                >
                  {getNameAcronym(teacher.fullname)}
                </button>
                {showDropdown && (
                  <div className="teacher-dropdown">
                    <div className="teacher-dropdown-profile">
                      <div className="teacher-avatar">
                        {getNameAcronym(teacher.fullname)}
                      </div>
                      <div className="teacher-dropdown-id">
                        {teacher.teachers_id}
                      </div>
                      <div className="teacher-dropdown-fullname">
                        {teacher.fullname || "Teacher"}
                      </div>
                      <div className="teacher-dropdown-email">
                        {teacher.email || "No email"}
                      </div>
                    </div>
                    <div className="teacher-dropdown-divider"></div>
                    <button
                      type="button"
                      className="teacher-dropdown-signout"
                      onClick={openSignOutModal}
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </nav>
        </div>
      </header>

      <main className="container">{children}</main>

      {showSignOutModal ? (
        <div
          className="confirm-modal-overlay"
          onClick={() => setShowSignOutModal(false)}
          role="presentation"
        >
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-confirm-title"
            aria-describedby="signout-confirm-description"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="signout-confirm-title" className="confirm-modal-title">
              Confirm Sign Out
            </h2>
            <p id="signout-confirm-description" className="confirm-modal-text">
              Are you sure you want to sign out?
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowSignOutModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
