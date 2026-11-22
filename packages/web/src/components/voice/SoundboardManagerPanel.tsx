import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SoundboardScopeType, SoundboardSound, SpaceSoundboardSettings } from '@backspace/shared';
import { getApiForOrigin } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { AudioManager } from '../../audio/AudioManager';
import { Toggle } from '../ui/Toggle';
import { SoundboardEditorModal } from './SoundboardEditorModal';

interface SoundboardManagerPanelProps {
  scopeType: SoundboardScopeType;
  scopeId: string | null;
  origin: string;
  /** Render as a compact subsection inside another panel (e.g. Instance Audio tab) rather than a top-level page heading. */
  embedded?: boolean;
}

interface EditorState {
  sound: SoundboardSound | null;
  defaultFolder: string | null;
}

function extractFolderNames(sounds: SoundboardSound[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of sounds) {
    const f = s.folder?.trim();
    if (f && !seen.has(f)) {
      seen.add(f);
      result.push(f);
    }
  }
  return result;
}

export function SoundboardManagerPanel({
  scopeType,
  scopeId,
  origin,
  embedded = false,
}: SoundboardManagerPanelProps) {
  const { t } = useTranslation('voice');
  const addToast = useUIStore((s) => s.addToast);

  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [instanceSounds, setInstanceSounds] = useState<SoundboardSound[]>([]);
  const [spaceSettings, setSpaceSettings] = useState<SpaceSoundboardSettings | null>(null);
  const [instanceMaxConcurrent, setInstanceMaxConcurrent] = useState(3);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingOverrideId, setSavingOverrideId] = useState<string | null>(null);
  const [editingVolumeId, setEditingVolumeId] = useState<string | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number>(100);
  const [canManage, setCanManage] = useState(false);
  const [maxSoundsPerScope, setMaxSoundsPerScope] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);

  const fetchSounds = useCallback(async () => {
    setLoading(true);
    try {
      const client = getApiForOrigin(origin);
      const data = await client.soundboard.list({
        spaceId: scopeType === 'space' && scopeId ? scopeId : undefined,
        includeHidden: scopeType === 'space' && Boolean(scopeId),
      });
      if (scopeType === 'instance') {
        setSounds(data.instanceSounds);
        setInstanceSounds([]);
        setSpaceSettings(null);
        setCanManage(data.canManageInstance);
        setMaxSoundsPerScope(null);
      } else {
        setSounds(data.scopedSounds);
        setInstanceSounds(data.instanceSounds);
        setSpaceSettings(
          data.spaceSettings ?? {
            soundboardEnabled: true,
            allowInstanceSounds: true,
            maxConcurrentSounds: null,
          },
        );
        setInstanceMaxConcurrent(data.instanceMaxConcurrentSounds ?? data.maxConcurrentSounds ?? 3);
        setCanManage(data.canManageScope);
        setMaxSoundsPerScope(data.maxSoundsPerScope ?? 32);
      }
    } catch {
      addToast(t('soundboard.loadFailed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [origin, scopeType, scopeId, addToast, t]);

  useEffect(() => {
    void fetchSounds();
  }, [fetchSounds]);

  const existingFolders = useMemo(() => extractFolderNames(sounds), [sounds]);

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const handleStartRenameFolder = (folderName: string) => {
    setRenamingFolder(folderName);
    setFolderNameDraft(folderName);
  };

  const handleCancelRenameFolder = () => {
    setRenamingFolder(null);
    setFolderNameDraft('');
  };

  const handleSaveRenameFolder = async () => {
    if (!renamingFolder || savingFolder) return;
    const trimmed = folderNameDraft.trim().slice(0, 32);
    if (!trimmed || trimmed === renamingFolder) {
      handleCancelRenameFolder();
      return;
    }
    setSavingFolder(true);
    try {
      const client = getApiForOrigin(origin);
      const res = await client.soundboard.renameFolder(scopeType, scopeId, renamingFolder, trimmed);
      setSounds(res.sounds);
      setCollapsedFolders((prev) => {
        if (!prev.has(renamingFolder)) return prev;
        const next = new Set(prev);
        next.delete(renamingFolder);
        next.add(trimmed);
        return next;
      });
      addToast(t('soundboard.folderRenamed'), 'success');
      handleCancelRenameFolder();
    } catch {
      addToast(t('soundboard.saveFailed'), 'warning');
    } finally {
      setSavingFolder(false);
    }
  };

  const handleUpdateSpaceSettings = async (patch: Partial<SpaceSoundboardSettings>) => {
    if (scopeType !== 'space' || !scopeId || !spaceSettings || savingSettings) return;
    const prev = spaceSettings;
    const optimistic = { ...spaceSettings, ...patch };
    setSpaceSettings(optimistic);
    setSavingSettings(true);
    try {
      const client = getApiForOrigin(origin);
      const res = await client.soundboard.updateSpaceSettings(scopeId, patch);
      setSpaceSettings(res.spaceSettings);
    } catch {
      setSpaceSettings(prev);
      addToast(t('soundboard.saveFailed'), 'warning');
    } finally {
      setSavingSettings(false);
    }
  };

  const applySoundOverrideLocally = (
    soundId: string,
    patch: { hiddenInSpace: boolean; volumeOverride: number | null },
  ) => {
    setSounds((prev) =>
      prev.map((s) => (s.id === soundId ? { ...s, ...patch } : s)),
    );
    setInstanceSounds((prev) =>
      prev.map((s) => (s.id === soundId ? { ...s, ...patch } : s)),
    );
  };

  const handleToggleHidden = async (sound: SoundboardSound) => {
    if (scopeType !== 'space' || !scopeId || savingOverrideId === sound.id) return;
    const nextHidden = !sound.hiddenInSpace;
    const prevPatch = {
      hiddenInSpace: Boolean(sound.hiddenInSpace),
      volumeOverride: sound.volumeOverride ?? null,
    };
    applySoundOverrideLocally(sound.id, {
      hiddenInSpace: nextHidden,
      volumeOverride: sound.volumeOverride ?? null,
    });
    setSavingOverrideId(sound.id);
    try {
      const client = getApiForOrigin(origin);
      const res = await client.soundboard.updateSpaceOverride(scopeId, sound.id, {
        hidden: nextHidden,
      });
      applySoundOverrideLocally(sound.id, {
        hiddenInSpace: res.override.hidden,
        volumeOverride: res.override.volume,
      });
    } catch {
      applySoundOverrideLocally(sound.id, prevPatch);
      addToast(t('soundboard.saveFailed'), 'warning');
    } finally {
      setSavingOverrideId(null);
    }
  };

  const handleSaveVolumeOverride = async (sound: SoundboardSound, volume: number | null) => {
    if (scopeType !== 'space' || !scopeId || savingOverrideId === sound.id) return;
    const normalized = volume === null || volume >= 100 ? null : Math.max(0, Math.min(100, Math.round(volume)));
    const prevPatch = {
      hiddenInSpace: Boolean(sound.hiddenInSpace),
      volumeOverride: sound.volumeOverride ?? null,
    };
    applySoundOverrideLocally(sound.id, {
      hiddenInSpace: Boolean(sound.hiddenInSpace),
      volumeOverride: normalized,
    });
    setSavingOverrideId(sound.id);
    try {
      const client = getApiForOrigin(origin);
      const res = await client.soundboard.updateSpaceOverride(scopeId, sound.id, {
        volume: normalized,
      });
      applySoundOverrideLocally(sound.id, {
        hiddenInSpace: res.override.hidden,
        volumeOverride: res.override.volume,
      });
    } catch {
      applySoundOverrideLocally(sound.id, prevPatch);
      addToast(t('soundboard.saveFailed'), 'warning');
    } finally {
      setSavingOverrideId(null);
    }
  };

  const handlePreview = (sound: SoundboardSound) => {
    if (playingId === sound.id) return;
    const resolvedUrl = sound.fileUrl.startsWith('/') && origin
      ? `${origin}${sound.fileUrl}`
      : sound.fileUrl;
    const clipScale = Math.max(0, Math.min(1, (sound.volumeOverride ?? 100) / 100));
    setPlayingId(sound.id);
    void AudioManager.getInstance()
      .playSoundUrl(resolvedUrl, { volume: 0.8 * clipScale })
      .then((res) => {
        if (!res) {
          setPlayingId((curr) => (curr === sound.id ? null : curr));
          return;
        }
        res.source.addEventListener('ended', () => {
          setPlayingId((curr) => (curr === sound.id ? null : curr));
        });
      })
      .catch(() => {
        setPlayingId((curr) => (curr === sound.id ? null : curr));
      });
  };

  const handleDelete = async (sound: SoundboardSound) => {
    try {
      const client = getApiForOrigin(origin);
      await client.soundboard.remove(sound.id);
      setSounds((prev) => prev.filter((s) => s.id !== sound.id));
      addToast(t('soundboard.deletedToast'), 'success');
    } catch {
      addToast(t('soundboard.deleteFailed'), 'warning');
    }
  };

  const handleMoveInGroup = async (
    soundId: string,
    groupFolder: string | null,
    direction: -1 | 1,
  ) => {
    const groupIndices: number[] = [];
    sounds.forEach((s, i) => {
      if ((s.folder?.trim() || null) === groupFolder) groupIndices.push(i);
    });
    const posInGroup = groupIndices.findIndex((idx) => sounds[idx]?.id === soundId);
    const targetPosInGroup = posInGroup + direction;
    if (posInGroup < 0 || targetPosInGroup < 0 || targetPosInGroup >= groupIndices.length) return;

    const fromIdx = groupIndices[posInGroup]!;
    const toIdx = groupIndices[targetPosInGroup]!;
    const fromItem = sounds[fromIdx];
    const toItem = sounds[toIdx];
    if (!fromItem || !toItem) return;

    const prevSounds = sounds;
    const next = sounds.map((item, i) => {
      if (i === fromIdx) return toItem;
      if (i === toIdx) return fromItem;
      return item;
    });
    setSounds(next);

    try {
      const client = getApiForOrigin(origin);
      await client.soundboard.reorder(
        scopeType,
        scopeId,
        next.map((s) => s.id),
      );
    } catch {
      setSounds(prevSounds);
      addToast(t('soundboard.reorderFailed'), 'warning');
    }
  };

  const ungrouped = sounds.filter((s) => !s.folder?.trim());
  const folderMap = new Map<string, SoundboardSound[]>();
  for (const s of sounds) {
    const f = s.folder?.trim();
    if (!f) continue;
    folderMap.set(f, [...(folderMap.get(f) ?? []), s]);
  }

  const renderRows = (
    items: SoundboardSound[],
    groupFolder: string | null,
    isInstanceOverrideList = false,
  ) => (
    <div className="space-y-1.5">
      {items.map((sound, idx) => {
        const isPlaying = playingId === sound.id;
        const isHidden = Boolean(sound.hiddenInSpace);
        const hasVolumeOverride = sound.volumeOverride != null && sound.volumeOverride !== 100;
        const isEditingVolume = editingVolumeId === sound.id;
        const isSavingOverride = savingOverrideId === sound.id;
        const showSpaceOverrides = scopeType === 'space' && Boolean(scopeId) && canManage;

        return (
          <div key={sound.id} className="space-y-1.5">
            <div
              onContextMenu={(e) => {
                e.preventDefault();
                handlePreview(sound);
              }}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                isPlaying
                  ? 'bg-accent-primary/15 border-accent-primary/50'
                  : 'bg-surface-channel/70 border-white/[0.06] hover:border-white/10'
              } ${isHidden ? 'opacity-55' : ''}`}
            >
              <button
                type="button"
                onClick={() => handlePreview(sound)}
                className="w-8 h-8 rounded-md bg-surface-elevated hover:bg-interactive-hover flex items-center justify-center text-base shrink-0 transition-colors cursor-pointer"
                title={t('soundboard.preview')}
              >
                {sound.emoji}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-txt-primary truncate">{sound.name}</span>
                  {isHidden && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.07] text-txt-tertiary shrink-0">
                      {t('soundboard.hiddenBadge')}
                    </span>
                  )}
                  {hasVolumeOverride && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums bg-accent-primary/15 text-accent-primary shrink-0">
                      {t('soundboard.volumePercent', { value: sound.volumeOverride })}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-txt-tertiary font-mono tabular-nums">
                  {t('soundboard.seconds', { value: (sound.durationMs / 1000).toFixed(2) })}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1 shrink-0">
                  {showSpaceOverrides && (
                    <>
                      <button
                        type="button"
                        disabled={isSavingOverride}
                        onClick={() => {
                          if (isEditingVolume) {
                            setEditingVolumeId(null);
                          } else {
                            setVolumeDraft(sound.volumeOverride ?? 100);
                            setEditingVolumeId(sound.id);
                          }
                        }}
                        className={`p-1.5 rounded-md transition-colors disabled:opacity-40 cursor-pointer ${
                          isEditingVolume || hasVolumeOverride
                            ? 'text-accent-primary bg-accent-primary/15'
                            : 'text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover'
                        }`}
                        aria-label={t('soundboard.overrideVolume')}
                        title={t('soundboard.overrideVolume')}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={isSavingOverride}
                        onClick={() => void handleToggleHidden(sound)}
                        className={`p-1.5 rounded-md transition-colors disabled:opacity-40 cursor-pointer ${
                          isHidden
                            ? 'text-accent-amber bg-accent-amber/15 hover:bg-accent-amber/25'
                            : 'text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover'
                        }`}
                        aria-label={isHidden ? t('soundboard.showInSpace') : t('soundboard.hideInSpace')}
                        title={isHidden ? t('soundboard.showInSpace') : t('soundboard.hideInSpace')}
                      >
                        {isHidden ? (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </>
                  )}
                  {!isInstanceOverrideList && (
                    <>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => void handleMoveInGroup(sound.id, groupFolder, -1)}
                        className="p-1.5 rounded-md text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover disabled:opacity-30 transition-colors cursor-pointer"
                        aria-label={t('soundboard.moveUp')}
                        title={t('soundboard.moveUp')}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={idx === items.length - 1}
                        onClick={() => void handleMoveInGroup(sound.id, groupFolder, 1)}
                        className="p-1.5 rounded-md text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover disabled:opacity-30 transition-colors cursor-pointer"
                        aria-label={t('soundboard.moveDown')}
                        title={t('soundboard.moveDown')}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditor({ sound, defaultFolder: sound.folder })}
                        className="p-1.5 rounded-md text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
                        aria-label={t('soundboard.edit')}
                        title={t('soundboard.edit')}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(sound)}
                        className="p-1.5 rounded-md text-txt-tertiary hover:text-txt-danger hover:bg-accent-rose/10 transition-colors cursor-pointer"
                        aria-label={t('soundboard.delete')}
                        title={t('soundboard.delete')}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {showSpaceOverrides && isEditingVolume && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <span className="text-[11px] text-txt-secondary shrink-0">
                  {t('soundboard.overrideVolume')}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={volumeDraft}
                  onChange={(e) => setVolumeDraft(Number(e.target.value))}
                  onMouseUp={() => void handleSaveVolumeOverride(sound, volumeDraft)}
                  onTouchEnd={() => void handleSaveVolumeOverride(sound, volumeDraft)}
                  onKeyUp={() => void handleSaveVolumeOverride(sound, volumeDraft)}
                  aria-label={t('soundboard.overrideVolume')}
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-surface-base
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-0"
                  style={{
                    background: `linear-gradient(to right, rgb(var(--accent-primary)) 0%, rgb(var(--accent-primary)) ${volumeDraft}%, rgb(var(--interactive-muted)) ${volumeDraft}%, rgb(var(--interactive-muted)) 100%)`,
                  }}
                />
                <span className="text-[11px] font-mono tabular-nums text-txt-tertiary w-9 text-right">
                  {t('soundboard.volumePercent', { value: volumeDraft })}
                </span>
                {hasVolumeOverride && (
                  <button
                    type="button"
                    disabled={isSavingOverride}
                    onClick={() => {
                      setVolumeDraft(100);
                      void handleSaveVolumeOverride(sound, null);
                    }}
                    className="px-2 py-0.5 rounded text-[11px] text-txt-secondary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
                  >
                    {t('soundboard.resetOverride')}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const descriptionKey = scopeType === 'instance'
    ? 'soundboard.managerInstanceDesc'
    : 'soundboard.managerSpaceDesc';

  const isLimitReached = scopeType !== 'instance'
    && maxSoundsPerScope !== null
    && sounds.length >= maxSoundsPerScope;

  return (
    <div className={embedded ? 'space-y-2' : 'space-y-4'}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {embedded ? (
              <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
                {t('soundboard.title')}
              </div>
            ) : (
              <h2 className="text-lg font-semibold text-txt-primary">{t('soundboard.title')}</h2>
            )}
            {scopeType !== 'instance' && maxSoundsPerScope !== null && (
              <span className="px-2 py-0.5 rounded-full bg-surface-elevated text-[11px] font-mono tabular-nums text-txt-tertiary">
                {t('soundboard.slotUsage', { current: sounds.length, max: maxSoundsPerScope })}
              </span>
            )}
          </div>
          <p className="text-xs text-txt-tertiary mt-0.5">{t(descriptionKey)}</p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={isLimitReached}
            onClick={() => setEditor({ sound: null, defaultFolder: null })}
            title={isLimitReached ? t('soundboard.limitReached') : undefined}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-medium transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            <span>{t('soundboard.addTitle')}</span>
          </button>
        )}
      </div>

      {isLimitReached && (
        <div className="px-3 py-2 rounded-lg bg-accent-amber/10 border border-accent-amber/25 text-xs text-accent-amber">
          {maxSoundsPerScope === 0 ? t('soundboard.disabledByInstance') : t('soundboard.limitReached')}
        </div>
      )}

      {scopeType === 'space' && scopeId && spaceSettings && (
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-3.5 space-y-3">
          <div>
            <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
              {t('soundboard.spaceOverridesTitle')}
            </div>
            <p className="text-xs text-txt-tertiary mt-0.5">
              {t('soundboard.spaceOverridesDesc')}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-txt-primary">
                {t('soundboard.spaceEnabledLabel')}
              </div>
              <div className="text-xs text-txt-tertiary">
                {t('soundboard.spaceEnabledDesc')}
              </div>
            </div>
            <Toggle
              enabled={spaceSettings.soundboardEnabled}
              disabled={!canManage || savingSettings}
              ariaLabel={t('soundboard.spaceEnabledLabel')}
              onChange={(val) => void handleUpdateSpaceSettings({ soundboardEnabled: val })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-txt-primary">
                {t('soundboard.allowInstanceSoundsLabel')}
              </div>
              <div className="text-xs text-txt-tertiary">
                {t('soundboard.allowInstanceSoundsDesc')}
              </div>
            </div>
            <Toggle
              enabled={spaceSettings.allowInstanceSounds}
              disabled={!canManage || savingSettings || !spaceSettings.soundboardEnabled}
              ariaLabel={t('soundboard.allowInstanceSoundsLabel')}
              onChange={(val) => void handleUpdateSpaceSettings({ allowInstanceSounds: val })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-txt-primary">
                {t('soundboard.spaceMaxConcurrentLabel')}
              </div>
              <div className="text-xs text-txt-tertiary">
                {t('soundboard.spaceMaxConcurrentDesc')}
              </div>
            </div>
            <select
              value={spaceSettings.maxConcurrentSounds === null ? '' : String(spaceSettings.maxConcurrentSounds)}
              disabled={!canManage || savingSettings || !spaceSettings.soundboardEnabled}
              aria-label={t('soundboard.spaceMaxConcurrentLabel')}
              onChange={(e) => {
                const raw = e.target.value;
                void handleUpdateSpaceSettings({
                  maxConcurrentSounds: raw === '' ? null : Number(raw),
                });
              }}
              className="input-standard h-8 px-2.5 text-xs shrink-0"
            >
              <option value="">
                {t('soundboard.inheritInstanceLimit', { max: instanceMaxConcurrent })}
              </option>
              {Array.from({ length: Math.max(1, instanceMaxConcurrent) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className={embedded ? 'rounded-lg bg-white/[0.02] p-3.5 space-y-3' : 'space-y-3'}>
        {loading ? (
          <div className="py-6 text-center text-sm text-txt-tertiary">{t('soundboard.loading')}</div>
        ) : sounds.length === 0 ? (
          <div className="py-6 px-4 text-center rounded-lg bg-white/[0.02] border border-white/[0.05] text-xs text-txt-tertiary">
            {t('soundboard.emptyScope')}
          </div>
        ) : (
          <div className="space-y-3">
            {ungrouped.length > 0 && renderRows(ungrouped, null)}

            {Array.from(folderMap.entries()).map(([folderName, folderSounds]) => {
              const isCollapsed = collapsedFolders.has(folderName);
              return (
                <div
                  key={folderName}
                  className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    {renamingFolder === folderName ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleSaveRenameFolder();
                        }}
                        className="flex items-center gap-1.5 flex-1 min-w-0"
                      >
                        <svg className="w-4 h-4 shrink-0 text-accent-primary/80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                        </svg>
                        <input
                          type="text"
                          value={folderNameDraft}
                          onChange={(e) => setFolderNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') handleCancelRenameFolder();
                          }}
                          maxLength={32}
                          autoFocus
                          disabled={savingFolder}
                          aria-label={t('soundboard.renameFolder')}
                          className="input-standard flex-1 min-w-0 px-2 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          disabled={savingFolder || !folderNameDraft.trim()}
                          className="p-1.5 rounded-md text-accent-mint hover:bg-interactive-hover transition-colors disabled:opacity-40 cursor-pointer"
                          aria-label={t('soundboard.save')}
                          title={t('soundboard.save')}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelRenameFolder}
                          disabled={savingFolder}
                          className="p-1.5 rounded-md text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
                          aria-label={t('soundboard.cancel')}
                          title={t('soundboard.cancel')}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleFolder(folderName)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left text-sm font-medium text-txt-primary hover:text-accent-primary transition-colors cursor-pointer"
                        >
                          <svg
                            className={`w-4 h-4 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                          </svg>
                          <svg className="w-4 h-4 shrink-0 text-accent-primary/80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                          </svg>
                          <span className="truncate">{folderName}</span>
                          <span className="text-xs text-txt-tertiary shrink-0">{folderSounds.length}</span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleStartRenameFolder(folderName)}
                              className="p-1.5 rounded-md text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
                              aria-label={t('soundboard.renameFolder')}
                              title={t('soundboard.renameFolder')}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                          )}
                          {canManage && !isLimitReached && (
                            <button
                              type="button"
                              onClick={() => setEditor({ sound: null, defaultFolder: folderName })}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover transition-colors cursor-pointer"
                              aria-label={t('soundboard.addToFolder', { folder: folderName })}
                              title={t('soundboard.addToFolder', { folder: folderName })}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                              </svg>
                              <span>{t('soundboard.addButton')}</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {!isCollapsed && renderRows(folderSounds, folderName)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {scopeType === 'space' && scopeId && !loading && instanceSounds.length > 0 && (
        <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
                {t('soundboard.instanceOverridesTitle')}
              </div>
              <p className="text-xs text-txt-tertiary mt-0.5">
                {t('soundboard.instanceOverridesDesc')}
              </p>
            </div>
            {instanceSounds.some((s) => s.hiddenInSpace) && (
              <span className="px-2 py-0.5 rounded-full bg-surface-elevated text-[11px] font-mono tabular-nums text-txt-tertiary shrink-0">
                {t('soundboard.hiddenCount', {
                  value: instanceSounds.filter((s) => s.hiddenInSpace).length,
                })}
              </span>
            )}
          </div>

          {spaceSettings && !spaceSettings.allowInstanceSounds && (
            <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-txt-tertiary">
              {t('soundboard.instanceSoundsHiddenBySpace')}
            </div>
          )}

          {renderRows(instanceSounds, null, true)}
        </div>
      )}

      <SoundboardEditorModal
        isOpen={editor !== null}
        scopeType={scopeType}
        scopeId={scopeId}
        origin={origin}
        initialSound={editor?.sound ?? null}
        defaultFolder={editor?.defaultFolder ?? null}
        existingFolders={existingFolders}
        onClose={() => setEditor(null)}
        onSaved={() => {
          void fetchSounds();
        }}
      />
    </div>
  );
}
