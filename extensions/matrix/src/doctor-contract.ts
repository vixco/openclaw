import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { matrixDoctor } from "./doctor.js";

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] =
  matrixDoctor.legacyConfigRules ?? [];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: OpenClawConfig;
}): ChannelDoctorConfigMutation {
  return matrixDoctor.normalizeCompatibilityConfig?.({ cfg }) ?? { config: cfg, changes: [] };
}
