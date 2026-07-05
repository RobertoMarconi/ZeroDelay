// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)

import * as common from './common.js';
import * as pix from './pix.js';

const L = common.label;

// --------------------------------------------------------------- DOM helpers
const $ = sel => document.querySelector(sel);

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'html') { if (v) node.append(parseSvg(v)); }
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
}

// Parse trusted static SVG markup (our own ICONS / generated QR) into a DOM node,
// avoiding innerHTML (and the addons-linter UNSAFE_VAR_ASSIGNMENT warning). Parse
// as text/html (not image/svg+xml): the HTML parser puts <svg> in the SVG
// namespace even without an xmlns attribute, so our inline ICONS actually render;
// image/svg+xml would drop them into the null namespace and they'd stay invisible.
//
// Defense-in-depth: every input here is our OWN static markup today, but we still
// sanitize the parsed tree so a future change that lets untrusted text reach this
// path can't inject script — the classic <svg onload=...>/javascript: vectors are
// stripped, and a scriptable root is rejected outright.
function parseSvg(markup) {
    const root = new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild;
    if (!root) return null;
    const tag = root.tagName.toLowerCase();
    if (tag === 'script' || tag === 'foreignobject') return null;
    sanitizeSvg(root);
    return root;
}

// Strip the scriptable surface from a parsed markup subtree: <script>/<foreignObject>
// nodes, inline event handlers (on*), and javascript:/data: URLs on href/src.
function sanitizeSvg(node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (tag === 'script' || tag === 'foreignobject') { node.remove(); return; }
    for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const isUrlAttr = name === 'href' || name.endsWith(':href') || name === 'src';
        if (name.startsWith('on') || (isUrlAttr && /^\s*(?:javascript|data):/i.test(attr.value))) {
            node.removeAttribute(attr.name);
        }
    }
    for (const child of [...node.children]) sanitizeSvg(child);
}

const getStorage = keys => new Promise(res => chrome.storage.local.get(keys, res));

/**
 * Wire ARIA radiogroup keyboard behavior: one tab-stop for the group (roving
 * tabindex) plus arrow/Home/End navigation that also activates the option.
 * @param {HTMLElement} container - The radiogroup element; receives the keydown listener.
 * @param {HTMLElement[]} items - Ordered radio elements.
 * @param {(index: number) => void} activate - Selects the item at `index`.
 * @returns {(index: number) => void} `roving(index)` - keeps the single tab-stop on the selected item when it changes externally (e.g. after a refresh).
 */
function wireRadiogroup(container, items, activate) {
    const roving = i => items.forEach((el, j) => { el.tabIndex = j === i ? 0 : -1; });
    roving(0);
    items.forEach((el, i) => el.addEventListener('click', () => roving(i)));
    container.addEventListener('keydown', e => {
        const cur = items.indexOf(document.activeElement);
        if (cur === -1) return;
        const last = items.length - 1;
        let next;
        switch (e.key) {
            case 'ArrowRight': case 'ArrowDown': next = cur >= last ? 0 : cur + 1; break;
            case 'ArrowLeft': case 'ArrowUp': next = cur <= 0 ? last : cur - 1; break;
            case 'Home': next = 0; break;
            case 'End': next = last; break;
            default: return;
        }
        e.preventDefault();
        roving(next);
        items[next].focus();
        activate(next);
    });
    return roving;
}

