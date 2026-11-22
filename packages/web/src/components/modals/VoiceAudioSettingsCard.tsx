import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from '../ui/Toggle';
import type { ResolvedAudioPolicy } from '../../utils/audioPolicy';

const SLIDER_COMMIT_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export interface VoiceAudioSettingsPatch {
  audioBitrateKbps?: number | null;
  maxAudioBitrateKbps?: number | null;
  allowMusicMode?: boolean | null;
  allowStereoAudio?: boolean | null;
}

interface VoiceAudioSettingsCardProps {
  /** Which scope is being edited — selects contextual inheritance copy. */
  scope: 'space' | 'category' | 'channel';
  audioBitrateKbps: number | null;
  maxAudioBitrateKbps: number | null;
  allowMusicMode: boolean | null;
  allowStereoAudio: boolean | null;
  /** Effective Opus policy resolved from all ancestor scopes above this one. */
  parentPolicy: ResolvedAudioPolicy;
  onSave: (patch: VoiceAudioSettingsPatch) => Promise<void>;
}

export function VoiceAudioSettingsCard({
  scope,
  audioBitrateKbps,
  maxAudioBitrateKbps,
  allowMusicMode,
  allowStereoAudio,
  parentPolicy,
  onSave,
}: VoiceAudioSettingsCardProps) {
  const { t } = useTranslation(['spaces']);

  const [bitrateDraft, setBitrateDraft] = useState<number>(
    audioBitrateKbps ?? parentPolicy.defaultBitrateKbps,
  );
  const [maxBitrateDraft, setMaxBitrateDraft] = useState<number>(
    maxAudioBitrateKbps ?? parentPolicy.maxBitrateKbps,
  );
  const lastCommittedBitrateRef = useRef<number | null>(audioBitrateKbps);
  const lastCommittedMaxBitrateRef = useRef<number | null>(maxAudioBitrateKbps);

  useEffect(() => {
    setBitrateDraft(audioBitrateKbps ?? parentPolicy.defaultBitrateKbps);
    lastCommittedBitrateRef.current = audioBitrateKbps;
  }, [audioBitrateKbps, parentPolicy.defaultBitrateKbps]);

  useEffect(() => {
    setMaxBitrateDraft(maxAudioBitrateKbps ?? parentPolicy.maxBitrateKbps);
    lastCommittedMaxBitrateRef.current = maxAudioBitrateKbps;
  }, [maxAudioBitrateKbps, parentPolicy.maxBitrateKbps]);

  const commitBitrate = (value: number) => {
    if (value === lastCommittedBitrateRef.current) return;
    lastCommittedBitrateRef.current = value;
    void onSave({ audioBitrateKbps: value });
  };

  const commitMaxBitrate = (value: number) => {
    if (value === lastCommittedMaxBitrateRef.current) return;
    lastCommittedMaxBitrateRef.current = value;
    void onSave({ maxAudioBitrateKbps: value });
  };

  const isAutoMaxBitrate = maxAudioBitrateKbps === null;
  const clampedMaxDraft = Math.min(parentPolicy.maxBitrateKbps, Math.max(8, maxBitrateDraft));
  const effectiveMaxCap = isAutoMaxBitrate ? parentPolicy.maxBitrateKbps : clampedMaxDraft;
  const maxSliderSpan = Math.max(1, parentPolicy.maxBitrateKbps - 8);
  const maxSliderPct = ((clampedMaxDraft - 8) / maxSliderSpan) * 100;

  const isAutoBitrate = audioBitrateKbps === null;
  const clampedDraft = Math.min(effectiveMaxCap, Math.max(8, bitrateDraft));
  const sliderSpan = Math.max(1, effectiveMaxCap - 8);
  const sliderPct = ((clampedDraft - 8) / sliderSpan) * 100;

  const effectiveAllowMusic = parentPolicy.allowMusicMode && (allowMusicMode ?? true);
  const effectiveAllowStereo = parentPolicy.allowStereoAudio && (allowStereoAudio ?? true);

  const autoBitrateDesc = scope === 'space'
    ? t('spaces:channel.settings.voiceAudio.autoBitrate.description', { kbps: parentPolicy.defaultBitrateKbps })
    : t('spaces:channel.settings.voiceAudio.autoBitrate.descriptionInherited', { kbps: parentPolicy.defaultBitrateKbps });

  const autoMaxBitrateDesc = scope === 'space'
    ? t('spaces:channel.settings.voiceAudio.autoMaxBitrate.description', { kbps: parentPolicy.maxBitrateKbps })
    : t('spaces:channel.settings.voiceAudio.autoMaxBitrate.descriptionInherited', { kbps: parentPolicy.maxBitrateKbps });

  const musicDisabledDesc = scope === 'space'
    ? t('spaces:channel.settings.voiceAudio.allowMusicMode.disabledByInstance')
    : t('spaces:channel.settings.voiceAudio.allowMusicMode.disabledByParent');

  const stereoDisabledDesc = scope === 'space'
    ? t('spaces:channel.settings.voiceAudio.allowStereoAudio.disabledByInstance')
    : t('spaces:channel.settings.voiceAudio.allowStereoAudio.disabledByParent');

  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
      <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
        {t('spaces:channel.settings.voiceAudio.sectionTitle')}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-txt-primary">{t('spaces:channel.settings.voiceAudio.autoBitrate.label')}</div>
          <div className="text-xs text-txt-tertiary">{autoBitrateDesc}</div>
        </div>
        <Toggle
          enabled={isAutoBitrate}
          onChange={(auto) => {
            const next = auto ? null : clampedDraft;
            lastCommittedBitrateRef.current = next;
            void onSave({ audioBitrateKbps: next });
          }}
          ariaLabel={t('spaces:channel.settings.voiceAudio.autoBitrate.label')}
        />
      </div>

      {!isAutoBitrate && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-txt-secondary">{t('spaces:channel.settings.voiceAudio.bitrateLabel')}</span>
            <span className="text-xs text-txt-primary font-medium tabular-nums">
              {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
              {clampedDraft} kbps
            </span>
          </div>
          <input
            type="range"
            min={8}
            max={effectiveMaxCap}
            step={8}
            value={clampedDraft}
            onChange={(e) => setBitrateDraft(Number(e.target.value))}
            onPointerUp={() => commitBitrate(clampedDraft)}
            onBlur={() => commitBitrate(clampedDraft)}
            onKeyUp={(e) => {
              if (SLIDER_COMMIT_KEYS.has(e.key)) commitBitrate(clampedDraft);
            }}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
            style={{
              background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${sliderPct}%, rgb(var(--interactive-muted)) ${sliderPct}%, rgb(var(--interactive-muted)) 100%)`,
            }}
          />
        </div>
      )}

      {/* Maximum Audio Bitrate cap */}
      <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/[0.04]">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-txt-primary">{t('spaces:channel.settings.voiceAudio.autoMaxBitrate.label')}</div>
          <div className="text-xs text-txt-tertiary">{autoMaxBitrateDesc}</div>
        </div>
        <Toggle
          enabled={isAutoMaxBitrate}
          onChange={(auto) => {
            const next = auto ? null : clampedMaxDraft;
            lastCommittedMaxBitrateRef.current = next;
            void onSave({ maxAudioBitrateKbps: next });
          }}
          ariaLabel={t('spaces:channel.settings.voiceAudio.autoMaxBitrate.label')}
        />
      </div>

      {!isAutoMaxBitrate && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-txt-secondary">{t('spaces:channel.settings.voiceAudio.maxBitrateLabel')}</span>
            <span className="text-xs text-txt-primary font-medium tabular-nums">
              {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
              {clampedMaxDraft} kbps
            </span>
          </div>
          <input
            type="range"
            min={8}
            max={parentPolicy.maxBitrateKbps}
            step={8}
            value={clampedMaxDraft}
            onChange={(e) => setMaxBitrateDraft(Number(e.target.value))}
            onPointerUp={() => commitMaxBitrate(clampedMaxDraft)}
            onBlur={() => commitMaxBitrate(clampedMaxDraft)}
            onKeyUp={(e) => {
              if (SLIDER_COMMIT_KEYS.has(e.key)) commitMaxBitrate(clampedMaxDraft);
            }}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
            style={{
              background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${maxSliderPct}%, rgb(var(--interactive-muted)) ${maxSliderPct}%, rgb(var(--interactive-muted)) 100%)`,
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/[0.04]">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-txt-primary">{t('spaces:channel.settings.voiceAudio.allowMusicMode.label')}</div>
          <div className="text-xs text-txt-tertiary">
            {parentPolicy.allowMusicMode
              ? t('spaces:channel.settings.voiceAudio.allowMusicMode.description')
              : musicDisabledDesc}
          </div>
        </div>
        <Toggle
          enabled={effectiveAllowMusic}
          disabled={!parentPolicy.allowMusicMode}
          onChange={(enabled) => {
            if (!parentPolicy.allowMusicMode) return;
            void onSave({ allowMusicMode: enabled });
          }}
          ariaLabel={t('spaces:channel.settings.voiceAudio.allowMusicMode.label')}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-txt-primary">{t('spaces:channel.settings.voiceAudio.allowStereoAudio.label')}</div>
          <div className="text-xs text-txt-tertiary">
            {parentPolicy.allowStereoAudio
              ? t('spaces:channel.settings.voiceAudio.allowStereoAudio.description')
              : stereoDisabledDesc}
          </div>
        </div>
        <Toggle
          enabled={effectiveAllowStereo}
          disabled={!parentPolicy.allowStereoAudio}
          onChange={(enabled) => {
            if (!parentPolicy.allowStereoAudio) return;
            void onSave({ allowStereoAudio: enabled });
          }}
          ariaLabel={t('spaces:channel.settings.voiceAudio.allowStereoAudio.label')}
        />
      </div>
    </div>
  );
}
