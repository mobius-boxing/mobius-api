/**
 * CodeGenerator formatting — golden parity cases from
 * specs/replication/modules/01-system-and-cross-cutting/autonumeradores.md
 */
import { describe, it, expect } from "@jest/globals";
import {
  formatCode,
  formatDependentCode,
  parseDependentSuffix,
} from "../../../services/code-generator.service";

describe("CodeGenerator formatting (Procusto parity goldens)", () => {
  it("formats production-order codes as 8-digit zero-padded", () => {
    expect(formatCode(1, 8)).toBe("00000001");
    expect(formatCode(11, 8)).toBe("00000011");
    expect(formatCode(14091, 8)).toBe("00014091");
  });

  it("formats coil (bobina) codes as 10-digit zero-padded", () => {
    expect(formatCode(1, 10)).toBe("0000000001");
  });

  it("width 0 means unpadded", () => {
    expect(formatCode(7, 0)).toBe("7");
  });

  it("does not truncate values wider than the pad width", () => {
    expect(formatCode(123456789, 8)).toBe("123456789");
  });

  it("formats dependent order codes as {pedido}\\{n}, unpadded", () => {
    expect(formatDependentCode("P100", 1)).toBe("P100\\1");
    expect(formatDependentCode("P100", 5)).toBe("P100\\5");
    expect(formatDependentCode("00014091", 1)).toBe("00014091\\1");
  });

  it("extracts dependent suffixes with the (.*)\\\\(.*) regex", () => {
    expect(parseDependentSuffix("P100\\4")).toBe(4);
    expect(parseDependentSuffix("00014091\\12")).toBe(12);
    expect(parseDependentSuffix("00000007")).toBeNull();
    expect(parseDependentSuffix("P100\\ABC")).toBeNull();
  });
});
