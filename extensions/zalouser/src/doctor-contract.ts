import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { zalouserDoctor } from "./doctor.js";

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] =
  zalouserDoctor.legacyConfigRules ?? [];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: OpenClawConfig;
}): ChannelDoctorConfigMutation {
  return zalouserDoctor.normalizeCompatibilityConfig?.({ cfg }) ?? { config: cfg, changes: [] };
}
