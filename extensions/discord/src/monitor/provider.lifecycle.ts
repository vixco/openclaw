import { createConnectedChannelStatusPatch } from "openclaw/plugin-sdk/gateway-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { attachDiscordGatewayLogging } from "../gateway-logging.js";
import { getDiscordGatewayEmitter, waitForDiscordGatewayStop } from "../monitor.gateway.js";
import type { DiscordVoiceManager } from "../voice/manager.js";
import type { MutableDiscordGateway } from "./gateway-handle.js";
import { registerGateway, unregisterGateway } from "./gateway-registry.js";
import type { DiscordGatewayEvent, DiscordGatewaySupervisor } from "./gateway-supervisor.js";
import type { DiscordMonitorStatusSink } from "./status.js";

const DISCORD_GATEWAY_READY_TIMEOUT_MS = 15_000;
const DISCORD_GATEWAY_READY_POLL_MS = 250;

type ExecApprovalsHandler = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type GatewayReadyWaitResult = "ready" | "stopped" | "timeout";

async function waitForGatewayReady(params: {
  gateway?: Pick<MutableDiscordGateway, "connect" | "disconnect" | "isConnected">;
  abortSignal?: AbortSignal;
  beforePoll?: () => Promise<"continue" | "stop"> | "continue" | "stop";
  pushStatus?: (patch: Parameters<DiscordMonitorStatusSink>[0]) => void;
  runtime: RuntimeEnv;
}): Promise<void> {
  const waitUntilReady = async (): Promise<GatewayReadyWaitResult> => {
    const deadlineAt = Date.now() + DISCORD_GATEWAY_READY_TIMEOUT_MS;
    while (!params.abortSignal?.aborted) {
      if ((await params.beforePoll?.()) === "stop") {
        return "stopped";
      }
      if (params.gateway?.isConnected ?? true) {
        const at = Date.now();
        params.pushStatus?.({
          ...createConnectedChannelStatusPatch(at),
          lastDisconnect: null,
        });
        return "ready";
      }
      if (Date.now() >= deadlineAt) {
        return "timeout";
      }
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, DISCORD_GATEWAY_READY_POLL_MS);
        timeout.unref?.();
      });
    }
    return "stopped";
  };

  const firstAttempt = await waitUntilReady();
  if (firstAttempt !== "timeout") {
    return;
  }
  if (!params.gateway) {
    throw new Error(
      `discord gateway did not reach READY within ${DISCORD_GATEWAY_READY_TIMEOUT_MS}ms`,
    );
  }

  const restartAt = Date.now();
  params.runtime.error?.(
    danger(
      `discord: gateway was not ready after ${DISCORD_GATEWAY_READY_TIMEOUT_MS}ms; restarting gateway`,
    ),
  );
  params.pushStatus?.({
    connected: false,
    lastEventAt: restartAt,
    lastDisconnect: {
      at: restartAt,
      error: "startup-not-ready",
    },
    lastError: "startup-not-ready",
  });
  params.gateway.disconnect();
  params.gateway.connect(false);

  if ((await waitUntilReady()) === "timeout") {
    throw new Error(
      `discord gateway did not reach READY within ${DISCORD_GATEWAY_READY_TIMEOUT_MS}ms after restart`,
    );
  }
}

export async function runDiscordGatewayLifecycle(params: {
  accountId: string;
  gateway?: MutableDiscordGateway;
  runtime: RuntimeEnv;
  abortSignal?: AbortSignal;
  isDisallowedIntentsError: (err: unknown) => boolean;
  voiceManager: DiscordVoiceManager | null;
  voiceManagerRef: { current: DiscordVoiceManager | null };
  execApprovalsHandler: ExecApprovalsHandler | null;
  threadBindings: { stop: () => void };
  gatewaySupervisor: DiscordGatewaySupervisor;
  statusSink?: DiscordMonitorStatusSink;
}) {
  const gateway = params.gateway;
  if (gateway) {
    registerGateway(params.accountId, gateway);
  }
  const gatewayEmitter = params.gatewaySupervisor.emitter ?? getDiscordGatewayEmitter(gateway);
  const stopGatewayLogging = attachDiscordGatewayLogging({
    emitter: gatewayEmitter,
    runtime: params.runtime,
  });
  let lifecycleStopping = false;

  const pushStatus = (patch: Parameters<DiscordMonitorStatusSink>[0]) => {
    params.statusSink?.(patch);
  };

  let sawDisallowedIntents = false;
  const handleGatewayEvent = (event: DiscordGatewayEvent): "continue" | "stop" => {
    if (event.type === "disallowed-intents") {
      lifecycleStopping = true;
      sawDisallowedIntents = true;
      params.runtime.error?.(
        danger(
          "discord: gateway closed with code 4014 (missing privileged gateway intents). Enable the required intents in the Discord Developer Portal or disable them in config.",
        ),
      );
      return "stop";
    }
    if (event.shouldStopLifecycle) {
      lifecycleStopping = true;
    }
    params.runtime.error?.(danger(`discord gateway error: ${event.message}`));
    return event.shouldStopLifecycle ? "stop" : "continue";
  };
  const drainPendingGatewayErrors = (): "continue" | "stop" =>
    params.gatewaySupervisor.drainPending((event) => {
      const decision = handleGatewayEvent(event);
      if (decision !== "stop") {
        return "continue";
      }
      if (event.type === "disallowed-intents") {
        return "stop";
      }
      throw event.err;
    });
  try {
    if (params.execApprovalsHandler) {
      await params.execApprovalsHandler.start();
    }

    // Drain gateway errors emitted before lifecycle listeners were attached.
    if (drainPendingGatewayErrors() === "stop") {
      return;
    }

    await waitForGatewayReady({
      gateway,
      abortSignal: params.abortSignal,
      beforePoll: drainPendingGatewayErrors,
      pushStatus,
      runtime: params.runtime,
    });

    if (drainPendingGatewayErrors() === "stop") {
      return;
    }

    await waitForDiscordGatewayStop({
      gateway: gateway
        ? {
            disconnect: () => gateway.disconnect(),
          }
        : undefined,
      abortSignal: params.abortSignal,
      gatewaySupervisor: params.gatewaySupervisor,
      onGatewayEvent: handleGatewayEvent,
    });
  } catch (err) {
    if (!sawDisallowedIntents && !params.isDisallowedIntentsError(err)) {
      throw err;
    }
  } finally {
    lifecycleStopping = true;
    params.gatewaySupervisor.detachLifecycle();
    unregisterGateway(params.accountId);
    stopGatewayLogging();
    if (params.voiceManager) {
      await params.voiceManager.destroy();
      params.voiceManagerRef.current = null;
    }
    if (params.execApprovalsHandler) {
      await params.execApprovalsHandler.stop();
    }
    params.threadBindings.stop();
  }
}
