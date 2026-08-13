import type { ContentTranslationFunction } from "metabase/content-translation/types";
import {
  formatCellValueForCopy,
  serializeTsv,
} from "metabase/data-grid/utils/formatting";
import { extractRemappedColumns } from "metabase/visualizations";
import * as DataGrid from "metabase/visualizations/lib/data_grid";
import { createPlainCellFormatter } from "metabase/visualizations/lib/plain-cell-formatter";
import {
  getTitleForColumn,
  isPivoted,
} from "metabase/visualizations/lib/settings/column";
import { getComputedSettingsForSeries } from "metabase/visualizations/lib/settings/visualization";
import {
  getTableCellClickedObject,
  getTableClickedObjectRowData,
} from "metabase/visualizations/lib/table";
import { getVisibleTableData } from "metabase/visualizations/lib/visible-table-data";
import type { ComputedVisualizationSettings } from "metabase/visualizations/types";
import type { HeaderItem } from "metabase/visualizations/visualizations/PivotTable/types";
import {
  getTopHeaderRowIndex,
  getTopHeaderRowsCount,
} from "metabase/visualizations/visualizations/PivotTable/utils";
import type {
  Card,
  ColumnSettings,
  DatasetData,
  RawSeries,
  RowValue,
} from "metabase-types/api";

interface ResultsClipboardParams {
  card: Card;
  data: DatasetData;
  pivoted?: boolean;
  translate: ContentTranslationFunction;
}

interface ResultsClipboardContent {
  text: string;
  html: string;
  rowCount: number;
  isPivotGrid: boolean;
}

export function getResultsClipboardContent({
  card,
  data,
  pivoted = false,
  translate,
}: ResultsClipboardParams): ResultsClipboardContent {
  // The rendered table works on remapping-extracted data, so the copy must too
  const series: RawSeries = [{ card, data: extractRemappedColumns(data) }];
  const settings = getComputedSettingsForSeries(series);

  if (pivoted && card.display === "pivot") {
    const grid = getPivotGrid(series, settings, translate);
    if (!grid) {
      throw new Error("Could not lay out the pivot table");
    }
    return {
      ...serializeLines(grid.lines),
      rowCount: grid.bodyRowCount,
      isPivotGrid: true,
    };
  }

  const [{ data: remappedData }] = series;
  const flatSeries: RawSeries = [
    { card, data: flattenPivotGroupedData(remappedData) },
  ];
  const visibleData = getVisibleTableData({ series: flatSeries, settings });
  const { cols, rows } = visibleData;

  // The renderer shows the all-columns-hidden message instead of a grid here
  if (cols.length === 0) {
    throw new Error("All columns are hidden");
  }

  const isClassicPivot = isPivoted(flatSeries, settings);

  const headers = cols.map((col) =>
    String(translate(getTitleForColumn(col, series, settings))),
  );

  // Click row data varies per cell only in classic pivots, so cache it per row
  const rowClickedData = new Map<
    number,
    ReturnType<typeof getTableClickedObjectRowData>
  >();
  const getRowClickedData = (rowIndex: number, columnIndex: number) => {
    if (isClassicPivot) {
      return getTableClickedObjectRowData(
        flatSeries,
        rowIndex,
        columnIndex,
        isClassicPivot,
        visibleData,
      );
    }
    if (!rowClickedData.has(rowIndex)) {
      rowClickedData.set(
        rowIndex,
        getTableClickedObjectRowData(
          flatSeries,
          rowIndex,
          0,
          false,
          visibleData,
        ),
      );
    }
    return rowClickedData.get(rowIndex) ?? null;
  };

  const formatters = cols.map((col, columnIndex) => {
    const columnSettings = settings.column?.(col);
    return createPlainCellFormatter({
      columnSettings,
      translate,
      getClicked: cellTextNeedsClicked(columnSettings)
        ? (rowIndex) =>
            getTableCellClickedObject(
              visibleData,
              settings,
              rowIndex,
              columnIndex,
              isClassicPivot,
              getRowClickedData(rowIndex, columnIndex),
            )
        : undefined,
    });
  });
  const getCellText = (
    value: RowValue,
    rowIndex: number,
    columnIndex: number,
  ) =>
    formatCellValueForCopy(
      value,
      formatters[columnIndex],
      rowIndex,
      cols[columnIndex].name,
    );

  const lines = [
    headers,
    ...rows.map((row, rowIndex) =>
      row.map((value, columnIndex) =>
        getCellText(value, rowIndex, columnIndex),
      ),
    ),
  ];
  return {
    ...serializeLines(lines),
    rowCount: rows.length,
    isPivotGrid: isClassicPivot,
  };
}

