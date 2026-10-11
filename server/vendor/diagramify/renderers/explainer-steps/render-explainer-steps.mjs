import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { asArray, isFinitePoint } from '../shared/geometry.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: explainer, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'explainer-steps',
  defaultExample: 'attention-mechanism.explainer-steps.json',
});

const VIEWBOX_WIDTH = 760;
const CARD_X = 64;
const CARD_GAP = 28;
const CARD_PADDING = 20;
const HEADER_H = 34;
const LINE_H = 15;
const MATH_LINE_H = 16;
const CODE_HEADER_H = 16;
const CODE_LINE_H = 13;
const DESC_MAX_UNITS = 90;
const TOP_MARGIN = 56;
const LEGEND_RESERVE = 64;
const CARD_WIDTH = VIEWBOX_WIDTH - CARD_X * 2;
const TEXT_X_OFFSET = 44;

const typeClass = {
  start: 'c-frontend',
  active: 'c-backend',
  waiting: 'c-cloud',
  decision: 'c-security',
  success: 'c-database',
  failure: 'c-security',
  neutral: 'c-external',
  external: 'c-external',
};

const textClass = {
  start: 't-frontend',
  active: 't-backend',
  waiting: 't-cloud',
  decision: 't-security',
  success: 't-database',
  failure: 't-security',
  neutral: 't-muted',
  external: 't-muted',
};

