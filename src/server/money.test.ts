import { describe, expect, it } from "vitest";
import { cents, formatUsd, toCents, toPayPalValue } from "./money";

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [50000, "$500.00"],
    [123456, "$1,234.56"],
  ])("formats %i", (input, expected) => {
    expect(formatUsd(input)).toBe(expected);
  });
});

describe("toCents", () => {
  it.each([
    ["100.00", 10000],
    ["12", 1200],
    ["0.1", 10],
    ["0.05", 5],
    ["999999999.99", 99999999999],
  ])("parses %s", (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it.each(["-1", "1.234", "1e3", "abc", " 1", "1.", ".5", "", "0x10", "1,000"])("rejects %j", (input) => {
    expect(() => toCents(input)).toThrow();
  });
});

describe("cents", () => {
  it("rejects fractions, negatives and unsafe integers", () => {
    expect(() => cents(1.5)).toThrow();
    expect(() => cents(-1)).toThrow();
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe("toPayPalValue", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [1234, "12.34"],
    [10000, "100.00"],
  ])("formats %i", (input, expected) => {
    expect(toPayPalValue(cents(input))).toBe(expected);
  });

  it("round-trips", () => {
    for (const v of ["0.01", "40.00", "38.47", "1000.10"]) expect(toPayPalValue(toCents(v))).toBe(v);
  });
});
