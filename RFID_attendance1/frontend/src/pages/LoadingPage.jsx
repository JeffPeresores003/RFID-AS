import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../images/SJLOGO.png";

export default function LoadingPage() {
  const navigate = useNavigate();
  const matrixSource = "01RFIDSANJOSEELEMENTARYSCHOOLATTENDANCESYSTEM";
  const matrixColumns = Array.from({ length: 40 }, (_, colIndex) => {
    const rows = 56;
    let column = "";

    for (let row = 0; row < rows; row += 1) {
      const charIndex =
        (colIndex * 7 + row * 5 + colIndex * row) % matrixSource.length;
      column += matrixSource[charIndex];
      if (row < rows - 1) column += "\n";
    }

    return column;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 8000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className="loading-shell" role="status" aria-live="polite">
      <div className="loading-scanlines" aria-hidden="true" />
      <div className="loading-matrix" aria-hidden="true">
        {matrixColumns.map((column, index) => (
          <span
            key={`matrix-${index}`}
            className="loading-matrix-column"
            style={{
              left: `${(index / (matrixColumns.length - 1)) * 100}%`,
              animationDuration: `${11 + (index % 8)}s`,
              animationDelay: `-${index * 0.55}s`,
              opacity: 0.28 + (index % 5) * 0.08,
            }}
          >
            {column}
          </span>
        ))}
      </div>
      <div className="loading-card">
        <div
          className="loading-logo-puzzle"
          role="img"
          aria-label="San Jose Elementary School logo"
        >
          <span
            className="loading-piece loading-piece-1"
            style={{ backgroundImage: `url(${logo})` }}
          />
          <span
            className="loading-piece loading-piece-2"
            style={{ backgroundImage: `url(${logo})` }}
          />
          <span
            className="loading-piece loading-piece-3"
            style={{ backgroundImage: `url(${logo})` }}
          />
          <span
            className="loading-piece loading-piece-4"
            style={{ backgroundImage: `url(${logo})` }}
          />
        </div>
        <p className="loading-kicker">SAN JOSE ELEMENTARY SCHOOL</p>
        <h1 className="loading-title">Preparing Dashboard</h1>
        <p className="loading-subtitle">
          Please wait while we load your session
        </p>

        <div className="loading-progress" aria-hidden="true">
          <span className="loading-progress-bar" />
        </div>

        <div className="loading-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
