import { useTranslation } from 'react-i18next';
import {
  useVoiceStore,
  MIN_AUDIO_BITRATE_KBPS,
  MAX_AUDIO_BITRATE_KBPS,
  type AudioMode,
} from '../../../stores/voiceStore';
import { useUIStore } from '../../../stores/uiStore';
import { useFormatters } from '../../../i18n/formatters';
import { Toggle } from '../../ui/Toggle';
import { VideoSection } from './VideoSection';
import { AudioInputSection } from './AudioInputSection';
import { AudioOutputSection } from './AudioOutputSection';

export function VoicePanel() {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const echoCancellation = useVoiceStore((s) => s.echoCancellation);
  const autoGainControl = useVoiceStore((s) => s.autoGainControl);
  const rnnoiseEnabled = useVoiceStore((s) => s.rnnoiseEnabled);
  const setEchoCancellation = useVoiceStore((s) => s.setEchoCancellation);
  const setAutoGainControl = useVoiceStore((s) => s.setAutoGainControl);
  const setRnnoiseEnabled = useVoiceStore((s) => s.setRnnoiseEnabled);
  const soundEffectVolume = useVoiceStore((s) => s.soundEffectVolume);
  const setSoundEffectVolume = useVoiceStore((s) => s.setSoundEffectVolume);
  const messageSoundAllChannels = useVoiceStore((s) => s.messageSoundAllChannels);
  const setMessageSoundAllChannels = useVoiceStore((s) => s.setMessageSoundAllChannels);
  const pipEnabled = useVoiceStore((s) => s.pipEnabled);
  const setPipEnabled = useVoiceStore((s) => s.setPipEnabled);
  const audioMode = useVoiceStore((s) => s.audioMode);
  const setAudioMode = useVoiceStore((s) => s.setAudioMode);
  const audioStereo = useVoiceStore((s) => s.audioStereo);
  const setAudioStereo = useVoiceStore((s) => s.setAudioStereo);
  const audioBitrate = useVoiceStore((s) => s.audioBitrate);
  const setAudioBitrate = useVoiceStore((s) => s.setAudioBitrate);

  const bitratePercent =
    ((audioBitrate - MIN_AUDIO_BITRATE_KBPS) / (MAX_AUDIO_BITRATE_KBPS - MIN_AUDIO_BITRATE_KBPS)) * 100;
  const bitrateNotice =
    audioBitrate < 32
      ? { text: t('settings:voice.opus.bitrate.warningLow'), tone: 'text-accent-amber' }
      : audioBitrate > 192
        ? { text: t('settings:voice.opus.bitrate.warningVeryHigh'), tone: 'text-accent-amber' }
        : audioBitrate > 96
          ? { text: t('settings:voice.opus.bitrate.warningHigh'), tone: 'text-accent-amber/90' }
          : { text: t('settings:voice.opus.bitrate.hintDefault'), tone: 'text-txt-tertiary' };
  // The floating window is mounted only by the desktop layout (AppLayout), and
  // the mobile Voice settings screen renders this same panel, so the setting is
  // offered only where it has an effect.
  const isMobile = useUIStore((s) => s.isMobile);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-txt-primary mb-6">{t('settings:voice.title')}</h2>

      <AudioInputSection />
      <AudioOutputSection />

      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('settings:voice.volume.sectionTitle')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
          <div className="py-1">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-txt-primary">{t('settings:voice.volume.soundEffects.label')}</div>
              <div className="text-xs text-txt-tertiary tabular-nums">{f.formatPercent(soundEffectVolume)}</div>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={soundEffectVolume}
              onChange={(e) => setSoundEffectVolume(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${soundEffectVolume / 2}%, rgb(var(--interactive-muted)) ${soundEffectVolume / 2}%, rgb(var(--interactive-muted)) 100%)`,
              }}
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.volume.messageSound.label')}</div>
              <div className="text-xs text-txt-tertiary">
                {t('settings:voice.volume.messageSound.description')}
              </div>
            </div>
            <Toggle enabled={messageSoundAllChannels} onChange={setMessageSoundAllChannels} />
          </div>
        </div>
      </div>

      {!isMobile && (
        <div>
          <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
            {t('settings:voice.pip.sectionTitle')}
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
            <div className="flex items-center justify-between py-2">
              <div className="flex-1 mr-4">
                <div className="text-sm text-txt-primary">{t('settings:voice.pip.showOnSwitch.label')}</div>
                <div className="text-xs text-txt-tertiary">{t('settings:voice.pip.showOnSwitch.description')}</div>
              </div>
              <Toggle
                enabled={pipEnabled}
                onChange={setPipEnabled}
                ariaLabel={t('settings:voice.pip.showOnSwitch.label')}
              />
            </div>
          </div>
        </div>
      )}

      <VideoSection />

      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('settings:voice.opus.sectionTitle')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5 space-y-3">
          {/* Audio Mode: Voice vs Music */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-txt-primary">{t('settings:voice.opus.mode.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.opus.mode.description')}</div>
            </div>
            <div className="inline-flex rounded-lg bg-surface-base p-0.5 shrink-0">
              {(['voice', 'music'] as const satisfies readonly AudioMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAudioMode(mode)}
                  aria-pressed={audioMode === mode}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    audioMode === mode
                      ? 'bg-accent-primary text-white'
                      : 'text-txt-secondary hover:text-txt-primary'
                  }`}
                >
                  {t(`settings:voice.opus.mode.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Stereo toggle */}
          <div className="flex items-center justify-between py-1">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.opus.stereo.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.opus.stereo.description')}</div>
            </div>
            <Toggle
              enabled={audioStereo}
              onChange={setAudioStereo}
              ariaLabel={t('settings:voice.opus.stereo.label')}
            />
          </div>

          {/* Bitrate slider with contextual warnings underneath */}
          <div className="py-1">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-txt-primary">{t('settings:voice.opus.bitrate.label')}</div>
              <div className="text-xs text-txt-secondary font-medium tabular-nums">
                {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
                {audioBitrate} kbps
              </div>
            </div>
            <input
              type="range"
              min={MIN_AUDIO_BITRATE_KBPS}
              max={MAX_AUDIO_BITRATE_KBPS}
              step={8}
              value={audioBitrate}
              onChange={(e) => setAudioBitrate(Number(e.target.value))}
              aria-label={t('settings:voice.opus.bitrate.label')}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${bitratePercent}%, rgb(var(--interactive-muted)) ${bitratePercent}%, rgb(var(--interactive-muted)) 100%)`,
              }}
            />
            <div className="relative h-4 text-[10px] text-txt-tertiary tabular-nums mt-1">
              {[MIN_AUDIO_BITRATE_KBPS, 128, 256, 384, MAX_AUDIO_BITRATE_KBPS].map((kbps) => {
                const pct = ((kbps - MIN_AUDIO_BITRATE_KBPS) / (MAX_AUDIO_BITRATE_KBPS - MIN_AUDIO_BITRATE_KBPS)) * 100;
                const posClass =
                  kbps === MIN_AUDIO_BITRATE_KBPS
                    ? 'left-0'
                    : kbps === MAX_AUDIO_BITRATE_KBPS
                      ? 'right-0'
                      : '-translate-x-1/2';
                const posStyle =
                  kbps === MIN_AUDIO_BITRATE_KBPS || kbps === MAX_AUDIO_BITRATE_KBPS
                    ? undefined
                    : { left: `${pct}%` };
                return (
                  <span key={kbps} className={`absolute top-0 ${posClass}`} style={posStyle}>
                    {/* i18n-check: allow-literal "kbps" is an SI audio bitrate unit */}
                    {kbps} kbps
                  </span>
                );
              })}
            </div>
            <p className={`text-xs mt-2 ${bitrateNotice.tone}`}>{bitrateNotice.text}</p>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
          {t('settings:voice.processing.sectionTitle')}
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
          {audioMode === 'music' ? (
            <p className="text-xs text-accent-amber mb-2">{t('settings:voice.opus.bypassNoticeMusic')}</p>
          ) : audioStereo ? (
            <p className="text-xs text-txt-tertiary mb-2">{t('settings:voice.opus.bypassNoticeStereo')}</p>
          ) : null}
          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.processing.noiseSuppression.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.processing.noiseSuppression.description')}</div>
            </div>
            <Toggle enabled={rnnoiseEnabled} onChange={setRnnoiseEnabled} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.processing.echoCancellation.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.processing.echoCancellation.description')}</div>
            </div>
            <Toggle enabled={echoCancellation} onChange={setEchoCancellation} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="flex-1 mr-4">
              <div className="text-sm text-txt-primary">{t('settings:voice.processing.autoGain.label')}</div>
              <div className="text-xs text-txt-tertiary">{t('settings:voice.processing.autoGain.description')}</div>
            </div>
            <Toggle enabled={autoGainControl} onChange={setAutoGainControl} />
          </div>
        </div>
      </div>
    </div>
  );
}
