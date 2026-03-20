import { Link, NavLink } from "react-router-dom";
import logo from "../images/SJLOGO.png";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/register", label: "Register" },
  { to: "/scanner", label: "Scanner" },
  { to: "/history", label: "History" },
];

export default function MainLayout({ children }) {
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
          </nav>
        </div>
      </header>

      <main className="container">{children}</main>
    </>
  );
}
