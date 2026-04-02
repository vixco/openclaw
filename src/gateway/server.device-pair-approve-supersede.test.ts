import { describe, expect, test } from "vitest";
import {
  approveDevicePairing,
  getPairedDevice,
  requestDevicePairing,
} from "../infra/device-pairing.js";
import { installGatewayTestHooks } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway device.pair.approve pending request reconciliation", () => {
  test("approves the same pending request id after a scope upgrade reconnect", async () => {
    const first = await requestDevicePairing({
      deviceId: "supersede-device-1",
      publicKey: "supersede-public-key",
      role: "node",
      scopes: [],
    });
    const second = await requestDevicePairing({
      deviceId: "supersede-device-1",
      publicKey: "supersede-public-key",
      role: "operator",
      scopes: ["operator.admin"],
    });

    expect(second.request.requestId).toBe(first.request.requestId);

    const approved = await approveDevicePairing(first.request.requestId, {
      callerScopes: ["operator.admin"],
    });
    expect(approved?.status).toBe("approved");

    const paired = await getPairedDevice("supersede-device-1");
    expect(paired?.roles).toEqual(expect.arrayContaining(["node", "operator"]));
    expect(paired?.scopes).toEqual(expect.arrayContaining(["operator.admin"]));
  });
});
