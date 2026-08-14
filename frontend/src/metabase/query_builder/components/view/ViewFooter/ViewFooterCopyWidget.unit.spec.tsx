import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen, waitFor } from "__support__/ui";
import { getChartImageBlob } from "metabase/visualizations/lib/save-chart-image";
import { registerVisualizations } from "metabase/visualizations/register";
import type { Card, Dataset } from "metabase-types/api";
import { createMockDataset } from "metabase-types/api/mocks";

import { ViewFooterCopyWidget } from "./ViewFooterCopyWidget";
import {
  ALL_HIDDEN_TABLE_CARD,
  CLASSIC_PIVOT_CARD,
  CLASSIC_PIVOT_RESULT,
  LINE_CARD,
  OBJECT_CARD,
  PIVOT_CARD,
  PIVOT_RESULT,
  SCALAR_CARD,
  TABLE_CARD,
  TABLE_RESULT,
  createViewFooterState,
} from "./test-utils";

jest.mock("metabase/visualizations/lib/save-chart-image", () => ({
  ...jest.requireActual("metabase/visualizations/lib/save-chart-image"),
  getChartImageBlob: jest.fn(),
}));

registerVisualizations();

// jsdom has no ClipboardItem; a stub that keeps its input is enough
class FakeClipboardItem {
  constructor(readonly parts: Record<string, Blob | Promise<Blob>>) {}
}

// jsdom's Blob has no .text()
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

const mockClipboardWrite = () => {
  Object.assign(window, { ClipboardItem: FakeClipboardItem });
  const write = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { write } });
  return write;
};

const mockClipboardWriteText = () => {
  Reflect.deleteProperty(window, "ClipboardItem");
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
};

interface SetupOpts {
  card: Card;
  result: Dataset;
  isShowingRawTable?: boolean;
}

const setup = ({ card, result, isShowingRawTable = false }: SetupOpts) =>
  renderWithProviders(<ViewFooterCopyWidget />, {
    storeInitialState: createViewFooterState({
      card,
      result,
      isShowingRawTable,
    }),
  });

