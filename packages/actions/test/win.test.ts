import { describe, expect, it } from "vitest";
import { isInside, normalizePath } from "../src";

describe("caminhos do Windows", () => {
  it("raiz de disco e subpastas", () => {
    expect(normalizePath("D:\\Fotos\\")).toBe("D:/Fotos");
    expect(isInside("D:/Fotos/a.jpg", normalizePath("D:\\"))).toBe(true);
    expect(isInside("D:/Fotos", normalizePath("D:"))).toBe(true);
    expect(isInside("E:/x", normalizePath("D:\\"))).toBe(false);
    expect(normalizePath("C:\\Users\\x\\..\\y")).toBe("C:/Users/y");
  });
});
