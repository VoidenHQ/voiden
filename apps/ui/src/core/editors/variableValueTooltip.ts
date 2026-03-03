/**
 * Hover tooltip that shows the resolved value of environment and process
 * variables ({{VAR}} / {{process.key}}).
 *
 * Follows the same mount/unmount pattern as fakerHoverTooltip so it can be
 * initialised once at app startup.
 */

const SELECTOR = '.variable-highlight-valid, .variable-highlight-invalid';

let cardEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let listenersBound = false;

function clearHideTimer() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide() {
  clearHideTimer();
  hideTimer = window.setTimeout(() => {
    if (cardEl) cardEl.style.display = 'none';
  }, 120);
}

function injectStyles() {
  const styleId = 'voiden-variable-value-hover-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .voiden-variable-value-card {
      position: fixed;
      z-index: 10020;
      max-width: min(400px, calc(100vw - 16px));
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-secondary);
      color: var(--fg-primary);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      font-family: "Geist Mono", monospace;
      font-size: 12px;
      line-height: 1.4;
      padding: 8px 10px;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
    .voiden-variable-value-card__undefined {
      color: var(--fg-secondary);
      font-style: italic;
    }
  `;
  document.head.appendChild(style);
}

function ensureCard() {
  if (cardEl) return cardEl;

  cardEl = document.createElement('div');
  cardEl.className = 'voiden-variable-value-card';
  cardEl.style.display = 'none';
  cardEl.addEventListener('mouseenter', () => clearHideTimer());
  cardEl.addEventListener('mouseleave', () => scheduleHide());
  document.body.appendChild(cardEl);
  return cardEl;
}

function getVariableInfo(target: HTMLElement): { name: string; type: string } | null {
  const name = target.dataset.variable;
  const type = target.dataset.variableType;
  if (!name || !type) return null;
  return { name, type };
}

async function resolveValue(name: string, type: string): Promise<string | undefined> {
  try {
    if (type === 'process') {
      const key = name.replace('process.', '');
      const value = await window.electron?.variables.get(key);
      return value != null ? String(value) : undefined;
    }
    // env variable — load active environment values and look up the key
    const envData = await window.electron?.env.load();
    if (!envData?.activeEnv || !envData.data[envData.activeEnv]) return undefined;
    const value = envData.data[envData.activeEnv][name];
    return value != null ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

function positionCard(card: HTMLDivElement, target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const margin = 10;
  card.style.display = 'block';
  const top = rect.top - card.offsetHeight - margin > 8
    ? rect.top - card.offsetHeight - margin
    : rect.bottom + margin;
  const maxLeft = window.innerWidth - card.offsetWidth - 8;
  const left = Math.max(8, Math.min(rect.left, maxLeft));
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

async function showForTarget(target: HTMLElement) {
  const info = getVariableInfo(target);
  if (!info) return;

  const card = ensureCard();

  // Show loading state while resolving
  card.innerHTML = `<span class="voiden-variable-value-card__undefined">loading\u2026</span>`;
  positionCard(card, target);

  const value = await resolveValue(info.name, info.type);

  // Only update if the card is still visible (user hasn't moved away)
  if (card.style.display === 'none') return;

  card.innerHTML = value !== undefined
    ? escapeHtml(value)
    : `<span class="voiden-variable-value-card__undefined">undefined</span>`;
  positionCard(card, target);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const onMouseOver = (event: Event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(SELECTOR);
  if (!target) return;
  // Skip faker variables — they have their own tooltip
  if (target.classList.contains('variable-highlight-faker')) return;
  clearHideTimer();
  showForTarget(target);
};

const onMouseOut = (event: Event) => {
  const fromTarget = (event.target as HTMLElement).closest<HTMLElement>(SELECTOR);
  if (!fromTarget) return;
  const toNode = (event as MouseEvent).relatedTarget as Node | null;
  if (toNode && (cardEl?.contains(toNode) || ((toNode as HTMLElement).closest && (toNode as HTMLElement).closest(SELECTOR)))) {
    return;
  }
  scheduleHide();
};

const onScroll = () => {
  if (cardEl) cardEl.style.display = 'none';
};

export function mountVariableValueTooltip() {
  if (listenersBound || typeof document === 'undefined') return;
  listenersBound = true;
  injectStyles();
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('mouseout', onMouseOut);
  window.addEventListener('scroll', onScroll, true);
}

export function unmountVariableValueTooltip() {
  if (!listenersBound || typeof document === 'undefined') return;
  listenersBound = false;
  document.removeEventListener('mouseover', onMouseOver);
  document.removeEventListener('mouseout', onMouseOut);
  window.removeEventListener('scroll', onScroll, true);
  clearHideTimer();
  if (cardEl) {
    cardEl.remove();
    cardEl = null;
  }
}
