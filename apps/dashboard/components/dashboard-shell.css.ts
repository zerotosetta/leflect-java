import { globalStyle, style } from "@vanilla-extract/css";

import { vars } from "@/app/theme.css";

export const root = style({
  display: "grid",
  gap: vars.space[2],
  minHeight: "calc(100vh - 16px)"
});

export const panel = style({
  minWidth: 0,
  border: `1px solid ${vars.color.stroke}`,
  borderRadius: vars.radius.lg,
  background: vars.color.bgPanel,
  boxShadow: vars.shadow.panel,
  backdropFilter: "blur(18px)"
});

export const topBar = style([
  panel,
  {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: vars.space[3],
    alignItems: "end",
    padding: `${vars.space[3]} ${vars.space[4]}`,
    "@media": {
      "screen and (max-width: 1180px)": {
        gridTemplateColumns: "1fr"
      }
    }
  }
]);

export const topBarInfo = style({
  minWidth: 0,
  display: "grid",
  gap: vars.space[1]
});

export const topBarTitle = style({
  fontSize: "clamp(1.3rem, 1.8vw, 1.8rem)",
  lineHeight: 1.05,
  letterSpacing: "-0.03em"
});

export const eyebrow = style({
  fontSize: "0.68rem",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: vars.color.accent
});

export const mutedText = style({
  color: vars.color.muted
});

export const monoText = style({
  fontFamily: "var(--font-mono), monospace"
});

export const ellipsisText = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
});

export const wrapText = style({
  overflowWrap: "anywhere"
});

export const topActions = style({
  display: "flex",
  alignItems: "flex-end",
  gap: vars.space[2],
  flexWrap: "wrap",
  justifyContent: "flex-end"
});

export const fieldStack = style({
  minWidth: 0,
  display: "grid",
  gap: vars.space[1]
});

export const fieldCompact = style({
  minWidth: "250px"
});

export const textInput = style({
  minWidth: 0,
  height: "36px",
  border: `1px solid ${vars.color.stroke}`,
  borderRadius: vars.radius.sm,
  background: "rgba(4, 14, 21, 0.8)",
  color: vars.color.text,
  padding: `0 ${vars.space[2]}`
});

globalStyle(`${textInput}::placeholder`, {
  color: vars.color.muted
});

export const primaryButton = style({
  height: "36px",
  padding: `0 ${vars.space[3]}`,
  borderRadius: vars.radius.sm,
  border: 0,
  background: `linear-gradient(135deg, ${vars.color.accent}, ${vars.color.accentStrong})`,
  color: "#03202d",
  fontWeight: 700,
  whiteSpace: "nowrap"
});

export const segmented = style({
  display: "inline-flex",
  gap: vars.space[1],
  padding: vars.space[1],
  borderRadius: vars.radius.md,
  border: `1px solid ${vars.color.stroke}`,
  background: "rgba(4, 14, 21, 0.74)",
  minWidth: 0
});

export const segmentedVertical = style({
  display: "grid",
  width: "100%"
});

export const segmentedButton = style({
  border: `1px solid transparent`,
  background: "transparent",
  color: vars.color.muted,
  padding: `${vars.space[1]} ${vars.space[2]}`,
  borderRadius: vars.radius.sm,
  lineHeight: 1.1,
  whiteSpace: "nowrap"
});

export const segmentedButtonActive = style({
  background: "rgba(139, 233, 253, 0.12)",
  borderColor: vars.color.strokeStrong,
  color: vars.color.text
});

export const policyStrip = style([
  panel,
  {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: vars.space[3],
    alignItems: "center",
    padding: `${vars.space[2]} ${vars.space[4]}`,
    "@media": {
      "screen and (max-width: 1180px)": {
        gridTemplateColumns: "1fr"
      }
    }
  }
]);

export const badgeRow = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space[1]
});

export const badge = style({
  display: "inline-flex",
  alignItems: "center",
  gap: vars.space[1],
  minHeight: "24px",
  padding: `0 ${vars.space[2]}`,
  borderRadius: "999px",
  border: `1px solid ${vars.color.stroke}`,
  background: "rgba(7, 20, 30, 0.92)",
  color: vars.color.muted,
  fontSize: "0.76rem",
  whiteSpace: "nowrap"
});

export const badgeAccent = style({
  color: vars.color.text,
  borderColor: "rgba(70, 217, 184, 0.34)"
});

export const metricsRow = style({
  display: "flex",
  gap: vars.space[2],
  flexWrap: "wrap",
  justifyContent: "flex-end",
  color: vars.color.muted,
  fontSize: "0.82rem"
});

