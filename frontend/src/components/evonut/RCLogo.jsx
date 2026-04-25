import React from "react";

/**
 * Rogério Costa Logo Mark — SVG version of the bracketed "P".
 * Sizes via `size` prop. Variants:
 *   - "blue"  → blue background, black mark (default)
 *   - "dark"  → black background, blue mark
 *   - "ghost" → transparent background, blue mark
 *   - "mono"  → transparent, single color (use `color`)
 */
export default function RCLogo({ size = 40, variant = "blue", color, className = "", ...props }) {
  const isBlue = variant === "blue";
  const isDark = variant === "dark";
  const isGhost = variant === "ghost";
  const isMono = variant === "mono";

  const bg = isBlue ? "#0081FD" : isDark ? "#000000" : "transparent";
  const fg = isBlue ? "#000000" : isDark ? "#0081FD" : (color || "#0081FD");

  const wrapStyle = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    background: bg,
    borderRadius: isGhost || isMono ? 0 : "9999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: isBlue ? "0 6px 22px -6px rgba(0,129,253,0.55)" : undefined,
  };

  // The mark is a stylized "P" composed of two parallelograms + a triangular cap.
  return (
    <span className={className} style={wrapStyle} aria-label="Rogério Costa logo" {...props}>
      <svg
        viewBox="0 0 64 64"
        width={size * 0.6}
        height={size * 0.6}
        fill={fg}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Top horizontal cap with notch — stylized "P" hood */}
        <polygon points="14,18 56,18 50,28 22,28" />
        {/* Right diagonal of the P — angled slab */}
        <polygon points="44,28 56,18 48,38 36,38" />
        {/* Left vertical bar (italic) */}
        <polygon points="14,32 26,32 22,50 10,50" />
        {/* Inner small bar — gives the silhouette */}
        <polygon points="28,38 40,38 36,50 24,50" />
      </svg>
    </span>
  );
}