function wrapDescription(text, maxUnitsPerLine) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let currentUnits = 0;
  for (const word of words) {
    const wordUnits = textUnits(word);
    const joinedUnits = current ? currentUnits + 1 + wordUnits : wordUnits;
    if (current && joinedUnits > maxUnitsPerLine) {
      lines.push(current);
      current = word;
      currentUnits = wordUnits;
    } else {
      current = current ? `${current} ${word}` : word;
      currentUnits = joinedUnits;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function splitVerbatimLines(text) {
  return String(text ?? '').split('\n');
}

function measureStep(step) {
  const descLines = wrapDescription(step.description, DESC_MAX_UNITS);
  const mathLines = step.math ? splitVerbatimLines(step.math) : [];
  const codeLines = step.code ? splitVerbatimLines(step.code.content) : [];
  let height = HEADER_H;
  if (descLines.length) height += descLines.length * LINE_H + 10;
  if (mathLines.length) height += mathLines.length * MATH_LINE_H + 8;
  if (codeLines.length) height += CODE_HEADER_H + codeLines.length * CODE_LINE_H + 16;
  height += CARD_PADDING;
  return { ...step, descLines, mathLines, codeLines, height };
}

// Check whether this explainer uses modular sections or classic flat steps
const hasSections = Array.isArray(explainer.sections) && explainer.sections.length > 0;
const measuredSteps = !hasSections ? asArray(explainer.steps).map(measureStep) : [];
const steps = new Map();

// Layout measurement for sections or classic steps
let cursorY = TOP_MARGIN;
if (Array.isArray(explainer.meta?.topic_tags) && explainer.meta.topic_tags.length > 0) {
  cursorY += 28;
}

const measuredSections = [];

if (hasSections) {
  for (const sec of explainer.sections) {
    let secHeight = 0;
    const kind = sec.kind;
    if (kind === 'tldr') {
      let contentLines = [];
      if (Array.isArray(sec.takeaways) && sec.takeaways.length > 0) {
        contentLines = sec.takeaways.flatMap((t) => wrapDescription(`•  ${t}`, DESC_MAX_UNITS - 6));
      } else {
        const rawText = sec.content || sec.description || sec.summary || sec.text ||
          (Array.isArray(sec.paragraphs) ? sec.paragraphs.join('\n') : '');
        contentLines = wrapDescription(rawText, DESC_MAX_UNITS - 6);
      }
      if (contentLines.length === 0) {
        contentLines = ['Summary of key takeaways and architecture concepts.'];
      }
      secHeight = 44 + contentLines.length * LINE_H + CARD_PADDING;
      measuredSections.push({ ...sec, contentLines, y: cursorY, height: secHeight });
    } else if (kind === 'narrative') {
      let paragraphs = sec.paragraphs;
      if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        const raw = sec.content || sec.description || sec.text || sec.summary || '';
        paragraphs = raw ? raw.split('\n\n').filter(Boolean) : [];
      }
      const allParaLines = paragraphs.map((p) => wrapDescription(p, DESC_MAX_UNITS));
      const totalParaLines = allParaLines.reduce((acc, lines) => acc + lines.length, 0);
      const formulaH = sec.formula ? 44 : 0;
      secHeight = 36 + totalParaLines * LINE_H + (allParaLines.length > 1 ? (allParaLines.length - 1) * 12 : 0) + formulaH + CARD_PADDING;
      measuredSections.push({ ...sec, allParaLines, y: cursorY, height: secHeight });
    } else if (kind === 'simulator') {
      const descLines = sec.description ? wrapDescription(sec.description, DESC_MAX_UNITS) : [];
      secHeight = 40 + (descLines.length ? descLines.length * LINE_H + 12 : 0) + 195 + CARD_PADDING;
      measuredSections.push({ ...sec, descLines, y: cursorY, height: secHeight });
    } else if (kind === 'chart') {
      const footerLines = sec.footer_note ? wrapDescription(sec.footer_note, DESC_MAX_UNITS) : [];
      secHeight = 220 + (footerLines.length ? footerLines.length * LINE_H + 14 : 0) + CARD_PADDING;
      measuredSections.push({ ...sec, footerLines, y: cursorY, height: secHeight });
    } else if (kind === 'calculator') {
      const descLines = sec.description ? wrapDescription(sec.description, DESC_MAX_UNITS) : [];
      const formulaH = sec.formula ? 38 : 0;
      secHeight = 40 + (descLines.length ? descLines.length * LINE_H + 12 : 0) + formulaH + 215 + CARD_PADDING;
      measuredSections.push({ ...sec, descLines, y: cursorY, height: secHeight });
    } else if (kind === 'grid_cards') {
      const descLines = sec.description ? wrapDescription(sec.description, DESC_MAX_UNITS) : [];
      const cols = sec.columns || (sec.cards?.length === 2 ? 2 : 3);
      const colWidth = Math.floor((CARD_WIDTH - (cols - 1) * 14) / cols);
      const cardGap = 14;
      const measuredCards = (sec.cards || []).map((c) => {
        const cLines = wrapDescription(c.description, Math.floor(colWidth / 7.2));
        const cH = 46 + cLines.length * 13 + 18;
        return { ...c, cLines, height: cH };
      });
      const maxCardH = Math.max(...measuredCards.map((c) => c.height), 110);
      const numRows = Math.ceil(measuredCards.length / cols);
      const totalGridH = numRows * maxCardH + (numRows > 1 ? (numRows - 1) * cardGap : 0);
      secHeight = 40 + (descLines.length ? descLines.length * LINE_H + 12 : 0) + totalGridH + CARD_PADDING;
      measuredSections.push({ ...sec, descLines, cols, colWidth, cardGap, measuredCards, maxCardH, totalGridH, y: cursorY, height: secHeight });
    } else if (kind === 'steps') {
      const items = (sec.items || []).map(measureStep);
      let stepY = cursorY + 36;
      for (const st of items) {
        steps.set(st.id, { ...st, x: CARD_X, y: stepY, width: CARD_WIDTH });
        stepY += st.height + CARD_GAP;
      }
      secHeight = (stepY - cursorY) + CARD_PADDING;
      measuredSections.push({ ...sec, items, y: cursorY, height: secHeight });
    }
    cursorY += secHeight + CARD_GAP;
  }
} else {
  for (const step of measuredSteps) {
    steps.set(step.id, { ...step, x: CARD_X, y: cursorY, width: CARD_WIDTH });
    cursorY += step.height + CARD_GAP;
  }
}

const viewBoxHeight = Math.max(320, cursorY - CARD_GAP + LEGEND_RESERVE);
const viewBox = [VIEWBOX_WIDTH, viewBoxHeight];

function validateExplainerSteps() {
  const problems = [];
  if (explainer.schema_version !== 1) problems.push('Explainer-steps files must set "schema_version": 1.');
  if (explainer.diagram_type !== 'explainer-steps') problems.push('Explainer-steps files must set "diagram_type": "explainer-steps".');
  if (!explainer.meta?.title) problems.push('Explainer-steps files must include meta.title.');
  
  if (!hasSections) {
    if (!Array.isArray(explainer.steps) || explainer.steps.length < 2) problems.push('Explainer-steps diagrams need at least two steps.');
    if (steps.size !== asArray(explainer.steps).length) problems.push('Step ids must be unique.');
  }

  for (const step of steps.values()) {
    if (!isFinitePoint(step.x, step.y, step.width, step.height)) {
      problems.push(`Step "${step.id}" produced non-finite coordinates — this is an internal layout bug, not an authoring error.`);
    }
  }

  if (problems.length) {
    throwDiagnosticProblems('Explainer-steps layout validation failed', problems, {
      subject: { diagramType: 'explainer-steps' },
    });
  }
}

function renderCodeBlock(step, startY) {
  if (!step.codeLines.length) return { markup: '', nextY: startY };
  const blockHeight = CODE_HEADER_H + step.codeLines.length * CODE_LINE_H + 10;
  const headerText = step.code.language ? `code (${step.code.language})` : 'code';
  const lines = step.codeLines.map((line, index) => `
          <text data-detail="context" x="${step.x + TEXT_X_OFFSET + 8}" y="${startY + CODE_HEADER_H + 4 + index * CODE_LINE_H}" class="t-muted" font-size="8">${esc(line)}</text>`).join('');
  const markup = `
          <rect x="${step.x + TEXT_X_OFFSET - 4}" y="${startY - 10}" width="${step.width - TEXT_X_OFFSET - 8}" height="${blockHeight}" rx="4" class="c-mask"/>
          <text data-detail="fine" x="${step.x + TEXT_X_OFFSET + 8}" y="${startY + 2}" class="t-dim" font-size="7" font-weight="700">${esc(headerText.toUpperCase())}</text>${lines}`;
  return { markup, nextY: startY + blockHeight + 8 };
}

function renderMathBlock(step, startY) {
  if (!step.mathLines.length) return { markup: '', nextY: startY };
  const lines = step.mathLines.map((line, index) => `
          <text data-detail="context" x="${step.x + TEXT_X_OFFSET}" y="${startY + index * MATH_LINE_H}" class="t-primary" font-size="9" font-style="italic">${esc(line)}</text>`).join('');
  return { markup: lines, nextY: startY + step.mathLines.length * MATH_LINE_H + 8 };
}

function renderStep(step, index, total) {
  const fill = typeClass[step.type] || typeClass.neutral;
  const accent = textClass[step.type] || 't-muted';
  const passport = {
    kind: step.type,
    sublabel: step.sublabel,
    tag: step.tag,
    context: i18nText(explainer.meta.locale, 'node.context.explainer-steps'),
  };
  const textX = step.x + TEXT_X_OFFSET;
  const sub = step.sublabel
    ? `\n          <text data-detail="context" x="${textX}" y="${step.y + 48}" class="t-muted" font-size="9">${esc(step.sublabel)}</text>`
    : '';
  const tag = step.tag
    ? `\n        <text data-detail="fine" x="${step.x + step.width - 12}" y="${step.y + 20}" class="${accent}" font-size="8" text-anchor="end">${esc(step.tag)}</text>`
    : '';
  let cursor = step.y + (step.sublabel ? 64 : 48);
  const descLines = step.descLines.map((line, lineIndex) => `
          <text data-detail="context" x="${textX}" y="${cursor + lineIndex * LINE_H}" class="t-muted" font-size="8">${esc(line)}</text>`).join('');
  if (step.descLines.length) cursor += step.descLines.length * LINE_H + 10;
  const math = renderMathBlock(step, cursor);
  cursor = math.nextY;
  const code = renderCodeBlock(step, cursor);
  const connector = index < total - 1
    ? `\n        <path d="M ${step.x + 16} ${step.y + step.height} L ${step.x + 16} ${step.y + step.height + CARD_GAP}" class="a-default" stroke-width="1.4" stroke-dasharray="2,6" marker-end="url(#arrowhead)"/>`
    : '';
  return `        <g ${focusNodeAttrs(step.id, step.label, passport, explainer.meta.locale)}>
          ${focusNodeTitle(step.label, passport)}
          <rect x="${step.x}" y="${step.y}" width="${step.width}" height="${step.height}" rx="10" class="c-mask"/>
          <rect x="${step.x}" y="${step.y}" width="${step.width}" height="${step.height}" rx="10" class="${fill}" stroke-width="1.5"${animateAttr(explainer.meta, 'node', index)}/>
          ${renderSemanticSigil(step.type, { x: step.x + 16, y: step.y + 16 })}
          <text data-detail="fine" x="${textX}" y="${step.y + 16}" class="${accent}" font-size="8" font-weight="700">STEP ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text>
          <text data-node-label="" x="${textX}" y="${step.y + 32}" class="t-primary" font-size="13" font-weight="600">${esc(step.label)}</text>${tag}${sub}${descLines}${math.markup}${code.markup}
        </g>${connector}`;
}

// --- SECTION COMPONENT RENDERERS ---

function renderTopicTagsHeader() {
  if (!Array.isArray(explainer.meta?.topic_tags) || !explainer.meta.topic_tags.length) return '';
  const text = explainer.meta.topic_tags.map((t) => t.toUpperCase()).join(' · ');
  return `        <text data-detail="fine" x="${CARD_X}" y="${TOP_MARGIN - 18}" class="t-dim" font-size="8" font-weight="700" letter-spacing="1.5">${esc(text)}</text>`;
}

function renderTldrBlock(sec) {
  const textLines = sec.contentLines.map((line, idx) => `
          <text data-detail="context" x="${CARD_X + 24}" y="${sec.y + 44 + idx * LINE_H}" class="t-muted" font-size="9">${esc(line)}</text>`).join('');
  const titleMarkup = sec.title
    ? `<text data-node-label="" x="${CARD_X + 80}" y="${sec.y + 24}" class="t-primary" font-size="11" font-weight="700">${esc(sec.title)}</text>`
    : '';
  return `        <!-- TL;DR Section -->
        <g id="section-${esc(sec.id || 'tldr')}" class="explainer-tldr" data-section-kind="tldr" data-section-number="" data-section-title="${esc(sec.title || 'TL;DR Takeaways')}" data-chapter-tag="concept">
          <rect x="${CARD_X}" y="${sec.y}" width="${CARD_WIDTH}" height="${sec.height - CARD_PADDING}" rx="8" class="c-mask"/>
          <rect x="${CARD_X}" y="${sec.y}" width="${CARD_WIDTH}" height="${sec.height - CARD_PADDING}" rx="8" class="c-database" stroke-width="1.5"/>
          <rect x="${CARD_X + 16}" y="${sec.y + 12}" width="48" height="18" rx="4" fill="rgba(167, 139, 250, 0.25)" stroke="#a78bfa" stroke-width="1"/>
          <text x="${CARD_X + 40}" y="${sec.y + 24}" class="t-emphasis" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="0.1em" fill="#c4b5fd">TL;DR</text>
          ${titleMarkup}
          ${textLines}
        </g>`;
}

function renderNarrativeBlock(sec) {
  const numBadge = sec.number
    ? `<text data-detail="fine" x="${CARD_X}" y="${sec.y + 18}" class="t-frontend" font-size="11" font-weight="700">${esc(sec.number)}</text>
       <text data-node-label="" x="${CARD_X + 26}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || '')}</text>`
    : `<text data-node-label="" x="${CARD_X}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || '')}</text>`;

  let curY = sec.y + 38;
  const paraMarkup = (sec.allParaLines || []).map((lines) => {
    const linesStr = lines.map((l, i) => `
          <text data-detail="context" x="${CARD_X}" y="${curY + i * LINE_H}" class="t-muted" font-size="9">${esc(l)}</text>`).join('');
    curY += lines.length * LINE_H + 12;
    return linesStr;
  }).join('');

  let formulaMarkup = '';
  if (sec.formula) {
    formulaMarkup = `
          <rect x="${CARD_X}" y="${curY}" width="${CARD_WIDTH}" height="32" rx="6" class="c-mask"/>
          <rect x="${CARD_X}" y="${curY}" width="${CARD_WIDTH}" height="32" rx="6" class="c-cloud" stroke-width="1"/>
          <text data-detail="context" x="${CARD_X + 16}" y="${curY + 20}" class="t-cloud" font-size="10" font-weight="600" font-family="monospace">${esc(sec.formula)}</text>`;
  }

  const rawSecId = sec.id || (sec.number ? 'narrative-' + sec.number.replace(/[^a-zA-Z0-9]/g, '') : 'narrative');
  return `        <!-- Narrative Section -->
        <g id="section-${esc(rawSecId)}" class="explainer-narrative" data-section-kind="narrative" data-section-number="${esc(sec.number || '')}" data-section-title="${esc(sec.title || 'Narrative')}" data-chapter-tag="concept">
          ${numBadge}
          ${paraMarkup}
          ${formulaMarkup}
        </g>`;
}

function renderSimulatorBlock(sec) {
  const numBadge = sec.number
    ? `<text data-detail="fine" x="${CARD_X}" y="${sec.y + 18}" class="t-frontend" font-size="11" font-weight="700">${esc(sec.number)}</text>
       <text data-node-label="" x="${CARD_X + 26}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || 'Step through it yourself')}</text>`
    : `<text data-node-label="" x="${CARD_X}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || 'Step through it yourself')}</text>`;

  let curY = sec.y + 36;
  const descMarkup = (sec.descLines || []).map((l, i) => `
          <text data-detail="context" x="${CARD_X}" y="${curY + i * LINE_H}" class="t-muted" font-size="9">${esc(l)}</text>`).join('');
  if (sec.descLines?.length) curY += sec.descLines.length * LINE_H + 12;

  const boxY = curY;
  const boxH = 195;

  const widgetType = sec.widget_type || (sec.generated_tokens ? 'decode_kv' : 'generic_step');
  const widgetTitle = sec.widget_title || (widgetType === 'decode_kv' ? 'DECODE SIMULATOR' : 'INTERACTIVE SIMULATOR');

  const rawItems = sec.elements || sec.tokens;
  const promptToks = sec.prompt_tokens || (rawItems ? rawItems.map(it => typeof it === 'string' ? it : it.text) : ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5']);
  const genToks = sec.generated_tokens || [];

  let tokensStripMarkup = '';
  if (rawItems || widgetType !== 'decode_kv') {
    const itemsList = rawItems || promptToks.map((t, idx) => ({ text: t, tag: `step ${idx + 1}` }));
    const totalChips = itemsList.length;
    const chipGap = 8;
    const chipWidth = Math.min(96, Math.floor((CARD_WIDTH - 48 - (totalChips - 1) * chipGap) / totalChips));
    const chipsHtml = itemsList.map((it, idx) => {
      const itemObj = typeof it === 'string' ? { text: it, tag: `step ${idx + 1}` } : it;
      const cx = CARD_X + 24 + idx * (chipWidth + chipGap);
      const isFirst = idx === 0;
      return `
            <g class="sim-token-chip" data-token-idx="${idx}" style="cursor: pointer;">
              <rect x="${cx}" y="${boxY + 46}" width="${chipWidth}" height="34" rx="6" class="c-mask"/>
              <rect x="${cx}" y="${boxY + 46}" width="${chipWidth}" height="34" rx="6" class="${isFirst ? 'c-frontend' : 'c-external'}" stroke-width="${isFirst ? '1.5' : '1'}"/>
              <text x="${cx + chipWidth / 2}" y="${boxY + 60}" class="t-primary" font-size="8.5" font-weight="700" text-anchor="middle">${esc(itemObj.text)}</text>
              <text x="${cx + chipWidth / 2}" y="${boxY + 73}" class="t-dim" font-size="6.5" font-weight="600" text-anchor="middle">${esc(itemObj.tag || itemObj.detail || `idx: ${idx}`)}</text>
            </g>`;
    }).join('');

    tokensStripMarkup = `
          <!-- Token / Step Discrete Chips Strip -->
          <g class="sim-tokens-chips">
            ${chipsHtml}
          </g>`;
  } else {
    tokensStripMarkup = `
          <!-- Token Sequence Strip -->
          <g class="sim-tokens">
            <rect x="${CARD_X + 20}" y="${boxY + 42}" width="${CARD_WIDTH - 40}" height="42" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 20}" y="${boxY + 42}" width="${CARD_WIDTH - 40}" height="42" rx="6" class="c-external" stroke-width="0.8" stroke-dasharray="2,2"/>
            <text x="${CARD_X + 28}" y="${boxY + 58}" font-size="8.5">
              ${promptToks.map((t, idx) => `<tspan data-token-idx="${idx}" class="t-primary" font-weight="600">${esc(t)} </tspan>`).join('')}
              ${genToks.map((t, idx) => `<tspan data-token-idx="${promptToks.length + idx}" class="t-dim" data-token-state="dim">${esc(t)} </tspan>`).join('')}
            </text>
          </g>`;
  }

  // Render 3 Stat Boxes
  let statBoxesMarkup = '';
  if (Array.isArray(sec.metrics) && sec.metrics.length > 0) {
    const cardW = 186;
    const cardGap = 16;
    statBoxesMarkup = sec.metrics.slice(0, 3).map((m, idx) => {
      const bx = CARD_X + 20 + idx * (cardW + cardGap);
      const colorClass = m.color === 'cloud' ? 'c-cloud' : m.color === 'security' ? 'c-security' : m.color === 'database' ? 'c-database' : idx === 2 ? 'c-security' : 'c-external';
      const textClass = m.color === 'cloud' ? 't-cloud' : m.color === 'security' ? 't-security' : m.color === 'database' ? 't-database' : idx === 0 ? 't-frontend' : idx === 1 ? 't-cloud' : 't-security';
      return `
          <!-- Stat ${idx + 1} -->
          <g class="sim-stat-box">
            <rect x="${bx}" y="${boxY + 96}" width="${cardW}" height="64" rx="6" class="c-mask"/>
            <rect x="${bx}" y="${boxY + 96}" width="${cardW}" height="64" rx="6" class="${colorClass}" stroke-width="1"/>
            <text x="${bx + 12}" y="${boxY + 112}" class="t-dim" font-size="7" font-weight="700" letter-spacing="0.5">${esc(m.label.toUpperCase())}</text>
            <text data-sim-metric="${idx}" x="${bx + 12}" y="${boxY + 134}" class="${textClass}" font-size="14" font-weight="700">${esc(m.value)}</text>
            <text x="${bx + 12}" y="${boxY + 148}" class="t-muted" font-size="7.5">${esc(m.sublabel || '')}</text>
          </g>`;
    }).join('');
  } else if (widgetType === 'decode_kv') {
    // KV decode fallback
    statBoxesMarkup = `
          <!-- Stat 1: With Cache -->
          <g class="sim-stat-box">
            <rect x="${CARD_X + 20}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 20}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-external" stroke-width="1"/>
            <text x="${CARD_X + 30}" y="${boxY + 112}" class="t-dim" font-size="7" font-weight="700" letter-spacing="0.5">WITH CACHE — TOTAL K,V OPS</text>
            <text data-sim-with-cache="" x="${CARD_X + 30}" y="${boxY + 134}" class="t-frontend" font-size="16" font-weight="700">${promptToks.length}</text>
            <text x="${CARD_X + 56}" y="${boxY + 134}" class="t-muted" font-size="8">grows by 1 every step</text>
          </g>

          <!-- Stat 2: Without Cache -->
          <g class="sim-stat-box">
            <rect x="${CARD_X + 222}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 222}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-external" stroke-width="1"/>
            <text x="${CARD_X + 232}" y="${boxY + 112}" class="t-dim" font-size="7" font-weight="700" letter-spacing="0.5">WITHOUT CACHE — TOTAL K,V OPS</text>
            <text data-sim-without-cache="" x="${CARD_X + 232}" y="${boxY + 134}" class="t-cloud" font-size="16" font-weight="700">${promptToks.length}</text>
            <text x="${CARD_X + 258}" y="${boxY + 134}" class="t-muted" font-size="8">recomputes whole sequence</text>
          </g>

          <!-- Stat 3: Wasted Compute -->
          <g class="sim-stat-box">
            <rect x="${CARD_X + 424}" y="${boxY + 96}" width="188" height="64" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 424}" y="${boxY + 96}" width="188" height="64" rx="6" class="c-security" stroke-width="1"/>
            <text x="${CARD_X + 434}" y="${boxY + 112}" class="t-security" font-size="7" font-weight="700" letter-spacing="0.5">EXTRA COMPUTE WASTED</text>
            <text data-sim-wasted="" x="${CARD_X + 434}" y="${boxY + 134}" class="t-security" font-size="16" font-weight="700">1.0×</text>
            <text x="${CARD_X + 482}" y="${boxY + 134}" class="t-muted" font-size="8">without cache vs with</text>
          </g>`;
  } else {
    // Default generic metrics
    statBoxesMarkup = `
          <!-- Stat 1: Current Step -->
          <g class="sim-stat-box">
            <rect x="${CARD_X + 20}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 20}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-external" stroke-width="1"/>
            <text x="${CARD_X + 30}" y="${boxY + 112}" class="t-dim" font-size="7" font-weight="700" letter-spacing="0.5">CURRENT STEP</text>
            <text data-sim-pos="" x="${CARD_X + 30}" y="${boxY + 134}" class="t-frontend" font-size="16" font-weight="700">Step 1</text>
            <text x="${CARD_X + 30}" y="${boxY + 148}" class="t-muted" font-size="7.5">Initial sequence state</text>
          </g>

          <!-- Stat 2: Progress -->
          <g class="sim-stat-box">
            <rect x="${CARD_X + 222}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 222}" y="${boxY + 96}" width="186" height="64" rx="6" class="c-external" stroke-width="1"/>
            <text x="${CARD_X + 232}" y="${boxY + 112}" class="t-dim" font-size="7" font-weight="700" letter-spacing="0.5">EXECUTION STATE</text>
            <text data-sim-freq="" x="${CARD_X + 232}" y="${boxY + 134}" class="t-cloud" font-size="14" font-weight="700">Active</text>
            <text x="${CARD_X + 232}" y="${boxY + 148}" class="t-muted" font-size="7.5">1 of ${promptToks.length} stages</text>
          </g>

          <!-- Stat 3: Metric -->
          <g class="sim-stat-box">
            <rect x="${CARD_X + 424}" y="${boxY + 96}" width="188" height="64" rx="6" class="c-mask"/>
            <rect x="${CARD_X + 424}" y="${boxY + 96}" width="188" height="64" rx="6" class="c-database" stroke-width="1"/>
            <text x="${CARD_X + 434}" y="${boxY + 112}" class="t-database" font-size="7" font-weight="700" letter-spacing="0.5">SYSTEM HEALTH</text>
            <text data-sim-geom="" x="${CARD_X + 434}" y="${boxY + 134}" class="t-database" font-size="14" font-weight="700">Optimal</text>
            <text x="${CARD_X + 434}" y="${boxY + 148}" class="t-muted" font-size="7.5">No bottleneck detected</text>
          </g>`;
  }

  const footerLabel = sec.status_label || 'Simulator status';
  const footerValue = sec.status_value || `${promptToks.length} elements loaded`;
  const totalSteps = widgetType === 'decode_kv' ? (genToks.length || promptToks.length) : promptToks.length;

  return `        <!-- Interactive Stepper / Simulator -->
        <g id="section-${esc(sec.id || 'simulator')}" class="explainer-simulator" data-widget="explainer-simulator"
           data-section-kind="simulator" data-section-number="${esc(sec.number || '')}"
           data-section-title="${esc(sec.title || 'Interactive Simulator')}" data-chapter-tag="lab"
           data-widget-type="${esc(widgetType)}"
           data-prompt-tokens="${esc(JSON.stringify(promptToks))}"
           data-gen-tokens="${esc(JSON.stringify(genToks))}">
          ${numBadge}
          ${descMarkup}

          <!-- Simulator Card Frame -->
          <rect x="${CARD_X}" y="${boxY}" width="${CARD_WIDTH}" height="${boxH}" rx="10" class="c-mask"/>
          <rect x="${CARD_X}" y="${boxY}" width="${CARD_WIDTH}" height="${boxH}" rx="10" class="c-backend" stroke-width="1.5"/>

          <!-- Top Toolbar -->
          <text data-detail="fine" x="${CARD_X + 20}" y="${boxY + 24}" class="t-dim" font-size="8" font-weight="700" letter-spacing="1">${esc(widgetTitle)}</text>
          
          <!-- Controls (Reset / Play) -->
          <g class="sim-ctrl-btn" data-sim-reset="" style="cursor: pointer;">
            <rect x="${CARD_X + CARD_WIDTH - 120}" y="${boxY + 12}" width="50" height="18" rx="4" class="c-mask"/>
            <rect x="${CARD_X + CARD_WIDTH - 120}" y="${boxY + 12}" width="50" height="18" rx="4" class="c-external" stroke-width="1"/>
            <text x="${CARD_X + CARD_WIDTH - 95}" y="${boxY + 24}" class="t-muted" font-size="8" font-weight="600" text-anchor="middle">Reset</text>
          </g>
          <g class="sim-ctrl-btn" data-sim-play="" style="cursor: pointer;">
            <rect x="${CARD_X + CARD_WIDTH - 64}" y="${boxY + 12}" width="48" height="18" rx="4" class="c-mask"/>
            <rect x="${CARD_X + CARD_WIDTH - 64}" y="${boxY + 12}" width="48" height="18" rx="4" class="c-frontend" stroke-width="1"/>
            <text x="${CARD_X + CARD_WIDTH - 40}" y="${boxY + 24}" class="t-frontend" font-size="8" font-weight="600" text-anchor="middle">▶ Play</text>
          </g>

          <text data-sim-step="" x="${CARD_X + CARD_WIDTH - 130}" y="${boxY + 24}" class="t-dim" font-size="8" text-anchor="end">step 0 / ${totalSteps}</text>

          ${tokensStripMarkup}
          ${statBoxesMarkup}

          <!-- Bottom Footer Bar -->
          <text x="${CARD_X + 24}" y="${boxY + 178}" class="t-dim" font-size="8">${esc(footerLabel)}</text>
          <text data-sim-cache-tokens="" x="${CARD_X + CARD_WIDTH - 24}" y="${boxY + 178}" class="t-frontend" font-size="8" font-weight="600" text-anchor="end">${esc(footerValue)}</text>
        </g>`;
}

function renderChartBlock(sec) {
  const chartY = sec.y + 10;
  const chartW = CARD_WIDTH;
  const chartH = 190;
  const plotX = CARD_X + 50;
  const plotY = chartY + 20;
  const plotW = chartW - 70;
  const plotH = 120;

  const yLabel = sec.y_label || 'cumulative ops / metric →';
  const xLabel = sec.x_label || 'step / input size →';

  // Supported curve types: constant, logarithmic, linear, quadratic, exponential
  const curvesList = (Array.isArray(sec.curves) && sec.curves.length > 0)
    ? sec.curves
    : [
        { label: 'with cache — linear', type: 'linear', color: '#22d3ee' },
        { label: 'without cache — quadratic', type: 'quadratic', color: '#f97316' }
      ];

  const curveColors = ['#22d3ee', '#f97316', '#a78bfa', '#34d399', '#f43f5e'];

  function getPathForType(type) {
    switch (type) {
      case 'constant':
        return `M ${plotX} ${plotY + plotH - 30} L ${plotX + plotW} ${plotY + plotH - 30}`;
      case 'logarithmic':
        return `M ${plotX} ${plotY + plotH - 10} Q ${plotX + plotW * 0.25} ${plotY + 20} ${plotX + plotW} ${plotY + 15}`;
      case 'linear':
        return `M ${plotX} ${plotY + plotH - 10} L ${plotX + plotW} ${plotY + plotH - 35}`;
      case 'quadratic':
        return `M ${plotX} ${plotY + plotH - 10} Q ${plotX + plotW * 0.5} ${plotY + plotH - 15} ${plotX + plotW} ${plotY + 10}`;
      case 'exponential':
        return `M ${plotX} ${plotY + plotH - 10} Q ${plotX + plotW * 0.75} ${plotY + plotH - 15} ${plotX + plotW} ${plotY + 5}`;
      default:
        return `M ${plotX} ${plotY + plotH - 10} L ${plotX + plotW} ${plotY + 10}`;
    }
  }

  const renderedCurvesSvg = curvesList.map((c, idx) => {
    const strokeColor = c.color || curveColors[idx % curveColors.length];
    const pathD = getPathForType(c.type);
    const strokeDash = c.style === 'dashed' ? 'stroke-dasharray="4,4"' : '';
    return `<path d="${pathD}" stroke="${strokeColor}" stroke-width="2.5" ${strokeDash} fill="none"/>`;
  }).join('\n          ');

  // Dynamic Legend
  const totalCurves = curvesList.length;
  const legendGap = Math.min(180, Math.floor(plotW / totalCurves));
  const legendStartX = plotX + 10;
  const legendMarkup = curvesList.map((c, idx) => {
    const lx = legendStartX + idx * legendGap;
    const strokeColor = c.color || curveColors[idx % curveColors.length];
    return `
          <circle cx="${lx}" cy="${chartY + chartH - 12}" r="3.5" fill="${strokeColor}"/>
          <text x="${lx + 10}" y="${chartY + chartH - 9}" class="t-muted" font-size="7.5">${esc(c.label)}</text>`;
  }).join('');

  let footerMarkup = '';
  if (sec.footerLines?.length) {
    const fY = chartY + chartH + 10;
    footerMarkup = sec.footerLines.map((l, i) => `
          <text data-detail="context" x="${CARD_X}" y="${fY + i * LINE_H}" class="t-muted" font-size="8.5">${esc(l)}</text>`).join('');
  }

  return `        <!-- Complexity Chart -->
        <g id="section-${esc(sec.id || 'chart')}" class="explainer-chart" data-widget="complexity-chart"
           data-section-kind="chart" data-section-number="${esc(sec.number || '')}"
           data-section-title="${esc(sec.title || 'Complexity Curves')}" data-chapter-tag="math">
          <!-- Frame Background -->
          <rect x="${CARD_X}" y="${chartY}" width="${chartW}" height="${chartH}" rx="10" class="c-mask"/>
          <rect x="${CARD_X}" y="${chartY}" width="${chartW}" height="${chartH}" rx="10" class="c-external" stroke-width="1"/>

          <!-- Y-axis Label -->
          <text transform="rotate(-90 ${CARD_X + 18} ${plotY + plotH / 2})" x="${CARD_X + 18}" y="${plotY + plotH / 2}" class="t-dim" font-size="7.5" text-anchor="middle">${esc(yLabel)}</text>

          <!-- Grid Lines -->
          <line x1="${plotX}" y1="${plotY + plotH}" x2="${plotX + plotW}" y2="${plotY + plotH}" class="c-external" stroke-width="1"/>
          <line x1="${plotX}" y1="${plotY + plotH / 2}" x2="${plotX + plotW}" y2="${plotY + plotH / 2}" class="c-grid" stroke-width="0.8" stroke-dasharray="3,3"/>
          <line x1="${plotX}" y1="${plotY}" x2="${plotX + plotW}" y2="${plotY}" class="c-grid" stroke-width="0.8" stroke-dasharray="3,3"/>

          <!-- Curves -->
          ${renderedCurvesSvg}

          <!-- X-axis Label -->
          <text x="${plotX + plotW / 2}" y="${plotY + plotH + 18}" class="t-dim" font-size="7.5" text-anchor="middle">${esc(xLabel)}</text>

          <!-- Legend -->
          ${legendMarkup}
        </g>
        ${footerMarkup}`;
}

function renderCalculatorBlock(sec) {
  const numBadge = sec.number
    ? `<text data-detail="fine" x="${CARD_X}" y="${sec.y + 18}" class="t-frontend" font-size="11" font-weight="700">${esc(sec.number)}</text>
       <text data-node-label="" x="${CARD_X + 26}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || "Interactive Parametric Sizing")}</text>`
    : `<text data-node-label="" x="${CARD_X}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || "Interactive Parametric Sizing")}</text>`;

  let curY = sec.y + 36;
  const descMarkup = (sec.descLines || []).map((l, i) => `
          <text data-detail="context" x="${CARD_X}" y="${curY + i * LINE_H}" class="t-muted" font-size="9">${esc(l)}</text>`).join('');
  if (sec.descLines?.length) curY += sec.descLines.length * LINE_H + 12;

  let formulaMarkup = '';
  if (sec.formula) {
    formulaMarkup = `
          <rect x="${CARD_X}" y="${curY}" width="${CARD_WIDTH}" height="30" rx="6" class="c-mask"/>
          <rect x="${CARD_X}" y="${curY}" width="${CARD_WIDTH}" height="30" rx="6" class="c-database" stroke-width="1"/>
          <text data-detail="context" x="${CARD_X + 16}" y="${curY + 19}" class="t-database" font-size="9.5" font-weight="600" font-family="monospace">${esc(sec.formula)}</text>`;
    curY += 38;
  }

  const boxY = curY;
  const boxH = 215;
  const widgetTitle = sec.widget_title || 'INTERACTIVE CALCULATOR';

  // If generic inputs & outputs provided:
  if (Array.isArray(sec.inputs) || Array.isArray(sec.outputs)) {
    const inputs = sec.inputs || [
      { label: "Input Parameter A", value: "Standard Setting" },
      { label: "Scale Factor B", value: "1,024 units" }
    ];
    const outputs = sec.outputs || [
      { label: "Primary Output Metric", value: "128 MB", highlight: true },
      { label: "Secondary Constraint", value: "99.9% headroom", highlight: false }
    ];
    const summaryNote = sec.summary_note || sec.note || "Interactive sizing output based on configured parameters.";

    // Render inputs grid
    const inputRowsMarkup = inputs.slice(0, 4).map((inp, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const ix = CARD_X + 20 + col * 310;
      const iy = boxY + 48 + row * 44;
      return `
            <text x="${ix}" y="${iy}" class="t-muted" font-size="8" font-weight="600">${esc(inp.label)}</text>
            <text x="${ix + 280}" y="${iy}" class="t-primary" font-size="8.5" font-weight="700" text-anchor="end">${esc(String(inp.value))}</text>
            <line x1="${ix}" y1="${iy + 14}" x2="${ix + 280}" y2="${iy + 14}" class="c-external" stroke-width="3" stroke-linecap="round"/>
            <circle cx="${ix + 140}" cy="${iy + 14}" r="5" fill="#22d3ee" stroke="#0f172a" stroke-width="1.5"/>`;
    }).join('');

    const outputsMarkup = outputs.slice(0, 3).map((out, idx) => {
      const oy = boxY + 152 + idx * 18;
      const textClass = out.highlight ? "t-frontend" : "t-primary";
      return `
            <text x="${CARD_X + 20}" y="${oy}" class="t-muted" font-size="8">${esc(out.label)}</text>
            <text x="${CARD_X + CARD_WIDTH - 20}" y="${oy}" class="${textClass}" font-size="9" font-weight="700" text-anchor="end">${esc(String(out.value))}${out.unit ? ' ' + esc(out.unit) : ''}</text>`;
    }).join('');

    return `        <!-- Generic Interactive Calculator -->
        <g id="section-${esc(sec.id || 'calculator')}" class="explainer-calculator" data-widget="cache-calculator"
           data-section-kind="calculator" data-section-number="${esc(sec.number || '')}"
           data-section-title="${esc(sec.title || 'Interactive Calculator')}" data-chapter-tag="math"
           data-inputs="${esc(JSON.stringify(inputs))}"
           data-outputs="${esc(JSON.stringify(outputs))}">
          ${numBadge}
          ${descMarkup}
          ${formulaMarkup}

          <!-- Calculator Frame -->
          <rect x="${CARD_X}" y="${boxY}" width="${CARD_WIDTH}" height="${boxH}" rx="10" class="c-mask"/>
          <rect x="${CARD_X}" y="${boxY}" width="${CARD_WIDTH}" height="${boxH}" rx="10" class="c-database" stroke-width="1.5"/>

          <text data-detail="fine" x="${CARD_X + 20}" y="${boxY + 24}" class="t-dim" font-size="8" font-weight="700" letter-spacing="1">${esc(widgetTitle)}</text>

          <!-- Input Controls -->
          <g class="calc-inputs">
            ${inputRowsMarkup}
          </g>

          <!-- Outputs Strip -->
          <g class="calc-results">
            <line x1="${CARD_X + 20}" y1="${boxY + 136}" x2="${CARD_X + CARD_WIDTH - 20}" y2="${boxY + 136}" class="c-grid" stroke-width="0.8"/>
            ${outputsMarkup}
            <text data-calc-ratio-res="" x="${CARD_X + 20}" y="${boxY + 202}" class="t-dim" font-size="7.5">${esc(summaryNote)}</text>
          </g>
        </g>`;
  }

  // Legacy fallback for KV Cache model_options
  const models = sec.model_options || [
    { name: '7B — 32 layers, 32 heads', layers: 32, heads: 32, head_dim: 128, weights_gb: 13.0 }
  ];

  return `        <!-- Interactive Cache Memory Calculator -->
        <g id="section-${esc(sec.id || 'calculator')}" class="explainer-calculator" data-widget="cache-calculator"
           data-section-kind="calculator" data-section-number="${esc(sec.number || '')}"
           data-section-title="${esc(sec.title || 'Cache Memory Calculator')}" data-chapter-tag="math"
           data-models="${esc(JSON.stringify(models))}">
          ${numBadge}
          ${descMarkup}
          ${formulaMarkup}

          <!-- Calculator Frame -->
          <rect x="${CARD_X}" y="${boxY}" width="${CARD_WIDTH}" height="${boxH}" rx="10" class="c-mask"/>
          <rect x="${CARD_X}" y="${boxY}" width="${CARD_WIDTH}" height="${boxH}" rx="10" class="c-database" stroke-width="1.5"/>

          <text data-detail="fine" x="${CARD_X + 20}" y="${boxY + 24}" class="t-dim" font-size="8" font-weight="700" letter-spacing="1">CACHE MEMORY CALCULATOR</text>

          <!-- Input Rows: Model Size & Context Length -->
          <!-- Row 1: Model Size -->
          <text x="${CARD_X + 20}" y="${boxY + 52}" class="t-muted" font-size="8" font-weight="600">Model size</text>
          <g class="calc-select-box">
            <rect x="${CARD_X + 20}" y="${boxY + 60}" width="280" height="24" rx="4" class="c-mask"/>
            <rect x="${CARD_X + 20}" y="${boxY + 60}" width="280" height="24" rx="4" class="c-external" stroke-width="1"/>
            <text x="${CARD_X + 30}" y="${boxY + 76}" class="t-primary" font-size="8.5">${esc(models[0].name)}</text>
          </g>

          <!-- Row 1 Right: Context Length -->
          <text x="${CARD_X + 330}" y="${boxY + 52}" class="t-muted" font-size="8" font-weight="600">Context length</text>
          <text data-calc-context-val="" x="${CARD_X + CARD_WIDTH - 20}" y="${boxY + 52}" class="t-primary" font-size="8.5" font-weight="700" text-anchor="end">4,096</text>
          <line x1="${CARD_X + 330}" y1="${boxY + 72}" x2="${CARD_X + CARD_WIDTH - 20}" y2="${boxY + 72}" class="c-external" stroke-width="4" stroke-linecap="round"/>
          <circle cx="${CARD_X + 430}" cy="${boxY + 72}" r="6" fill="#22d3ee" stroke="#0f172a" stroke-width="1.5"/>

          <!-- Row 2: Batch Size & KV Heads -->
          <text x="${CARD_X + 20}" y="${boxY + 104}" class="t-muted" font-size="8" font-weight="600">Batch size</text>
          <text data-calc-batch-val="" x="${CARD_X + 300}" y="${boxY + 104}" class="t-primary" font-size="8.5" font-weight="700" text-anchor="end">1</text>
          <line x1="${CARD_X + 20}" y1="${boxY + 120}" x2="${CARD_X + 300}" y2="${boxY + 120}" class="c-external" stroke-width="4" stroke-linecap="round"/>
          <circle cx="${CARD_X + 40}" cy="${boxY + 120}" r="6" fill="#a78bfa" stroke="#0f172a" stroke-width="1.5"/>

          <text x="${CARD_X + 330}" y="${boxY + 104}" class="t-muted" font-size="8" font-weight="600">KV heads</text>
          <text data-calc-heads-val="" x="${CARD_X + CARD_WIDTH - 20}" y="${boxY + 104}" class="t-primary" font-size="8.5" font-weight="700" text-anchor="end">32 / 32</text>
          <line x1="${CARD_X + 330}" y1="${boxY + 120}" x2="${CARD_X + CARD_WIDTH - 20}" y2="${boxY + 120}" class="c-external" stroke-width="4" stroke-linecap="round"/>
          <circle cx="${CARD_X + CARD_WIDTH - 26}" cy="${boxY + 120}" r="6" fill="#a78bfa" stroke="#0f172a" stroke-width="1.5"/>

          <!-- Memory Ratio Output Strip -->
          <g class="calc-results">
            <line x1="${CARD_X + 20}" y1="${boxY + 144}" x2="${CARD_X + CARD_WIDTH - 20}" y2="${boxY + 144}" class="c-grid" stroke-width="0.8"/>
            
            <text x="${CARD_X + 20}" y="${boxY + 164}" class="t-muted" font-size="8">KV cache</text>
            <text data-calc-kv-res="" x="${CARD_X + CARD_WIDTH - 20}" y="${boxY + 164}" class="t-frontend" font-size="9" font-weight="700" text-anchor="end">2.15 GB</text>

            <text x="${CARD_X + 20}" y="${boxY + 182}" class="t-muted" font-size="8">Model weights</text>
            <text data-calc-weight-res="" x="${CARD_X + CARD_WIDTH - 20}" y="${boxY + 182}" class="t-primary" font-size="9" font-weight="700" text-anchor="end">13.0 GB</text>

            <text data-calc-ratio-res="" x="${CARD_X + 20}" y="${boxY + 202}" class="t-dim" font-size="7.5">The cache is 17% of the model weights' size at this setting.</text>
          </g>
        </g>`;
}

function renderGridCardsBlock(sec) {
  const numBadge = sec.number
    ? `<text data-detail="fine" x="${CARD_X}" y="${sec.y + 18}" class="t-frontend" font-size="11" font-weight="700">${esc(sec.number)}</text>
       <text data-node-label="" x="${CARD_X + 26}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || 'How systems push back')}</text>`
    : `<text data-node-label="" x="${CARD_X}" y="${sec.y + 18}" class="t-primary" font-size="14" font-weight="700">${esc(sec.title || 'How systems push back')}</text>`;

  let curY = sec.y + 36;
  const descMarkup = (sec.descLines || []).map((l, i) => `
          <text data-detail="context" x="${CARD_X}" y="${curY + i * LINE_H}" class="t-muted" font-size="9">${esc(l)}</text>`).join('');
  if (sec.descLines?.length) curY += sec.descLines.length * LINE_H + 12;

  const cols = sec.cols || 3;
  const colW = sec.colWidth || 198;
  const cardGap = 14;
  const maxCardH = sec.maxCardH || 120;

  const cardsMarkup = (sec.measuredCards || []).map((card, idx) => {
    const cX = CARD_X + (idx % cols) * (colW + cardGap);
    const cY = curY + Math.floor(idx / cols) * (maxCardH + cardGap);
    const eyebrow = card.eyebrow
      ? `<text data-detail="fine" x="${cX + 14}" y="${cY + 18}" class="t-dim" font-size="6.5" font-weight="700" letter-spacing="0.6">${esc(card.eyebrow.toUpperCase())}</text>`
      : '';
    const titleY = card.eyebrow ? cY + 34 : cY + 22;
    const bodyStartY = titleY + 16;
    const descLines = (card.cLines || []).map((l, i) => `
          <text data-detail="context" x="${cX + 14}" y="${bodyStartY + i * 13}" class="t-muted" font-size="7.5">${esc(l)}</text>`).join('');

    return `
          <!-- Card ${idx + 1} -->
          <rect x="${cX}" y="${cY}" width="${colW}" height="${maxCardH}" rx="8" class="c-mask"/>
          <rect x="${cX}" y="${cY}" width="${colW}" height="${maxCardH}" rx="8" class="c-external" stroke-width="1"/>
          ${eyebrow}
          <text x="${cX + 14}" y="${titleY}" class="t-primary" font-size="9" font-weight="700">${esc(card.title)}</text>
          ${descLines}`;
  }).join('');

  const rawSecId = sec.id || 'comparison';
  return `        <!-- Comparison Grid Section -->
        <g id="section-grid-${esc(rawSecId)}" class="explainer-grid-cards" data-section-kind="grid_cards"
           data-section-number="${esc(sec.number || '')}" data-section-title="${esc(sec.title || 'Comparative Matrix')}" data-chapter-tag="concept">
          ${numBadge}
          ${descMarkup}
          ${cardsMarkup}
        </g>`;
}

const LEGEND_CATALOG = [
  'start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external',
].map((kind) => ({ kind, label: i18nText(explainer.meta.locale, `legend.explainer-steps.${kind}`) }));

function renderLegend() {
  if (hasSections) return ''; // Modular explainers use inline section keys
  const presentKinds = new Set([...steps.values()].map((step) => step.type));
  const entries = resolveLegend(explainer.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: explainer.meta.locale,
    layout: {
      x: 40,
      baselineY: viewBox[1] - 36,
      width: viewBox[0] - 80,
      minTitleY: cursorY - CARD_GAP + 8,
      unfit: explainer.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'explainer-steps',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${typeClass[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  if (hasSections) {
    const renderedSections = measuredSections.map((sec) => {
      if (sec.kind === 'tldr') return renderTldrBlock(sec);
      if (sec.kind === 'narrative') return renderNarrativeBlock(sec);
      if (sec.kind === 'simulator') return renderSimulatorBlock(sec);
      if (sec.kind === 'chart') return renderChartBlock(sec);
      if (sec.kind === 'calculator') return renderCalculatorBlock(sec);
      if (sec.kind === 'grid_cards') return renderGridCardsBlock(sec);
      if (sec.kind === 'steps') {
        const ordered = asArray(sec.items).map((item) => steps.get(item.id));
        return ordered.map((step, idx) => renderStep(step, idx, ordered.length)).join('\n\n');
      }
      return '';
    }).join('\n\n');

    return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(explainer.meta, 'explorable visual explainer')}>
${svgAccessibleText(explainer.meta, 'explainer-steps')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Topic Tags Header -->
${renderTopicTagsHeader()}

        <!-- Modular Explorable Sections -->
${renderedSections}
      </svg>`;
  }

  const orderedSteps = asArray(explainer.steps).map((step) => steps.get(step.id));
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(explainer.meta, 'explainer steps diagram')}>
${svgAccessibleText(explainer.meta, 'explainer-steps')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Steps -->
${orderedSteps.map((step, index) => renderStep(step, index, orderedSteps.length)).join('\n\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateExplainerSteps();
writeDiagram({
  outPath,
  template,
  diagramType: 'explainer-steps',
  meta: explainer.meta,
  svg: renderSvg(),
  cards: explainer.cards,
});

