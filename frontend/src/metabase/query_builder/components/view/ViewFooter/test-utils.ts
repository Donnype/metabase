import { mockSettings } from "__support__/settings";
import { createMockEntitiesState } from "__support__/store";
import {
  createMockQueryBuilderState,
  createMockQueryBuilderUIControlsState,
  createMockState,
} from "metabase/redux/store/mocks";
import type { Card, Dataset } from "metabase-types/api";
import {
  createMockCard,
  createMockColumn,
  createMockDataset,
  createMockStructuredDatasetQuery,
} from "metabase-types/api/mocks";
import { ORDERS_ID, SAMPLE_DB_ID } from "metabase-types/api/mocks/presets";

const testDatasetQuery = () =>
  createMockStructuredDatasetQuery({
    database: SAMPLE_DB_ID,
    query: { "source-table": ORDERS_ID },
  });

export const TABLE_CARD = createMockCard({
  display: "table",
  dataset_query: testDatasetQuery(),
});

export const TABLE_RESULT = createMockDataset({
  data: {
    cols: [
      createMockColumn({
        name: "NAME",
        display_name: "Name",
        base_type: "type/Text",
      }),
      createMockColumn({
        name: "TOTAL",
        display_name: "Total",
        base_type: "type/Float",
      }),
    ],
    rows: [["Widget", 10.5]],
  },
});

export const PIVOT_CARD = createMockCard({
  display: "pivot",
  dataset_query: testDatasetQuery(),
  visualization_settings: {
    "pivot_table.column_split": {
      rows: ["CATEGORY"],
      columns: ["VENDOR"],
      values: ["COUNT"],
    },
    "pivot.show_row_totals": false,
    "pivot.show_column_totals": false,
  },
});

export const PIVOT_RESULT = createMockDataset({
  data: {
    cols: [
      createMockColumn({
        name: "CATEGORY",
        display_name: "Category",
        base_type: "type/Text",
        source: "breakout",
      }),
      createMockColumn({
        name: "VENDOR",
        display_name: "Vendor",
        base_type: "type/Text",
        source: "breakout",
      }),
      createMockColumn({
        name: "COUNT",
        display_name: "Count",
        base_type: "type/Integer",
        source: "aggregation",
      }),
      createMockColumn({
        name: "pivot-grouping",
        display_name: "pivot-grouping",
        base_type: "type/Integer",
      }),
    ],
    rows: [
      ["Doohickey", "Alpha", 10, 0],
      ["Doohickey", "Beta", 20, 0],
      [null, "Alpha", 30, 1],
    ],
  },
});

export const CLASSIC_PIVOT_CARD = createMockCard({
  display: "table",
  dataset_query: testDatasetQuery(),
  visualization_settings: {
    "table.pivot": true,
    "table.pivot_column": "VENDOR",
    "table.cell_column": "COUNT",
  },
});

export const CLASSIC_PIVOT_RESULT = createMockDataset({
  data: {
    cols: [
      createMockColumn({
        name: "CATEGORY",
        display_name: "Category",
        base_type: "type/Text",
        source: "breakout",
      }),
      createMockColumn({
        name: "VENDOR",
        display_name: "Vendor",
        base_type: "type/Text",
        source: "breakout",
      }),
      createMockColumn({
        name: "COUNT",
        display_name: "Count",
        base_type: "type/Integer",
        source: "aggregation",
      }),
    ],
    rows: [
      ["Doohickey", "Alpha", 10],
      ["Doohickey", "Beta", 20],
      ["Gizmo", "Alpha", 30],
    ],
  },
});

export const LINE_CARD = createMockCard({
  display: "line",
  dataset_query: testDatasetQuery(),
});

export const SCALAR_CARD = createMockCard({
  display: "scalar",
  dataset_query: testDatasetQuery(),
});

export const OBJECT_CARD = createMockCard({
  display: "object",
  dataset_query: testDatasetQuery(),
});

export const createViewFooterState = ({
  card,
  result,
  isShowingRawTable = false,
}: {
  card: Card;
  result: Dataset;
  isShowingRawTable?: boolean;
}) =>
  createMockState({
    entities: createMockEntitiesState({ questions: [card] }),
    settings: mockSettings({ "enable-pivoted-exports": true }),
    qb: createMockQueryBuilderState({
      card,
      lastRunCard: card,
      queryResults: [result],
      uiControls: createMockQueryBuilderUIControlsState({ isShowingRawTable }),
    }),
  });
