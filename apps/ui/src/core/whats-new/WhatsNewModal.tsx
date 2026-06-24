import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import whatsNewData from './whats-new.json';
import { useWhatsNewStore } from './whatsNewStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type WelcomeItem = {
  emoji: string;
  title: string;
  description: string;
};

// What's actually worth telling a user about in a release. Releases with an
// empty `whatsnew` array have nothing announcement-worthy — they're skipped
// entirely (no spotlight, no popup) but still tracked as "seen".
type WhatsNewEntry = {
  icon: string;
  title: string;
  description: string;
};

type Release = {
  version: string;
  date: string;
  whatsnew: WhatsNewEntry[];
};

type WelcomeData = {
  headline: string;
  subheadline: string;
  items: WelcomeItem[];
};

// Fresh installs get the same changelog dialog as everyone else (current
// version's release notes) — `isFreshInstall` only swaps the header copy
// ("Welcome to Voiden" instead of "What's New").
type Announcement =
  | { kind: 'fresh-install'; releases: Release[] }
  | { kind: 'update'; releases: Release[] }
  | null;

const ALL_RELEASES = whatsNewData.releases as Release[];
const WELCOME = whatsNewData.welcome as WelcomeData;

// ── Version helpers ───────────────────────────────────────────────────────────

function getBaseVersion(version: string): string {
  return version.replace(/-.*$/, '');
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(n => parseInt(n, 10) || 0);
  const bParts = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function saveUiSettings(patch: { last_seen_version?: string; show_whats_new_after_update?: boolean }) {
  (window as any).electron?.userSettings?.set({ ui: patch });
}

// A release with an empty `whatsnew` has nothing worth interrupting the user
// for — skip announcing it (it still gets marked as "seen" once passed over).
function hasAnnouncementContent(release: Release): boolean {
  return release.whatsnew.length > 0;
}

// ── Hook: figures out whether there's something new to announce ──────────────
//
// Surfaces the announcement (if any) exactly once per release — either right
// after a fresh install (welcome tour) or right after an update (changelog for
// every version newer than the one the user last saw).

function useWhatsNewAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  const [baseVersion, setBaseVersion] = useState('');
  const setHasUnseen = useWhatsNewStore(s => s.setHasUnseen);

  useEffect(() => {
    (async () => {
      const [fullVersion, settings] = await Promise.all([
        (window as any).electron?.getVersion?.() as Promise<string> | undefined,
        (window as any).electron?.userSettings?.get(),
      ]);

      if (!fullVersion) return;

      const base = getBaseVersion(fullVersion);
      setBaseVersion(base);

      const lastSeen: string | undefined = settings?.ui?.last_seen_version;
      const showAfterUpdate: boolean = settings?.ui?.show_whats_new_after_update ?? false;

      if (showAfterUpdate) {
        saveUiSettings({ show_whats_new_after_update: false });
        const toShow = ALL_RELEASES.slice(0, 1).filter(hasAnnouncementContent);
        if (toShow.length > 0) {
          setAnnouncement({ kind: 'update', releases: toShow });
          setHasUnseen(true);
        }
        return;
      }

      if (!lastSeen) {
        // Show the current version's release notes — same content the navbar
        // button opens — just under a "Welcome to Voiden" header.
        const current = ALL_RELEASES.slice(0, 1).filter(hasAnnouncementContent);
        setAnnouncement({ kind: 'fresh-install', releases: current });
        setHasUnseen(true);
        return;
      }

      if (lastSeen !== base) {
        const newer = ALL_RELEASES.filter(r => compareVersions(r.version, lastSeen) > 0);
        const worthShowing = newer.filter(hasAnnouncementContent);
        if (worthShowing.length > 0) {
          setAnnouncement({ kind: 'update', releases: worthShowing });
          setHasUnseen(true);
        } else {
          saveUiSettings({ last_seen_version: base });
        }
      }
    })();
  }, [setHasUnseen]);

  const acknowledge = useCallback(() => {
    setAnnouncement(null);
    setHasUnseen(false);
    if (baseVersion) {
      saveUiSettings({ last_seen_version: baseVersion, show_whats_new_after_update: false });
    }
  }, [baseVersion, setHasUnseen]);

  return { announcement, acknowledge, baseVersion };
}

