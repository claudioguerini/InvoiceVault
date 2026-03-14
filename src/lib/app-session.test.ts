import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPackageOverride,
  loadNotarizationPackageOverride,
  loadPackageOverride,
  loadPackageOverrides,
  savePackageOverride,
} from "@/lib/app-session";

const invoicePackageId = `0x${"a".repeat(64)}`;
const notarizationPackageId = `0x${"b".repeat(64)}`;

describe("app-session overrides", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores invoice and notarization package overrides together", () => {
    savePackageOverride("DevNet", invoicePackageId.toUpperCase(), notarizationPackageId.toUpperCase());

    expect(loadPackageOverrides("devnet")).toEqual({
      invoicePackageId,
      notarizationPackageId,
    });
  });

  it("reads legacy invoice-only override values", () => {
    window.localStorage.setItem(
      "invoice-vault-package-override-v2:devnet",
      invoicePackageId.toUpperCase(),
    );

    expect(loadPackageOverride("devnet")).toBe(invoicePackageId);
    expect(loadNotarizationPackageOverride("devnet")).toBeNull();
  });

  it("clears both overrides together", () => {
    savePackageOverride("devnet", invoicePackageId, notarizationPackageId);
    clearPackageOverride("devnet");

    expect(loadPackageOverride("devnet")).toBeNull();
    expect(loadNotarizationPackageOverride("devnet")).toBeNull();
  });
});
