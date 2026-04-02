import { describe, expect, it, vi } from "vitest";
import { reconcileNodePairingOnConnect } from "./node-connect-reconcile.js";

describe("reconcileNodePairingOnConnect", () => {
  it("passes approved device scopes into implicit node pairing approval", async () => {
    const approvePairing = vi.fn(async () => ({
      requestId: "node-request-1",
      node: {
        nodeId: "device-1",
        token: "node-token",
        createdAtMs: 1,
        approvedAtMs: 2,
      },
    }));

    const result = await reconcileNodePairingOnConnect({
      cfg: {},
      connectParams: {
        minProtocol: 1,
        maxProtocol: 1,
        role: "node",
        scopes: [],
        caps: [],
        commands: ["system.exec"],
        permissions: {},
        client: {
          id: "openclaw-android",
          mode: "node",
          version: "1.0.0",
          platform: "android",
        },
        device: {
          id: "device-1",
          publicKey: "public-key",
          signature: "signature",
          signedAt: 1,
          nonce: "nonce",
        },
      },
      pairedNode: null,
      reportedClientIp: "192.168.1.10",
      allowImplicitPairing: true,
      implicitPairingCallerScopes: ["operator.write"],
      requestPairing: async () => ({
        status: "pending",
        created: true,
        request: {
          requestId: "node-request-1",
          nodeId: "device-1",
          commands: ["system.exec"],
          ts: 1,
        },
      }),
      approvePairing,
    });

    expect(approvePairing).toHaveBeenCalledWith("node-request-1", ["operator.write"]);
    expect(result.approvedPairing?.requestId).toBe("node-request-1");
    expect(result.pendingPairing).toBeUndefined();
  });
});
