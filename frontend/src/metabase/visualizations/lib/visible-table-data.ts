import * as DataGrid from "metabase/visualizations/lib/data_grid";
import { isPivoted } from "metabase/visualizations/lib/settings/column";
import type { ComputedVisualizationSettings } from "metabase/visualizations/types";
import { findColumnIndexesForColumnSettings } from "metabase-lib/v1/queries/utils/dataset";
import type { DatasetData, RawSeries } from "metabase-types/api";

export type VisibleTableData = Pick<
  DatasetData,
  "cols" | "rows" | "results_timezone" | "rows_truncated" | "sourceRows"
>;

// The classic pivot layout when "table.pivot" is on, otherwise "table.columns"
export function getVisibleTableData({
  series,
  settings,
  isShowingDetailsOnlyColumns = false,
}: {
  series: RawSeries;
  settings: ComputedVisualizationSettings;
  isShowingDetailsOnlyColumns?: boolean;
}): VisibleTableData {
  const [{ data }] = series;

  if (isPivoted(series, settings)) {
    const pivotIndex = data.cols.findIndex(
      (col) => col.name === settings["table.pivot_column"],
    );
    const cellIndex = data.cols.findIndex(
      (col) => col.name === settings["table.cell_column"],
    );
    const normalIndex = data.cols.findIndex(
      (_col, index) => index !== pivotIndex && index !== cellIndex,
    );
    return DataGrid.pivot(data, normalIndex, pivotIndex, cellIndex, settings);
  }

  const { cols, rows, results_timezone, rows_truncated } = data;
  const columnSettings = settings["table.columns"] ?? [];

  const isColumnVisible = (columnIndex: number, settingIndex: number) => {
    if (columnIndex < 0) {
      return false;
    }
    if (isShowingDetailsOnlyColumns) {
      return true;
    }
    const isDetailsOnlyColumn =
      cols[columnIndex].visibility_type === "details-only";
    return !isDetailsOnlyColumn && columnSettings[settingIndex].enabled;
  };

  const columnIndexes = findColumnIndexesForColumnSettings(
    cols,
    columnSettings,
  ).filter(isColumnVisible);

  return {
    cols: columnIndexes.map((i) => cols[i]),
    rows: rows.map((row) => columnIndexes.map((i) => row[i])),
    results_timezone,
    rows_truncated,
  };
}
