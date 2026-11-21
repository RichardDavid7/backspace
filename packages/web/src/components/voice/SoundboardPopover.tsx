import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SoundboardScopeType, SoundboardSound } from '@backspace/shared';
import { useVoiceStore } from '../../stores/voiceStore';
import { getApiForOrigin, getMyUserIdForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { AudioManager } from '../../audio/AudioManager';
import { getActiveRoom } from '../../hooks/useLiveKit';
import { dmCallChannelId, voiceSessionOrigin } from '../../utils/dmCall';
import { encodeSoundboardPlay } from '../../utils/soundboardProtocol';
import { SoundboardEditorModal } from './SoundboardEditorModal';

interface SoundboardPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

interface EditorState {
  scopeType: SoundboardScopeType;
  scopeId: string | null;
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

export function SoundboardPopover({ isOpen, onClose, className = '' }: SoundboardPopoverProps) {
  const { t } = useTranslation('voice');
  const addToast = useUIStore((s) => s.addToast);

  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const soundboardVolume = useVoiceStore((s) => s.soundboardVolume);
  const soundboardMuted = useVoiceStore((s) => s.soundboardMuted);
  const setSoundboardVolume = useVoiceStore((s) => s.setSoundboardVolume);
  const setSoundboardMuted = useVoiceStore((s) => s.setSoundboardMuted);
  const markUserPlayingSoundboard = useVoiceStore((s) => s.markUserPlayingSoundboard);
  const channelToSpaceMap = useSpaceStore((s) => s.channelToSpaceMap);

  const origin = voiceSessionOrigin(useVoiceStore.getState());
  const dmChannelId = activeDmCall ? dmCallChannelId(activeDmCall) : null;
  const spaceId = !dmChannelId && currentVoiceChannelId
    ? (channelToSpaceMap.get(currentVoiceChannelId) ?? null)
    : null;

  const [instanceSounds, setInstanceSounds] = useState<SoundboardSound[]>([]);
  const [scopeSounds, setScopeSounds] = useState<SoundboardSound[]>([]);
  const [canManageInstance, setCanManageInstance] = useState(false);
  const [canManageScope, setCanManageScope] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());

  const fetchSounds = useCallback(async () => {
    setLoading(true);
    try {
      const client = getApiForOrigin(origin);
      const data = await client.soundboard.list({
        spaceId: spaceId ?? undefined,
        dmChannelId: dmChannelId ?? undefined,
      });
      setInstanceSounds(data.instanceSounds);
      setScopeSounds(data.scopedSounds);
      setCanManageInstance(data.canManageInstance);
      setCanManageScope(data.canManageScope);
    } catch {
      addToast(t('soundboard.loadFailed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [origin, spaceId, dmChannelId, addToast, t]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchSounds();
  }, [isOpen, fetchSounds]);

  const instanceFolders = useMemo(() => extractFolderNames(instanceSounds), [instanceSounds]);
  const scopeFolders = useMemo(() => extractFolderNames(scopeSounds), [scopeSounds]);

  if (!isOpen) return null;

  const activeScopeType: SoundboardScopeType | null = spaceId
    ? 'space'
    : dmChannelId
      ? 'dm'
      : null;
  const activeScopeId = spaceId ?? dmChannelId ?? null;
  const totalSoundCount = instanceSounds.length + scopeSounds.length;
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const toggleFolder = (folderKey: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  };

  const handlePlay = async (sound: SoundboardSound) => {
    const resolvedUrl = sound.fileUrl.startsWith('/') && origin
      ? `${origin}${sound.fileUrl}`
      : sound.fileUrl;

    setPlayingId(sound.id);
    setTimeout(() => {
      setPlayingId((curr) => (curr === sound.id ? null : curr));
    }, Math.max(500, Math.min(sound.durationMs || 1500, 10_000)));

    const myUserId = getMyUserIdForOrigin(origin);
    if (myUserId && !soundboardMuted) {
      markUserPlayingSoundboard(myUserId, sound.emoji, sound.name, sound.durationMs);
    }

    if (!isDeafened && !soundboardMuted) {
      void AudioManager.getInstance().playSoundUrl(resolvedUrl, {
        volume: (soundboardVolume / 100) * 0.8,
      });
    }

    const room = getActiveRoom();
    if (room) {
      const payload = encodeSoundboardPlay({
        soundId: sound.id,
        fileUrl: sound.fileUrl,
        emoji: sound.emoji,
        name: sound.name,
        senderUserId: myUserId ?? room.localParticipant.identity.split(':')[0] ?? '',
        durationMs: sound.durationMs,
      });
      room.localParticipant.publishData(new Uint8Array(payload), { reliable: true }).catch(() => {});
    }
  };

  const handleDelete = async (sound: SoundboardSound) => {
    try {
      const client = getApiForOrigin(origin);
      await client.soundboard.remove(sound.id);
      if (sound.scopeType === 'instance') {
        setInstanceSounds((prev) => prev.filter((s) => s.id !== sound.id));
      } else {
        setScopeSounds((prev) => prev.filter((s) => s.id !== sound.id));
      }
      addToast(t('soundboard.deletedToast'), 'success');
    } catch {
      addToast(t('soundboard.deleteFailed'), 'warning');
    }
  };

  const handleMoveInGroup = async (
    fullList: SoundboardSound[],
    setList: React.Dispatch<React.SetStateAction<SoundboardSound[]>>,
    scopeType: SoundboardScopeType,
    scopeIdVal: string | null,
    soundId: string,
    groupFolder: string | null,
    direction: -1 | 1,
  ) => {
    const groupIndices: number[] = [];
    fullList.forEach((s, i) => {
      if ((s.folder?.trim() || null) === groupFolder) groupIndices.push(i);
    });
    const posInGroup = groupIndices.findIndex((idx) => fullList[idx]?.id === soundId);
    const targetPosInGroup = posInGroup + direction;
    if (posInGroup < 0 || targetPosInGroup < 0 || targetPosInGroup >= groupIndices.length) return;

    const fromIdx = groupIndices[posInGroup]!;
    const toIdx = groupIndices[targetPosInGroup]!;
    const fromItem = fullList[fromIdx];
    const toItem = fullList[toIdx];
    if (!fromItem || !toItem) return;
    const next = fullList.map((item, i) => {
      if (i === fromIdx) return toItem;
      if (i === toIdx) return fromItem;
      return item;
    });
    setList(next);

    try {
      const client = getApiForOrigin(origin);
      await client.soundboard.reorder(
        scopeType,
        scopeIdVal,
        next.map((s) => s.id),
      );
    } catch {
      setList(fullList);
      addToast(t('soundboard.reorderFailed'), 'warning');
    }
  };

  const renderSoundGrid = (
    items: SoundboardSound[],
    fullList: SoundboardSound[],
    setList: React.Dispatch<React.SetStateAction<SoundboardSound[]>>,
    scopeType: SoundboardScopeType,
    scopeIdVal: string | null,
    groupFolder: string | null,
    canManage: boolean,
  ) => (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((sound, idx) => {
        const isPlaying = playingId === sound.id;
        return (
          <div
            key={sound.id}
            className={`group relative rounded-xl border transition-all ${
              isPlaying
                ? 'bg-accent-sky/20 border-accent-sky/70 shadow-sm shadow-accent-sky/20'
                : 'bg-surface-900/55 border-surface-700/50 hover:bg-surface-800/75 hover:border-surface-600/80'
            }`}
          >
            <button
              type="button"
              onClick={() => void handlePlay(sound)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer"
              title={sound.name}
            >
              <span className="text-base shrink-0 leading-none">{sound.emoji}</span>
              <span className="text-xs font-medium text-text-primary truncate flex-1">
                {sound.name}
              </span>
            </button>

            {manageMode && canManage && (
              <div className="flex items-center justify-end gap-0.5 px-1.5 pb-1.5 pt-0.5 border-t border-surface-700/40">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => void handleMoveInGroup(fullList, setList, scopeType, scopeIdVal, sound.id, groupFolder, -1)}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-700/60 disabled:opacity-30 cursor-pointer"
                  aria-label={t('soundboard.moveUp')}
                  title={t('soundboard.moveUp')}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={idx === items.length - 1}
                  onClick={() => void handleMoveInGroup(fullList, setList, scopeType, scopeIdVal, sound.id, groupFolder, 1)}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-700/60 disabled:opacity-30 cursor-pointer"
                  aria-label={t('soundboard.moveDown')}
                  title={t('soundboard.moveDown')}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M19 12l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setEditor({ scopeType, scopeId: scopeIdVal, sound, defaultFolder: sound.folder })}
                  className="p-1 rounded text-text-muted hover:text-accent-sky hover:bg-surface-700/60 cursor-pointer"
                  aria-label={t('soundboard.edit')}
                  title={t('soundboard.edit')}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(sound)}
                  className="p-1 rounded text-text-muted hover:text-accent-rose hover:bg-surface-700/60 cursor-pointer"
                  aria-label={t('soundboard.delete')}
                  title={t('soundboard.delete')}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderSection = (
    title: string,
    sounds: SoundboardSound[],
    setSounds: React.Dispatch<React.SetStateAction<SoundboardSound[]>>,
    scopeType: SoundboardScopeType,
    scopeIdVal: string | null,
    canManage: boolean,
  ) => {
    const filtered = normalizedQuery
      ? sounds.filter((s) =>
          s.name.toLowerCase().includes(normalizedQuery)
          || (s.folder?.toLowerCase().includes(normalizedQuery) ?? false),
        )
      : sounds;

    const ungrouped = filtered.filter((s) => !s.folder?.trim());
    const folderMap = new Map<string, SoundboardSound[]>();
    for (const s of filtered) {
      const f = s.folder?.trim();
      if (!f) continue;
      folderMap.set(f, [...(folderMap.get(f) ?? []), s]);
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {title}
          </span>
          {canManage && (
            <button
              type="button"
              onClick={() => setEditor({ scopeType, scopeId: scopeIdVal, sound: null, defaultFolder: null })}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-sky/15 hover:bg-accent-sky/25 text-accent-sky text-[11px] font-medium transition-colors cursor-pointer"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              <span>{t('soundboard.addButton')}</span>
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="text-xs text-text-muted py-3 px-2 text-center rounded-xl bg-surface-900/40 border border-surface-700/40">
            {t('soundboard.emptyScope')}
          </div>
        ) : (
          <div className="space-y-2">
            {ungrouped.length > 0 && renderSoundGrid(
              ungrouped,
              sounds,
              setSounds,
              scopeType,
              scopeIdVal,
              null,
              canManage,
            )}

            {Array.from(folderMap.entries()).map(([folderName, folderSounds]) => {
              const folderKey = `${scopeType}:${scopeIdVal ?? 'instance'}:${folderName}`;
              const isCollapsed = !normalizedQuery && collapsedFolders.has(folderKey);
              return (
                <div
                  key={folderKey}
                  className="rounded-xl bg-surface-900/35 border border-surface-700/45 p-2 space-y-2"
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => toggleFolder(folderKey)}
                      className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      <svg
                        className={`w-3.5 h-3.5 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                      </svg>
                      <svg className="w-3.5 h-3.5 shrink-0 text-accent-sky/80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                      <span className="truncate">{folderName}</span>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {folderSounds.length}
                      </span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setEditor({ scopeType, scopeId: scopeIdVal, sound: null, defaultFolder: folderName })}
                        className="p-1 rounded text-text-muted hover:text-accent-sky hover:bg-surface-700/50 transition-colors cursor-pointer"
                        aria-label={t('soundboard.addToFolder', { folder: folderName })}
                        title={t('soundboard.addToFolder', { folder: folderName })}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {!isCollapsed && renderSoundGrid(
                    folderSounds,
                    sounds,
                    setSounds,
                    scopeType,
                    scopeIdVal,
                    folderName,
                    canManage,
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const canManageAny = canManageInstance || canManageScope;
  const editorExistingFolders = editor?.scopeType === 'instance' ? instanceFolders : scopeFolders;

  return (
    <>
      <div
        className={`glass w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-3.5 text-text-primary shadow-2xl border border-surface-700/60 space-y-3 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-accent-sky" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            <span className="text-sm font-semibold">{t('soundboard.title')}</span>
          </div>
          <div className="flex items-center gap-1">
            {canManageAny && (
              <button
                type="button"
                onClick={() => setManageMode((v) => !v)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  manageMode
                    ? 'bg-accent-sky/20 text-accent-sky'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-700/50'
                }`}
                aria-label={t('soundboard.manage')}
                title={t('soundboard.manage')}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-700/50 transition-colors cursor-pointer"
              aria-label={t('soundboard.close')}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Volume & Global Mute Bar */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-surface-900/55 border border-surface-700/40">
          <button
            type="button"
            onClick={() => setSoundboardMuted(!soundboardMuted)}
            className={`p-1 rounded-lg transition-colors cursor-pointer ${
              soundboardMuted
                ? 'text-accent-rose bg-accent-rose/15'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-700/50'
            }`}
            aria-label={soundboardMuted ? t('soundboard.unmuteAll') : t('soundboard.muteAll')}
            title={soundboardMuted ? t('soundboard.unmuteAll') : t('soundboard.muteAll')}
          >
            {soundboardMuted ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={soundboardMuted ? 0 : soundboardVolume}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (soundboardMuted && val > 0) setSoundboardMuted(false);
              setSoundboardVolume(val);
            }}
            aria-label={t('soundboard.volumeLabel')}
            className="flex-1 accent-accent-sky cursor-pointer"
          />
          <span className="text-[11px] font-mono text-text-muted w-9 text-right">
            {t('soundboard.volumePercent', { value: soundboardMuted ? 0 : soundboardVolume })}
          </span>
        </div>

        {/* Quick Search (shown when 5+ sounds exist) */}
        {totalSoundCount >= 5 && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('soundboard.searchPlaceholder')}
            className="w-full h-8 px-2.5 rounded-lg bg-surface-900/60 border border-surface-700/50 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-sky"
          />
        )}

        {/* Sound Sections */}
        <div className="max-h-80 overflow-y-auto pr-0.5 space-y-4">
          {loading && instanceSounds.length === 0 && scopeSounds.length === 0 ? (
            <div className="py-6 text-center text-xs text-text-muted">
              {t('soundboard.loading')}
            </div>
          ) : (
            <>
              {activeScopeType && activeScopeId && renderSection(
                activeScopeType === 'space' ? t('soundboard.spaceSection') : t('soundboard.dmSection'),
                scopeSounds,
                setScopeSounds,
                activeScopeType,
                activeScopeId,
                canManageScope,
              )}

              {renderSection(
                t('soundboard.instanceSection'),
                instanceSounds,
                setInstanceSounds,
                'instance',
                null,
                canManageInstance,
              )}
            </>
          )}
        </div>
      </div>

      <SoundboardEditorModal
        isOpen={editor !== null}
        scopeType={editor?.scopeType ?? 'instance'}
        scopeId={editor?.scopeId ?? null}
        origin={origin}
        initialSound={editor?.sound ?? null}
        defaultFolder={editor?.defaultFolder ?? null}
        existingFolders={editorExistingFolders}
        onClose={() => setEditor(null)}
        onSaved={() => {
          void fetchSounds();
        }}
      />
    </>
  );
}
