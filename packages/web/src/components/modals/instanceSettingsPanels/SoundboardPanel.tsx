import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import type { InstanceStreamingLimits } from '@backspace/shared';
import { describeError } from '../../../i18n/errors';
import { Toggle } from '../../ui/Toggle';
import { SoundboardManagerPanel } from '../../voice/SoundboardManagerPanel';

export function SoundboardPanel() {
  const { t } = useTranslation(['admin', 'common', 'voice']);
  const streamingLimits = useSettingsStore((s) => s.streamingLimits);
  const fetchStreamingLimits = useSettingsStore((s) => s.fetchStreamingLimits);
  const updateStreamingLimits = useSettingsStore((s) => s.updateStreamingLimits);
  const addToast = useUIStore((s) => s.addToast);

  const [draft, setDraft] = useState<InstanceStreamingLimits | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStreamingLimits();
  }, [fetchStreamingLimits]);

  useEffect(() => {
    if (streamingLimits) {
      setDraft({ ...streamingLimits });
    }
  }, [streamingLimits]);

  const hasChanges = Boolean(
    draft && streamingLimits && (
      (draft.soundboardEnabled ?? true) !== (streamingLimits.soundboardEnabled ?? true)
      || (draft.maxSoundboardSoundsPerScope ?? 32) !== (streamingLimits.maxSoundboardSoundsPerScope ?? 32)
      || (draft.maxConcurrentSoundboardSounds ?? 3) !== (streamingLimits.maxConcurrentSoundboardSounds ?? 3)
    ),
  );

  const handleReset = () => {
    if (streamingLimits) setDraft({ ...streamingLimits });
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateStreamingLimits({
        soundboardEnabled: draft.soundboardEnabled ?? true,
        maxSoundboardSoundsPerScope: draft.maxSoundboardSoundsPerScope ?? 32,
        maxConcurrentSoundboardSounds: draft.maxConcurrentSoundboardSounds ?? 3,
      });
      addToast(t('admin:soundboard.saved'), 'success');
    } catch (err) {
      setSaveError(err instanceof Error ? describeError(err) : t('admin:soundboard.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-medium text-txt-primary mb-1">{t('voice:soundboard.title')}</h3>
        <p className="text-xs text-txt-tertiary">{t('admin:soundboard.description')}</p>
      </div>

      {draft && (
        <div className="rounded-lg bg-white/[0.02] p-3.5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-txt-primary">{t('admin:soundboard.soundboardEnabled.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('admin:soundboard.soundboardEnabled.description')}</div>
            </div>
            <Toggle
              enabled={draft.soundboardEnabled ?? true}
              onChange={(enabled) => setDraft({ ...draft, soundboardEnabled: enabled })}
            />
          </div>

          {(draft.soundboardEnabled ?? true) && (
            <>
              <div className="border-t border-white/[0.04] pt-4 space-y-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-txt-primary">{t('admin:soundboard.maxSoundboardPerScope.label')}</div>
                    <div className="text-xs text-txt-tertiary">{t('admin:soundboard.maxSoundboardPerScope.description')}</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    value={draft.maxSoundboardSoundsPerScope ?? 32}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0)));
                      setDraft({ ...draft, maxSoundboardSoundsPerScope: val });
                    }}
                    className="input-standard w-20 px-2.5 py-1 text-xs text-center tabular-nums shrink-0"
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={draft.maxSoundboardSoundsPerScope ?? 32}
                  onChange={(e) => setDraft({ ...draft, maxSoundboardSoundsPerScope: Number(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: (() => {
                      const val = draft.maxSoundboardSoundsPerScope ?? 32;
                      const pct = (val / 200) * 100;
                      return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                    })(),
                  }}
                />
              </div>

              <div className="border-t border-white/[0.04] pt-4 space-y-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-txt-primary">{t('admin:soundboard.maxConcurrentSoundboard.label')}</div>
                    <div className="text-xs text-txt-tertiary">{t('admin:soundboard.maxConcurrentSoundboard.description')}</div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={draft.maxConcurrentSoundboardSounds ?? 3}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1)));
                      setDraft({ ...draft, maxConcurrentSoundboardSounds: val });
                    }}
                    className="input-standard w-20 px-2.5 py-1 text-xs text-center tabular-nums shrink-0"
                  />
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={draft.maxConcurrentSoundboardSounds ?? 3}
                  onChange={(e) => setDraft({ ...draft, maxConcurrentSoundboardSounds: Number(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: (() => {
                      const val = draft.maxConcurrentSoundboardSounds ?? 3;
                      const pct = ((val - 1) / 9) * 100;
                      return `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${pct}%, rgb(var(--interactive-muted)) ${pct}%, rgb(var(--interactive-muted)) 100%)`;
                    })(),
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {(draft?.soundboardEnabled ?? true) && (
        <SoundboardManagerPanel scopeType="instance" scopeId={null} origin="" embedded />
      )}

      {saveError && (
        <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{saveError}</div>
      )}
      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="glass-bubble rounded-full px-4 py-2 flex items-center gap-2 animate-slide-up pointer-events-auto">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors"
              >
                {t('common:actions.reset')}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50"
              >
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