export const workspace = style({
  display: "grid",
  gridTemplateColumns: "240px minmax(0, 1fr) 296px",
  gap: vars.space[2],
  minHeight: 0,
  flex: 1,
  "@media": {
    "screen and (max-width: 1180px)": {
      gridTemplateColumns: "1fr"
    }
  }
});

export const sidebar = style([
  panel,
  {
    minHeight: "78vh",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gap: vars.space[2],
    padding: vars.space[2],
    overflow: "hidden",
    "@media": {
      "screen and (max-width: 1180px)": {
        minHeight: "auto"
      }
    }
  }
]);

export const sidebarSection = style({
  minHeight: 0,
  overflow: "auto",
  display: "grid",
  gap: vars.space[2],
  alignContent: "start",
  paddingRight: vars.space[1]
});

export const entryGroup = style({
  display: "grid",
  gap: vars.space[1]
});

export const groupHeading = style({
  fontSize: "0.78rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: vars.color.accent,
  padding: `0 ${vars.space[1]}`
});

export const stackList = style({
  display: "grid",
  gap: vars.space[1]
});

export const entryButton = style({
  width: "100%",
  minWidth: 0,
  display: "grid",
  gap: "2px",
  textAlign: "left",
  padding: `${vars.space[2]} ${vars.space[2]}`,
  borderRadius: vars.radius.md,
  border: `1px solid ${vars.color.stroke}`,
  background: "rgba(6, 18, 27, 0.78)"
});

globalStyle(`${entryButton} strong`, {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  lineHeight: 1.15
});

globalStyle(`${entryButton} span`, {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: vars.color.muted,
  fontSize: "0.74rem"
});

export const entryButtonSelected = style({
  background: "rgba(139, 233, 253, 0.1)",
  borderColor: vars.color.strokeStrong
});

export const policyList = style({
  display: "grid",
  gap: vars.space[2]
});

export const policyCard = style({
  display: "grid",
  gap: vars.space[2],
  padding: vars.space[2],
  borderRadius: vars.radius.md,
  border: `1px solid ${vars.color.stroke}`,
  background: "rgba(6, 18, 27, 0.78)"
});

export const policyHead = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: vars.space[2],
  alignItems: "start"
});

export const scopeText = style({
  color: vars.color.muted,
  fontSize: "0.76rem"
});

export const toggle = style({
  display: "inline-flex",
  alignItems: "center",
  gap: vars.space[1],
  color: vars.color.muted,
  fontSize: "0.76rem",
  whiteSpace: "nowrap"
});

export const ruleList = style({
  display: "grid",
  gap: vars.space[1]
});

export const ruleItem = style({
  display: "grid",
  gap: "2px",
  padding: `${vars.space[1]} ${vars.space[2]}`,
  borderRadius: vars.radius.sm,
  background: "rgba(4, 13, 20, 0.72)",
  border: `1px solid rgba(157, 209, 255, 0.08)`
});

globalStyle(`${ruleItem} span`, {
  color: vars.color.accent,
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase"
});

globalStyle(`${ruleItem} strong`, {
  fontSize: "0.78rem",
  overflowWrap: "anywhere"
});

export const zoneCard = style({
  display: "grid",
  gap: vars.space[2],
  padding: vars.space[2],
  borderRadius: vars.radius.md,
  border: `1px solid ${vars.color.stroke}`,
  background: "rgba(6, 18, 27, 0.78)"
});

export const zoneActions = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: vars.space[1]
});

export const actionButton = style({
  minWidth: 0,
  height: "30px",
  padding: `0 ${vars.space[2]}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.stroke}`,
  background: "rgba(5, 16, 24, 0.92)",
  color: vars.color.muted,
  fontSize: "0.72rem"
});

export const filterSection = style({
  display: "grid",
  gap: vars.space[2]
});

export const checkRow = style({
  display: "flex",
  gap: vars.space[1],
  alignItems: "center",
  color: vars.color.muted,
  fontSize: "0.8rem"
});

export const graphPanel = style([
  panel,
  {
    minHeight: "78vh",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    overflow: "hidden",
    "@media": {
      "screen and (max-width: 1180px)": {
        minHeight: "auto"
      }
    }
  }
]);

export const graphPanelHead = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: vars.space[2],
  alignItems: "start",
  padding: `${vars.space[3]} ${vars.space[3]} ${vars.space[2]}`
});

export const graphTitle = style({
  minWidth: 0,
  display: "grid",
  gap: vars.space[1]
});

export const graphTitleHeading = style({
  fontSize: "1.05rem",
  lineHeight: 1.1
});

