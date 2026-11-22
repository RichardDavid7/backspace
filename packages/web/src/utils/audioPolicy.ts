export interface InstanceAudioPolicyInput {
  defaultAudioBitrateKbps?: number;
  maxAudioBitrateKbps?: number;
  allowMusicMode?: boolean;
  allowStereoAudio?: boolean;
}

export interface AudioPolicyLevel {
  audioBitrateKbps?: number | null;
  maxAudioBitrateKbps?: number | null;
  allowMusicMode?: boolean | null;
  allowStereoAudio?: boolean | null;
}

export interface ResolvedAudioPolicy {
  /** Effective default Opus bitrate in kbps (always clamped to `[8, maxBitrateKbps]`). */
  defaultBitrateKbps: number;
  /** Effective maximum Opus bitrate cap in kbps (`[8, 512]`). */
  maxBitrateKbps: number;
  /** Whether Opus Music mode is allowed at this level. */
  allowMusicMode: boolean;
  /** Whether Opus Stereo audio is allowed at this level. */
  allowStereoAudio: boolean;
}

const MIN_BITRATE_KBPS = 8;
const MAX_BITRATE_KBPS = 512;
const DEFAULT_BITRATE_KBPS = 64;

function clampBitrate(value: number, max: number): number {
  return Math.max(MIN_BITRATE_KBPS, Math.min(max, value));
}

export function resolveInstanceAudioPolicy(
  instance?: InstanceAudioPolicyInput | null,
): ResolvedAudioPolicy {
  const maxBitrateKbps = clampBitrate(instance?.maxAudioBitrateKbps ?? MAX_BITRATE_KBPS, MAX_BITRATE_KBPS);
  const defaultBitrateKbps = clampBitrate(instance?.defaultAudioBitrateKbps ?? DEFAULT_BITRATE_KBPS, maxBitrateKbps);
  return {
    defaultBitrateKbps,
    maxBitrateKbps,
    allowMusicMode: instance?.allowMusicMode ?? true,
    allowStereoAudio: instance?.allowStereoAudio ?? true,
  };
}

/**
 * Applies a single child level's optional overrides on top of a resolved parent
 * policy:
 * - Caps (`maxAudioBitrateKbps`) and capability flags (`allowMusicMode`,
 *   `allowStereoAudio`) are strictly restrictive — a child may tighten them,
 *   never exceed or re-enable what a parent disabled.
 * - Defaults (`audioBitrateKbps`) override the parent's default when set,
 *   clamped to the effective cap at this level.
 */
export function applyAudioPolicyLevel(
  parent: ResolvedAudioPolicy,
  level?: AudioPolicyLevel | null,
): ResolvedAudioPolicy {
  if (!level) return parent;
  const maxBitrateKbps = level.maxAudioBitrateKbps != null
    ? clampBitrate(level.maxAudioBitrateKbps, parent.maxBitrateKbps)
    : parent.maxBitrateKbps;
  const defaultBitrateKbps = level.audioBitrateKbps != null
    ? clampBitrate(level.audioBitrateKbps, maxBitrateKbps)
    : clampBitrate(parent.defaultBitrateKbps, maxBitrateKbps);
  return {
    defaultBitrateKbps,
    maxBitrateKbps,
    allowMusicMode: parent.allowMusicMode && (level.allowMusicMode ?? true),
    allowStereoAudio: parent.allowStereoAudio && (level.allowStereoAudio ?? true),
  };
}

/**
 * Resolves the effective Opus audio policy across the full hierarchy in exact
 * precedence order:
 *   Instance → Space → Category (Subcategory) → Channel
 *
 * - Default bitrate priority (most specific wins, clamped to effective cap):
 *   Channel > Category > Space > Instance
 * - Max bitrate cap & Music/Stereo permissions (strict intersection):
 *   Instance ∩ Space ∩ Category ∩ Channel
 */
export function resolveAudioPolicyHierarchy(input: {
  instance?: InstanceAudioPolicyInput | null;
  space?: AudioPolicyLevel | null;
  category?: AudioPolicyLevel | null;
  channel?: AudioPolicyLevel | null;
}): ResolvedAudioPolicy {
  const afterInstance = resolveInstanceAudioPolicy(input.instance);
  const afterSpace = applyAudioPolicyLevel(afterInstance, input.space);
  const afterCategory = applyAudioPolicyLevel(afterSpace, input.category);
  return applyAudioPolicyLevel(afterCategory, input.channel);
}
