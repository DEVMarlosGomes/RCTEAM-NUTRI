import React from "react";
import RCLogo from "./RCLogo";

/**
 * Brand wordmark: logo mark + "ROGÉRIO COSTA / TREINADOR E NUTRICIONISTA"
 * Variants: "default" (white text on dark) | "compact" | "icon-only"
 */
export default function Brand({ size = "md", variant = "default", className = "" }) {
  const sizes = {
    sm: { logo: 32, title: "text-sm", sub: "text-[9px]" },
    md: { logo: 40, title: "text-base", sub: "text-[10px]" },
    lg: { logo: 56, title: "text-xl", sub: "text-[11px]" },
  };
  const s = sizes[size] || sizes.md;

  if (variant === "icon-only") {
    return <RCLogo size={s.logo} variant="blue" className={className} />;
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <RCLogo size={s.logo} variant="blue" />
      <div className="flex flex-col leading-none">
        <span className={`font-display font-black tracking-wider ${s.title} text-white uppercase`}>
          Rogério Costa
        </span>
        <span className={`text-rc-blue tracking-[0.25em] uppercase ${s.sub} font-bold mt-0.5`}>
          Treinador e Nutricionista
        </span>
      </div>
    </div>
  );
}
