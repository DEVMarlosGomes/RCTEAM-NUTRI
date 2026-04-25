import React from "react";

export default function GlowOrb({ color = "#0081FD", size = 480, top = "10%", left = "5%", opacity = 0.4 }) {
  return (
    <div
      aria-hidden
      className="rc-orb"
      style={{
        width: size,
        height: size,
        background: color,
        top,
        left,
        opacity,
      }}
    />
  );
}
