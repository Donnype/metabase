import { parse } from "csv-parse/browser/esm/sync";

import { serializeTsv } from "./formatting";

const roundTrip = (lines: string[][]) =>
  parse(serializeTsv(lines), { delimiter: "\t" });

describe("serializeTsv", () => {
  it("joins cells with tabs and lines with newlines", () => {
    expect(
      serializeTsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a\tb\nc\td");
  });

  it("quotes cells containing tabs, newlines, or carriage returns", () => {
    expect(serializeTsv([["tab\there", "line\nbreak", "cr\rhere"]])).toBe(
      '"tab\there"\t"line\nbreak"\t"cr\rhere"',
    );
  });

  it("round-trips cells containing quotes", () => {
    const lines = [
      ['say "hi"', 'multi\n"quoted"'],
      ['"leading quote', '{"tags":["a","b"]}'],
    ];
    expect(roundTrip(lines)).toEqual(lines);
  });

  it("keeps empty cells so the pasted shape survives", () => {
    expect(serializeTsv([["a", "", "c"]])).toBe("a\t\tc");
  });
});
