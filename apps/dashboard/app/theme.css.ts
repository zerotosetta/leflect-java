import { createGlobalTheme, globalStyle, style } from "@vanilla-extract/css";

export const vars = createGlobalTheme(":root", {
  color: {
    bg: "#051019",
    bgElevated: "rgba(8, 24, 35, 0.92)",
    bgPanel: "rgba(8, 23, 34, 0.88)",
    bgPanelStrong: "rgba(10, 28, 41, 0.96)",
    stroke: "rgba(157, 209, 255, 0.14)",
    strokeStrong: "rgba(157, 209, 255, 0.24)",
    text: "#ecf7ff",
    muted: "#91a9ba",
    accent: "#8be9fd",
    accentStrong: "#46d9b8",
    warm: "#ffb86c",
    danger: "#ff6b6b",
    success: "#50fa7b"
  },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px"
  },
  radius: {
    sm: "10px",
    md: "14px",
    lg: "18px",
    xl: "22px"
  },
  shadow: {
    panel: "0 16px 40px rgba(0, 0, 0, 0.28)"
  }
});

globalStyle("*", {
  boxSizing: "border-box"
});

globalStyle("html, body", {
  margin: 0,
  minHeight: "100%",
  background: [
    "radial-gradient(circle at top left, rgba(70, 217, 184, 0.2), transparent 24%)",
    "radial-gradient(circle at top right, rgba(139, 233, 253, 0.16), transparent 22%)",
    "linear-gradient(180deg, #07131d 0%, #040c13 100%)"
  ].join(", "),
  color: vars.color.text,
  fontFamily: "var(--font-heading), sans-serif"
});

globalStyle("body", {
  padding: vars.space[2]
});

globalStyle("button, input, select, textarea", {
  font: "inherit"
});

globalStyle("button", {
  cursor: "pointer"
});

globalStyle("input", {
  minWidth: 0
});

globalStyle("h1, h2, h3, h4, p", {
  margin: 0
});

globalStyle("ul", {
  listStyle: "none",
  margin: 0,
  padding: 0
});

globalStyle("table", {
  width: "100%",
  borderCollapse: "collapse"
});

export const bodyRoot = style({
  minHeight: "calc(100vh - 16px)"
});
