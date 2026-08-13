import type { RawSeries } from "metabase-types/api";
import {
  createMockCard,
  createMockColumn,
  createMockDatasetData,
} from "metabase-types/api/mocks";

import { getVisibleTableData } from "./visible-table-data";

const TEST_SERIES: RawSeries = [
  {
    card: createMockCard({ display: "table" }),
    data: createMockDatasetData({
      cols: [
        createMockColumn({ name: "NAME", display_name: "Name" }),
        createMockColumn({ name: "TOTAL", display_name: "Total" }),
      ],
      rows: [["Widget", 10.5]],
    }),
  },
];

describe("getVisibleTableData", () => {
  it("hides every column when the table.columns setting is missing", () => {
    const { cols, rows } = getVisibleTableData({
      series: TEST_SERIES,
      settings: {},
    });

    expect(cols).toEqual([]);
    expect(rows).toEqual([[]]);
  });
});