// --------------------------------------------------------------- Icons
// The signature "degraded → sharp" morph. Each mode icon stacks two vendored
// glyphs of the SAME concept: a Pixelarticons pixel glyph (MIT — the degraded
// state) over a Lucide vector (ISC — the sharp/synced state). CSS resolves the
// pixel into the vector on hover/focus/selection (see the .mode-icon morph
// rules in popup.css). These builders only assemble trusted static markup —
// no logic, injected via the existing parseSvg path. Support glyphs are single
// Lucide vectors (one clean library across the whole UI).
const pixel = d => `<svg class="pixel" viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;
const clean = d => `<svg class="clean" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const morph = (p, c) => `<span class="ico" aria-hidden="true">${pixel(p)}${clean(c)}</span>`;
const solo = c => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c}</svg>`;

const ICONS = {
    off: morph(
        '<path d="M6 20h12v2H6zM18 6h2v2h-2zM4 6h2v2H4zm2-2h2v2H6zm10 0h2v2h-2zM4 18h2v2H4zm14 0h2v2h-2zM2 8h2v10H2zm18 0h2v10h-2zm-9-6h2v9h-2z"/>',
        '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'),
    auto: morph(
        '<path d="M11 1h2v4h-2zm0 22h2v-4h-2zM9 5h2v4H9zm0 14h2v-4H9zm4-14h2v4h-2zm0 14h2v-4h-2zM5 9h4v2H5zm14 0h-4v2h4zM1 11h4v2H1zm22 0h-4v2h4zM5 13h4v2H5zm14 0h-4v2h4z"/>',
        '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>'),
    suave: morph(
        '<path d="M4 2h16v2H4zM2 4h2v10H2zm18 0h2v10h-2zM4 14h2v2H4zm2 2h2v2H6zm4 4h4v2h-4zm10-6h-2v2h2zm-2 2h-2v2h2zm-2 2h-2v2h2zm-6 0H8v2h2z"/>',
        '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
    balanced: morph(
        '<path d="M5 19H3v-2h2v2Zm16 0h-2v-2h2v2ZM3 17H1v-6h2v6Zm11 0h-4v-4h1V5h2v8h1v4Zm9 0h-2v-6h2v6ZM5 11H3V9h2v2Zm16 0h-2V9h2v2ZM9 9H5V7h4v2Zm10 0h-4V7h4v2Z"/>',
        '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
    aggressive: morph(
        '<path d="M20 4v16h2V4zM2 11v2h16v-2zm12 2v2h2v-2zm-2 2v2h2v-2zm-2 2v2h2v-2zm4-8v2h2V9zm-2-2v2h2V7zm-2-2v2h2V5z"/>',
        '<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>'),
    extreme: morph(
        '<path d="M4 13h8v6h2v2h-2v2h-2v-8H2v-4h2v2Zm12 6h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2v-2h2v2Zm-6-6h8v4h-2v-2h-8V5h-2V3h2V1h2v8Zm-8 2H4V9h2v2Zm2-2H6V7h2v2Zm2-2H8V5h2v2Z"/>',
        '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
    estavel: morph(
        '<rect x="3" y="9" width="3" height="12"/><rect x="8" y="5" width="3" height="16"/><rect x="13" y="7" width="3" height="14"/><rect x="18" y="11" width="3" height="10"/>',
        '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    wifi: solo('<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>'),
    gain: solo('<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>'),
    bmc: solo('<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>'),
};

// Drink glyph per PIX amount (BR-only, shown in the PIX flow) — "fancier the more
// you tip": copo americano → lata → long neck → caneca. Line style, to match the
// Lucide beer mug in the header. The mug (R$10) is Lucide "beer" (ISC); the glass,
// can and bottle are original line icons drawn for this project.
const drink = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
// One consistent line set (stroke 2, same optical height + baseline), fancier the
// more you tip: copo americano -> lata -> long neck -> caneca. Each carries a small
// "beer" tell (foam/fill line, pull-tab, label) so they read as a family.
const BEER = {
    // Copo americano: short tumbler flaring to the rim, beer level near the top.
    1: drink('<path d="M7.6 7h8.8l-1 12.2a1 1 0 0 1-1 .9H9.6a1 1 0 0 1-1-.9z"/><path d="M8.2 10.5h7.6"/>'),
    // Lata: an oval lid on top, shoulders flaring OUT wider than the lid (the can
    // tell), a straight body with a base rim, and the pull-tab ring on the lid.
    3: drink('<path d="M8.6 6.6c-1.3.3-1.4 1.1-1.4 2v9.6a4.6 1.3 0 0 0 9.6 0V8.6c0-.9-.1-1.7-1.4-2"/><ellipse cx="12" cy="6.1" rx="3.5" ry="1.3"/><ellipse cx="12" cy="6" rx="1.6" ry="0.65"/>'),
    // Long neck: slim neck + shoulders into the body, cap on top, rectangular label.
    5: drink('<path d="M10 2.2h4v3.6a3 3 0 0 0 .44 1.57l.62 1A3 3 0 0 1 16 9.95V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9.95a3 3 0 0 1 .94-2.18l.62-1A3 3 0 0 0 10 5.8z"/><path d="M8.4 13.4h7.2v3.4H8.4z"/><path d="M10 2.4h4"/>'),
    // Caneca: full mug with handle + foam head (Lucide "beer").
    10: drink('<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>'),
};

// Beer-mug outline for the header support toggle, swapped in for BR (matches the
// coffee-toggle's stroke style). Lucide "beer" (ISC). The three .bubble dots rise
// and fade (CSS) — carbonation recovering the coffee's old steam animation.
const BEER_TOGGLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/><circle class="bubble" cx="8.4" cy="17" r="0.9" fill="currentColor" stroke="none"/><circle class="bubble" cx="11" cy="15.5" r="0.9" fill="currentColor" stroke="none"/><circle class="bubble" cx="13.4" cy="17.5" r="0.9" fill="currentColor" stroke="none"/></svg>';

// --------------------------------------------------------------- State
let state = {};
// Per-channel mode memory (opt-in) — these live OUTSIDE the engine `state`.
let currentChannelId = null;  // channel of the active tab (content.js writes it)
let channelModes = {};        // { channelId: modeName }
let channelMemoryOn = false;  // the opt-in toggle's current value
const updaters = [];          // fn() -> sync a control's display
const modeCards = {};         // mode name -> card element
let rovingModes = null;       // wireRadiogroup roving-tabindex setter for modes

function setOne(key, val) {
    state[key] = val;
    chrome.storage.local.set({ [key]: val });
    refresh();
}

function applyPreset(name) {
    const preset = common.presets[name];
    chrome.storage.local.set(preset);
    Object.assign(state, preset);
    // Per-channel memory (opt-in): record this EXPLICIT pick for the current channel.
    if (channelMemoryOn && currentChannelId && name !== 'off') {
        channelModes = common.saveChannelMode({ [common.channelModesKey]: channelModes }, currentChannelId, name);
        chrome.storage.local.set({ [common.channelModesKey]: channelModes });
    }
    refresh();
}

// --------------------------------------------------------------- Render
function renderStatic() {
    // Wordmark is authored in the HTML as Zer<span.brand-o>Delay (the "o" is the
    // animated live seal). appName is the same constant "ZeroDelay" in every
    // locale, so it is not injected here; aria-label keeps the accessible name.
    $('#brand-tagline').textContent = L.tagline;
    $('#modes-title').textContent = L.sectionMode;
    $('#modes-note').textContent = L.modesNote;
    $('#advanced-label').textContent = L.sectionIndicators;
    $('#reset-label').textContent = L.reset;
    $('#reset').title = L.resetHint;
    $('#about-label').textContent = L.aboutLink;
    $('#issue-label').textContent = L.reportIssue;
}

function renderModes() {
    const container = $('#mode-cards');
    for (const name of common.modeOrder) {
        const meta = common.modeMeta[name];
        const card = el('button', {
            class: 'mode-card', type: 'button', role: 'radio', 'aria-checked': 'false',
            onclick: () => applyPreset(name),
        },
            el('span', { class: 'mode-icon', html: ICONS[name] }),
            el('span', { class: 'mode-body' },
                el('span', { class: 'mode-name', text: meta.title }),
                el('span', { class: 'mode-desc', text: meta.desc }),
                el('span', { class: 'mode-conn' }, el('span', { class: 'conn-icon', html: ICONS.wifi }), el('span', { text: meta.conn })),
                el('span', { class: 'mode-gain' + (name === 'off' ? ' is-none' : '') }, el('span', { class: 'gain-icon', html: ICONS.gain }), el('span', { text: meta.gain })),
            ),
            el('span', { class: 'mode-check', html: ICONS.check }),
        );
        modeCards[name] = card;
        container.append(card);
    }
    const modeItems = common.modeOrder.map(n => modeCards[n]);
    rovingModes = wireRadiogroup(container, modeItems, idx => applyPreset(common.modeOrder[idx]));
}

function buildRow({ label, control }) {
    const main = el('div', { class: 'row-main' }, el('div', { class: 'row-label', text: label }));
    return el('div', { class: 'row' }, main, el('div', { class: 'row-control' }, control));
}

function buildToggle(key) {
    const input = el('input', { type: 'checkbox', onchange: () => setOne(key, input.checked) });
    const sw = el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', { class: 'thumb' }));
    updaters.push(() => { input.checked = !!state[key]; });
    return sw;
}

function renderIndicators() {
    const rows = $('#indicator-rows');
    const defs = [
        { key: 'showPlaybackRate', label: L.showPlaybackRate },
        { key: 'showLatency', label: L.showLatency },
        { key: 'showHealth', label: L.showHealth },
    ];
    for (const d of defs) {
        rows.append(buildRow({ label: d.label, control: buildToggle(d.key) }));
    }
}

// MODO HEXA prefs live outside the engine `state`/presets, so this toggle reads
// and writes chrome.storage.local directly (content.js reacts via onChanged).
function buildHexaToggle(key, defaultOn) {
    const input = el('input', { type: 'checkbox', onchange: () => chrome.storage.local.set({ [key]: input.checked }) });
    const sw = el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', { class: 'thumb' }));
    const set = v => { input.checked = (v == null) ? defaultOn : !!v; };
    chrome.storage.local.get([key], d => set(d[key]));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[key]) set(changes[key].newValue);
    });
    return sw;
}

function renderHexa() {
    $('#hexa-title').textContent = L.hexaSectionTitle;
    const rows = $('#hexa-rows');
    rows.append(buildRow({ label: L.hexaSuggestLabel, control: buildHexaToggle(common.hexaSuggestKey, true) }));
    rows.append(buildRow({ label: L.hexaFullLabel, control: buildHexaToggle(common.hexaFullKey, false) }));
}

// Dress the popup with a few hexa touches while the theme is live on a tab.
function watchHexaActive() {
    const set = on => document.body.classList.toggle('hexa', !!on);
    chrome.storage.local.get([common.hexaActiveKey], d => set(d[common.hexaActiveKey]));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[common.hexaActiveKey]) set(changes[common.hexaActiveKey].newValue);
    });
}

// The "Estável" mode's single knob: the target buffer (seconds) the band
// controller parks around. Only shown while that mode is active (see refresh).
function renderBandControl() {
    const slider = $('#band-slider');
    $('#band-label').textContent = L.bandCenter;
    slider.min = common.minCenterBuffer;
    slider.max = common.maxCenterBuffer;
    slider.step = common.stepCenterBuffer;
    slider.setAttribute('aria-label', L.bandCenter);
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        $('#band-value').textContent = v.toFixed(1) + 's';
        setOne('centerBuffer', v);
    });
    updaters.push(() => {
        const v = common.limitValue(state.centerBuffer, common.defaultCenterBuffer,
            common.minCenterBuffer, common.maxCenterBuffer, common.stepCenterBuffer);
        slider.value = v;
        $('#band-value').textContent = v.toFixed(1) + 's';
    });
}

function renderAdvancedToggle() {
    const toggle = $('#advanced-toggle');
    const panel = $('#advanced-panel');
    toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
    });
}

// FAQ / "how to use" — a collapsible help section for new users. Mirrors the
// Advanced toggle/panel pattern (and reuses its classes) so it reads as native.
function renderFaq() {
    const toggle = $('#faq-toggle');
    const panel = $('#faq-panel');
    $('#faq-label').textContent = L.faqTitle;
    toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
    });
    const items = [
        { q: L.faqWhatQ, a: L.faqWhatA },
        { q: L.faqStartQ, a: L.faqStartA },
        { q: L.faqSpeedQ, a: L.faqSpeedA },
        { q: L.faqModeQ, a: L.faqModeA },
        { q: L.faqIndicatorsQ, a: L.faqIndicatorsA },
        { q: L.faqShortcutsQ, a: L.faqShortcutsA },
    ];
    for (const it of items) {
        panel.append(el('div', { class: 'group' },
            el('p', { class: 'faq-q', text: it.q }),
            el('p', { class: 'faq-a', text: it.a }),
        ));
    }
}

function renderReset() {
    const btn = $('#reset');
    let timer, armed = false, doneTimer;

    const start = () => {
        clearTimeout(timer);
        clearTimeout(doneTimer);
        btn.classList.remove('done');
        armed = false;
        void btn.offsetWidth; // restart the fill animation
        btn.classList.add('holding');
        timer = setTimeout(() => {
            btn.classList.remove('holding');
            btn.classList.add('done');
            armed = true;
        }, 1000);
    };
    const end = commit => {
        clearTimeout(timer);
        btn.classList.remove('holding');
        if (commit && armed) {
            doReset();
            doneTimer = setTimeout(() => btn.classList.remove('done'), 700);
        } else {
            btn.classList.remove('done');
        }
        armed = false;
    };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', () => end(true));
    btn.addEventListener('mouseleave', () => end(false));
    btn.addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
    btn.addEventListener('touchend', e => { e.preventDefault(); end(true); });
    btn.addEventListener('touchcancel', () => end(false));
}

function doReset() {
    // Only clear engine settings — keep the donation opt-out / snooze choices.
    chrome.storage.local.remove(common.storage);
    state = common.resolveSettings({});
    refresh();
}

// --------------------------------------------------------------- Support (PIX)
function renderSupport() {
    const toggle = $('#coffee-toggle');
    const panel = $('#support-panel');
    const amountsBox = $('#support-amounts');
    const custom = $('#support-custom');
    const qrBox = $('#support-qr');
    const copyBtn = $('#support-copy');

    toggle.title = L.supportTitle;
    toggle.setAttribute('aria-label', L.supportTitle);
    $('#coffee-label').textContent = L.supportBtn;
    $('#support-cta-text').textContent = L.supportCtaText;
    const ctaBtn = $('#support-cta-btn');
    ctaBtn.textContent = L.supportCtaBtn;
    $('#support-title').textContent = L.supportTitle;
    $('#support-note').textContent = L.supportNote;
    $('#support-scan').textContent = L.supportScan;
    custom.placeholder = L.supportCustomPlaceholder;
    copyBtn.textContent = L.supportCopy;

    const isBr = common.isBrazil();
    let render = () => {};   // refresh hook called by setOpen / eligibility

    if (isBr) {
        // ----- PIX (Brazil): suggested amounts + "copia e cola" code + QR ----
        // Brazil's whole donation theme is beer 🍺 — swap the header cup for a mug.
        const headerIcon = toggle.querySelector('svg');
        if (headerIcon) headerIcon.replaceWith(parseSvg(BEER_TOGGLE));
        let amount = pix.PIX_DEFAULT_AMOUNT;
        const chips = {};
        const chipEls = [];   // ordered, for the radiogroup keyboard wiring
        let copyTimer;

        // Parse the custom field; 0 = open amount (payer types it in the bank
        // app). Capped so a huge number can't push toFixed() into exponential
        // notation and corrupt the EMV payload.
        const readCustomAmount = () => {
            const v = parseFloat(custom.value);
            return (Number.isFinite(v) && v > 0 && v < 100000) ? v : 0;
        };

        const selectChip = key => {
            for (const [k, c] of Object.entries(chips)) c.setAttribute('aria-checked', String(k === key));
        };

        const updatePix = () => {
            const code = pix.buildPixCode(amount);
            copyBtn.dataset.code = code;
            copyBtn.classList.remove('copied');
            copyBtn.textContent = L.supportCopy;
            if (typeof window.qrcode === 'function') {
                try {
                    const qr = window.qrcode(0, 'M');
                    qr.addData(code);
                    qr.make();
                    qrBox.textContent = '';
                    qrBox.append(parseSvg(qr.createSvgTag({ cellSize: 4, scalable: true })));
                    qrBox.hidden = false;
                } catch {
                    qrBox.hidden = true;
                }
            } else {
                qrBox.hidden = true;
            }
        };
        render = updatePix;

        for (const value of pix.PIX_AMOUNTS) {
            const key = String(value);
            const chip = el('button', {
                class: 'support-chip', type: 'button', role: 'radio', 'aria-checked': 'false',
                onclick: () => { amount = value; custom.hidden = true; selectChip(key); updatePix(); },
            }, el('span', { class: 'chip-ico', html: BEER[value] || '' }), el('span', { class: 'chip-val', text: 'R$ ' + value }));
            chips[key] = chip;
            chipEls.push(chip);
            amountsBox.append(chip);
        }

        chips.custom = el('button', {
            class: 'support-chip support-chip--custom', type: 'button', role: 'radio', 'aria-checked': 'false',
            onclick: () => {
                custom.hidden = false;
                custom.focus();
                selectChip('custom');
                amount = readCustomAmount();
                updatePix();
            },
        }, L.supportCustom);
        chipEls.push(chips.custom);
        amountsBox.append(chips.custom);

        // Same ARIA radiogroup keyboard behavior as the mode cards.
        wireRadiogroup(amountsBox, chipEls, i => chipEls[i].click());

        custom.addEventListener('input', () => {
            amount = readCustomAmount();
            updatePix();
        });

        copyBtn.addEventListener('click', async () => {
            const code = copyBtn.dataset.code || pix.buildPixCode(amount);
            let ok = false;
            try {
                await navigator.clipboard.writeText(code);
                ok = true;
            } catch {
                // execCommand('copy') is deprecated, but it's the only fallback
                // when the async Clipboard API is unavailable/denied here.
                try {
                    const ta = el('textarea', { class: '' });
                    ta.value = code;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.append(ta);
                    ta.select();
                    ok = document.execCommand('copy');
                    ta.remove();
                } catch { ok = false; }
            }
            if (ok) {
                copyBtn.classList.add('copied');
                copyBtn.textContent = L.supportCopied;
                clearTimeout(copyTimer);
                copyTimer = setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.textContent = L.supportCopy;
                }, 1600);
            }
        });

        selectChip(String(pix.PIX_DEFAULT_AMOUNT));
    } else {
        // ----- International (non-Brazil): external donation link buttons ----
        amountsBox.hidden = true;
        custom.hidden = true;
        $('#support-pix').hidden = true;

        const intl = $('#support-intl');
        intl.hidden = false;
        const labels = { bmc: L.supportBmc };
        for (const [key, url] of Object.entries(common.donateLinks)) {
            if (!url || url.includes('REPLACE')) continue;
            intl.append(el('button', {
                class: 'support-link support-link--' + key, type: 'button',
                onclick: () => chrome.tabs.create({ url }),
            },
                el('span', { class: 'support-link-icon', html: ICONS[key] || '' }),
                el('span', { class: 'support-link-text' }, labels[key] || key),
            ));
        }
    }

    const setOpen = open => {
        toggle.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (open) render();
    };
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    ctaBtn.addEventListener('click', () => setOpen(panel.hidden));

    // ----- Gentle, optional donation invite ---------------------------------
    const nudge = $('#support-nudge');
    const nudgeActions = $('#support-nudge-actions');
    const laterBtn = $('#support-later');
    const optoutBtn = $('#support-optout');
    nudge.textContent = L.donateNudge;
    laterBtn.textContent = L.donateLater;
    optoutBtn.textContent = L.donateOptOut;

    const showNudge = on => { nudge.hidden = !on; nudgeActions.hidden = !on; };

    laterBtn.addEventListener('click', () => {
        // "Hoje não": rest until tomorrow (local midnight). Nothing escalates —
        // the invite returns on the next session after the day turns.
        chrome.storage.local.set({ donateSnoozeUntil: common.endOfToday(Date.now()) });
        showNudge(false);
        setOpen(false);
    });
    optoutBtn.addEventListener('click', () => {
        // "Não quero apoiar": the one choice that silences the invite for good
        // (the support button in the header stays available).
        chrome.storage.local.set({ donateOptOut: true });
        showNudge(false);
        setOpen(false);
    });

    const forceDonate = new URLSearchParams(location.search).get('donate') === '1';
    common.ensureInstalledAt();
    chrome.storage.local.get(common.donateKeys, d => {
        const now = Date.now();
        // Opening the popup clears the toolbar dot.
        try { chrome.action.setBadgeText({ text: '' }); } catch { /* best-effort; ignore */ }
        try { chrome.runtime.sendMessage({ type: 'donate-seen' }); } catch { /* best-effort; ignore */ }

        if (forceDonate) {
            setOpen(true);
        } else if (common.donateEligible(d, now)) {
            // Seeing the invite arms NOTHING — it may show once per browser
            // session until the user explicitly picks "Hoje não" (rest until
            // tomorrow) or "Não quero apoiar" (never again). The session flag
            // keeps repeated popup opens from re-slamming the panel.
            const sess = chrome.storage.session;
            if (!sess) { showNudge(true); setOpen(true); return; }
            sess.get(['donateNudgeSession'], s => {
                if (!chrome.runtime.lastError && s.donateNudgeSession) { render(); return; }
                sess.set({ donateNudgeSession: true });
                showNudge(true);
                setOpen(true);
            });
        } else {
            render(); // pre-render (PIX QR) so a manual open is instant
        }
    });
}

// ----------------------------------------------------------- Theme toggle
// Light/dark switch in the header. A saved choice ('light' | 'dark' under
// common.themeKey) wins over the system scheme via html[data-theme]; with
// nothing saved the popup keeps following prefers-color-scheme (CSS-only, so
// the first paint is already right). Kept out of the engine `state`, like the
// Hexa toggles, so "Restore defaults" never touches it.
function renderThemeToggle() {
    const btn = $('#theme-toggle');
    const root = document.documentElement;
    const systemTheme = () => matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const current = () => root.dataset.theme || systemTheme();
    const relabel = () => {
        const title = current() === 'dark' ? L.themeToLight : L.themeToDark;
        btn.title = title;
        btn.setAttribute('aria-label', title);
    };
    relabel();
    chrome.storage.local.get([common.themeKey], d => {
        const saved = d[common.themeKey];
        if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
        relabel();
    });
    btn.addEventListener('click', () => {
        const next = current() === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        chrome.storage.local.set({ [common.themeKey]: next });
        relabel();
    });
}

// --------------------------------------------------------------- Refresh
function refresh() {
    const mode = common.deriveMode(state);
    // Purely presentational hook: expose the derived signal state so CSS can drive
    // the global LIVE↔SYNCED seal (red/pulsing when syncing, gray/still when Off).
    // Reads existing state only — no storage, messages, or behavior touched.
    $('#app').dataset.signal = mode === 'off' ? 'degraded' : 'synced';
    // The target-buffer slider belongs to the "Estável" mode only.
    $('#band-control').hidden = mode !== 'estavel';
    let activeIndex = -1;
    common.modeOrder.forEach((name, i) => {
        const on = name === mode;
        modeCards[name].setAttribute('aria-checked', String(on));
        if (on) activeIndex = i;
    });
    // Keep the group's single tab-stop on the selected mode (first card if none).
    if (rovingModes) rovingModes(activeIndex >= 0 ? activeIndex : 0);
    for (const u of updaters) u();
    updateChannelHint();
}

// --------------------------------------------------- Per-channel mode memory
// Opt-in toggle + a "remembered for this channel" hint. Like the Hexa toggles, it
// reads/writes chrome.storage.local directly since it lives outside the engine
// `state`; content.js reacts and restores the saved mode on the page.
function renderChannelMemory() {
    const rows = $('#channel-memory-rows');
    if (!rows) return;
    const input = el('input', { type: 'checkbox', onchange: () => chrome.storage.local.set({ [common.channelMemoryKey]: input.checked }) });
    const sw = el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', { class: 'thumb' }));
    const row = buildRow({ label: L.channelMemoryLabel, control: sw });
    row.querySelector('.row-label').title = L.channelMemoryHint;
    rows.append(row);

    $('#channel-remembered-text').textContent = L.channelRemembered;
    const forget = $('#channel-forget');
    forget.textContent = L.channelForget;
    forget.addEventListener('click', () => {
        if (!currentChannelId) return;
        channelModes = common.forgetChannelMode({ [common.channelModesKey]: channelModes }, currentChannelId);
        chrome.storage.local.set({ [common.channelModesKey]: channelModes });
    });

    const sync = d => {
        channelMemoryOn = d[common.channelMemoryKey] == null ? common.defaultChannelMemory : !!d[common.channelMemoryKey];
        input.checked = channelMemoryOn;
        channelModes = d[common.channelModesKey] || {};
        currentChannelId = d[common.currentChannelIdKey] || null;
        updateChannelHint();
    };
    const keys = [common.channelMemoryKey, common.channelModesKey, common.currentChannelIdKey];
    chrome.storage.local.get(keys, sync);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && keys.some(k => k in changes)) chrome.storage.local.get(keys, sync);
    });
}

// Show the hint only when the active mode was the one saved for this channel.
function updateChannelHint() {
    const hint = $('#channel-remembered');
    if (!hint) return;
    const mode = common.deriveMode(state);
    hint.hidden = !(channelMemoryOn && currentChannelId && mode !== 'off' && channelModes[currentChannelId] === mode);
}

// --------------------------------------------------------------- Init
(async function init() {
    // The markup is language-neutral; reflect the real UI language for
    // screen readers and hyphenation (popup.html can't hardcode one).
    document.documentElement.lang = chrome.i18n.getUILanguage() || 'en';

    const data = await getStorage(common.storage);
    state = common.resolveSettings(data);
    renderStatic();
    renderThemeToggle();
    renderModes();
    renderChannelMemory();
    renderBandControl();
    renderIndicators();
    renderHexa();
    watchHexaActive();
    renderAdvancedToggle();
    renderFaq();
    renderReset();
    renderSupport();
    refresh();

    // Keep the UI in sync with changes made elsewhere while the popup is open
    // (keyboard shortcut, the player's stall offer, another options window).
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !common.storage.some(k => k in changes)) return;
        getStorage(common.storage).then(d => {
            state = common.resolveSettings(d);
            refresh();
        });
    });
})();
