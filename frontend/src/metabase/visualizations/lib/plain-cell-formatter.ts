import type { ContentTranslationFunction } from "metabase/content-translation/types";
import type { PlainCellFormatter } from "metabase/data-grid/types";
import { formatValue } from "metabase/value-formatting";
import type { ClickObject } from "metabase/visualizations/types";
import type { ColumnSettings } from "metabase-types/api";

export function createPlainCellFormatter({
  columnSettings,
  translate,
  getClicked,
}: {
  columnSettings?: ColumnSettings;
  translate: ContentTranslationFunction;
  getClicked?: (rowIndex: number, columnId: string) => ClickObject | undefined;
}): PlainCellFormatter<unknown> {
  return (untranslatedValue, rowIndex, columnId) =>
    String(
      formatValue(translate(untranslatedValue), {
        ...columnSettings,
        type: "cell",
        copyLinkUrl: true,
        clicked: getClicked?.(rowIndex, columnId),
      }),
    );
}