// ── Spotlight: the "intriguing toast" that introduces a release once ─────────
//
// Lives in the bottom-right corner instead of stealing the centre of the
// screen. A slow conic glow sweeps its border to draw the eye without being a
// generic toast — clicking it opens the full changelog dialog.

const SpotlightCard = ({
  announcement,
  onExpand,
  onDismiss,
}: {
  announcement: Announcement;
  onExpand: () => void;
  onDismiss: () => void;
}) => {
  if (!announcement) return null;

  const isFreshInstall = announcement.kind === 'fresh-install';
  const latest = announcement.releases[0];
  const teaserIcon = latest?.whatsnew[0]?.icon;
  const teaserTitle = latest?.whatsnew[0]?.title;
  const teaserDescription = latest?.whatsnew[0]?.description;

  return createPortal(
    <motion.div
      key="whats-new-spotlight"
      initial={{ opacity: 0, y: 28, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 26, mass: 0.9, delay: 0.4 }}
      className="fixed bottom-5 right-5 z-[10000] w-[320px]"
    >
      <div
        className="relative rounded-2xl overflow-hidden cursor-pointer group bg-bg"
        style={{
          border: '1px solid rgba(var(--common-accent), 0.35)',
          boxShadow: '0 12px 36px var(--ui-shadow, rgba(0, 0, 0, 0.3))',
        }}
        onClick={onExpand}
      >
        {/* Slim accent bar — a steady, theme-safe accent cue instead of a gradient wash */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2.5px]"
          style={{ background: 'rgb(var(--common-accent))' }}
        />

        {/* Content */}
        <div className="relative p-4">
          <div className="flex items-start gap-3">
            <motion.div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: 'rgba(var(--common-accent), 0.14)',
                border: '1px solid rgba(var(--common-accent), 0.28)',
              }}
              animate={{
                boxShadow: [
                  '0 0 0px rgba(var(--common-accent), 0)',
                  '0 0 14px rgba(var(--common-accent), 0.45)',
                  '0 0 0px rgba(var(--common-accent), 0)',
                ],
              }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles className="w-4 h-4" style={{ color: 'rgb(var(--common-accent))' }} />
            </motion.div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[12.5px] font-bold leading-tight text-text">
                  {isFreshInstall ? 'Welcome to Voiden' : "What's new"}
                </p>
                {!isFreshInstall && latest && (
                  <span
                    className="inline-flex items-center text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{
                      color: 'rgb(var(--common-accent))',
                      background: 'rgba(var(--common-accent), 0.14)',
                    }}
                  >
                    v{latest.version}
                  </span>
                )}
              </div>
              {teaserTitle && (
                <p className="text-[11px] text-comment mt-1 leading-relaxed line-clamp-2">
                  <span className="mr-1">{teaserIcon}</span>
                  {teaserTitle} — {teaserDescription}
                </p>
              )}
            </div>

            <button
              onClick={e => { e.stopPropagation(); onDismiss(); }}
              className="text-comment hover:text-text transition-colors p-1 rounded-md hover:bg-active flex-shrink-0 -mr-1 -mt-1"
            >
              <X size={12} />
            </button>
          </div>

          <div
            className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold transition-colors"
            style={{ color: 'rgb(var(--common-accent))' }}
          >
            <span>{isFreshInstall ? 'Take the tour' : 'See what changed'}</span>
            <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </motion.div>,
    document.body
  );
};

// ── Full changelog dialog ─────────────────────────────────────────────────────

