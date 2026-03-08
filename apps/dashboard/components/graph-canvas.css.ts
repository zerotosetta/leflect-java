import { style } from "@vanilla-extract/css";

import { vars } from "@/app/theme.css";

export const shell = style({
  position: "relative",
  minHeight: "60vh",
  borderRadius: vars.radius.lg,
  overflow: "hidden",
  border: `1px solid ${vars.color.stroke}`,
  background: [
    "linear-gradient(180deg, rgba(8, 24, 35, 0.96), rgba(4, 13, 20, 0.98))",
    "radial-gradient(circle at top left, rgba(139, 233, 253, 0.1), transparent 28%)"
  ].join(", ")
});

export const canvas = style({
  minHeight: "60vh"
});

export const tooltip = style({
  position: "absolute",
  top: vars.space[2],
  left: vars.space[2],
  maxWidth: "220px",
  display: "grid",
  gap: "2px",
  padding: `${vars.space[1]} ${vars.space[2]}`,
  borderRadius: vars.radius.sm,
  border: `1px solid rgba(139, 233, 253, 0.2)`,
  background: "rgba(4, 14, 21, 0.92)",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28)",
  fontSize: "0.78rem"
});