export const graphStage = style({
  minHeight: 0,
  padding: `0 ${vars.space[2]} ${vars.space[2]}`
});

export const rightPanel = style([
  panel,
  {
    minHeight: "78vh",
    display: "grid",
    gridTemplateRows: "minmax(0, auto) minmax(0, auto) 1fr",
    gap: vars.space[2],
    padding: vars.space[2],
    overflow: "hidden",
    "@media": {
      "screen and (max-width: 1180px)": {
        minHeight: "auto"
      }
    }
  }
]);

export const detailBlock = style({
  minHeight: 0,
  display: "grid",
  gap: vars.space[2],
  overflow: "hidden"
});

export const detailStack = style({
  display: "grid",
  gap: vars.space[1]
});

export const detailPanelTitle = style({
  fontSize: "0.98rem",
  lineHeight: 1.15
});

export const detailList = style({
  display: "grid",
  gap: vars.space[1],
  minHeight: 0,
  overflow: "auto"
});

export const detailListItem = style({
  display: "grid",
  gap: "2px",
  padding: `${vars.space[1]} ${vars.space[2]}`,
  borderRadius: vars.radius.sm,
  background: "rgba(5, 15, 23, 0.76)",
  border: `1px solid rgba(157, 209, 255, 0.08)`
});

globalStyle(`${detailListItem} span`, {
  color: vars.color.muted,
  fontSize: "0.74rem",
  overflowWrap: "anywhere"
});

globalStyle(`${detailListItem} em`, {
  color: vars.color.accent,
  fontStyle: "normal",
  fontSize: "0.72rem"
});

export const statusBanner = style({
  alignSelf: "end",
  padding: `${vars.space[2]} ${vars.space[2]}`,
  borderRadius: vars.radius.md,
  background: "rgba(255, 107, 107, 0.1)",
  border: `1px solid rgba(255, 107, 107, 0.24)`,
  color: "#ffdede",
  fontSize: "0.8rem"
});

export const statusBar = style([
  panel,
  monoText,
  {
    display: "flex",
    flexWrap: "wrap",
    gap: vars.space[2],
    padding: `${vars.space[2]} ${vars.space[3]}`,
    color: vars.color.muted,
    fontSize: "0.76rem"
  }
]);

export const matrixView = style({
  minHeight: "60vh",
  overflow: "auto",
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.stroke}`,
  background: vars.color.bgElevated,
  padding: vars.space[2]
});

globalStyle(`${matrixView} th, ${matrixView} td`, {
  padding: `${vars.space[1]} ${vars.space[2]}`,
  borderBottom: `1px solid rgba(157, 209, 255, 0.08)`,
  fontSize: "0.78rem",
  textAlign: "center",
  whiteSpace: "nowrap"
});

globalStyle(`${matrixView} th:first-child, ${matrixView} td:first-child`, {
  textAlign: "left"
});

export const emptyState = style({
  minHeight: "60vh",
  display: "grid",
  placeItems: "center",
  padding: vars.space[4],
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.stroke}`,
  background: vars.color.bgElevated,
  color: vars.color.muted,
  textAlign: "center"
});

export const impactGrid = style({
  minHeight: "60vh",
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: vars.space[2],
  alignContent: "start",
  "@media": {
    "screen and (max-width: 1180px)": {
      gridTemplateColumns: "1fr"
    }
  }
});

export const impactCard = style({
  display: "grid",
  gap: vars.space[1],
  padding: vars.space[3],
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.stroke}`,
  background: vars.color.bgElevated
});

globalStyle(`${impactCard} span`, {
  color: vars.color.accent,
  fontSize: "0.84rem"
});

globalStyle(`${impactCard} p`, {
  color: vars.color.muted,
  overflowWrap: "anywhere",
  fontSize: "0.8rem"
});

export const cycleList = style({
  minHeight: "60vh",
  display: "grid",
  gap: vars.space[2],
  alignContent: "start",
  padding: vars.space[2],
  borderRadius: vars.radius.lg,
  border: `1px solid ${vars.color.stroke}`,
  background: vars.color.bgElevated
});

export const cycleCard = style({
  display: "grid",
  gap: vars.space[1],
  padding: vars.space[2],
  borderRadius: vars.radius.md,
  border: `1px solid rgba(157, 209, 255, 0.12)`,
  background: "rgba(7, 19, 28, 0.82)"
});

globalStyle(`${cycleCard} p`, {
  color: vars.color.muted,
  overflowWrap: "anywhere",
  fontSize: "0.78rem"
});

export const statsInline = style({
  display: "flex",
  gap: vars.space[1],
  flexWrap: "wrap"
});
