import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/register", label: "Register" },
  { to: "/scanner", label: "Scanner" },
  { to: "/history", label: "History" },
];

export default function MainLayout({ children }) {
  return (
    <>
      <header className="header">
        <div className="header-content">
          <h1 className="header-title">RFID Attendance</h1>
          <nav className="header-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
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