// Only the link branches of formatValue read `clicked` for plain text
function cellTextNeedsClicked(columnSettings?: ColumnSettings): boolean {
  const clickBehavior = columnSettings?.click_behavior;
  const hasClickBehaviorLinkText =
    clickBehavior != null &&
    "linkTextTemplate" in clickBehavior &&
    Boolean(clickBehavior.linkTextTemplate);
  const hasLegacyLink =
    columnSettings?.view_as === "link" &&
    Boolean(columnSettings.link_text || columnSettings.link_url);
  return hasClickBehaviorLinkText || hasLegacyLink;
}

function serializeLines(lines: string[][]) {
  return {
    text: serializeTsv(lines),
    html: serializeHtmlTable(lines),
  };
}

function serializeHtmlTable(lines: string[][]): string {
  const rows = lines
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td>${escapeHtmlCell(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function escapeHtmlCell(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>");
}

// Translated where the renderer translates: top headers and dimension titles
function getPivotGrid(
  series: RawSeries,
  settings: ComputedVisualizationSettings,
  translate: ContentTranslationFunction,
): { lines: string[][]; bodyRowCount: number } | null {
  const [{ data }] = series;
  const pivotData = DataGrid.multiLevelPivot(data, settings);
  if (!pivotData) {
    return null;
  }

  const getItemText = (item: Pick<HeaderItem, "value">) => item.value ?? "";

  const {
    topHeaderItems,
    leftHeaderItems,
    rowCount,
    columnCount,
    rowIndexes,
    columnIndexes,
    valueIndexes,
    columnsWithoutPivotGroup,
    getRowSection,
  } = pivotData;

  const topRowCount = getTopHeaderRowsCount(columnIndexes, valueIndexes);
  const leftColumnCount = rowIndexes.length;
  const bodyColumnCount = columnCount * valueIndexes.length;

  const headerLines = Array.from({ length: topRowCount }, () =>
    new Array<string>(leftColumnCount + bodyColumnCount).fill(""),
  );
  for (const item of topHeaderItems) {
    const lineIndex = getTopHeaderRowIndex(item, topRowCount);
    headerLines[lineIndex][leftColumnCount + item.offset] = String(
      translate(getItemText(item)),
    );
  }
  rowIndexes.forEach((columnIndex, position) => {
    headerLines[topRowCount - 1][position] = String(
      translate(
        getTitleForColumn(
          columnsWithoutPivotGroup[columnIndex],
          series,
          settings,
        ),
      ),
    );
  });

  const bodyLines: string[][] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const line = new Array<string>(leftColumnCount).fill("");
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      for (const cell of getRowSection(columnIndex, rowIndex)) {
        line.push(getItemText(cell));
      }
    }
    bodyLines.push(line);
  }
  for (const item of leftHeaderItems) {
    if (bodyLines[item.offset]) {
      bodyLines[item.offset][item.depth] = getItemText(item);
    }
  }

  return { lines: [...headerLines, ...bodyLines], bodyRowCount: rowCount };
}

// Pivot results interleave subtotal rows and carry the grouping column
function flattenPivotGroupedData(data: DatasetData): DatasetData {
  const groupIndex = data.cols.findIndex(DataGrid.isPivotGroupColumn);
  if (groupIndex < 0) {
    return data;
  }
  return {
    ...data,
    cols: data.cols.filter((col) => !DataGrid.isPivotGroupColumn(col)),
    rows: data.rows
      .filter((row) => DataGrid.isPivotDetailRow(row, groupIndex))
      .map((row) => row.filter((_value, index) => index !== groupIndex)),
  };
}