const WhatsNewDialog = ({
  open,
  isFreshInstall,
  releases,
  onClose,
}: {
  open: boolean;
  isFreshInstall: boolean;
  releases: Release[];
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const latestRelease = releases[0];

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'var(--ui-overlay-bg, rgba(0, 0, 0, 0.4))', backdropFilter: 'blur(3px)' }}
          onClick={onClose}
        >
          <motion.div
            key="modal"
            initial={{ opacity: 0, y: 32, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.9 }}
            className="relative w-full flex flex-col overflow-hidden rounded-2xl border border-border shadow-2xl bg-bg"
            style={{
              maxWidth: 500,
              maxHeight: '88vh',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── Header ────────────────────────────────────────────────── */}
            <div className="relative z-10 flex items-start justify-between gap-3 px-6 pt-6 pb-5 flex-shrink-0">
              <div className="flex items-center gap-3.5">
                {/* Icon badge */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(var(--common-accent), 0.14)',
                    border: '1px solid rgba(var(--common-accent), 0.28)',
                    boxShadow: '0 0 16px rgba(var(--common-accent), 0.12)',
                  }}
                >
                  <Sparkles className="w-4.5 h-4.5" style={{ color: 'rgb(var(--common-accent))' }} />
                </div>

                <div>
                  <h2 className="text-[15px] font-bold leading-tight tracking-tight text-text">
                    {isFreshInstall ? WELCOME.headline : "What's New"}
                  </h2>

                  {isFreshInstall ? (
                    <p className="text-xs text-comment mt-0.5">{WELCOME.subheadline}</p>
                  ) : latestRelease ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className="inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md"
                        style={{
                          color: 'rgb(var(--common-accent))',
                          background: 'rgba(var(--common-accent), 0.14)',
                          border: '1px solid rgba(var(--common-accent), 0.22)',
                        }}
                      >
                        v{latestRelease.version}
                      </span>
                      <span className="text-[11px] text-comment">{latestRelease.date}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                className="text-comment hover:text-text transition-colors p-1.5 rounded-lg hover:bg-active flex-shrink-0 mt-0.5"
              >
                <X size={14} />
              </button>
            </div>

            {/* Divider */}
            <div className="relative z-10 h-px mx-6 flex-shrink-0" style={{ background: 'var(--border)' }} />

            {/* ── Body ──────────────────────────────────────────────────── */}
            <div className="relative z-10 overflow-y-auto flex-1 px-5 py-5">
              <UpdateChangelog releases={releases} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

// ── Orchestrator ──────────────────────────────────────────────────────────────
//
// Owns both surfaces: the once-only spotlight (auto-triggered on fresh install
// or right after an update) and the full changelog dialog, which can also be
// opened on demand from the "What's New" button in the top bar.

export const WhatsNewModal = () => {
  const { announcement, acknowledge } = useWhatsNewAnnouncement();
  const openSignal = useWhatsNewStore(s => s.openSignal);
  const onboardingActive = useWhatsNewStore(s => s.onboardingActive);
  const isInitialOpenSignal = useRef(true);

  const [spotlightVisible, setSpotlightVisible] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; isFreshInstall: boolean; releases: Release[] }>({
    open: false,
    isFreshInstall: false,
    releases: [],
  });

  // Surface the spotlight once an announcement is resolved — but never while
  // the fresh-install OnboardingModal is still on screen; it surfaces right
  // after onboarding closes instead.
  useEffect(() => {
    setSpotlightVisible(!!announcement && !onboardingActive);
  }, [announcement, onboardingActive]);

  // Manual trigger from the top bar — always shows the full release history.
  useEffect(() => {
    if (isInitialOpenSignal.current) {
      isInitialOpenSignal.current = false;
      return;
    }
    setSpotlightVisible(false);
    setDialog({ open: true, isFreshInstall: false, releases: ALL_RELEASES });
  }, [openSignal]);

  const expandFromSpotlight = useCallback(() => {
    if (!announcement) return;
    setSpotlightVisible(false);
    setDialog({
      open: true,
      isFreshInstall: announcement.kind === 'fresh-install',
      releases: announcement.releases,
    });
  }, [announcement]);

  const dismissSpotlight = useCallback(() => {
    setSpotlightVisible(false);
    acknowledge();
  }, [acknowledge]);

  const closeDialog = useCallback(() => {
    setDialog(d => ({ ...d, open: false }));
    acknowledge();
  }, [acknowledge]);

  return (
    <>
      <AnimatePresence>
        {spotlightVisible && (
          <SpotlightCard
            announcement={announcement}
            onExpand={expandFromSpotlight}
            onDismiss={dismissSpotlight}
          />
        )}
      </AnimatePresence>
      <WhatsNewDialog
        open={dialog.open}
        isFreshInstall={dialog.isFreshInstall}
        releases={dialog.releases}
        onClose={closeDialog}
      />
    </>
  );
};

