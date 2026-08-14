import { useCallback } from "react";
import { msgid, ngettext, t } from "ttag";

import { waitUntilNextFramePainted } from "metabase/common/utils/wait-until-next-frame-paints";
import { useTranslateContent } from "metabase/content-translation/hooks";
import { useDispatch, useSelector } from "metabase/redux";
import { addUndo } from "metabase/redux/undo";
import { getTokenFeature } from "metabase/settings";
import { canSavePng, extractRemappedColumns } from "metabase/visualizations";
import { getChartSelector } from "metabase/visualizations/lib/image-exports";
import {
  flattenPivotGroupedData,
  getResultsClipboardContent,
} from "metabase/visualizations/lib/results-clipboard";
import { getChartImageBlob } from "metabase/visualizations/lib/save-chart-image";
import { getComputedSettingsForSeries } from "metabase/visualizations/lib/settings/visualization";
import { getVisibleTableData } from "metabase/visualizations/lib/visible-table-data";
import type Question from "metabase-lib/v1/Question";
import type { Dataset, RawSeries } from "metabase-types/api";

type CopyMode = "results" | "chart";

const isGridDisplay = (question: Question) =>
  question.display() === "table" || question.display() === "pivot";

export const getCopyMode = (question: Question): CopyMode =>
  isGridDisplay(question) || !canSavePng(question.display())
    ? "results"
    : "chart";

// The renderer refuses these same two result shapes, so the copy action must too
export const getCopyIneligibleReason = (
  question: Question,
  result: Dataset,
): string | null => {
  if (
    question.display() === "pivot" &&
    result.data.pivot_rows_truncated != null
  ) {
    return t`This pivot table is truncated and can't be copied`;
  }

  // The pivot grid is built from multiLevelPivot, not table.columns, so this
  // hidden-columns check (mirroring the flat-table path below) doesn't apply to it
  if (getCopyMode(question) !== "results" || question.display() === "pivot") {
    return null;
  }

  const card = isGridDisplay(question)
    ? question.card()
    : question.setDisplay("table").card();
  const series: RawSeries = [
    { card, data: extractRemappedColumns(result.data) },
  ];
  const settings = getComputedSettingsForSeries(series);
  const flatSeries: RawSeries = [
    { card, data: flattenPivotGroupedData(series[0].data) },
  ];
  const { cols } = getVisibleTableData({ series: flatSeries, settings });

  return cols.length === 0
    ? t`All columns are hidden, so there's nothing to copy`
    : null;
};

interface UseCopyResultsParams {
  question: Question;
  result: Dataset;
}

export const useCopyResults = ({ question, result }: UseCopyResultsParams) => {
  const dispatch = useDispatch();
  const translate = useTranslateContent();
  const isWhitelabeled = useSelector((state) =>
    getTokenFeature(state, "whitelabel"),
  );

  return useCallback(async (): Promise<void> => {
    const ineligibleReason = getCopyIneligibleReason(question, result);
    if (ineligibleReason) {
      dispatch(addUndo({ icon: "warning", message: ineligibleReason }));
      return;
    }

    try {
      if (getCopyMode(question) === "chart") {
        await copyChartImage(question, !isWhitelabeled);
        dispatch(addUndo({ message: t`Copied the chart to the clipboard` }));
        return;
      }

      const card = isGridDisplay(question)
        ? question.card()
        : question.setDisplay("table").card();

      // Spinner paints first; Safari needs the write started inside the click
      const content = waitUntilNextFramePainted().then(() =>
        getResultsClipboardContent({
          card,
          data: result.data,
          pivoted: question.display() === "pivot",
          translate,
        }),
      );
      await writeResultsToClipboard(content);

      const { rowCount, isPivotGrid } = await content;
      const message = getRowsCopiedMessage({
        rowCount,
        truncatedRowCount:
          result.data.rows_truncated || result.data.pivot_rows_truncated,
        isPivotGrid,
      });
      dispatch(addUndo({ message }));
    } catch {
      dispatch(
        addUndo({
          icon: "warning",
          message: t`Couldn't copy to the clipboard.`,
        }),
      );
    }
  }, [dispatch, question, result, translate, isWhitelabeled]);
};

function getRowsCopiedMessage({
  rowCount,
  truncatedRowCount,
  isPivotGrid,
}: {
  rowCount: number;
  truncatedRowCount: number | undefined;
  isPivotGrid: boolean;
}): string {
  if (!truncatedRowCount) {
    return ngettext(
      msgid`Copied ${rowCount} row to the clipboard`,
      `Copied ${rowCount} rows to the clipboard`,
      rowCount,
    );
  }
  if (isPivotGrid) {
    return ngettext(
      msgid`Copied a pivot table of the first ${truncatedRowCount} row to the clipboard`,
      `Copied a pivot table of the first ${truncatedRowCount} rows to the clipboard`,
      truncatedRowCount,
    );
  }
  return ngettext(
    msgid`Copied the first ${rowCount} row to the clipboard`,
    `Copied the first ${rowCount} rows to the clipboard`,
    rowCount,
  );
}

function copyChartImage(question: Question, includeBranding: boolean) {
  if (typeof ClipboardItem === "undefined") {
    return Promise.reject(
      new Error("Clipboard images are not supported in this browser"),
    );
  }

  // Safari rejects writes started outside the click, so the blob is a promise
  const blob = waitUntilNextFramePainted()
    .then(() =>
      getChartImageBlob({
        selector: getChartSelector({ cardId: question.id() }),
        includeBranding,
      }),
    )
    .then((blob) => {
      if (!blob) {
        throw new Error("No chart to copy");
      }
      return blob;
    });

  return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

// Spreadsheets paste the html flavor as a grid
async function writeResultsToClipboard(
  content: Promise<{ text: string; html: string }>,
) {
  if (
    typeof ClipboardItem !== "undefined" &&
    navigator.clipboard.write != null
  ) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": content.then(
          ({ text }) => new Blob([text], { type: "text/plain" }),
        ),
        "text/html": content.then(
          ({ html }) => new Blob([html], { type: "text/html" }),
        ),
      }),
    ]);
  } else {
    const { text } = await content;
    await navigator.clipboard.writeText(text);
  }
}
