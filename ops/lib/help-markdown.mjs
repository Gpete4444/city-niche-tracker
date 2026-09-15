/**
 * Split docs/USER-GUIDE.md into searchable sections for the Help panel.
 * No extra npm dependency. Supports headings, {#id}, lists, tables, bold, code, links, fenced code.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const USER_GUIDE_PATH = path.join(ROOT, 'docs', 'USER-GUIDE.md');

function slugify(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\{#[^}]+\}/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseHeading(line) {
  const m = String(line || '').match(/^(#{1,3})\s+(.+?)\s*$/);
  if (!m) return null;
  const level = m[1].length;
  let title = m[2].trim();
  let id = '';
  const idMatch = title.match(/\{#([a-z0-9-]+)\}\s*$/i);
  if (idMatch) {
    id = idMatch[1];
    title = title.replace(/\s*\{#[a-z0-9-]+\}\s*$/i, '').trim();
  }
  if (!id) id = slugify(title);
  return { level, title, id };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = String(href).replace(/"/g, '');
    const internal = safeHref.endsWith('.md') || safeHref.startsWith('#');
    if (internal && !safeHref.startsWith('http')) {
      return `<strong>${label}</strong>`;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function flushList(lines, html) {
  if (!lines.length) return;
  const ordered = /^\d+\.\s/.test(lines[0]);
  const tag = ordered ? 'ol' : 'ul';
  html.push(`<${tag}>`);
  for (const line of lines) {
    const item = ordered ? line.replace(/^\d+\.\s+/, '') : line.replace(/^[-*]\s+/, '');
    html.push(`<li>${inline(item)}</li>`);
  }
  html.push(`</${tag}>`);
  lines.length = 0;
}

function flushTable(rows, html) {
  if (rows.length < 2) {
    rows.length = 0;
    return;
  }
  const split = (row) =>
    row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = split(rows[0]);
  const body = rows.slice(2).map(split);
  html.push('<table class="help-table"><thead><tr>');
  for (const cell of header) html.push(`<th>${inline(cell)}</th>`);
  html.push('</tr></thead><tbody>');
  for (const row of body) {
    html.push('<tr>');
    for (let i = 0; i < header.length; i += 1) html.push(`<td>${inline(row[i] || '')}</td>`);
    html.push('</tr>');
  }
  html.push('</tbody></table>');
  rows.length = 0;
}

function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const list = [];
  const table = [];
  const para = [];
  let fence = null;

  const flushPara = () => {
    if (!para.length) return;
    html.push(`<p>${inline(para.join(' '))}</p>`);
    para.length = 0;
  };

  const flushFence = () => {
    if (!fence) return;
    html.push(`<pre class="help-pre"><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
    fence = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith('```')) {
        flushFence();
        continue;
      }
      fence.push(raw);
      continue;
    }
    if (trimmed.startsWith('```')) {
      flushList(list, html);
      flushTable(table, html);
      flushPara();
      fence = [];
      continue;
    }
    if (!trimmed) {
      flushList(list, html);
      flushTable(table, html);
      flushPara();
      continue;
    }
    if (/^\|/.test(trimmed)) {
      flushList(list, html);
      flushPara();
      table.push(trimmed);
      continue;
    }
    if (table.length) flushTable(table, html);
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      flushPara();
      list.push(trimmed);
      continue;
    }
    if (list.length) flushList(list, html);
    para.push(trimmed);
  }
  flushList(list, html);
  flushTable(table, html);
  flushPara();
  flushFence();
  return html.join('\n');
}

function stripHeadingMarkup(title) {
  return String(title || '').replace(/\s*\{#[a-z0-9-]+\}\s*$/i, '').trim();
}

/**
 * @param {string} [filePath]
 * @returns {{ title: string, sections: Array<{ id: string, title: string, level: number, html: string, text: string }> }}
 */
export function parseUserGuide(filePath = USER_GUIDE_PATH) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let title = 'Rover User Guide';
  /** @type {Array<{ id: string, title: string, level: number, body: string[] }>} */
  const buckets = [];
  let current = null;

  const pushCurrent = () => {
    if (current) buckets.push(current);
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      if (heading.level === 1) {
        title = heading.title;
        continue;
      }
      pushCurrent();
      current = { id: heading.id, title: heading.title, level: heading.level, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  pushCurrent();

  const sections = buckets.map((b) => {
    const md = b.body.join('\n').trim();
    const html = mdToHtml(md);
    const text = `${b.title}\n${md}`.replace(/\s+/g, ' ').trim();
    return {
      id: b.id,
      title: stripHeadingMarkup(b.title),
      level: b.level,
      html,
      text,
    };
  });

  return { title, sections };
}

export function getUserGuidePayload() {
  return parseUserGuide();
}
