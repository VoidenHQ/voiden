/**
 * Hover tooltip that shows the resolved value of environment and process
 * variables ({{VAR}} / {{process.key}}).
 *
 * Replaces the old tippy-based tooltips in environmentHighlighter and
 * variableHighlighter with a single, consistent DOM-based hover card.
 * Values are read directly from the decoration data attributes — no async
 * lookups needed for env vars.
 */

const SELECTOR = '[data-variable-type="env"], [data-variable-type="process"]';

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

const COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function injectStyles() {
  const styleId = 'voiden-variable-value-hover-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .vvcard {
      position: fixed;
      z-index: 10020;
      width: 220px;
      max-width: min(280px, calc(100vw - 16px));
      border: 1px solid var(--ui-line);
      border-radius: 6px;
      background: var(--ui-panel-bg);
      color: var(--editor-fg);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      font-family: inherit;
      font-size: 13px;
      overflow: hidden;
    }
    .vvcard__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--ui-line);
      background: var(--ui-bg);
    }
    .vvcard__key {
      font-family: "Geist Mono", monospace;
      font-size: 12px;
      font-weight: 500;
      color: var(--editor-fg);
      background: var(--ui-selection-normal);
      border-radius: 4px;
      padding: 1px 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 160px;
    }
    .vvcard__copy {
      all: unset;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3px 5px;
      border-radius: 4px;
      color: var(--icon-secondary);
      transition: background 0.1s, color 0.1s;
      flex-shrink: 0;
    }
    .vvcard__copy:hover {
      background: var(--ui-hover);
      color: var(--editor-fg);
    }
    .vvcard__copy--copied {
      color: #4ade80 !important;
    }
    .vvcard__copy--disabled {
      opacity: 0.35;
      cursor: default;
      pointer-events: none;
    }
    .vvcard__body {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .vvcard__label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-weight: 500;
      color: var(--syntax-comment);
    }
    .vvcard__value {
      font-family: "Geist Mono", monospace;
      font-size: 12px;
      color: var(--editor-fg);
      word-break: break-all;
      white-space: pre-wrap;
      max-height: 120px;
      overflow-y: auto;
    }
    .vvcard__value--undefined {
      color: var(--syntax-comment);
      font-style: italic;
    }
  `;
  document.head.appendChild(style);
}

function buildCard(): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'vvcard';
  card.style.display = 'none';

  // Header
  const header = document.createElement('div');
  header.className = 'vvcard__header';

  const keyEl = document.createElement('span');
  keyEl.className = 'vvcard__key';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'vvcard__copy';
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.title = 'Copy value';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const valueEl = card.querySelector('.vvcard__value') as HTMLElement | null;
    if (!valueEl || valueEl.classList.contains('vvcard__value--undefined')) return;
    navigator.clipboard.writeText(valueEl.textContent ?? '').then(() => {
      copyBtn.innerHTML = CHECK_ICON;
      copyBtn.classList.add('vvcard__copy--copied');
      setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.classList.remove('vvcard__copy--copied');
      }, 1500);
    });
  });

  header.appendChild(keyEl);
  header.appendChild(copyBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'vvcard__body';


  const valueEl = document.createElement('span');
  valueEl.className = 'vvcard__value';
  valueEl.textContent = '—';

  body.appendChild(valueEl);

  card.appendChild(header);
  card.appendChild(body);

  card.addEventListener('mouseenter', () => clearHideTimer());
  card.addEventListener('mouseleave', () => scheduleHide());

  document.body.appendChild(card);
  return card;
}

function ensureCard(): HTMLDivElement {
  if (cardEl) return cardEl;
  cardEl = buildCard();
  return cardEl;
}

function updateCard(card: HTMLDivElement, name: string, value: string | undefined) {
  const keyEl = card.querySelector('.vvcard__key') as HTMLElement;
  const valueEl = card.querySelector('.vvcard__value') as HTMLElement;
  const copyBtn = card.querySelector('.vvcard__copy') as HTMLButtonElement;

  keyEl.textContent = name;

  if (value !== undefined) {
    valueEl.textContent = value || '—';
    valueEl.className = 'vvcard__value';
    copyBtn.classList.remove('vvcard__copy--disabled');
  } else {
    valueEl.textContent = 'undefined';
    valueEl.className = 'vvcard__value vvcard__value--undefined';
    copyBtn.classList.add('vvcard__copy--disabled');
  }
}

function positionCard(card: HTMLDivElement, target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const margin = 8;
  card.style.display = 'block';
  const cardHeight = card.offsetHeight;
  const top = rect.top - cardHeight - margin > 8
    ? rect.top - cardHeight - margin
    : rect.bottom + margin;
  const maxLeft = window.innerWidth - card.offsetWidth - 8;
  const left = Math.max(8, Math.min(rect.left, maxLeft));
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function showForTarget(target: HTMLElement) {
  const name = target.dataset.variable;
  const type = target.dataset.variableType;
  if (!name || !type) return;

  // Value is stored directly in the decoration attribute by both highlighters.
  // If it's absent the variable isn't defined — nothing useful to show.
  const value = target.dataset.varValue;
  if (value === undefined) return;

  const card = ensureCard();
  updateCard(card, name, value);
  positionCard(card, target);
}

const onMouseOver = (event: Event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(SELECTOR);
  if (!target) return;
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
