import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SoundboardScopeType, SoundboardSound } from '@backspace/shared';
import { getApiForOrigin } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import {
  computeWaveformPeaks,
  findPeakAmplitude,
  trimAndNormalizeToWav,
} from '../../utils/audioClipEditor';

const QUICK_EMOJIS = ['🔊', '🦆', '🥁', '🎺', '👏', '😂', '💥', '🎉', '💀', '🚨', '🎻', '🔔'];
const MAX_CLIP_SECONDS = 10;
const TARGET_NORMALIZE_PEAK = 0.891; // -1 dBFS

interface SoundboardEditorModalProps {
  isOpen: boolean;
  scopeType: SoundboardScopeType;
  scopeId: string | null;
  origin: string;
  initialSound?: SoundboardSound | null;
  onClose: () => void;
  onSaved: (sound: SoundboardSound) => void;
}

export function SoundboardEditorModal({
  isOpen,
  scopeType,
  scopeId,
  origin,
  initialSound,
  onClose,
  onSaved,
}: SoundboardEditorModalProps) {
  const { t } = useTranslation('voice');
  const addToast = useUIStore((s) => s.addToast);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔊');
  const [normalize, setNormalize] = useState(true);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [audioDirty, setAudioDirty] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopPreview = () => {
    try {
      previewSourceRef.current?.stop();
    } catch {
      // ignore already-stopped source
    }
    previewSourceRef.current = null;
    setIsPlayingPreview(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      return;
    }

    setError(null);
    setSaving(false);
    setAudioDirty(false);

    if (initialSound) {
      setName(initialSound.name);
      setEmoji(initialSound.emoji || '🔊');
      setNormalize(false);
      setAudioBuffer(null);
      setStartSec(0);
      setEndSec(0);

      let cancelled = false;
      setLoadingAudio(true);
      const url = initialSound.fileUrl.startsWith('/') && origin
        ? `${origin}${initialSound.fileUrl}`
        : initialSound.fileUrl;

      void (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const ab = await resp.arrayBuffer();
          const ctx = new AudioContext();
          const decoded = await ctx.decodeAudioData(ab);
          await ctx.close().catch(() => {});
          if (cancelled) return;
          setAudioBuffer(decoded);
          setStartSec(0);
          setEndSec(Math.min(decoded.duration, MAX_CLIP_SECONDS));
        } catch {
          if (!cancelled) {
            setError(t('soundboard.loadAudioFailed'));
          }
        } finally {
          if (!cancelled) setLoadingAudio(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    } else {
      setName('');
      setEmoji('🔊');
      setNormalize(true);
      setAudioBuffer(null);
      setStartSec(0);
      setEndSec(0);
    }
  }, [isOpen, initialSound, origin, t]);

  useEffect(() => {
    return () => {
      stopPreview();
      if (previewCtxRef.current) {
        void previewCtxRef.current.close().catch(() => {});
        previewCtxRef.current = null;
      }
    };
  }, []);

  const peaks = useMemo(() => {
    if (!audioBuffer) return [];
    return computeWaveformPeaks(audioBuffer, 64);
  }, [audioBuffer]);

  if (!isOpen) return null;

  const duration = audioBuffer?.duration ?? 0;
  const trimDuration = Math.max(0, endSec - startSec);

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    stopPreview();
    setError(null);
    setLoadingAudio(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      await ctx.close().catch(() => {});

      setAudioBuffer(decoded);
      setStartSec(0);
      setEndSec(Math.min(decoded.duration, MAX_CLIP_SECONDS));
      setAudioDirty(true);
      if (!name.trim()) {
        const baseName = file.name.replace(/\.[^/.]+$/, '').slice(0, 32);
        setName(baseName);
      }
    } catch {
      setError(t('soundboard.decodeFailed'));
    } finally {
      setLoadingAudio(false);
    }
  };

  const handleStartChange = (nextStart: number) => {
    const clampedStart = Math.max(0, Math.min(nextStart, Math.max(0, endSec - 0.1)));
    setStartSec(clampedStart);
    if (endSec - clampedStart > MAX_CLIP_SECONDS) {
      setEndSec(Math.min(duration, clampedStart + MAX_CLIP_SECONDS));
    }
    setAudioDirty(true);
  };

  const handleEndChange = (nextEnd: number) => {
    const clampedEnd = Math.min(duration, Math.max(nextEnd, startSec + 0.1));
    if (clampedEnd - startSec > MAX_CLIP_SECONDS) {
      setStartSec(Math.max(0, clampedEnd - MAX_CLIP_SECONDS));
    }
    setEndSec(clampedEnd);
    setAudioDirty(true);
  };

  const handlePreview = async () => {
    if (!audioBuffer) return;
    if (isPlayingPreview) {
      stopPreview();
      return;
    }

    try {
      if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
        previewCtxRef.current = new AudioContext();
      }
      const ctx = previewCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gain = ctx.createGain();
      let previewGain = 0.85;
      if (normalize) {
        const startSample = Math.max(0, Math.floor(startSec * audioBuffer.sampleRate));
        const endSample = Math.min(audioBuffer.length, Math.ceil(endSec * audioBuffer.sampleRate));
        const peak = findPeakAmplitude(audioBuffer, startSample, endSample);
        if (peak > 1e-4) {
          previewGain = Math.min(8, (TARGET_NORMALIZE_PEAK / peak) * 0.85);
        }
      }
      gain.gain.value = previewGain;

      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = () => {
        if (previewSourceRef.current === source) {
          previewSourceRef.current = null;
          setIsPlayingPreview(false);
        }
      };

      previewSourceRef.current = source;
      setIsPlayingPreview(true);
      source.start(0, startSec, Math.max(0.05, endSec - startSec));
    } catch {
      setIsPlayingPreview(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('soundboard.nameRequired'));
      return;
    }
    if (!initialSound && !audioBuffer) {
      setError(t('soundboard.audioRequired'));
      return;
    }

    stopPreview();
    setSaving(true);
    setError(null);

    try {
      const client = getApiForOrigin(origin);
      const safeEmoji = emoji.trim() || '🔊';

      if (initialSound && !audioDirty) {
        const updated = await client.soundboard.update(initialSound.id, {
          name: trimmedName,
          emoji: safeEmoji,
        });
        onSaved(updated);
        onClose();
        return;
      }

      if (!audioBuffer) {
        setError(t('soundboard.audioRequired'));
        setSaving(false);
        return;
      }

      const { blob, durationMs } = trimAndNormalizeToWav(
        audioBuffer,
        startSec,
        endSec,
        normalize,
      );

      const formData = new FormData();
      formData.append('name', trimmedName);
      formData.append('emoji', safeEmoji);
      formData.append('durationMs', String(durationMs));
      if (!initialSound) {
        formData.append('scopeType', scopeType);
        if (scopeId) formData.append('scopeId', scopeId);
      }
      formData.append('file', blob, 'clip.wav');

      const saved = initialSound
        ? await client.soundboard.update(initialSound.id, formData)
        : await client.soundboard.create(formData);

      addToast(
        initialSound ? t('soundboard.savedToast') : t('soundboard.uploadedToast'),
        'success',
      );
      onSaved(saved);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('soundboard.saveFailed');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const startPct = duration > 0 ? (startSec / duration) * 100 : 0;
  const endPct = duration > 0 ? (endSec / duration) * 100 : 100;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass-modal w-full max-w-lg rounded-2xl p-5 text-text-primary shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {initialSound ? t('soundboard.editTitle') : t('soundboard.addTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-700/50 transition-colors cursor-pointer"
            aria-label={t('soundboard.close')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Name & Emoji */}
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('soundboard.emojiLabel')}
            </label>
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 8))}
              className="w-full h-10 rounded-xl bg-surface-900/70 border border-surface-700/60 text-center text-lg focus:outline-none focus:border-accent-sky"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('soundboard.nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              maxLength={32}
              placeholder={t('soundboard.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-surface-900/70 border border-surface-700/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-sky"
            />
          </div>
        </div>

        {/* Quick Emoji Picker */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_EMOJIS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setEmoji(item)}
              className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors cursor-pointer ${
                emoji === item
                  ? 'bg-accent-sky/25 ring-1 ring-accent-sky'
                  : 'bg-surface-800/60 hover:bg-surface-700/70'
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {/* Audio File Picker */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.webm,.m4a"
            className="hidden"
            onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-dashed border-surface-600 hover:border-accent-sky/70 bg-surface-900/40 hover:bg-surface-800/50 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span>
              {audioBuffer ? t('soundboard.replaceAudio') : t('soundboard.chooseAudio')}
            </span>
          </button>
        </div>

        {/* Mini Waveform Trim Editor */}
        {loadingAudio && (
          <div className="py-6 text-center text-xs text-text-muted">
            {t('soundboard.loadingAudio')}
          </div>
        )}

        {audioBuffer && !loadingAudio && (
          <div className="space-y-3 p-3 rounded-xl bg-surface-900/60 border border-surface-700/60">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <svg className="w-3.5 h-3.5 text-accent-sky" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
                </svg>
                {t('soundboard.trimEditor')}
              </span>
              <span className="font-mono text-[11px] text-text-muted">
                {t('soundboard.trimRange', {
                  start: startSec.toFixed(2),
                  end: endSec.toFixed(2),
                  duration: trimDuration.toFixed(2),
                })}
              </span>
            </div>

            {/* Waveform Bars */}
            <div className="relative h-16 flex items-center gap-[2px] px-1 rounded-lg bg-surface-950/70 overflow-hidden">
              {peaks.map((peak, idx) => {
                const pct = ((idx + 0.5) / peaks.length) * 100;
                const inRange = pct >= startPct && pct <= endPct;
                const heightPct = Math.max(8, Math.round(peak * 100));
                return (
                  <div
                    key={idx}
                    className={`flex-1 rounded-full transition-colors ${
                      inRange ? 'bg-accent-sky' : 'bg-surface-600/40'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                );
              })}
            </div>

            {/* Start / End Range Sliders */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-text-muted mb-1">
                  <span>{t('soundboard.trimStart')}</span>
                  <span className="font-mono">{t('soundboard.seconds', { value: startSec.toFixed(2) })}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, duration - 0.1)}
                  step={0.05}
                  value={startSec}
                  onChange={(e) => handleStartChange(Number(e.target.value))}
                  className="w-full accent-accent-sky cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-text-muted mb-1">
                  <span>{t('soundboard.trimEnd')}</span>
                  <span className="font-mono">{t('soundboard.seconds', { value: endSec.toFixed(2) })}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={duration}
                  step={0.05}
                  value={endSec}
                  onChange={(e) => handleEndChange(Number(e.target.value))}
                  className="w-full accent-accent-sky cursor-pointer"
                />
              </div>
            </div>

            {/* Preview + Normalize Row */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handlePreview()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-sky/20 hover:bg-accent-sky/30 text-accent-sky text-xs font-medium transition-colors cursor-pointer"
              >
                {isPlayingPreview ? (
                  <>
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                    <span>{t('soundboard.stopPreview')}</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>{t('soundboard.preview')}</span>
                  </>
                )}
              </button>

              <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => {
                    setNormalize(e.target.checked);
                    setAudioDirty(true);
                  }}
                  className="rounded accent-accent-sky"
                />
                <svg className="w-3.5 h-3.5 text-accent-amber" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" />
                </svg>
                <span>{t('soundboard.normalizeVolume')}</span>
              </label>
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-accent-rose bg-accent-rose/10 border border-accent-rose/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-700/50 transition-colors cursor-pointer"
          >
            {t('soundboard.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || loadingAudio}
            onClick={() => void handleSave()}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-accent-sky text-surface-950 hover:bg-accent-sky/90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {saving ? t('soundboard.saving') : t('soundboard.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