describe("ViewFooterCopyWidget", () => {
  it("copies text and html table flavors so spreadsheets paste a grid", async () => {
    const write = mockClipboardWrite();
    setup({ card: TABLE_CARD, result: TABLE_RESULT });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item: FakeClipboardItem = write.mock.calls[0][0][0];
    expect(await readBlob(await item.parts["text/plain"])).toBe(
      "Name\tTotal\nWidget\t10.5",
    );
    expect(await readBlob(await item.parts["text/html"])).toBe(
      "<table><tbody><tr><td>Name</td><td>Total</td></tr><tr><td>Widget</td><td>10.5</td></tr></tbody></table>",
    );
  });

  it("copies the rendered grid for pivot tables", async () => {
    const writeText = mockClipboardWriteText();
    setup({ card: PIVOT_CARD, result: PIVOT_RESULT });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        ["Category\tAlpha\tBeta", "Doohickey\t10\t20"].join("\n"),
      ),
    );
  });

  it("copies the flat table when the raw data view is shown", async () => {
    const writeText = mockClipboardWriteText();
    setup({ card: PIVOT_CARD, result: PIVOT_RESULT, isShowingRawTable: true });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "Category\tVendor\tCount",
          "Doohickey\tAlpha\t10",
          "Doohickey\tBeta\t20",
        ].join("\n"),
      ),
    );
  });

  it("copies results, not a chart, when a chart is toggled to the raw data view", async () => {
    const writeText = mockClipboardWriteText();
    setup({ card: LINE_CARD, result: TABLE_RESULT, isShowingRawTable: true });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Name\tTotal\nWidget\t10.5"),
    );
  });

  it("copies a png of the chart for chart views", async () => {
    const write = mockClipboardWrite();
    jest
      .mocked(getChartImageBlob)
      .mockResolvedValue(new Blob(["png-bytes"], { type: "image/png" }));
    setup({ card: LINE_CARD, result: TABLE_RESULT });

    await userEvent.click(
      screen.getByLabelText("Copy this chart to clipboard"),
    );

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item: FakeClipboardItem = write.mock.calls[0][0][0];
    expect(await readBlob(await item.parts["image/png"])).toBe("png-bytes");
    expect(getChartImageBlob).toHaveBeenCalledWith(
      expect.objectContaining({ includeBranding: true }),
    );
  });

  it.each([
    ["scalar", SCALAR_CARD],
    ["object", OBJECT_CARD],
  ])(
    "copies results as text for a %s view that cannot export a png",
    async (_display, card) => {
      const writeText = mockClipboardWriteText();
      setup({ card, result: TABLE_RESULT });

      await userEvent.click(
        screen.getByLabelText("Copy these results to clipboard"),
      );

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith("Name\tTotal\nWidget\t10.5"),
      );
    },
  );

  it("disables copy for a pivot the renderer rejected as truncated", async () => {
    const writeText = mockClipboardWriteText();
    const truncated = createMockDataset({
      data: { ...PIVOT_RESULT.data, pivot_rows_truncated: 1000 },
    });

    setup({ card: PIVOT_CARD, result: truncated });

    const button = screen.getByLabelText(
      "This pivot table is truncated and can't be copied",
    );
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("disables copy for a table with every column hidden", async () => {
    const writeText = mockClipboardWriteText();

    setup({ card: ALL_HIDDEN_TABLE_CARD, result: TABLE_RESULT });

    const button = screen.getByLabelText(
      "All columns are hidden, so there's nothing to copy",
    );
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says the raw view of a truncated pivot copied only the first rows", async () => {
    const writeText = mockClipboardWriteText();
    const truncated = createMockDataset({
      data: { ...PIVOT_RESULT.data, pivot_rows_truncated: 1000 },
    });

    const { store } = setup({
      card: PIVOT_CARD,
      result: truncated,
      isShowingRawTable: true,
    });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        [
          "Category\tVendor\tCount",
          "Doohickey\tAlpha\t10",
          "Doohickey\tBeta\t20",
        ].join("\n"),
      ),
    );
    await waitFor(() => {
      expect(store.getState().undo).toContainEqual(
        expect.objectContaining({
          message: "Copied the first 2 rows to the clipboard",
        }),
      );
    });
  });

  it("starts the results clipboard write inside the click, before serializing", async () => {
    const write = mockClipboardWrite();
    const raf = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 0);

    setup({ card: TABLE_CARD, result: TABLE_RESULT });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    expect(write).toHaveBeenCalledTimes(1);
    raf.mockRestore();
  });

  it("starts the chart clipboard write inside the click, before any frame is painted", async () => {
    const write = mockClipboardWrite();
    const raf = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 0);

    setup({ card: LINE_CARD, result: TABLE_RESULT });

    await userEvent.click(
      screen.getByLabelText("Copy this chart to clipboard"),
    );

    expect(write).toHaveBeenCalledTimes(1);
    raf.mockRestore();
  });

  it("shows an error toast when the clipboard write fails", async () => {
    Reflect.deleteProperty(window, "ClipboardItem");
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    const { store } = setup({ card: TABLE_CARD, result: TABLE_RESULT });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() => {
      expect(store.getState().undo).toContainEqual(
        expect.objectContaining({
          message: "Couldn't copy to the clipboard.",
        }),
      );
    });
  });

  it("says when only the first rows were copied", async () => {
    mockClipboardWriteText();
    const truncated = createMockDataset({
      data: { ...TABLE_RESULT.data, rows_truncated: 2000 },
    });

    const { store } = setup({ card: TABLE_CARD, result: truncated });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() => {
      expect(store.getState().undo).toContainEqual(
        expect.objectContaining({
          message: "Copied the first 1 row to the clipboard",
        }),
      );
    });
  });

  it("says the pivot covers only the first rows when results are truncated", async () => {
    mockClipboardWriteText();
    const truncated = createMockDataset({
      data: { ...CLASSIC_PIVOT_RESULT.data, rows_truncated: 2000 },
    });

    const { store } = setup({ card: CLASSIC_PIVOT_CARD, result: truncated });

    await userEvent.click(
      screen.getByLabelText("Copy these results to clipboard"),
    );

    await waitFor(() => {
      expect(store.getState().undo).toContainEqual(
        expect.objectContaining({
          message:
            "Copied a pivot table of the first 2000 rows to the clipboard",
        }),
      );
    });
  });
});
