import { serializeTsv } from "./formatting";

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

  it("doubles quotes only inside quoted cells", () => {
    expect(serializeTsv([['say "hi"', 'multi\n"quoted"']])).toBe(
      'say "hi"\t"multi\n""quoted"""',
    );
    expect(serializeTsv([['"leading quote']])).toBe('"leading quote');
  });

  it("keeps empty cells so the pasted shape survives", () => {
    expect(serializeTsv([["a", "", "c"]])).toBe("a\t\tc");
  });
});
