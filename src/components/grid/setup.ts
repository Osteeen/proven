"use client";

import { ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AiToolkitModule, AllEnterpriseModule } from "ag-grid-enterprise";

// AG Grid Enterprise, without a licence key for the hackathon: the AG Grid team
// confirmed the trial watermark and console notice are fine for judging.
ModuleRegistry.registerModules([AllEnterpriseModule, AiToolkitModule]);

/** Proven's paper, ink and line colours, so the grids read as part of the app. */
export const provenGridTheme = themeQuartz.withParams({
  backgroundColor: "#ffffff",
  foregroundColor: "#0f1e3d",
  headerBackgroundColor: "#fbfaf6",
  headerTextColor: "#5b6680",
  borderColor: "#d9d5ca",
  // Fine lines: soft row dividers, no vertical rules between columns.
  rowBorder: { color: "#ece8de" },
  columnBorder: false,
  headerColumnBorder: false,
  headerRowBorder: { color: "#d9d5ca" },
  wrapperBorder: { color: "#d9d5ca" },
  // Barely-there hover, so rows sliding under the pointer while scrolling don't flash.
  rowHoverColor: "rgba(15, 30, 61, 0.025)",
  selectedRowBackgroundColor: "#eef1f7",
  accentColor: "#0f1e3d",
  chromeBackgroundColor: "#f7f5ef",
  fontFamily: "inherit",
  fontSize: 14,
  headerFontSize: 12,
  headerFontWeight: 500,
  iconSize: 14,
  borderRadius: 8,
  wrapperBorderRadius: 10,
  // Roomy rows: these grids are read and decided on, not scanned at speed.
  spacing: 10,
  rowHeight: 52,
  headerHeight: 48,
  cellHorizontalPadding: 16,
});
