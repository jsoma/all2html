import { describe, expect, it } from "vitest";
import {
  AE_HOST_COMMANDS,
  COMMON_HOST_COMMANDS,
  HOST_COMMANDS,
  HOST_NAMESPACE,
  ILLUSTRATOR_HOST_COMMANDS,
} from "../../plugins/illustrator/panel/src/shared/host-contract.js";

describe("host command contract", () => {
  it("keeps the CEP namespace and exported command names stable", () => {
    expect(HOST_NAMESPACE).toBe("com.all2html.panel");
    expect(COMMON_HOST_COMMANDS.openFolder).toBe("openFolder");
    expect(COMMON_HOST_COMMANDS.getDiagnostics).toBe("getDiagnostics");
    expect(ILLUSTRATOR_HOST_COMMANDS.runExport).toBe("runExport");
    expect(AE_HOST_COMMANDS.runAeExport).toBe("runAeExport");
    expect(HOST_COMMANDS.readConfigFile).toBe("readConfigFile");
    expect(HOST_COMMANDS.getAeMissingFonts).toBe("getAeMissingFonts");
  });

  it("keeps the grouped command exports in sync with the flattened map", () => {
    const grouped = {
      ...COMMON_HOST_COMMANDS,
      ...ILLUSTRATOR_HOST_COMMANDS,
      ...AE_HOST_COMMANDS,
    };

    expect(HOST_COMMANDS).toEqual(grouped);
    expect(new Set(Object.values(HOST_COMMANDS)).size).toBe(Object.keys(HOST_COMMANDS).length);
  });
});
