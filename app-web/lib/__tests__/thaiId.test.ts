import { describe, it, expect } from "vitest";
import { formatThaiNationalId } from "../thaiId";

describe("formatThaiNationalId", () => {
  it("groups a full 13-digit id the way the card prints it", () => {
    expect(formatThaiNationalId("1890700262571")).toBe("1-8907-00262-57-1");
  });

  it("re-groups an id that already carries separators", () => {
    expect(formatThaiNationalId("1 8907 00262 57 1")).toBe("1-8907-00262-57-1");
  });

  it("leaves anything that isn't 13 digits exactly as entered", () => {
    // Partially typed, or simply not a national ID — mangling either would
    // be worse than showing it raw.
    expect(formatThaiNationalId("18907")).toBe("18907");
    expect(formatThaiNationalId("")).toBe("");
    expect(formatThaiNationalId("12345678901234")).toBe("12345678901234");
  });
});
