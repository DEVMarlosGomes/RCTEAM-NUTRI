import { useEffect } from "react";

export default function Landing() {
  useEffect(() => {
    window.location.replace("/landing.html");
  }, []);

  return (
    <div style={{ background: "#07080a", minHeight: "100vh" }} />
  );
}
