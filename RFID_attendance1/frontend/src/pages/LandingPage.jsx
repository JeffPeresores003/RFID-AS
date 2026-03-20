import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import logo from "../images/SJLOGO.png";
import sj1 from "../images/sj1.jpg";
import sj2 from "../images/sj2.jpg";

export default function LandingPage() {
  const backgrounds = [sj1, sj2];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgrounds.length);
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, [backgrounds.length]);

  return (
    <div className="landing-shell">
      <div className="landing-photo-stack" aria-hidden="true">
        {backgrounds.map((image, index) => (
          <div
            key={image}
            className={`landing-photo${index === activeIndex ? " active" : ""}`}
            style={{ backgroundImage: `url(${image})` }}
          />
        ))}
      </div>

      <div className="landing-blur landing-blur-one" aria-hidden="true" />
      <div className="landing-blur landing-blur-two" aria-hidden="true" />

      <section className="landing-card">
        <img
          src={logo}
          alt="San Jose Elementary School logo"
          className="landing-logo"
        />

        <p className="landing-kicker">Welcome to</p>
        <h1 className="landing-title">San Jose Elementary School</h1>
        <p className="landing-subtitle">San Miguel, Bohol</p>

        <p className="landing-description">
          A secure and reliable RFID attendance platform for fast daily
          check-ins, accurate records, and streamlined monitoring.
        </p>

        <div className="landing-actions">
          <Link to="/dashboard" className="btn btn-primary btn-landing">
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
}