// ── Update changelog: each entry is a card that expands for the full story ───

// Below this length the description already fits on two lines — no need to
// offer an expand control for it.
const DESCRIPTION_PREVIEW_THRESHOLD = 110;

// Roughly two lines at the description's text size/line-height — the
// collapsed state animates from this fixed height up to its natural height,
// rather than snapping a `line-clamp` on/off (which is what caused the jump).
const COLLAPSED_DESCRIPTION_HEIGHT = 32;

const WhatsNewCard = ({
  entry,
  index,
  expanded,
  onToggle,
}: {
  entry: WhatsNewEntry;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const isExpandable = entry.description.length > DESCRIPTION_PREVIEW_THRESHOLD;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 500, damping: 30 }}
      className={`rounded-lg px-3 py-2.5 transition-colors hover:bg-panel ${expanded ? 'bg-panel' : ''} ${isExpandable ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={() => isExpandable && onToggle()}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text leading-snug">{entry.title}</p>
        <motion.div
          initial={false}
          animate={{ height: expanded || !isExpandable ? 'auto' : COLLAPSED_DESCRIPTION_HEIGHT }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden mt-0.5"
        >
          <p className="text-[11px] text-comment leading-relaxed">{entry.description}</p>
        </motion.div>
        {isExpandable && (
          <button
            onClick={e => { e.stopPropagation(); onToggle(); }}
            className="text-[10px] font-semibold mt-1 hover:opacity-80 transition-opacity"
            style={{ color: 'rgb(var(--common-accent))' }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </motion.div>
  );
};

const UpdateChangelog = ({ releases }: { releases: Release[] }) => {
  // Only one card stays open at a time — tracked by a "version:index" key so
  // it works across every release shown in the dialog, not just within one.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // The current release always gets priority — older ones stay collapsed
  // behind a "Show older releases" toggle so they don't bury what's new now.
  const [showOlder, setShowOlder] = useState(false);

  const visibleReleases = showOlder ? releases : releases.slice(0, 1);
  const olderCount = releases.length - 1;

  return (
    <div className="space-y-5">
      {visibleReleases.map((release, ri) => (
        <div key={release.version} className="space-y-1">
          {visibleReleases.length > 1 && ri > 0 && (
            <div className="flex items-center gap-3 pt-1 pb-2">
              <span
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{
                  color: 'rgb(var(--common-accent))',
                  background: 'rgba(var(--common-accent), 0.12)',
                }}
              >
                v{release.version}
              </span>
              <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
              <span className="text-[11px] text-comment">{release.date}</span>
            </div>
          )}
          {release.whatsnew.map((entry, i) => {
            const key = `${release.version}:${i}`;
            return (
              <WhatsNewCard
                key={key}
                entry={entry}
                index={i}
                expanded={expandedKey === key}
                onToggle={() => setExpandedKey(k => (k === key ? null : key))}
              />
            );
          })}
          {ri < visibleReleases.length - 1 && (
            <div className="h-px mt-4" style={{ background: 'var(--border)' }} />
          )}
        </div>
      ))}
      {!showOlder && olderCount > 0 && (
        <button
          onClick={() => setShowOlder(true)}
          className="text-[11px] font-semibold mt-1 hover:opacity-80 transition-opacity"
          style={{ color: 'rgb(var(--common-accent))' }}
        >
          Show older releases ({olderCount})
        </button>
      )}
    </div>
  );
};
