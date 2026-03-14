import { describe, expect, it } from "vitest";
import {
  formatLocalDateInputValue,
  parseLocalDateInputToDueEpochSec,
} from "@/lib/date-input";

describe("date-input helpers", () => {
  it("formats local dates for date inputs without relying on UTC", () => {
    const date = new Date(2026, 2, 13, 8, 30, 0, 0);
    expect(formatLocalDateInputValue(date)).toBe("2026-03-13");
  });

  it("parses due dates to the end of the selected local day", () => {
    const expected = Math.floor(new Date(2026, 2, 13, 23, 59, 59, 999).getTime() / 1000);
    expect(parseLocalDateInputToDueEpochSec("2026-03-13")).toBe(expected);
    expect(Number.isNaN(parseLocalDateInputToDueEpochSec("2026-02-31"))).toBe(true);
  });
});
