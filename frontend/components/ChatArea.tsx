import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAppContext } from '../context/AppContext';
import { generateLegalResponse, distillCaseLearning, cleanChatReply, isUserAbortError, userAskedForSummary, analysisUploadPrompt, ANALYSIS_ACTIONS, warmBackend } from '../services/geminiService';
import { buildLearnedStylePrompt, loadCommunityStyles, rememberUserStyle } from '../services/styleLearningService';
import { prepareFilesForAi, uploadPreparedAttachments, validateUploadFile } from '../services/chatMediaService';
import { Attachment } from '../types';
import { PaperclipIcon, TemplateIcon, SendIcon, SparklesIcon, XIcon, UserIcon, MenuIcon, MicIcon, DocxIcon, PdfIcon, EditIcon, SearchIcon, PlusIcon, CopyIcon, ShareIcon, StopIcon, CheckIcon } from './Icons';
import { BrandLogo } from './BrandLogo';
import { Message } from '../types';
import { translations } from '../utils/translations';
import { PREDEFINED_TEMPLATES } from '../utils/templates';
import { JUDGEMENT_TEMPLATES, JUDGEMENT_TEMPLATE_OPTIONS } from '../utils/judgementTemplates';
import { ADVOCATE_CATALOGUE_OPTIONS, catalogueTemplateContent } from '../utils/advocateCatalogue';
import { templateLabel } from '../utils/templateLabels';
import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { saveBlobFile, sharePlainText } from '../utils/nativeDownload';
import { saveFilledTemplate, getFilledTemplate, plainForCompare } from '../utils/filledTemplateStore';
import { saveScanDraft, getScanDraft, getProfile } from '../utils/scanProfileStore';
import { ScanTemplateCheck } from './ScanTemplateCheck';
import { Capacitor } from '@capacitor/core';
import { getPlanLimits, validateChatCharacterLimits, hasUnlimitedAccess, validatePhotoLimit, countCasePhotos, nextIstMidnightLabel, getSessionCharCount, chatLimitProximity } from '../utils/planLimits';
import { IncreaseChatLimitModal } from './IncreaseChatLimitModal';
import { validateChatLimits } from '../services/entitlementsService';
import { pickMultipleNativeFiles, isNativeApp } from '../utils/pickFiles';
import { registerDocumentEditorCloser } from '../utils/nativeNavigation';
import { chatDayKey, chatStartedAt, formatChatDay, formatChatTime, parseClientFromEvidence } from '../utils/chatLabel';
import { languageLocale } from '../utils/languages';
import { beginBackgroundWork, endBackgroundWork } from '../services/backgroundWork';
import { isAndroidSpeechPlatform, nativeSpeechAvailable, startNativeSpeech, stopNativeSpeech } from '../services/speechListen';
import { FreeUsageStrip } from './UsageMeter';

// Helper to escape HTML to prevent XSS before parsing custom tags
const escapeHTML = (str: string) => str.replace(/[&<>'"]/g, 
  tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
);

// Helper to convert custom tags to HTML for UI and PDF
const parseFormattingToHTML = (text: string) => {
  let safeText = escapeHTML(text);
  
  // Pre-process [ROW] — 2 cells = left|right, 3 cells = left|center|right
  safeText = safeText.replace(/\[ROW\]([\s\S]*?)\[\/ROW\]/gi, (match, content) => {
    const parts = content.split('|').map((p: string) => p.trim().replace(/\n/g, '<br>'));
    
    const formatPart = (str: string) => str
      .replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>');

    if (parts.length >= 3) {
      return `__ROW_START__<div data-line-split="3" style="display:flex;align-items:flex-start;width:100%;margin:0;page-break-inside:avoid;"><div data-split-cell="left" style="flex:1;text-align:left;white-space:pre-wrap;min-width:0;">${formatPart(parts[0]) || '&nbsp;'}</div><div data-split-cell="center" style="flex:1;text-align:center;white-space:pre-wrap;min-width:0;">${formatPart(parts[1]) || '&nbsp;'}</div><div data-split-cell="right" style="flex:1;text-align:right;white-space:pre-wrap;min-width:0;">${formatPart(parts.slice(2).join(' | ')) || '&nbsp;'}</div></div>__ROW_END__`;
    }

    const left = formatPart(parts[0] || '');
    const right = formatPart(parts[1] || '');
    return `__ROW_START__<div data-line-split="2" style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;margin:0;page-break-inside:avoid;"><div data-split-cell="left" style="flex:1;text-align:left;white-space:pre-wrap;min-width:0;">${left || '&nbsp;'}</div><div data-split-cell="right" style="flex:1;text-align:right;white-space:pre-wrap;min-width:0;">${right || '&nbsp;'}</div></div>__ROW_END__`;
  });

  const lines = safeText.split('\n');
  
  const htmlLines = lines.map((line, i) => {
    if (line.includes('__ROW_START__')) {
      return line.replace('__ROW_START__', '').replace('__ROW_END__', '');
    }

    const prev = lines[i - 1] || '';
    const next = lines[i + 1] || '';
    if (!line.trim() && (prev.includes('__ROW_START__') || next.includes('__ROW_START__'))) {
      return '';
    }

    if (!line.trim()) return '<p style="margin: 0; min-height: 1.5em;">&nbsp;</p>';
    
    let align = 'justify';
    let currentLine = line;
    
    if (currentLine.toUpperCase().includes('[CENTER]')) {
      align = 'center';
      currentLine = currentLine.replace(/\[\/?CENTER\]/gi, '');
    } else if (currentLine.toUpperCase().includes('[RIGHT]')) {
      align = 'right';
      currentLine = currentLine.replace(/\[\/?RIGHT\]/gi, '');
    } else if (currentLine.toUpperCase().includes('[JUSTIFY]')) {
      align = 'justify';
      currentLine = currentLine.replace(/\[\/?JUSTIFY\]/gi, '');
    } else if (currentLine.toUpperCase().includes('[LEFT]')) {
      align = 'left';
      currentLine = currentLine.replace(/\[\/?LEFT\]/gi, '');
    }
    
    currentLine = currentLine
      .replace(/\[U\]([\s\S]*?)\[\/U\]/gi, '<u>$1</u>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/\[\/?(?:ROW|CENTER|RIGHT|LEFT|JUSTIFY|U|B|I|LOGO)\]/gi, '')
      .replace(/\[LOGO:\d+\]/gi, '');

    if (/^\s*(?:-{3,}|_{3,}|\*{3,}|—{2,})\s*$/.test(currentLine)) {
      return '<p style="margin: 0; min-height: 0.6em;">&nbsp;</p>';
    }
      
    return `<p align="${align}" style="text-align: ${align}; margin: 0; width: 100%; min-height: 1.5em; white-space: pre-wrap;">${currentLine}</p>`;
  });
  
  return htmlLines.join('');
};

// Helper to convert HTML back to custom tags after editing
const htmlToCustomTags = (html: string) => {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  const processNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').replace(/\u200b/g, '');
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();

      if (tag === 'DIV' && el.hasAttribute('data-line-split')) {
        const cells = Array.from(el.children) as HTMLElement[];
        const texts = cells.map((c) =>
          Array.from(c.childNodes)
            .map(processNode)
            .join('')
            .replace(/\u200b/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        );
        const extrasEmpty = texts.slice(1).every((t) => !t);
        if (extrasEmpty) return `\n${texts[0] || ''}`;
        if (texts.length >= 3) {
          return `\n[ROW]${texts[0] || ''} | ${texts[1] || ''} | ${texts.slice(2).join(' ')}[/ROW]`;
        }
        if (texts.length >= 2) {
          return `\n[ROW]${texts[0] || ''} | ${texts[1] || ''}[/ROW]`;
        }
      }

      let inner = Array.from(el.childNodes).map(processNode).join('');
      if (!inner.replace(/\u200b/g, '').trim() && tag !== 'BR' && tag !== 'IMG') {
        inner = (el.textContent || '').replace(/\u200b/g, '');
      }
      
      if (tag === 'B' || tag === 'STRONG') return inner ? `**${inner}**` : '';
      if (tag === 'I' || tag === 'EM') return inner ? `*${inner}*` : '';
      if (tag === 'U') return inner ? `[U]${inner}[/U]` : '';
      if (tag === 'LI') return inner.trim();
      if (tag === 'UL') {
        return `\n${Array.from(el.children).map((li) => `• ${processNode(li).trim()}`).join('\n')}\n`;
      }
      if (tag === 'OL') {
        return `\n${Array.from(el.children).map((li, i) => `${i + 1}. ${processNode(li).trim()}`).join('\n')}\n`;
      }
      if (tag === 'BLOCKQUOTE') return inner;
      
      if (tag === 'DIV' || tag === 'P') {
        const hasBlockKids = Array.from(el.children).some((c) =>
          /^(P|DIV|LI|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|TABLE|UL|OL)$/.test((c as HTMLElement).tagName)
        );
        if (hasBlockKids && tag === 'DIV') {
          return inner.startsWith('\n') ? inner : `\n${inner}`;
        }
        const align = ((el.style.textAlign || el.getAttribute('align') || '').toLowerCase());
        const prefix = '\n';
        const collapsed = inner.replace(/\u00a0/g, ' ').replace(/\n+/g, ' ').replace(/[ \t]+/g, ' ').trim();
        if (!collapsed) return '\n';
        const oneLine = inner
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]*\n+[ \t]*/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();

        if (align === 'center') return `${prefix}[CENTER]${oneLine}[/CENTER]`;
        if (align === 'right') return `${prefix}[RIGHT]${oneLine}[/RIGHT]`;
        if (align === 'left') return `${prefix}[LEFT]${oneLine}[/LEFT]`;
        return `${prefix}${oneLine}`;
      }
      if (tag === 'BR') return '\n';
      
      if (tag === 'SPAN') {
        if (el.style.fontWeight === 'bold' || el.style.fontWeight === '700') inner = inner ? `**${inner}**` : '';
        if (el.style.fontStyle === 'italic') inner = inner ? `*${inner}*` : '';
        if (el.style.textDecoration === 'underline') inner = inner ? `[U]${inner}[/U]` : '';
        return inner;
      }
      
      return inner;
    }
    return '';
  };

  let result = Array.from(temp.childNodes).map(processNode).join('');
  result = result
    .replace(/\n{0,2}(\[ROW\])/gi, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return result;
};

const editorPlain = (s: string) =>
  s.replace(/\[\/?(?:CENTER|RIGHT|LEFT|JUSTIFY|ROW|U)\]/gi, '')
    .replace(/\*+/g, '')
    .replace(/\u200b/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '');

const editorSignature = (s: string) =>
  s.replace(/\u200b/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\[\/?JUSTIFY\]/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const editorTagScore = (s: string) =>
  (s.match(/\[CENTER\]/gi) || []).length
  + (s.match(/\[RIGHT\]/gi) || []).length
  + (s.match(/\[LEFT\]/gi) || []).length
  + (s.match(/\[ROW\]/gi) || []).length
  + (s.match(/\[U\]/gi) || []).length
  + Math.floor((s.match(/\*\*/g) || []).length / 2);

const sameEditorText = (a: string, b: string) => editorSignature(a) === editorSignature(b);

const pickSavedEditorText = (captured: string, original: string, lastGood: string) => {
  const cap = (captured || '').replace(/\u200b/g, '').trim();
  const orig = (original || '').replace(/\u200b/g, '').trim();
  const good = (lastGood || orig).replace(/\u200b/g, '').trim();
  if (!cap) return good || orig;
  if (sameEditorText(cap, orig)) return orig;
  if (!taggedLooksComplete(cap, cap)) return good || orig;
  if (editorPlain(cap) === editorPlain(orig) && editorTagScore(cap) < editorTagScore(orig)) {
    return orig;
  }
  return cap;
};

const PAGE_GUTTER_PX = 24;
const CONTINUED_BAND_PX = 32;
const PAGE_SAFETY_PX = 6;
const MARGIN_OPTIONS = ['0.5in', '0.75in', '1in', '1.25in', '1.5in', '1.75in', '2in', '2.25in', '2.5in'];
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 20) / 20));
const inchToPx = (value: string) => (parseFloat(value) || 1) * 96;
const inchToTwips = (value: string) => Math.round((parseFloat(value) || 1) * 1440);

const stripContinuedHtml = (html: string) =>
  html
    .replace(/<p[^>]*data-page-continued[\s\S]*?<\/p>/gi, '')
    .replace(/<p[^>]*data-page-mark[\s\S]*?<\/p>/gi, '')
    .replace(/<p[^>]*>\s*शेष\s*\/\/\d+\/\/\s*पर\s*<\/p>/gi, '')
    .replace(/<p[^>]*>\s*\/\/\d+\/\/\s*<\/p>/gi, '');

const takeContinuedFromPages = (pages: string[]) => {
  const continued: number[] = [];
  const cleaned = pages.map((html, i) => {
    let next = html;
    if (/शेष\s*\/\/\d+\/\/\s*पर/.test(next)) {
      continued.push(i);
      next = next.replace(/<p[^>]*>\s*शेष\s*\/\/\d+\/\/\s*पर\s*<\/p>/gi, '');
    }
    if (i > 0 && /^\s*(<p[^>]*>\s*)?\/\/\d+\/\//.test(next)) {
      if (!continued.includes(i - 1)) continued.push(i - 1);
      next = next.replace(/<p[^>]*>\s*\/\/\d+\/\/\s*<\/p>/i, '');
    }
    return stripContinuedHtml(next);
  });
  return { pages: cleaned, continued };
};

const continuedBandPx = (fontSize: string) => {
  const pt = parseFloat(fontSize) || 12;
  const px = pt * (96 / 72);
  return Math.max(CONTINUED_BAND_PX, Math.ceil(px * 1.5) + 10);
};

const pageLimitPx = (
  pageIndex: number,
  contentHeightPx: number,
  continued: number[],
  bandPx = CONTINUED_BAND_PX
) => {
  let h = Math.max(80, contentHeightPx - PAGE_SAFETY_PX);
  if (continued.includes(pageIndex - 1)) h -= bandPx;
  if (continued.includes(pageIndex)) h -= bandPx;
  return Math.max(64, h);
};

const DEVANAGARI_MARK = /[\u0900-\u0903\u093A-\u094F\u0951-\u0957\u0962-\u0963\u0300-\u036f]/;
const isDigitChar = (ch: string) => /[0-9\u0966-\u096F]/.test(ch);

const graphemeEndAtOrBefore = (s: string, i: number) => {
  const max = Math.max(0, Math.min(s.length, i));
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let end = 0;
    for (const part of new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(s)) {
      const next = part.index + part.segment.length;
      if (next > max) return end;
      end = next;
    }
    return end;
  }
  let j = max;
  while (j > 0 && DEVANAGARI_MARK.test(s[j])) j -= 1;
  if (j > 0 && /[\uDC00-\uDFFF]/.test(s[j]) && /[\uD800-\uDBFF]/.test(s[j - 1])) j -= 1;
  return j;
};

/** Never cut inside a Hindi akshara, a number, or a short token. */
const findSafeCut = (s: string, best: number) => {
  let cut = graphemeEndAtOrBefore(s, best);
  if (cut <= 0) return 0;
  if (cut >= s.length) return s.length;
  while (cut > 0 && isDigitChar(s[cut - 1] || '') && isDigitChar(s[cut] || '')) {
    cut = graphemeEndAtOrBefore(s, cut - 1);
  }
  const brk = Math.max(
    s.lastIndexOf(' ', cut),
    s.lastIndexOf('\n', cut),
    s.lastIndexOf('\u00a0', cut),
    s.lastIndexOf('।', cut),
    s.lastIndexOf('॥', cut)
  );
  if (brk > 0) {
    return s[brk] === '।' || s[brk] === '॥' ? brk + 1 : brk;
  }
  const token = (s.slice(0, cut).split(/\s+/).pop() || '');
  const tokenMarks =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(token)].length
      : token.length;
  if (s.length < 24 || tokenMarks < 16) return 0;
  return cut;
};

const splitBlockToFit = (
  el: HTMLElement,
  maxH: number,
  host: HTMLElement,
  depth = 0
): { head: string; tail: HTMLElement | null } => {
  const h = el.offsetHeight || 0;
  if (h <= maxH) return { head: el.outerHTML, tail: null };
  if (maxH < 22) return { head: '', tail: el };
  if (el.hasAttribute('data-line-split')) return { head: '', tail: el };

  const kids = Array.from(el.children) as HTMLElement[];
  if (depth < 4 && kids.length > 1) {
    const probe = el.cloneNode(false) as HTMLElement;
    host.appendChild(probe);
    let take = 0;
    for (let i = 0; i < kids.length; i++) {
      probe.appendChild(kids[i].cloneNode(true));
      if ((probe.offsetHeight || 0) > maxH) break;
      take = i + 1;
    }
    host.removeChild(probe);
    if (take > 0 && take < kids.length) {
      const headEl = el.cloneNode(false) as HTMLElement;
      kids.slice(0, take).forEach((k) => headEl.appendChild(k.cloneNode(true)));
      const tailEl = el.cloneNode(false) as HTMLElement;
      kids.slice(take).forEach((k) => tailEl.appendChild(k.cloneNode(true)));
      return { head: headEl.outerHTML, tail: tailEl };
    }
    if (take === 0) {
      const split = splitBlockToFit(kids[0], maxH, host, depth + 1);
      const headEl = el.cloneNode(false) as HTMLElement;
      if (split.head) {
        const wrap = document.createElement('div');
        wrap.innerHTML = split.head;
        Array.from(wrap.childNodes).forEach((n) => headEl.appendChild(n));
      }
      const tailEl = el.cloneNode(false) as HTMLElement;
      if (split.tail) tailEl.appendChild(split.tail.cloneNode(true));
      kids.slice(1).forEach((k) => tailEl.appendChild(k.cloneNode(true)));
      return {
        head: headEl.childNodes.length ? headEl.outerHTML : '',
        tail: tailEl.childNodes.length ? tailEl : null,
      };
    }
  }

  const brParts = el.innerHTML.split(/<br\s*\/?>/i);
  if (brParts.length > 1) {
    const probe = el.cloneNode(false) as HTMLElement;
    host.appendChild(probe);
    let take = 0;
    for (let i = 0; i < brParts.length; i++) {
      probe.innerHTML = brParts.slice(0, i + 1).join('<br>');
      if ((probe.offsetHeight || 0) > maxH) break;
      take = i + 1;
    }
    host.removeChild(probe);
    if (take > 0 && take < brParts.length) {
      const headEl = el.cloneNode(false) as HTMLElement;
      headEl.innerHTML = brParts.slice(0, take).join('<br>');
      const tailEl = el.cloneNode(false) as HTMLElement;
      tailEl.innerHTML = brParts.slice(take).join('<br>');
      return { head: headEl.outerHTML, tail: tailEl };
    }
  }

  const text = (el.textContent || '').replace(/\u200b/g, '').normalize('NFC');
  if (text.length < 2) return { head: el.outerHTML, tail: null };

  const probe = el.cloneNode(false) as HTMLElement;
  host.appendChild(probe);
  let lo = 1;
  let hi = text.length;
  let best = 0;
  while (lo <= hi) {
    let mid = graphemeEndAtOrBefore(text, (lo + hi) >> 1);
    if (mid < lo) mid = lo;
    if (mid > hi) break;
    probe.textContent = text.slice(0, mid);
    if ((probe.offsetHeight || 0) <= maxH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  host.removeChild(probe);

  const cut = findSafeCut(text, best);
  if (cut < 1 || cut >= text.length) return { head: '', tail: el };

  const headEl = el.cloneNode(false) as HTMLElement;
  headEl.textContent = text.slice(0, cut).replace(/\s+$/, '').normalize('NFC');
  const tailEl = el.cloneNode(false) as HTMLElement;
  tailEl.textContent = text.slice(cut).replace(/^\s+/, '').normalize('NFC');
  if (!headEl.textContent || !tailEl.textContent) return { head: '', tail: el };
  return { head: headEl.outerHTML, tail: tailEl };
};

const paginateDocumentHtml = (
  html: string,
  widthPx: number,
  contentHeightPx: number,
  fontSize: string,
  continued: number[] = []
): string[] => {
  if (typeof document === 'undefined') return [html || ''];
  const measure = document.createElement('div');
  measure.setAttribute('aria-hidden', 'true');
  measure.style.cssText = [
    'position:absolute',
    'left:-12000px',
    'top:0',
    `width:${Math.max(80, widthPx)}px`,
    "font-family:'Times New Roman','Nirmala UI','Mangal','Arial Unicode MS',serif",
    `font-size:${fontSize}`,
    'line-height:1.5',
    'white-space:pre-wrap',
    'word-break:normal',
    'overflow-wrap:break-word',
    'line-break:auto',
    'text-align:justify',
  ].join(';');
  measure.innerHTML = html || '<p style="margin:0;min-height:1.5em;">&nbsp;</p>';
  Array.from(measure.childNodes).forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const p = document.createElement('p');
      p.setAttribute('style', 'margin:0;min-height:1.5em;white-space:pre-wrap;');
      p.textContent = n.textContent || '';
      measure.replaceChild(p, n);
    }
  });
  Array.from(measure.children).forEach((node) => {
    const el = node as HTMLElement;
    el.style.marginTop = el.style.marginTop || '0px';
    el.style.marginBottom = el.style.marginBottom || '0px';
    if (!el.style.minHeight) el.style.minHeight = '1.5em';
  });
  document.body.appendChild(measure);

  const queue = Array.from(measure.children) as HTMLElement[];
  const pages: string[] = [];
  let buf: string[] = [];
  let y = 0;
  let pageIndex = 0;
  const band = continuedBandPx(fontSize);
  let limit = pageLimitPx(0, contentHeightPx, continued, band);
  const scratch = document.createElement('div');
  measure.appendChild(scratch);

  const flush = () => {
    if (!buf.length) return;
    pages.push(buf.join(''));
    buf = [];
    y = 0;
    pageIndex += 1;
    limit = pageLimitPx(pageIndex, contentHeightPx, continued, band);
  };

  while (queue.length) {
    const el = queue.shift() as HTMLElement;
    const h = Math.max(el.offsetHeight || 0, 22);
    if (buf.length && y + h > limit) {
      const remaining = limit - y;
      if (remaining >= 18 && h > remaining) {
        const split = splitBlockToFit(el, remaining, scratch);
        if (split.head) {
          buf.push(split.head);
        }
        flush();
        if (split.tail) {
          measure.insertBefore(split.tail, scratch);
          queue.unshift(split.tail);
        }
        continue;
      }
      flush();
    }
    if (!buf.length && h > limit) {
      const split = splitBlockToFit(el, limit, scratch);
      if (split.head) {
        buf.push(split.head);
        flush();
      }
      if (split.tail && split.head) {
        measure.insertBefore(split.tail, scratch);
        queue.unshift(split.tail);
      } else if (!split.head) {
        buf.push(el.outerHTML);
        flush();
      }
      continue;
    }
    buf.push(el.outerHTML);
    y += h;
  }
  if (buf.length) pages.push(buf.join(''));
  document.body.removeChild(measure);
  return pages.length ? pages : ['<p style="margin:0;min-height:1.5em;">&nbsp;</p>'];
};

const extractContinuedHint = (html: string) => {
  const found = new Set<number>();
  const foot = /शेष\s*\/\/(\d+)\/\/\s*पर/g;
  let m: RegExpExecArray | null;
  while ((m = foot.exec(html))) {
    const next = Number(m[1]);
    if (Number.isFinite(next) && next >= 2) found.add(next - 2);
  }
  const head = /(?:^|>)\s*\/\/(\d+)\/\//g;
  while ((m = head.exec(html))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 2) found.add(n - 2);
  }
  return [...found].sort((a, b) => a - b);
};

/** Paginate without measuring शेष marks as body text, but reserve their bands. */
const layoutDocumentHtml = (
  html: string,
  widthPx: number,
  contentHeightPx: number,
  fontSize: string,
  continuedHint: number[] = []
) => {
  const stripped = stripContinuedHtml(html);
  const fromMarks = extractContinuedHint(html);
  const continued = fromMarks.length ? fromMarks : continuedHint.slice();
  return {
    pages: paginateDocumentHtml(stripped, widthPx, contentHeightPx, fontSize, continued),
    continued,
  };
};

const EMPTY_PAGE_HTML = '<p style="margin:0;min-height:1.5em;"><br></p>';

const collectPagesHtml = (root: HTMLElement | null) => {
  if (!root) return '';
  return Array.from(root.querySelectorAll('[data-doc-page]'))
    .map((n) => (n as HTMLElement).innerHTML)
    .join('');
};

const isBlockTag = (tag: string) =>
  /^(P|DIV|LI|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|TABLE|UL|OL)$/.test(tag);

const isAtomicBlock = (el: HTMLElement) =>
  el.style.display === 'flex' || el.hasAttribute('data-line-split') || el.tagName === 'TABLE' || el.tagName === 'UL' || el.tagName === 'OL';

const isVisuallyEmpty = (el: HTMLElement) =>
  !(el.innerText || '').replace(/\u00a0/g, ' ').replace(/\s+/g, '');

const caretAtVisualStart = (el: HTMLElement) => {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) && range.startContainer !== el) return false;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  try {
    pre.setEnd(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  return !pre.toString().replace(/\u00a0/g, ' ').replace(/\s+/g, '');
};

const caretAtVisualEnd = (el: HTMLElement) => {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.endContainer) && range.endContainer !== el) return false;
  const after = document.createRange();
  after.selectNodeContents(el);
  try {
    after.setStart(range.endContainer, range.endOffset);
  } catch {
    return false;
  }
  return !after.toString().replace(/\u00a0/g, ' ').replace(/\s+/g, '');
};

const pageBlockBottom = (page: HTMLElement, el: HTMLElement) =>
  el.offsetTop + Math.max(el.offsetHeight, 22);

const pageOverflows = (page: HTMLElement) => {
  const limit = page.clientHeight;
  if (limit <= 0) return false;
  if (page.scrollHeight > limit + 2) return true;
  let bottom = 0;
  Array.from(page.children).forEach((node) => {
    const el = node as HTMLElement;
    bottom = Math.max(bottom, el.offsetTop + Math.max(el.offsetHeight, 22));
  });
  return bottom > limit + 2;
};

const CARET_MARK = '<span data-cm-caret="1">\u200b</span>';

const stripCaretMarks = (html: string) =>
  html
    .replace(/<span[^>]*data-cm-caret[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/\u200b/g, '');

const focusNoScroll = (el: HTMLElement | null | undefined, viewport?: HTMLElement | null) => {
  const y = viewport?.scrollTop ?? 0;
  try {
    el?.focus({ preventScroll: true });
  } catch {
    el?.focus();
  }
  if (viewport) {
    viewport.scrollTop = y;
    requestAnimationFrame(() => {
      viewport.scrollTop = y;
    });
  }
};

const scrollViewportToSheet = (viewport: HTMLElement | null, sheet: HTMLElement | null) => {
  if (!viewport || !sheet) return;
  const keep = viewport.scrollTop;
  const v = viewport.getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  if (s.top >= v.top + 8 && s.bottom <= v.bottom - 8) return;
  const next = viewport.scrollTop + (s.top - v.top - 12);
  if (!Number.isFinite(next) || next < 0) {
    viewport.scrollTop = keep;
    return;
  }
  viewport.scrollTop = next;
};

const getPagesCaretOffset = (root: HTMLElement) => {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  let n = 0;
  const pages = root.querySelectorAll('[data-doc-page]');
  for (const page of Array.from(pages)) {
    if (page.contains(range.startContainer) || page === range.startContainer) {
      const pre = range.cloneRange();
      pre.selectNodeContents(page);
      try {
        pre.setEnd(range.startContainer, range.startOffset);
      } catch {
        return n;
      }
      return n + pre.toString().length;
    }
    n += (page.textContent || '').replace(/\u200b/g, '').length;
  }
  return n;
};

const setPagesCaretOffset = (root: HTMLElement, offset: number) => {
  const pages = Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[];
  let n = 0;
  for (const page of pages) {
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length || 0;
      if (n + len >= offset) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, offset - n));
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return page;
      }
      n += len;
    }
  }
  const last = pages[pages.length - 1];
  if (last) {
    const range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  return last || null;
};

const EditorPageBody = React.memo(function EditorPageBody({ index }: { index: number }) {
  return (
    <div
      className="casemate-doc-page"
      data-doc-page={String(index)}
      contentEditable
      suppressContentEditableWarning
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'normal',
        overflowWrap: 'break-word',
        lineBreak: 'auto',
        textAlign: 'justify',
        outline: 'none',
      }}
    />
  );
}, (a, b) => a.index === b.index);

const EditorSheet = React.memo(function EditorSheet({
  index,
  pageWidth,
  pageMinHeight,
  pagePadding,
  fontSize,
  showHead,
  showFoot,
}: {
  index: number;
  pageWidth: string;
  pageMinHeight: string;
  pagePadding: string;
  fontSize: string;
  showHead: boolean;
  showFoot: boolean;
}) {
  return (
    <React.Fragment>
      {index > 0 && (
        <div className="casemate-page-gutter" contentEditable={false}>
          //{index + 1}//
        </div>
      )}
      <div
        className="casemate-doc-sheet"
        style={{
          width: pageWidth,
          height: pageMinHeight,
          padding: pagePadding,
          fontFamily: "'Times New Roman', 'Nirmala UI', 'Mangal', 'Arial Unicode MS', serif",
          fontSize,
          lineHeight: 1.5,
          color: '#000',
        }}
      >
        <div className={`casemate-doc-surface${showHead ? ' has-continued-head' : ''}${showFoot ? ' has-continued-foot' : ''}`}>
          <div className={`casemate-continued-head${showHead ? '' : ' is-off'}`} contentEditable={false}>{`//${index + 1}//`}</div>
          <EditorPageBody index={index} />
          <div className={`casemate-continued-foot${showFoot ? '' : ' is-off'}`} contentEditable={false}>{`शेष //${index + 2}// पर`}</div>
        </div>
      </div>
    </React.Fragment>
  );
}, (a, b) =>
  a.index === b.index
  && a.pageWidth === b.pageWidth
  && a.pageMinHeight === b.pageMinHeight
  && a.pagePadding === b.pagePadding
  && a.fontSize === b.fontSize
  && a.showHead === b.showHead
  && a.showFoot === b.showFoot
);

const pageBlockFromCaret = (page: HTMLElement): HTMLElement | null => {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  if (node === page) {
    const kids = Array.from(page.children) as HTMLElement[];
    if (!kids.length) return null;
    return kids[Math.min(range.startOffset, Math.max(0, kids.length - 1))] || kids[0];
  }
  while (node && node !== page) {
    const parent: HTMLElement | null = node.parentElement;
    if (parent === page && node instanceof HTMLElement) return node;
    node = parent;
  }
  return (page.firstElementChild as HTMLElement | null);
};

const previousBlock = (block: HTMLElement): HTMLElement | null => {
  let n = block.previousElementSibling as HTMLElement | null;
  while (n && !isBlockTag(n.tagName)) n = n.previousElementSibling as HTMLElement | null;
  return n;
};

const lastBlock = (page: HTMLElement): HTMLElement | null => {
  let n = page.lastElementChild as HTMLElement | null;
  while (n && !isBlockTag(n.tagName)) n = n.previousElementSibling as HTMLElement | null;
  return n;
};

const placeCaretAtEnd = (el: HTMLElement) => {
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
};

const placeCaretAtStart = (el: HTMLElement) => {
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
};

const lineSplitFromNode = (node: Node | null): HTMLElement | null => {
  const el = node instanceof Element ? node : node?.parentElement;
  return (el?.closest('[data-line-split]') as HTMLElement | null) || null;
};

const splitCellFromNode = (node: Node | null): HTMLElement | null => {
  const el = node instanceof Element ? node : node?.parentElement;
  return (el?.closest('[data-split-cell]') as HTMLElement | null) || null;
};

const htmlFromRange = (range: Range) => {
  const wrap = document.createElement('div');
  wrap.appendChild(range.cloneContents());
  return wrap.innerHTML;
};

const splitBlockHtmlAtCaret = (block: HTMLElement) => {
  const sel = window.getSelection();
  if (!sel?.rangeCount) {
    return { before: block.innerHTML, after: '' };
  }
  const caret = sel.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(block);
  try {
    before.setEnd(caret.startContainer, caret.startOffset);
  } catch {
    return { before: block.innerHTML, after: '' };
  }
  const after = document.createRange();
  after.selectNodeContents(block);
  try {
    after.setStart(caret.endContainer, caret.endOffset);
  } catch {
    return { before: htmlFromRange(before), after: '' };
  }
  return { before: htmlFromRange(before), after: htmlFromRange(after) };
};

const lineSplitHtml = (mode: 'center' | 'right', leftHtml: string, restHtml?: string, rightHtml?: string) => {
  const left = leftHtml || '<br>';
  if (mode === 'center') {
    return `<div data-line-split="3" style="display:flex;align-items:flex-start;width:100%;margin:0;page-break-inside:avoid;"><div data-split-cell="left" data-empty="0" style="flex:1;text-align:left;white-space:pre-wrap;min-width:0;">${left}</div><div data-split-cell="center" data-empty="1" style="flex:1;text-align:center;white-space:pre-wrap;min-width:0;">${restHtml || `${CARET_MARK}<br>`}</div><div data-split-cell="right" data-empty="1" style="flex:1;text-align:right;white-space:pre-wrap;min-width:0;">${rightHtml || '<br>'}</div></div>`;
  }
  return `<div data-line-split="2" style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;margin:0;page-break-inside:avoid;"><div data-split-cell="left" data-empty="0" style="flex:1;text-align:left;white-space:pre-wrap;min-width:0;">${left}</div><div data-split-cell="right" data-empty="1" style="flex:1;text-align:right;white-space:pre-wrap;min-width:0;">${restHtml || `${CARET_MARK}<br>`}</div></div>`;
};

const focusSplitCaret = (row: HTMLElement | null, cell: 'left' | 'center' | 'right') => {
  if (!row) return;
  const mark = row.querySelector('[data-cm-caret="1"]') as HTMLElement | null;
  if (mark) {
    placeCaretAtStart(mark);
    const parent = mark.parentElement;
    mark.remove();
    if (parent && !(parent.textContent || '').replace(/\u200b/g, '').trim()) {
      placeCaretAtStart(parent);
    }
    parent?.setAttribute('data-active', '1');
    return;
  }
  const target = row.querySelector(`[data-split-cell="${cell}"]`) as HTMLElement | null;
  if (target) {
    placeCaretAtStart(target);
    target.setAttribute('data-active', '1');
  }
};

const splitCellIsEmpty = (el: HTMLElement) =>
  !(el.innerText || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, '');

const unwrapLineSplit = (row: HTMLElement, caret: 'start' | 'end' = 'end') => {
  const cells = Array.from(row.querySelectorAll('[data-split-cell]')) as HTMLElement[];
  const parts = cells
    .map((c) => (c.innerHTML || '').replace(/\u200b/g, '').replace(/^\s*<br\s*\/?>\s*$/i, '').trim())
    .filter((h) => h && h !== '<br>');
  const p = document.createElement('p');
  p.setAttribute('style', 'margin:0;min-height:1.5em;white-space:pre-wrap;width:100%;');
  p.innerHTML = parts.join(' ') || '<br>';
  row.replaceWith(p);
  if (caret === 'start') placeCaretAtStart(p);
  else placeCaretAtEnd(p);
  return p;
};

const extrasEmpty = (row: HTMLElement) => {
  const cells = Array.from(row.querySelectorAll('[data-split-cell]')) as HTMLElement[];
  return cells.slice(1).every(splitCellIsEmpty);
};

const mergeBlockInto = (prev: HTMLElement, block: HTMLElement) => {
  if (isVisuallyEmpty(block)) {
    block.remove();
    placeCaretAtEnd(prev);
    return;
  }
  if (isVisuallyEmpty(prev) && !isAtomicBlock(prev)) {
    prev.innerHTML = block.innerHTML;
    block.remove();
    placeCaretAtStart(prev);
    return;
  }
  if (isAtomicBlock(prev) || isAtomicBlock(block)) {
    prev.parentElement?.insertBefore(block, prev.nextSibling);
    placeCaretAtStart(block);
    return;
  }
  while (
    prev.lastChild &&
    ((prev.lastChild instanceof HTMLElement && prev.lastChild.tagName === 'BR') ||
      (prev.lastChild.nodeType === Node.TEXT_NODE &&
        !(prev.lastChild.textContent || '').replace(/\u00a0/g, ' ').trim()))
  ) {
    prev.removeChild(prev.lastChild);
  }
  const mark = document.createElement('span');
  mark.setAttribute('data-cm-caret', '1');
  prev.appendChild(mark);
  while (block.firstChild) prev.appendChild(block.firstChild);
  block.remove();
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStartAfter(mark);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
  mark.remove();
};

const pageHasSpareLine = (el: HTMLElement) => {
  const last = el.lastElementChild as HTMLElement | null;
  if (!last) return el.clientHeight > 40;
  const gap = el.clientHeight - (last.offsetTop + last.offsetHeight);
  return gap > 36;
};

const stripTrailingEmptyBlocks = (page: HTMLElement) => {
  let removed = 0;
  let n = lastBlock(page);
  while (n && isVisuallyEmpty(n) && page.children.length > 1) {
    const prev = previousBlock(n);
    n.remove();
    removed += 1;
    n = prev;
  }
  return removed;
};

/** Pull following-page lines up when this page still has room above शेष. */
const fillSpareFromNext = (root: HTMLElement, skip: HTMLElement | null = null) => {
  const pages = Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[];
  for (let i = 0; i < pages.length - 1; i++) {
    if (skip && (pages[i] === skip || pages[i + 1] === skip)) continue;
    let guard = 0;
    while (guard < 40 && pageHasSpareLine(pages[i])) {
      guard += 1;
      stripTrailingEmptyBlocks(pages[i]);
      const nextPage = pages[i + 1];
      const first = nextPage.firstElementChild as HTMLElement | null;
      if (!first) break;
      if (isVisuallyEmpty(first)) {
        first.remove();
        continue;
      }
      pages[i].appendChild(first);
      if (pageOverflows(pages[i])) {
        nextPage.insertBefore(first, nextPage.firstChild);
        break;
      }
    }
  }
};

const ensureParagraphSeparator = () => {
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  } catch {
    /* WebView may ignore this */
  }
};

const taggedLooksComplete = (tagged: string, livePlain: string) => {
  const nextPlain = tagged
    .replace(/\[\/?(?:CENTER|RIGHT|LEFT|JUSTIFY|ROW|U)\]/gi, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, '');
  const live = livePlain.replace(/\s+/g, '');
  if (!nextPlain) return false;
  if (live.length < 8) return true;
  return nextPlain.length >= Math.floor(live.length * 0.9);
};

type EditorTextMatch = { node: Text; start: number; end: number };

const collectEditorTextNodes = (root: HTMLElement): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
      if (!(node as Text).nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
};

const findEditorMatches = (root: HTMLElement, query: string, matchCase: boolean): EditorTextMatch[] => {
  if (!query) return [];
  const q = matchCase ? query : query.toLowerCase();
  const pages = Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[];
  const scopes = pages.length ? pages : [root];
  const matches: EditorTextMatch[] = [];
  for (const scope of scopes) {
    for (const node of collectEditorTextNodes(scope)) {
      const raw = node.nodeValue || '';
      const hay = matchCase ? raw : raw.toLowerCase();
      let from = 0;
      while (from <= hay.length - q.length) {
        const i = hay.indexOf(q, from);
        if (i < 0) break;
        matches.push({ node, start: i, end: i + query.length });
        from = i + Math.max(1, q.length);
      }
    }
  }
  return matches;
};

const selectEditorMatch = (
  match: EditorTextMatch,
  viewport?: HTMLElement | null,
  scale = 1
) => {
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.end);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  const el = match.node.parentElement;
  const sheet = el?.closest('.casemate-doc-sheet') as HTMLElement | null;
  if (viewport && sheet) {
    const top = sheet.offsetTop * scale;
    viewport.scrollTo({ top: Math.max(0, top - 72), behavior: 'smooth' });
    return;
  }
  el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
};

// Editable Document Component (WYSIWYG Page Viewer)
const DocumentViewer = memo(({ msg, title, t, onUpdate }: { msg: Message, title: string, t: any, onUpdate: (id: string, text: string) => void }) => {
  const { isTimeUp, setIsUpgradeModalOpen, isCloudSyncing, language } = useAppContext();
  const [isEditing, setIsEditing] = useState(false);
  const [pageSize, setPageSize] = useState('legal');
  const [fontSize, setFontSize] = useState('12pt');
  const [marginTop, setMarginTop] = useState('1in');
  const [marginRight, setMarginRight] = useState('1in');
  const [marginBottom, setMarginBottom] = useState('1in');
  const [marginLeft, setMarginLeft] = useState('1in');
  const [continuedPages, setContinuedPages] = useState<number[]>([]);
  const [fitScale, setFitScale] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [activeSplitCell, setActiveSplitCell] = useState<'left' | 'center' | 'right' | null>(null);
  const [hasScanDraft, setHasScanDraft] = useState(false);
  const [scanCheckOpen, setScanCheckOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const editorViewportRef = useRef<HTMLDivElement>(null);
  const editorOverlayRef = useRef<HTMLDivElement>(null);
  const scaleShellRef = useRef<HTMLDivElement>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const zoomLevelRef = useRef(1);
  const [editorFitScale, setEditorFitScale] = useState(1);
  const [docPages, setDocPages] = useState<string[]>(['']);
  const [visiblePage, setVisiblePage] = useState(1);
  const pendingCaretRef = useRef<number | null>(null);
  const lastGoodTextRef = useRef(msg.text);
  const editOriginalRef = useRef(msg.text);
  const editorDirtyRef = useRef(false);
  const composingRef = useRef(false);
  const continuedPagesRef = useRef<number[]>([]);
  const docPagesRef = useRef<string[]>(['']);
  const frozenPagesRef = useRef<{
    text: string;
    pages: string[];
    continued: number[];
    layoutKey: string;
  } | null>(null);
  const pageTimerRef = useRef<number | null>(null);
  const persistEditorNowRef = useRef<() => void>(() => undefined);
  const closeEditorRef = useRef<(save: boolean) => void>(() => undefined);
  const deleteGuardRef = useRef(false);
  const enterGuardRef = useRef(false);
  const editorScrollRef = useRef(0);
  const typingUntilRef = useRef(0);
  const markTyping = () => {
    typingUntilRef.current = Date.now() + 900;
  };
  const markEditorDirty = () => {
    editorDirtyRef.current = true;
    markTyping();
  };
  const holdEditorScroll = () => {
    const vp = editorViewportRef.current;
    if (vp) editorScrollRef.current = vp.scrollTop;
  };
  const restoreEditorScroll = () => {
    const vp = editorViewportRef.current;
    if (!vp) return;
    const y = editorScrollRef.current;
    vp.scrollTop = y;
    requestAnimationFrame(() => {
      vp.scrollTop = y;
    });
  };
  const isTyping = () => Date.now() < typingUntilRef.current;
  const viewScale = fitScale * zoomLevel;
  const editorViewScale = editorFitScale * zoomLevel;
  /** Custom undo/redo — native execCommand undo is unreliable in Android WebView */
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const applyingHistoryRef = useRef(false);
  const historyTimerRef = useRef<number | null>(null);

  const pagePadding = `${marginTop} ${marginRight} ${marginBottom} ${marginLeft}`;
  const marginTopPx = inchToPx(marginTop);
  const marginRightPx = inchToPx(marginRight);
  const marginBottomPx = inchToPx(marginBottom);
  const marginLeftPx = inchToPx(marginLeft);
  const marginTopTwips = inchToTwips(marginTop);
  const marginRightTwips = inchToTwips(marginRight);
  const marginBottomTwips = inchToTwips(marginBottom);
  const marginLeftTwips = inchToTwips(marginLeft);

  const getPageDimensions = (size: string) => {
    switch (size) {
      case 'a4': return { width: '794px', minHeight: '1123px' };
      case 'letter': return { width: '816px', minHeight: '1056px' };
      case 'legal': return { width: '816px', minHeight: '1344px' };
      default: return { width: '816px', minHeight: '1344px' };
    }
  };

  const { width: pageWidth, minHeight: pageMinHeight } = getPageDimensions(pageSize);
  const pageWidthPx = parseInt(pageWidth, 10);
  const pageHeightPx = parseInt(pageMinHeight, 10) || 1344;
  const contentWidthPx = Math.max(80, pageWidthPx - marginLeftPx - marginRightPx);
  const contentHeightPx = Math.max(80, pageHeightPx - marginTopPx - marginBottomPx);
  const pageCount = docPages.length;
  const stackHeightPx = pageCount * pageHeightPx + Math.max(0, pageCount - 1) * PAGE_GUTTER_PX;

  const paginateNow = (html: string, continued = continuedPagesRef.current) =>
    paginateDocumentHtml(html, contentWidthPx, contentHeightPx, fontSize, continued);

  const layoutNow = (html: string, continued = continuedPagesRef.current) =>
    layoutDocumentHtml(html, contentWidthPx, contentHeightPx, fontSize, continued);

  useEffect(() => {
    continuedPagesRef.current = continuedPages;
  }, [continuedPages]);

  useEffect(() => {
    docPagesRef.current = docPages;
  }, [docPages]);

  useEffect(() => {
    if (!isEditing) lastGoodTextRef.current = msg.text;
  }, [msg.text, isEditing]);

  useEffect(() => {
    let dead = false;
    void getScanDraft(msg.id).then((rec) => {
      if (!dead) setHasScanDraft(!!rec);
    });
    return () => { dead = true; };
  }, [msg.id]);

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  // Fit the A4/Legal page into the chat width (same as before) — PDF/DOCX stay full size
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateScale = () => {
      const available = el.clientWidth;
      if (available <= 0) return;
      setFitScale(Math.min(1, available / pageWidthPx));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    window.addEventListener('resize', updateScale);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [pageWidthPx]);

  // Pinch / trackpad-pinch on the draft only
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const pinch = { dist: 0, zoom: 1 };
    const clamp = (z: number) => clampZoom(z);
    const distance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      return Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch.dist = distance(e.touches) || 1;
        pinch.zoom = zoomLevelRef.current;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.dist) return;
      e.preventDefault();
      setZoomLevel(clamp(pinch.zoom * (distance(e.touches) / pinch.dist)));
    };
    const onEnd = () => {
      pinch.dist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoomLevel((z) => clamp(z * factor));
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    if (!isEditing) return;
    const layoutKey = `${contentWidthPx}|${contentHeightPx}|${fontSize}`;
    const frozen = frozenPagesRef.current;
    if (
      frozen
      && frozen.layoutKey === layoutKey
      && sameEditorText(frozen.text, msg.text)
    ) {
      setDocPages(frozen.pages);
      setContinuedPages(frozen.continued);
      historyRef.current = [frozen.pages.join('')];
      historyIndexRef.current = 0;
      syncHistoryButtons();
      return;
    }
    const extracted = layoutNow(parseFormattingToHTML(msg.text));
    setDocPages(extracted.pages);
    setContinuedPages(extracted.continued);
    historyRef.current = [extracted.pages.join('')];
    historyIndexRef.current = 0;
    syncHistoryButtons();
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const joined = collectPagesHtml(editorRef.current);
    if (!joined || joined.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length < 8) return;
    if (editorRef.current) pendingCaretRef.current = getPagesCaretOffset(editorRef.current);
    holdEditorScroll();
    const next = paginateNow(stripContinuedHtml(joined));
    if (!next.some((p) => (p || '').replace(/<[^>]+>/g, '').trim())) return;
    setDocPages(next);
  }, [fontSize, contentWidthPx, contentHeightPx]);

  useEffect(() => {
    if (!isEditing) {
      registerDocumentEditorCloser(null);
      return;
    }
    registerDocumentEditorCloser(() => {
      closeEditorRef.current(false);
      return true;
    });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      registerDocumentEditorCloser(null);
      document.body.style.overflow = prev;
    };
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const el = editorViewportRef.current;
    if (!el) return;
    const updateScale = () => {
      if (isTyping()) return;
      const available = el.clientWidth - 16;
      if (available <= 0) return;
      setEditorFitScale(Math.min(1, available / pageWidthPx));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isEditing, pageWidthPx]);

  useEffect(() => {
    if (!isEditing) return;
    const el = editorViewportRef.current;
    if (!el) return;
    const pinch = { dist: 0, zoom: 1 };
    const clamp = (z: number) => clampZoom(z);
    const distance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      return Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch.dist = distance(e.touches) || 1;
        pinch.zoom = zoomLevelRef.current;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.dist) return;
      e.preventDefault();
      setZoomLevel(clamp(pinch.zoom * (distance(e.touches) / pinch.dist)));
    };
    const onEnd = () => {
      pinch.dist = 0;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoomLevel((z) => clampZoom(z * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [isEditing]);

  useEffect(() => {
    if (isEditing) return;
    const layoutKey = `${contentWidthPx}|${contentHeightPx}|${fontSize}`;
    const frozen = frozenPagesRef.current;
    const source = lastGoodTextRef.current || msg.text;
    if (
      frozen
      && frozen.layoutKey === layoutKey
      && sameEditorText(frozen.text, source)
    ) {
      setDocPages(frozen.pages);
      setContinuedPages(frozen.continued);
      return;
    }
    frozenPagesRef.current = null;
    const extracted = layoutNow(parseFormattingToHTML(source));
    setDocPages(extracted.pages);
    setContinuedPages(extracted.continued);
  }, [msg.text, contentWidthPx, contentHeightPx, fontSize, isEditing]);

  useEffect(() => {
    if (scaleShellRef.current) {
      scaleShellRef.current.style.height = `${stackHeightPx * viewScale}px`;
    }
    if (editorShellRef.current) {
      editorShellRef.current.style.height = `${stackHeightPx * editorViewScale}px`;
    }
  }, [stackHeightPx, viewScale, editorViewScale, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const el = editorViewportRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isTyping() && el.scrollTop < 12 && editorScrollRef.current > 80) {
        el.scrollTop = editorScrollRef.current;
        return;
      }
      if (!isTyping()) editorScrollRef.current = el.scrollTop;
      const span = (pageHeightPx + PAGE_GUTTER_PX) * editorViewScale;
      setVisiblePage(Math.min(pageCount, Math.max(1, Math.floor(el.scrollTop / Math.max(1, span)) + 1)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [isEditing, pageCount, pageHeightPx, editorViewScale]);

  // Keep Save + format bar on the visible phone screen when the keyboard opens
  useEffect(() => {
    if (!isEditing) return;
    const overlay = editorOverlayRef.current;
    const vv = window.visualViewport;
    if (!overlay) return;
    const pin = () => {
      const top = vv?.offsetTop ?? 0;
      const left = vv?.offsetLeft ?? 0;
      const height = vv?.height ?? window.innerHeight;
      const width = vv?.width ?? window.innerWidth;
      overlay.style.top = `${top}px`;
      overlay.style.left = `${left}px`;
      overlay.style.height = `${height}px`;
      overlay.style.width = `${width}px`;
      overlay.style.bottom = 'auto';
      overlay.style.right = 'auto';
      const vp = editorViewportRef.current;
      if (vp && isTyping() && vp.scrollTop < 12 && editorScrollRef.current > 80) {
        vp.scrollTop = editorScrollRef.current;
      }
    };
    pin();
    vv?.addEventListener('resize', pin);
    vv?.addEventListener('scroll', pin);
    window.addEventListener('orientationchange', pin);
    return () => {
      vv?.removeEventListener('resize', pin);
      vv?.removeEventListener('scroll', pin);
      window.removeEventListener('orientationchange', pin);
    };
  }, [isEditing]);

  useLayoutEffect(() => {
    if (!isEditing) return;
    const root = editorRef.current;
    if (!root) return;
    const focused = document.activeElement as HTMLElement | null;
    const focusedPage = focused?.closest?.('[data-doc-page]') as HTMLElement | null;
    const nodes = root.querySelectorAll('[data-doc-page]');
    nodes.forEach((node, i) => {
      const el = node as HTMLElement;
      // Never replace the page the user is typing on — that wipes unsaved keystrokes.
      if (!applyingHistoryRef.current && focusedPage === el) return;
      const next = docPages[i] || '';
      if (el.innerHTML !== next) el.innerHTML = next;
    });
    if (!isTyping() && !applyingHistoryRef.current) fillSpareFromNext(root, focusedPage);
    restoreEditorScroll();
    const viewport = editorViewportRef.current;
    const mark = root.querySelector('[data-cm-caret]') as HTMLElement | null;
    if (mark) {
      const page = mark.closest('[data-doc-page]') as HTMLElement | null;
      if (page && document.activeElement !== page) focusNoScroll(page, viewport);
      const range = document.createRange();
      range.setStartAfter(mark);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      mark.remove();
      pendingCaretRef.current = null;
      restoreEditorScroll();
      if (!isTyping()) {
        scrollViewportToSheet(viewport, page?.closest('.casemate-doc-sheet') as HTMLElement | null);
        holdEditorScroll();
      }
      return;
    }
    if (pendingCaretRef.current != null) {
      const page = setPagesCaretOffset(root, pendingCaretRef.current as number);
      pendingCaretRef.current = null;
      if (page && document.activeElement !== page) focusNoScroll(page, viewport);
      restoreEditorScroll();
      if (!isTyping()) {
        scrollViewportToSheet(viewport, page?.closest('.casemate-doc-sheet') as HTMLElement | null);
        holdEditorScroll();
      }
    }
  }, [docPages, isEditing]);

  const syncHistoryButtons = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  const pushHistorySnapshot = (html?: string) => {
    if (applyingHistoryRef.current || !editorRef.current) return;
    const snapshot = html ?? collectPagesHtml(editorRef.current);
    const stack = historyRef.current;
    const idx = historyIndexRef.current;
    if (stack[idx] === snapshot) {
      syncHistoryButtons();
      return;
    }
    historyRef.current = stack.slice(0, idx + 1).concat(snapshot);
    if (historyRef.current.length > 80) {
      historyRef.current = historyRef.current.slice(-80);
    }
    historyIndexRef.current = historyRef.current.length - 1;
    syncHistoryButtons();
    if (!editorDirtyRef.current) return;
    const tagged = htmlToCustomTags(stripContinuedHtml(snapshot));
    if (taggedLooksComplete(tagged, tagged)) {
      lastGoodTextRef.current = pickSavedEditorText(
        tagged.replace(/\u200b/g, ''),
        editOriginalRef.current || msg.text,
        lastGoodTextRef.current
      );
    }
  };

  const pagesOverflowing = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[data-doc-page]')).some((n) => pageOverflows(n as HTMLElement));

  const reflowPages = (force = false) => {
    const root = editorRef.current;
    if (!root || applyingHistoryRef.current || composingRef.current) return;
    if (!force && !pagesOverflowing(root)) return;
    holdEditorScroll();
    const extra: string[] = [];
    let guard = 0;
    while (pagesOverflowing(root) && guard < 60) {
      guard += 1;
      const pages = Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[];
      const i = pages.findIndex((p) => pageOverflows(p));
      if (i < 0) break;
      const page = pages[i];
      const kids = Array.from(page.children) as HTMLElement[];
      if (!kids.length) break;
      if (kids.length === 1) break;
      const last = kids[kids.length - 1];
      const nextPage = pages[i + 1];
      if (nextPage) {
        nextPage.insertBefore(last, nextPage.firstChild);
      } else {
        extra.unshift(last.outerHTML);
        last.remove();
      }
    }
    if (!isTyping()) fillSpareFromNext(root);
    const htmls = Array.from(root.querySelectorAll('[data-doc-page]')).map(
      (p) => (p as HTMLElement).innerHTML
    );
    if (extra.length) htmls.push(extra.join(''));
    const prevCount = docPagesRef.current.length;
    docPagesRef.current = htmls;
    if (htmls.length !== prevCount) setDocPages(htmls);
  };

  const scheduleHistorySnapshot = () => {
    markTyping();
    holdEditorScroll();
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      pushHistorySnapshot();
    }, 280);
    const root = editorRef.current;
    if (root && pagesOverflowing(root)) {
      if (pageTimerRef.current) window.clearTimeout(pageTimerRef.current);
      pageTimerRef.current = window.setTimeout(() => reflowPages(true), 80);
    }
  };

  const applyHistoryAt = (index: number) => {
    const html = historyRef.current[index];
    if (html == null) return;
    applyingHistoryRef.current = true;
    historyIndexRef.current = index;
    pendingCaretRef.current = html.replace(/<[^>]+>/g, '').length;
    holdEditorScroll();
    const next = paginateNow(html);
    docPagesRef.current = next;
    setDocPages(next);
    syncHistoryButtons();
    window.setTimeout(() => {
      applyingHistoryRef.current = false;
    }, 0);
  };

  const handleUndo = () => {
    if (historyTimerRef.current) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    pushHistorySnapshot();
    if (historyIndexRef.current <= 0) return;
    applyHistoryAt(historyIndexRef.current - 1);
  };

  const handleRedo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    applyHistoryAt(historyIndexRef.current + 1);
  };

  const startEditing = () => {
    setZoomLevel(1);
    ensureParagraphSeparator();
    editOriginalRef.current = msg.text;
    lastGoodTextRef.current = msg.text;
    editorDirtyRef.current = false;
    setIsEditing(true);
  };

  const captureEditorTagged = (root: HTMLElement | null) => {
    const pageEls = root
      ? (Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[])
      : [];
    const htmls = (pageEls.length
      ? pageEls.map((n) => n.innerHTML)
      : docPagesRef.current
    ).map((html) => stripCaretMarks(stripContinuedHtml(html)));
    const livePlain = pageEls.map((n) => n.innerText || '').join('\n');
    const pages = htmls.map((html, i) => {
      let next = html;
      if (continuedPagesRef.current.includes(i - 1)) {
        next = `<p align="center" style="text-align:center;margin:0 0 2px;width:100%;">//${i + 1}//</p>${next}`;
      }
      if (continuedPagesRef.current.includes(i)) {
        next = `${next}<p align="right" style="text-align:right;margin:2px 0 0;width:100%;">शेष //${i + 2}// पर</p>`;
      }
      return next;
    });
    const tagged = htmlToCustomTags(pages.join(''));
    if (taggedLooksComplete(tagged, livePlain || tagged)) {
      return tagged.replace(/\u200b/g, '');
    }
    return lastGoodTextRef.current || editOriginalRef.current || msg.text;
  };

  const persistEditorNow = () => {
    if (historyTimerRef.current) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    pushHistorySnapshot();
    const root = editorRef.current;
    if (root) {
      docPagesRef.current = Array.from(root.querySelectorAll('[data-doc-page]')).map(
        (p) => (p as HTMLElement).innerHTML
      );
    }
    const original = editOriginalRef.current || msg.text;
    if (!editorDirtyRef.current) {
      lastGoodTextRef.current = original;
      return;
    }
    const nextText = captureEditorTagged(root);
    const toSave = pickSavedEditorText(nextText, original, lastGoodTextRef.current || original);
    if (!toSave.trim()) return;
    if (sameEditorText(toSave, original) || toSave === msg.text) {
      lastGoodTextRef.current = original;
      return;
    }
    lastGoodTextRef.current = toSave;
    onUpdate(msg.id, toSave);
  };
  persistEditorNowRef.current = persistEditorNow;

  const closeEditor = (save: boolean) => {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    if (pageTimerRef.current) window.clearTimeout(pageTimerRef.current);
    if (save) persistEditorNow();
    else lastGoodTextRef.current = editOriginalRef.current || msg.text;
    const source = save
      ? (lastGoodTextRef.current || msg.text)
      : (editOriginalRef.current || msg.text);
    if (save) {
      const root = editorRef.current;
      const htmls = root
        ? Array.from(root.querySelectorAll('[data-doc-page]')).map((p) =>
            stripCaretMarks(stripContinuedHtml((p as HTMLElement).innerHTML))
          )
        : docPagesRef.current.map((html) => stripCaretMarks(stripContinuedHtml(html)));
      if (htmls.some((html) => html.replace(/<[^>]+>/g, '').trim())) {
        docPagesRef.current = htmls;
        setDocPages(htmls);
        frozenPagesRef.current = {
          text: source,
          pages: htmls,
          continued: continuedPagesRef.current.slice(),
          layoutKey: `${contentWidthPx}|${contentHeightPx}|${fontSize}`,
        };
      } else {
        frozenPagesRef.current = null;
        const extracted = layoutNow(parseFormattingToHTML(source));
        setDocPages(extracted.pages);
        setContinuedPages(extracted.continued);
      }
    } else {
      frozenPagesRef.current = null;
      const extracted = layoutNow(parseFormattingToHTML(source));
      setDocPages(extracted.pages);
      setContinuedPages(extracted.continued);
    }
    historyRef.current = [];
    historyIndexRef.current = 0;
    setIsEditing(false);
    setFindOpen(false);
    setCanUndo(false);
    setCanRedo(false);
    setZoomLevel(1);
  };
  closeEditorRef.current = closeEditor;

  const handleSave = () => closeEditor(true);
  const handleDiscard = () => closeEditor(false);

  const openFindBar = () => {
    setFindOpen(true);
    window.setTimeout(() => findInputRef.current?.focus(), 0);
  };

  const refreshFindMatches = (query = findQuery, cs = matchCase, preferredIndex = matchIndex, select = true) => {
    const root = editorRef.current;
    if (!root || !query) {
      setMatchCount(0);
      setMatchIndex(0);
      return 0;
    }
    const matches = findEditorMatches(root, query, cs);
    setMatchCount(matches.length);
    if (!matches.length) {
      setMatchIndex(0);
      return 0;
    }
    const i = ((preferredIndex % matches.length) + matches.length) % matches.length;
    setMatchIndex(i);
    if (select) selectEditorMatch(matches[i], editorViewportRef.current, editorViewScale);
    return matches.length;
  };

  const goToFindMatch = (delta: number) => {
    const root = editorRef.current;
    if (!root || !findQuery) return;
    const matches = findEditorMatches(root, findQuery, matchCase);
    if (!matches.length) {
      setMatchCount(0);
      setMatchIndex(0);
      return;
    }
    const next = ((matchIndex + delta) % matches.length + matches.length) % matches.length;
    setMatchCount(matches.length);
    setMatchIndex(next);
    selectEditorMatch(matches[next], editorViewportRef.current, editorViewScale);
  };

  const replaceCurrentMatch = () => {
    const root = editorRef.current;
    if (!root || !findQuery) return;
    const matches = findEditorMatches(root, findQuery, matchCase);
    if (!matches.length) {
      setMatchCount(0);
      return;
    }
    const i = Math.min(matchIndex, matches.length - 1);
    const m = matches[i];
    const text = m.node.nodeValue || '';
    m.node.nodeValue = text.slice(0, m.start) + replaceQuery + text.slice(m.end);
    markEditorDirty();
    pushHistorySnapshot();
    window.requestAnimationFrame(() => refreshFindMatches(findQuery, matchCase, i));
  };

  const replaceAllMatches = () => {
    const root = editorRef.current;
    if (!root || !findQuery) return;
    const matches = findEditorMatches(root, findQuery, matchCase);
    if (!matches.length) {
      setMatchCount(0);
      return;
    }
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const text = m.node.nodeValue || '';
      m.node.nodeValue = text.slice(0, m.start) + replaceQuery + text.slice(m.end);
    }
    markEditorDirty();
    pushHistorySnapshot();
    setMatchCount(0);
    setMatchIndex(0);
  };

  useEffect(() => {
    if (!isEditing || !findOpen) return;
    refreshFindMatches(findQuery, matchCase, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, matchCase, findOpen, isEditing]);

  const execCmd = (cmd: string, value?: string) => {
    const active = document.activeElement as HTMLElement | null;
    if (!active?.closest?.('[data-doc-page]')) {
      focusNoScroll(
        editorRef.current?.querySelector('[data-doc-page]') as HTMLElement | null,
        editorViewportRef.current
      );
    }
    document.execCommand(cmd, false, value);
    markEditorDirty();
    // Formatting changes must enter undo history (execCommand undo is unreliable on Android)
    pushHistorySnapshot();
  };

  const deleteBackwardLikeWord = (pageEl: HTMLElement, pageIndex: number) => {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return false;
    const root = editorRef.current;
    if (!root) return false;
    const range = sel.getRangeAt(0);
    const pages = Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[];
    const block = pageBlockFromCaret(pageEl);

    const atStartOfPage = (() => {
      const pre = document.createRange();
      pre.selectNodeContents(pageEl);
      try {
        pre.setEnd(range.startContainer, range.startOffset);
      } catch {
        return false;
      }
      return !pre.toString().replace(/\u00a0/g, ' ').replace(/\s+/g, '');
    })();

    if (block && caretAtVisualStart(block)) {
      const prevOnPage = previousBlock(block);
      if (prevOnPage) {
        mergeBlockInto(prevOnPage, block);
        return true;
      }
    } else if (!atStartOfPage) {
      return false;
    }

    if (pageIndex <= 0) {
      if (block && isVisuallyEmpty(block) && pageEl.children.length > 1) {
        const next = block.nextElementSibling as HTMLElement | null;
        block.remove();
        if (next) placeCaretAtStart(next);
        else placeCaretAtEnd(pageEl);
        return true;
      }
      return false;
    }

    const prevPage = pages[pageIndex - 1];
    if (!prevPage) return false;
    const cleared = stripTrailingEmptyBlocks(prevPage);

    const first = (block && !previousBlock(block) ? block : pageEl.firstElementChild) as HTMLElement | null;
    const prevLast = lastBlock(prevPage);

    if (first && isVisuallyEmpty(first)) {
      const next = first.nextElementSibling as HTMLElement | null;
      first.remove();
      focusNoScroll(prevPage, editorViewportRef.current);
      if (next) {
        if (pageHasSpareLine(prevPage) || (prevLast && isVisuallyEmpty(prevLast))) {
          if (prevLast && isVisuallyEmpty(prevLast)) prevLast.remove();
          prevPage.appendChild(next);
          placeCaretAtStart(next);
        } else {
          focusNoScroll(pageEl, editorViewportRef.current);
          placeCaretAtStart(next);
        }
      } else if (prevLast) {
        placeCaretAtEnd(prevLast);
      } else {
        placeCaretAtEnd(prevPage);
      }
      return true;
    }

    if (first) {
      focusNoScroll(prevPage, editorViewportRef.current);
      if (!prevLast || isVisuallyEmpty(prevLast) || pageHasSpareLine(prevPage)) {
        if (prevLast && isVisuallyEmpty(prevLast)) prevLast.remove();
        prevPage.appendChild(first);
        placeCaretAtStart(first);
        return true;
      }
      mergeBlockInto(prevLast, first);
      return true;
    }

    if (cleared > 0) {
      focusNoScroll(prevPage, editorViewportRef.current);
      if (prevLast) placeCaretAtEnd(prevLast);
      else placeCaretAtEnd(prevPage);
      return true;
    }
    return false;
  };

  const afterStructuralDelete = () => {
    markEditorDirty();
    holdEditorScroll();
    scheduleHistorySnapshot();
    requestAnimationFrame(() => {
      restoreEditorScroll();
      if (editorRef.current) reflowPages(true);
    });
  };

  const consumeBackspace = (pageEl: HTMLElement, pageIndex: number, e: { preventDefault: () => void }) => {
    if (deleteGuardRef.current) {
      e.preventDefault();
      return;
    }
    if (!deleteBackwardLikeWord(pageEl, pageIndex)) return;
    deleteGuardRef.current = true;
    window.setTimeout(() => {
      deleteGuardRef.current = false;
    }, 0);
    e.preventDefault();
    afterStructuralDelete();
  };

  const handleEnterOnPage = (pageEl: HTMLElement, pageIndex: number) => {
    ensureParagraphSeparator();
    const last = lastBlock(pageEl) || (pageEl.lastElementChild as HTMLElement | null);
    const block = pageBlockFromCaret(pageEl);
    const atEndOfLast = !!(block && last && block === last && caretAtVisualEnd(block));
    const lineH = 26;
    const noRoom = last ? pageBlockBottom(pageEl, last) > pageEl.clientHeight - lineH : false;

    if (atEndOfLast && (noRoom || pageOverflows(pageEl))) {
      const blank = `<p style="margin:0;min-height:1.5em;">${CARET_MARK}<br></p>`;
      const live = Array.from(editorRef.current?.querySelectorAll('[data-doc-page]') || []) as HTMLElement[];
      const htmls = live.map((p) => p.innerHTML);
      if (htmls[pageIndex + 1] != null) htmls[pageIndex + 1] = `${blank}${htmls[pageIndex + 1]}`;
      else htmls.push(blank);
      holdEditorScroll();
      docPagesRef.current = htmls;
      setDocPages(htmls);
      scheduleHistorySnapshot();
      return;
    }

    const inserted = document.execCommand('insertParagraph');
    if (!inserted) {
      document.execCommand('insertHTML', false, `<p style="margin:0;min-height:1.5em;">${CARET_MARK}<br></p>`);
    } else {
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const mark = document.createElement('span');
        mark.setAttribute('data-cm-caret', '1');
        mark.textContent = '\u200b';
        sel.getRangeAt(0).insertNode(mark);
        const range = document.createRange();
        range.setStartAfter(mark);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    scheduleHistorySnapshot();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreEditorScroll();
        reflowPages(true);
      });
    });
  };

  const consumeEnter = (pageEl: HTMLElement, pageIndex: number, e: { preventDefault: () => void }) => {
    if (enterGuardRef.current) {
      e.preventDefault();
      return;
    }
    enterGuardRef.current = true;
    window.setTimeout(() => {
      enterGuardRef.current = false;
    }, 0);
    e.preventDefault();
    handleEnterOnPage(pageEl, pageIndex);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, pageIndex: number) => {
    if (e.nativeEvent.isComposing) return;
    ensureParagraphSeparator();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openFindBar();
      return;
    }
    if (mod && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      openFindBar();
      return;
    }
    if (e.key === 'Escape' && findOpen) {
      e.preventDefault();
      setFindOpen(false);
      return;
    }
    if (mod && (e.key === '=' || e.key === '+' || e.key === '-')) {
      e.preventDefault();
      setZoomLevel((z) => clampZoom(z + (e.key === '-' ? -0.1 : 0.1)));
      return;
    }
    if (mod && e.key === '0') {
      e.preventDefault();
      setZoomLevel(1);
      return;
    }
    const pageEl = ((e.target as HTMLElement).closest?.('[data-doc-page]') as HTMLElement | null)
      || e.currentTarget;

    if (e.key === 'Enter' && !e.shiftKey) {
      const row = lineSplitFromNode(window.getSelection()?.anchorNode || null);
      if (row) {
        e.preventDefault();
        const p = document.createElement('p');
        p.setAttribute('style', 'margin:0;min-height:1.5em;white-space:pre-wrap;');
        p.innerHTML = '<br>';
        row.insertAdjacentElement('afterend', p);
        placeCaretAtStart(p);
        afterStructuralDelete();
        return;
      }
      consumeEnter(pageEl, pageIndex, e);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (moveInLineSplit(e.shiftKey)) return;
      insertLineSplit(e.shiftKey ? 'center' : 'right');
      return;
    }

    if (e.key === 'Backspace') {
      if (deleteGuardRef.current) {
        e.preventDefault();
        return;
      }
      if (handleSplitBackspace()) {
        deleteGuardRef.current = true;
        window.setTimeout(() => {
          deleteGuardRef.current = false;
        }, 0);
        e.preventDefault();
        afterStructuralDelete();
        return;
      }
      consumeBackspace(pageEl, pageIndex, e);
    }
  };

  const handleEditorBeforeInput = (e: React.FormEvent<HTMLDivElement>, pageIndex: number) => {
    const ne = e.nativeEvent as InputEvent;
    const pageEl = ((e.target as HTMLElement).closest?.('[data-doc-page]') as HTMLElement | null)
      || e.currentTarget;
    if (ne.inputType === 'insertParagraph') {
      consumeEnter(pageEl, pageIndex, e);
      return;
    }
    if (ne.inputType !== 'deleteContentBackward') {
      markTyping();
      holdEditorScroll();
      requestAnimationFrame(() => {
        const root = editorRef.current;
        if (root && pagesOverflowing(root)) reflowPages(true);
      });
      return;
    }
    if (deleteGuardRef.current) {
      e.preventDefault();
      return;
    }
    if (handleSplitBackspace()) {
      deleteGuardRef.current = true;
      window.setTimeout(() => {
        deleteGuardRef.current = false;
      }, 0);
      e.preventDefault();
      afterStructuralDelete();
      return;
    }
    consumeBackspace(pageEl, pageIndex, e);
  };

  const splitHint = (cell: 'left' | 'center' | 'right') => {
    if (cell === 'left') return t.lineSlotLeft || 'Left';
    if (cell === 'center') return t.lineSlotCenter || 'Centre';
    return t.lineSlotRight || 'Right';
  };

  const syncSplitHints = (root: HTMLElement | null = editorRef.current) => {
    if (!root) return;
    const selCell = splitCellFromNode(window.getSelection()?.anchorNode || null);
    root.querySelectorAll('[data-split-cell]').forEach((node) => {
      const cell = node as HTMLElement;
      const empty = splitCellIsEmpty(cell);
      const role = (cell.getAttribute('data-split-cell') || 'left') as 'left' | 'center' | 'right';
      cell.setAttribute('data-empty', empty ? '1' : '0');
      cell.setAttribute('data-hint', empty ? splitHint(role) : '');
      if (selCell === cell) cell.setAttribute('data-active', '1');
      else cell.removeAttribute('data-active');
    });
    setActiveSplitCell(
      selCell
        ? ((selCell.getAttribute('data-split-cell') as 'left' | 'center' | 'right') || null)
        : null
    );
  };

  useEffect(() => {
    if (!isEditing) {
      setActiveSplitCell(null);
      return;
    }
    const onSel = () => syncSplitHints();
    document.addEventListener('selectionchange', onSel);
    const id = window.setTimeout(onSel, 0);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, language]);

  const handleEditorInput = (e?: React.FormEvent<HTMLDivElement>) => {
    const inputType = ((e?.nativeEvent as InputEvent | undefined)?.inputType || '');
    if (/^(insert|delete|format)/.test(inputType)) markEditorDirty();
    holdEditorScroll();
    if (!composingRef.current) scheduleHistorySnapshot();
    const root = editorRef.current;
    if (!root) return;
    syncSplitHints(root);
    if (!composingRef.current && pagesOverflowing(root)) {
      if (pageTimerRef.current) window.clearTimeout(pageTimerRef.current);
      pageTimerRef.current = window.setTimeout(() => reflowPages(true), 80);
    }
  };

  const insertContinuedMarks = () => {
    const root = editorRef.current;
    if (!root) return;
    markEditorDirty();
    holdEditorScroll();
    const pages = Array.from(root.querySelectorAll('[data-doc-page]')) as HTMLElement[];
    let htmls = pages.map((p) => p.innerHTML);
    if (!htmls.length) htmls = [EMPTY_PAGE_HTML];
    let idx = Math.max(0, visiblePage - 1);
    const node = window.getSelection()?.anchorNode;
    if (node) {
      const pageEl = (node instanceof Element ? node : node.parentElement)?.closest('[data-doc-page]');
      if (pageEl) {
        const n = Number(pageEl.getAttribute('data-doc-page'));
        if (Number.isFinite(n)) idx = n;
      }
    }
    idx = Math.max(0, Math.min(idx, htmls.length - 1));
    const already = continuedPagesRef.current.includes(idx);
    if (!already && idx >= htmls.length - 1) {
      htmls = [...htmls, EMPTY_PAGE_HTML];
    }
    const nextContinued = already
      ? continuedPagesRef.current.filter((n) => n !== idx)
      : [...continuedPagesRef.current, idx];
    continuedPagesRef.current = nextContinued;
    setContinuedPages(nextContinued);
    const next = paginateNow(stripContinuedHtml(htmls.join('')) || EMPTY_PAGE_HTML, nextContinued);
    docPagesRef.current = next.length ? next : [EMPTY_PAGE_HTML];
    setDocPages(docPagesRef.current);
  };

  const jumpToSplitCell = (row: HTMLElement, cell: 'left' | 'center' | 'right') => {
    const target = row.querySelector(`[data-split-cell="${cell}"]`) as HTMLElement | null;
    if (!target) return;
    if (splitCellIsEmpty(target)) target.innerHTML = '<br>';
    placeCaretAtStart(target);
    syncSplitHints();
  };

  const upgradeSplitToThree = (row: HTMLElement) => {
    const cells = Array.from(row.querySelectorAll('[data-split-cell]')) as HTMLElement[];
    const left = cells[0]?.innerHTML || '<br>';
    const right =
      cells.find((c) => c.getAttribute('data-split-cell') === 'right')?.innerHTML
      || cells[cells.length - 1]?.innerHTML
      || '<br>';
    row.insertAdjacentHTML('afterend', lineSplitHtml('center', left, `${CARET_MARK}<br>`, right));
    const created = row.nextElementSibling as HTMLElement;
    row.remove();
    return created;
  };

  const handleSplitBackspace = () => {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return false;
    const row = lineSplitFromNode(sel.anchorNode || null);
    const cell = splitCellFromNode(sel.anchorNode || null);
    if (!row || !cell) return false;
    const role = (cell.getAttribute('data-split-cell') || 'left') as 'left' | 'center' | 'right';
    const atStart = caretAtVisualStart(cell);
    const empty = splitCellIsEmpty(cell);

    if (role !== 'left') {
      if (!empty && !atStart) return false;
      if (extrasEmpty(row)) {
        unwrapLineSplit(row, 'end');
        syncSplitHints();
        return true;
      }
      const cells = Array.from(row.querySelectorAll('[data-split-cell]')) as HTMLElement[];
      const prev = cells[cells.indexOf(cell) - 1];
      if (prev) {
        placeCaretAtEnd(prev);
        syncSplitHints();
        return true;
      }
      return false;
    }

    if (atStart && extrasEmpty(row)) {
      unwrapLineSplit(row, 'start');
      syncSplitHints();
      return true;
    }
    return false;
  };

  const insertLineSplit = (mode: 'left' | 'center' | 'right') => {
    const root = editorRef.current;
    if (!root) return;
    markEditorDirty();
    holdEditorScroll();
    const sel = window.getSelection();
    const node = sel?.anchorNode || null;
    let existing = lineSplitFromNode(node);

    const fromSel = (node instanceof Element ? node : node?.parentElement)?.closest('[data-doc-page]') as HTMLElement | null;
    const pageEl = (fromSel && root.contains(fromSel) ? fromSel : null)
      || (root.querySelector(`[data-doc-page="${Math.max(0, visiblePage - 1)}"]`) as HTMLElement | null)
      || (root.querySelector('[data-doc-page]') as HTMLElement | null);
    if (!pageEl) return;

    let block = pageBlockFromCaret(pageEl);
    if (!existing && block) {
      existing = (block.closest?.('[data-line-split]') as HTMLElement | null)
        || (block.hasAttribute('data-line-split') ? block : null);
    }

    if (existing) {
      const currentRole = splitCellFromNode(node)?.getAttribute('data-split-cell');
      if (extrasEmpty(existing) && (mode === 'left' || currentRole === mode)) {
        unwrapLineSplit(existing, 'end');
        syncSplitHints();
        pushHistorySnapshot();
        return;
      }
      if (mode === 'center' && existing.getAttribute('data-line-split') !== '3') {
        const created = upgradeSplitToThree(existing);
        focusSplitCaret(created, 'center');
        syncSplitHints();
        pushHistorySnapshot();
        return;
      }
      jumpToSplitCell(existing, mode);
      return;
    }

    if (mode === 'left') {
      if (block && block !== pageEl) placeCaretAtStart(block);
      syncSplitHints();
      return;
    }

    if (!block || block === pageEl) {
      block = (pageEl.lastElementChild as HTMLElement | null);
    }

    const leftHtml = (block?.innerHTML || '').replace(/\u200b/g, '') || '<br>';
    const html = mode === 'center'
      ? lineSplitHtml('center', leftHtml, `${CARET_MARK}<br>`, '<br>')
      : lineSplitHtml('right', leftHtml, `${CARET_MARK}<br>`);
    let created: HTMLElement | null = null;
    if (block) {
      block.insertAdjacentHTML('afterend', html);
      created = block.nextElementSibling as HTMLElement;
      block.remove();
    } else {
      pageEl.insertAdjacentHTML('beforeend', html);
      created = pageEl.lastElementChild as HTMLElement;
    }
    focusSplitCaret(created, mode);
    syncSplitHints();
    pushHistorySnapshot();
  };

  const moveInLineSplit = (backward: boolean) => {
    const sel = window.getSelection();
    const row = lineSplitFromNode(sel?.anchorNode || null);
    if (!row) return false;
    const cells = Array.from(row.querySelectorAll('[data-split-cell]')) as HTMLElement[];
    const current = splitCellFromNode(sel?.anchorNode || null);
    const idx = current ? cells.indexOf(current) : 0;
    const next = cells[idx + (backward ? -1 : 1)];
    if (!next) return false;
    placeCaretAtEnd(next);
    syncSplitHints();
    return true;
  };

  const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) {
      requestAnimationFrame(() => reflowPages(true));
      return;
    }
    e.preventDefault();
    markEditorDirty();
    holdEditorScroll();
    const html = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => `<p style="margin:0;min-height:1.5em;white-space:pre-wrap;">${escapeHTML(line) || '<br>'}</p>`)
      .join('');
    if (e.defaultPrevented) {
      document.execCommand('insertHTML', false, html);
    }
    scheduleHistorySnapshot();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => reflowPages(true));
    });
  };

  const createDownloadVeil = (heading: string, hint: string) => {
    const veil = document.createElement('div');
    veil.className = 'casemate-pdf-veil';
    veil.innerHTML =
      `<div class="casemate-pdf-card">` +
      `<div class="casemate-pdf-spinner"></div>` +
      `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;letter-spacing:0.08em;color:#f5f5f5;margin-bottom:8px;">casemate</div>` +
      `<div style="font-size:15px;font-weight:600;color:#f5f5f5;">${heading}</div>` +
      `<div style="font-size:12px;color:#8a8a8a;margin-top:6px;">${hint}</div>` +
      `</div>`;
    return veil;
  };

  const downloadDocx = async () => {
    // A draft made by filling the advocate's own Word template is exported from that template's file,
    // so its tables, headers, footers, logos, numbering and page breaks are exactly the original's.
    try {
      const stored = await getFilledTemplate(msg.id);
      if (stored) {
        const edited = plainForCompare(msg.text) !== plainForCompare(stored.baseText);
        const keepEdits = edited && window.confirm(
          'You edited this draft after it was generated.\n\n' +
          'OK = download your edited text (rebuilt in the editor layout; your template\'s own formatting is NOT applied).\n' +
          'Cancel = download the template-exact file without your edits.\n\n' +
          'आपने ड्राफ्ट बदला है। OK = आपका बदला हुआ टेक्स्ट (एडिटर लेआउट में, टेम्पलेट का फ़ॉर्मेट नहीं)। Cancel = टेम्पलेट का हूबहू फ़ॉर्मेट, बिना आपके बदलावों के।'
        );
        if (!keepEdits) {
          const copy = new Uint8Array(stored.docx);
          await saveBlobFile(
            new Blob([copy], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
            `${title.replace(/\s+/g, '_')}.docx`
          );
          return;
        }
      }
    } catch (e) {
      console.warn('Could not use the stored template file; exporting from the editor text', e);
    }
    const screen = document.createElement('div');
    screen.setAttribute('aria-hidden', 'true');
    screen.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a0a;';
    screen.appendChild(createDownloadVeil(t.preparingDocx, t.preparingPdfHint));
    document.body.appendChild(screen);
    const shownAt = performance.now();
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const paragraphs: any[] = [];
      // Content width in DXA (twips) based on page size width minus equal margins
      const PAGE_CONTENT_WIDTH = Math.max(1440, 12240 - marginLeftTwips - marginRightTwips);

      let safeText = msg.text;
      safeText = safeText.replace(/\[ROW\]([\s\S]*?)\[\/ROW\]/gi, (_match, content) => {
        return `__ROW_START__${content.trim().replace(/\n/g, '<br>')}__ROW_END__`;
      });

      const lines = safeText.split('\n');

      const createRuns = (text: string) => {
        const runs: any[] = [];
        let isBold = false;
        let isItalic = false;
        let isUnderline = false;
        let currentText = "";
        const upperText = text.toUpperCase();

        const pushRun = () => {
          if (!currentText) return;
          runs.push(new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            underline: isUnderline ? { type: "single" } : undefined,
            font: "Nirmala UI",
            size: 24, // 12pt
          }));
          currentText = "";
        };

        for (let i = 0; i < text.length; i++) {
          if (text.startsWith('**', i)) {
            pushRun();
            isBold = !isBold;
            i++;
          } else if (text.startsWith('*', i)) {
            pushRun();
            isItalic = !isItalic;
          } else if (upperText.startsWith('[U]', i)) {
            pushRun();
            isUnderline = true;
            i += 2;
          } else if (upperText.startsWith('[/U]', i)) {
            pushRun();
            isUnderline = false;
            i += 3;
          } else {
            currentText += text[i];
          }
        }
        pushRun();
        if (runs.length === 0) {
          runs.push(new TextRun({ text: "", font: "Nirmala UI", size: 24 }));
        }
        return runs;
      };

      for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i];
        const prevLine = lines[i - 1] || '';
        const nextLine = lines[i + 1] || '';
        if (!currentLine.trim() && (prevLine.includes('__ROW_START__') || nextLine.includes('__ROW_START__'))) {
          continue;
        }

        if (currentLine.includes('__ROW_START__') && currentLine.includes('|')) {
          currentLine = currentLine.replace('__ROW_START__', '').replace('__ROW_END__', '');
          const rawParts = currentLine.split('|').map((p) => p.trim());
          const cols = rawParts.length >= 3
            ? [rawParts[0] || '', rawParts[1] || '', rawParts.slice(2).join(' | ')]
            : [rawParts[0] || '', rawParts[1] || ''];
          const aligns = cols.length === 3
            ? [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.RIGHT]
            : [AlignmentType.LEFT, AlignmentType.RIGHT];
          const colWidth = Math.floor(PAGE_CONTENT_WIDTH / cols.length);

          const createCellParagraphs = (text: string, align: any) => {
            const parts = text.split('<br>').map((t) => t.trim()).filter(Boolean);
            return (parts.length ? parts : ['']).map((t) => new Paragraph({
              children: createRuns(t),
              alignment: align,
              spacing: { before: 0, after: 0, line: 276 },
            }));
          };

          const noneBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
          paragraphs.push(new Table({
            width: { size: PAGE_CONTENT_WIDTH, type: WidthType.DXA },
            columnWidths: cols.map(() => colWidth),
            borders: {
              top: noneBorder,
              bottom: noneBorder,
              left: noneBorder,
              right: noneBorder,
              insideHorizontal: noneBorder,
              insideVertical: noneBorder,
            },
            rows: [
              new TableRow({
                children: cols.map((text, i) => new TableCell({
                  width: { size: colWidth, type: WidthType.DXA },
                  children: createCellParagraphs(text, aligns[i]),
                  margins: { top: 0, bottom: 0, left: 0, right: 0 },
                  borders: {
                    top: noneBorder,
                    bottom: noneBorder,
                    left: noneBorder,
                    right: noneBorder,
                  },
                })),
              }),
            ],
          }));
          continue;
        }

        if (!currentLine.trim()) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: "", font: "Nirmala UI", size: 24 })] }));
          continue;
        }

        let alignment: any = AlignmentType.BOTH;
        if (currentLine.toUpperCase().includes('[CENTER]')) {
          alignment = AlignmentType.CENTER;
          currentLine = currentLine.replace(/\[\/?CENTER\]/gi, '');
        } else if (currentLine.toUpperCase().includes('[RIGHT]')) {
          alignment = AlignmentType.RIGHT;
          currentLine = currentLine.replace(/\[\/?RIGHT\]/gi, '');
        } else if (currentLine.toUpperCase().includes('[LEFT]')) {
          alignment = AlignmentType.LEFT;
          currentLine = currentLine.replace(/\[\/?LEFT\]/gi, '');
        } else if (currentLine.toUpperCase().includes('[JUSTIFY]')) {
          alignment = AlignmentType.BOTH;
          currentLine = currentLine.replace(/\[\/?JUSTIFY\]/gi, '');
        }

        paragraphs.push(new Paragraph({
          alignment,
          children: createRuns(currentLine),
        }));
      }

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              size: {
                width: 12240,
                height: pageSize === 'a4' ? 16838 : pageSize === 'letter' ? 15840 : 20160,
              },
              margin: {
                top: marginTopTwips,
                right: marginRightTwips,
                bottom: marginBottomTwips,
                left: marginLeftTwips,
              },
            },
          },
          children: paragraphs,
        }],
      });

      const blob = await Packer.toBlob(doc);
      await saveBlobFile(blob, `${title.replace(/\s+/g, '_')}.docx`);
    } catch (error) {
      console.error("Error generating DOCX:", error);
      alert("Failed to generate DOCX file.");
    } finally {
      const remain = 450 - (performance.now() - shownAt);
      if (remain > 0) await new Promise((r) => window.setTimeout(r, remain));
      screen.remove();
    }
  };

  const downloadPdf = async () => {
    const html2canvas = (window as any).html2canvas;
    const JsPDF = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
    if (!html2canvas || !JsPDF) {
      alert("PDF generation library is still loading. Please try again in a moment.");
      return;
    }

    const filename = `${title.replace(/\s+/g, '_')}.pdf`;
    try {
      const stored = await getScanDraft(msg.id);
      if (stored) {
        const edited = plainForCompare(msg.text) !== plainForCompare(stored.baseText);
        const keepEdits = edited && window.confirm(
          'You edited this draft after it was generated.\n\n' +
          'OK = PDF from the editor view (your edits; template layout is NOT applied).\n' +
          'Cancel = PDF from the scanned-template reconstruction, without your edits.\n\n' +
          'आपने ड्राफ्ट बदला है। OK = एडिटर व्यू (आपके बदलाव)। Cancel = स्कैन टेम्पलेट से बना PDF, बिना आपके बदलावों के।'
        );
        if (!keepEdits) {
          const profile = await getProfile(stored.profileId);
          if (profile) {
            const stage = document.createElement('div');
            stage.setAttribute('aria-hidden', 'true');
            stage.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a0a;overflow:hidden;';
            stage.appendChild(createDownloadVeil(t.preparingPdf, t.preparingPdfHint));
            document.body.appendChild(stage);
            try {
              const { exportScanPdf } = await import('../utils/scanExport');
              const outcome = await exportScanPdf({
                profile,
                draft: stored.draft,
                stage,
                chooseOriginal: (plan) => {
                  if (!plan.eligible) return false;
                  return window.confirm(
                    'OK = original scan as the page background (text only in the replaced lines). Best for short fills on a form.\n' +
                    'Cancel = reconstructed flowing pages matching the Word file. Use this for petitions.\n\n' +
                    'OK = मूल स्कैन पृष्ठ, केवल बदली हुई पंक्तियाँ। Cancel = Word जैसा बहता लेआउट (याचिकाओं के लिए)।'
                  );
                },
              });
              await saveBlobFile(outcome.blob, filename);
              const failed = outcome.checks.filter((c) => !c.ok);
              if (failed.length || outcome.notes.length) {
                alert(
                  [
                    outcome.mode === 'original-layout'
                      ? (language === 'Hindi' ? 'PDF मूल स्कैन पृष्ठ पर बना है।' : 'PDF used the original scan as the page background.')
                      : (language === 'Hindi' ? 'PDF बहते पृष्ठों से बना है (टेम्पलेट प्रोफ़ाइल)। मूल से अंतर हो सकता है।' : 'PDF was rebuilt as flowing pages from the template reading. Compare it with your original.'),
                    ...outcome.notes,
                    ...failed.map((c) => c.detail),
                  ].join('\n')
                );
              }
              return;
            } finally {
              stage.remove();
            }
          }
        }
      }
    } catch (e) {
      console.warn('Scanned-template PDF export failed; using the editor view', e);
    }

    const pagesHtml = docPages.some((p) => (p || '').replace(/<[^>]+>/g, '').trim())
      ? docPages
      : layoutNow(parseFormattingToHTML(msg.text)).pages;
    if (!pagesHtml.length) {
      alert("Document container not found!");
      return;
    }

    let pdfFormat = 'legal';
    if (pageSize === 'a4') pdfFormat = 'a4';
    if (pageSize === 'letter') pdfFormat = 'letter';

    const pdfBand = continuedBandPx(fontSize);
    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a0a;overflow:hidden;';
    const mount = document.createElement('div');
    mount.style.cssText = 'position:absolute;left:0;top:0;z-index:0;background:#ffffff;';
    pagesHtml.forEach((html, i) => {
      const hasHead = continuedPages.includes(i - 1);
      const hasFoot = continuedPages.includes(i);
      const bodyH = Math.max(60, contentHeightPx - (hasHead ? pdfBand : 0) - (hasFoot ? pdfBand : 0));
      const page = document.createElement('div');
      page.className = 'casemate-pdf-page';
      page.style.cssText = [
        `width:${pageWidthPx}px`,
        `height:${pageHeightPx}px`,
        `padding:${pagePadding}`,
        'box-sizing:border-box',
        'background:#ffffff',
        'color:#111111',
        "font-family:'Nirmala UI','Mangal','Arial Unicode MS','Times New Roman',serif",
        `font-size:${fontSize}`,
        'line-height:1.5',
        'white-space:pre-wrap',
        'word-break:normal',
        'overflow:hidden',
        'text-align:justify',
      ].join(';');
      page.style.position = 'relative';
      const surface = document.createElement('div');
      surface.className = `casemate-pdf-surface${hasHead ? ' has-continued-head' : ''}${hasFoot ? ' has-continued-foot' : ''}`;
      surface.style.cssText = [
        'display:block',
        'position:relative',
        'width:100%',
        `height:${contentHeightPx}px`,
        'overflow:visible',
      ].join(';');
      if (hasHead) {
        const head = document.createElement('div');
        head.className = 'casemate-continued-head';
        head.textContent = `//${i + 1}//`;
        head.style.cssText = [
          'display:block',
          `height:${pdfBand}px`,
          `line-height:${pdfBand}px`,
          'text-align:center',
          'overflow:visible',
          'padding:0',
          'margin:0',
          'min-height:0',
          'box-sizing:border-box',
        ].join(';');
        surface.appendChild(head);
      }
      const body = document.createElement('div');
      body.className = 'casemate-doc-page casemate-pdf-body';
      body.style.cssText = [
        'display:block',
        `height:${bodyH}px`,
        'overflow:hidden',
        'min-height:0',
      ].join(';');
      body.innerHTML = html;
      surface.appendChild(body);
      if (hasFoot) {
        const foot = document.createElement('div');
        foot.className = 'casemate-continued-foot';
        foot.textContent = `शेष //${i + 2}// पर`;
        foot.style.cssText = [
          'display:block',
          `height:${pdfBand}px`,
          `line-height:${pdfBand}px`,
          'text-align:right',
          'overflow:visible',
          'padding:0',
          'margin:0',
          'min-height:0',
          'box-sizing:border-box',
        ].join(';');
        surface.appendChild(foot);
      }
      page.appendChild(surface);
      mount.appendChild(page);
    });
    const veil = createDownloadVeil(t.preparingPdf, t.preparingPdfHint);
    stage.appendChild(mount);
    stage.appendChild(veil);
    document.body.appendChild(stage);

    try {
      if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
      await new Promise((r) => window.setTimeout(r, 120));
      const pageEls = Array.from(stage.querySelectorAll('.casemate-pdf-page')) as HTMLElement[];
      const pdf = new JsPDF({ unit: 'mm', format: pdfFormat, orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await html2canvas(pageEls[i], {
          scale: 1.2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          foreignObjectRendering: false,
          logging: false,
          width: pageWidthPx,
          height: pageHeightPx,
          windowWidth: pageWidthPx,
          windowHeight: pageHeightPx,
          onclone: (_doc: Document, el: HTMLElement) => {
            el.querySelectorAll('.casemate-continued-head, .casemate-continued-foot').forEach((node) => {
              const mark = node as HTMLElement;
              mark.style.overflow = 'visible';
              mark.style.visibility = 'visible';
              mark.style.clipPath = 'none';
            });
          },
        });
        if (!canvas.width || !canvas.height) throw new Error('Empty PDF page');
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH);
      }
      const blob = new Blob([pdf.output('blob')], { type: 'application/pdf' });
      if (blob.size < 800) throw new Error('Empty PDF');
      await saveBlobFile(blob, filename);
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('Failed to generate PDF.');
    } finally {
      stage.remove();
    }
  };

  const toolBtn = "h-8 min-w-[32px] px-2 flex items-center justify-center hover:bg-neutral-800 rounded text-xs font-medium shrink-0";

  const renderPageStack = (editable: boolean) =>
    docPages.map((html, i) => (
      <React.Fragment key={`sheet-${i}-${editable ? 'edit' : 'view'}`}>
        {i > 0 && (
          <div className="casemate-page-gutter" contentEditable={false}>
            //{i + 1}//
          </div>
        )}
        <div
          className="casemate-doc-sheet"
          style={{
            width: pageWidth,
            height: pageMinHeight,
            padding: pagePadding,
            fontFamily: "'Times New Roman', 'Nirmala UI', 'Mangal', 'Arial Unicode MS', serif",
            fontSize,
            lineHeight: 1.5,
            color: '#000',
          }}
        >
          <div className={`casemate-doc-surface${continuedPages.includes(i - 1) ? ' has-continued-head' : ''}${continuedPages.includes(i) ? ' has-continued-foot' : ''}`}>
            <div className={`casemate-continued-head${continuedPages.includes(i - 1) ? '' : ' is-off'}`} contentEditable={false}>{`//${i + 1}//`}</div>
            <div
              className="casemate-doc-page"
              data-doc-page={String(i)}
              contentEditable={editable}
              suppressContentEditableWarning
              onInput={editable ? handleEditorInput : undefined}
              onKeyDown={editable ? (e) => handleEditorKeyDown(e, i) : undefined}
              onFocus={editable ? ensureParagraphSeparator : undefined}
              onBeforeInput={editable ? (e) => handleEditorBeforeInput(e, i) : undefined}
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'normal',
                overflowWrap: 'break-word',
                lineBreak: 'auto',
                textAlign: 'justify',
                outline: 'none',
              }}
              {...(!editable ? { dangerouslySetInnerHTML: { __html: html } } : {})}
            />
            <div className={`casemate-continued-foot${continuedPages.includes(i) ? '' : ' is-off'}`} contentEditable={false}>{`शेष //${i + 2}// पर`}</div>
          </div>
        </div>
      </React.Fragment>
    ));

  const editor = isEditing && typeof document !== 'undefined' ? createPortal(
    <div
      ref={editorOverlayRef}
      className="flex flex-col text-white"
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H')) {
          e.preventDefault();
          openFindBar();
        } else if (mod && (e.key === '=' || e.key === '+' || e.key === '-')) {
          e.preventDefault();
          setZoomLevel((z) => clampZoom(z + (e.key === '-' ? -0.1 : 0.1)));
        } else if (mod && e.key === '0') {
          e.preventDefault();
          setZoomLevel(1);
        } else if (e.key === 'Escape' && findOpen) {
          e.preventDefault();
          setFindOpen(false);
        }
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100dvh',
        zIndex: 2147483000,
        background: '#5a5a5a',
        overflow: 'hidden',
        overscrollBehavior: 'none',
      }}
    >
      <div
        className="shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', background: '#1a1a1a' }}
      >
        <div className="flex items-center gap-2 px-2 sm:px-3 py-2 border-b border-black/40">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDiscard}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-neutral-800"
            aria-label={t.cancel}
          >
            <span className="text-lg leading-none">←</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{title}</div>
            <div className="text-[11px] text-band-mute">{pageCount} {t.pages}</div>
          </div>
          <div className="flex items-center gap-0.5 bg-ink-soft p-0.5 rounded-lg border border-ink-border shrink-0">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setZoomLevel((z) => clampZoom(z - 0.1))}
              className={`${toolBtn} text-base`}
              title={t.zoomOut || 'Zoom out'}
            >
              −
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setZoomLevel(1)}
              className={`${toolBtn} min-w-[3.2rem] text-[11px]`}
              title={t.zoomReset || 'Reset zoom'}
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setZoomLevel((z) => clampZoom(z + 0.1))}
              className={`${toolBtn} text-base`}
              title={t.zoomIn || 'Zoom in'}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleSave}
            className="px-3 h-9 rounded-lg bg-white text-black text-sm font-semibold hover:bg-neutral-200 shrink-0"
          >
            {isCloudSyncing ? (t.saving || 'Saving…') : (t.save || t.saveChanges)}
          </button>
        </div>
        <div className="bg-[#222] border-b border-black/30 px-2 py-1.5 overflow-x-auto">
          <div className="flex items-center gap-1.5 min-w-max text-band-dim">
            <div className="flex items-center gap-0.5 bg-ink-soft p-0.5 rounded-lg border border-ink-border">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('bold')} className={`${toolBtn} font-bold`} title="Bold">B</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('italic')} className={`${toolBtn} italic`} title="Italic">I</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('underline')} className={`${toolBtn} underline`} title="Underline">U</button>
            </div>
            <div className="flex items-center gap-0.5 bg-ink-soft p-0.5 rounded-lg border border-ink-border">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleUndo} disabled={!canUndo} className={`${toolBtn} disabled:opacity-40`} title={t.undo}>{t.undo}</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleRedo} disabled={!canRedo} className={`${toolBtn} disabled:opacity-40`} title={t.redo}>{t.redo}</button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (findOpen ? setFindOpen(false) : openFindBar())}
                className={`${toolBtn} ${findOpen ? 'bg-neutral-700 text-white' : ''}`}
                title={`${t.find || 'Find'} (Ctrl+F)`}
              >
                <SearchIcon className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-ink-soft p-0.5 rounded-lg border border-ink-border">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('justifyLeft')} className={toolBtn}>Left</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('justifyCenter')} className={toolBtn}>Center</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('justifyRight')} className={toolBtn}>Right</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('justifyFull')} className={toolBtn}>Justify</button>
            </div>
            <div className="flex items-center gap-0.5 bg-ink-soft p-0.5 rounded-lg border border-ink-border">
              <span className="px-1.5 text-[10px] text-neutral-400 whitespace-nowrap">{t.sameLine || 'Same line'}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertLineSplit('left')}
                className={`${toolBtn} px-2 ${activeSplitCell === 'left' ? 'bg-neutral-700 text-white' : ''}`}
                title={t.lineSlotLeftHint || 'Type at the left of this line'}
              >
                {t.lineSlotLeft || 'Left'}
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertLineSplit('center')}
                className={`${toolBtn} px-2 ${activeSplitCell === 'center' ? 'bg-neutral-700 text-white' : ''}`}
                title={t.lineSlotCenterHint || 'Type at the centre of this line'}
              >
                {t.lineSlotCenter || 'Centre'}
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertLineSplit('right')}
                className={`${toolBtn} px-2 ${activeSplitCell === 'right' ? 'bg-neutral-700 text-white' : ''}`}
                title={t.lineSlotRightHint || 'Type at the right of this line'}
              >
                {t.lineSlotRight || 'Right'}
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-ink-soft p-0.5 rounded-lg border border-ink-border">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('insertUnorderedList')} className={toolBtn} title="Bullets">•</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('insertOrderedList')} className={toolBtn} title="Numbers">1.</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('outdent')} className={toolBtn} title="Outdent">⇤</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('indent')} className={toolBtn} title="Indent">⇥</button>
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertContinuedMarks}
              className={toolBtn}
              title={t.addContinued}
            >
              {t.addContinued}
            </button>
            <select value={fontSize} onChange={(e) => setFontSize(e.target.value)} className="bg-ink-soft border border-ink-border rounded-lg px-2 h-8 outline-none text-xs">
              <option value="10pt">10pt</option>
              <option value="11pt">11pt</option>
              <option value="12pt">12pt</option>
              <option value="14pt">14pt</option>
            </select>
            <select value={pageSize} onChange={(e) => setPageSize(e.target.value)} className="bg-ink-soft border border-ink-border rounded-lg px-2 h-8 outline-none text-xs">
              <option value="legal">Legal</option>
              <option value="letter">Letter</option>
              <option value="a4">A4</option>
            </select>
            <label className="flex items-center gap-1 text-[11px] text-band-mute">
              {t.marginTop}
              <select value={marginTop} onChange={(e) => setMarginTop(e.target.value)} className="bg-ink-soft border border-ink-border rounded-lg px-1.5 h-8 outline-none text-xs text-band-dim">
                {MARGIN_OPTIONS.map((m) => <option key={`t-${m}`} value={m}>{m.replace('in', '"')}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-band-mute">
              {t.marginRight}
              <select value={marginRight} onChange={(e) => setMarginRight(e.target.value)} className="bg-ink-soft border border-ink-border rounded-lg px-1.5 h-8 outline-none text-xs text-band-dim">
                {MARGIN_OPTIONS.map((m) => <option key={`r-${m}`} value={m}>{m.replace('in', '"')}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-band-mute">
              {t.marginBottom}
              <select value={marginBottom} onChange={(e) => setMarginBottom(e.target.value)} className="bg-ink-soft border border-ink-border rounded-lg px-1.5 h-8 outline-none text-xs text-band-dim">
                {MARGIN_OPTIONS.map((m) => <option key={`b-${m}`} value={m}>{m.replace('in', '"')}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-band-mute">
              {t.marginLeft}
              <select value={marginLeft} onChange={(e) => setMarginLeft(e.target.value)} className="bg-ink-soft border border-ink-border rounded-lg px-1.5 h-8 outline-none text-xs text-band-dim">
                {MARGIN_OPTIONS.map((m) => <option key={`l-${m}`} value={m}>{m.replace('in', '"')}</option>)}
              </select>
            </label>
          </div>
        </div>
        {findOpen && (
          <div className="bg-[#2a2a2a] border-b border-black/30 px-2 py-2 flex flex-wrap items-center gap-2">
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  goToFindMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setFindOpen(false);
                }
              }}
              placeholder={t.find || 'Find'}
              className="h-8 min-w-[140px] flex-1 bg-ink-soft border border-ink-border rounded-lg px-2 text-sm outline-none text-white"
            />
            <input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  replaceCurrentMatch();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setFindOpen(false);
                }
              }}
              placeholder={t.replace || 'Replace'}
              className="h-8 min-w-[140px] flex-1 bg-ink-soft border border-ink-border rounded-lg px-2 text-sm outline-none text-white"
            />
            <span className="text-[11px] text-band-mute shrink-0 min-w-[4.5rem]">
              {findQuery
                ? (matchCount ? `${matchIndex + 1}/${matchCount}` : (t.noMatches || 'No matches'))
                : ''}
            </span>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goToFindMatch(-1)} className={toolBtn} title={t.findPrev || 'Previous'}>↑</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goToFindMatch(1)} className={toolBtn} title={t.findNext || 'Next'}>↓</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={replaceCurrentMatch} className={`${toolBtn} px-2`} title={t.replace || 'Replace'}>{t.replace || 'Replace'}</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={replaceAllMatches} className={`${toolBtn} px-2`} title={t.replaceAll || 'Replace all'}>{t.replaceAll || 'Replace all'}</button>
            <label className="flex items-center gap-1 text-[11px] text-band-mute shrink-0">
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
              {t.matchCase || 'Match case'}
            </label>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setFindOpen(false)} className={toolBtn} aria-label={t.cancel}>
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={editorViewportRef}
        className="flex-1 min-h-0 overflow-auto overscroll-contain relative"
        style={{ paddingBottom: 'max(160px, env(safe-area-inset-bottom, 12px))', overflowAnchor: 'none' }}
      >
        <div className="sticky top-3 z-10 flex justify-end pr-3 pointer-events-none">
          <div className="rounded-full bg-black/70 text-white text-xs px-2.5 py-1">
            {visiblePage}/{pageCount}
          </div>
        </div>
        <div className="flex justify-center py-3 px-2">
          <div
            ref={editorShellRef}
            style={{ width: pageWidthPx * editorViewScale, height: stackHeightPx * editorViewScale }}
          >
            <div
              ref={editorRef}
              onInput={handleEditorInput}
              onPasteCapture={handleEditorPaste}
              onKeyDown={(e) => {
                const page = (e.target as HTMLElement).closest?.('[data-doc-page]') as HTMLElement | null;
                if (!page) return;
                handleEditorKeyDown(e, Number(page.getAttribute('data-doc-page')) || 0);
              }}
              onBeforeInput={(e) => {
                const page = (e.target as HTMLElement).closest?.('[data-doc-page]') as HTMLElement | null;
                if (!page) return;
                handleEditorBeforeInput(e, Number(page.getAttribute('data-doc-page')) || 0);
              }}
              onCompositionStart={() => {
                composingRef.current = true;
                markTyping();
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
                markEditorDirty();
                scheduleHistorySnapshot();
              }}
              onFocus={() => {
                ensureParagraphSeparator();
                holdEditorScroll();
                markTyping();
              }}
              style={{
                width: pageWidthPx,
                transform: `scale(${editorViewScale})`,
                transformOrigin: 'top left',
              }}
            >
              {docPages.map((_, i) => (
                <EditorSheet
                  key={`edit-sheet-${i}`}
                  index={i}
                  pageWidth={pageWidth}
                  pageMinHeight={pageMinHeight}
                  pagePadding={pagePadding}
                  fontSize={fontSize}
                  showHead={continuedPages.includes(i - 1)}
                  showFoot={continuedPages.includes(i)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="w-full bg-ink-muted/70 rounded-xl border border-ink-border overflow-hidden shadow-lg">
      {editor}
      <div
        ref={viewportRef}
        className="w-full p-2 sm:p-8 bg-ink flex justify-center overflow-x-hidden overflow-y-visible"
      >
        <div
          ref={scaleShellRef}
          style={{
            width: pageWidthPx * viewScale,
            height: stackHeightPx * viewScale,
            overflow: 'hidden',
          }}
        >
          <div
            ref={contentRef}
            style={{
              width: pageWidthPx,
              transform: `scale(${viewScale})`,
              transformOrigin: 'top left',
            }}
          >
            {renderPageStack(false)}
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4 bg-ink-muted border-t border-ink-border flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 text-xs sm:text-sm text-band-mute">
          <TemplateIcon className="w-4 h-4 text-band-dim flex-shrink-0" />
          <span>Legal Document Generated</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(cleanChatReply(msg.text)).catch(() => undefined);
            }}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <CopyIcon className="w-3.5 h-3.5" /> {t.copy}
          </button>
          <button
            type="button"
            onClick={() => { void sharePlainText(cleanChatReply(msg.text), title); }}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <ShareIcon className="w-3.5 h-3.5" /> {t.share}
          </button>
          {hasScanDraft && (
            <button
              type="button"
              onClick={() => setScanCheckOpen(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <TemplateIcon className="w-3.5 h-3.5" /> {language === 'Hindi' ? 'टेम्पलेट जाँच' : 'Template check'}
            </button>
          )}
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <EditIcon className="w-3.5 h-3.5" /> {t.edit}
          </button>
          <button onClick={downloadDocx} className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white text-black hover:bg-neutral-200 text-xs font-medium rounded-lg transition-colors">
            <DocxIcon className="w-3.5 h-3.5" /> {t.downloadDocx}
          </button>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors">
            <PdfIcon className="w-3.5 h-3.5" /> {t.downloadPdf}
          </button>
        </div>
      </div>
      {scanCheckOpen && (
        <ScanTemplateCheck
          messageId={msg.id}
          language={language}
          onClose={() => setScanCheckOpen(false)}
        />
      )}
    </div>
  );
});

const renderInlineText = (line: string, keyPrefix: string) => {
  if (/https?:\/\/\S+/.test(line)) {
    const urlParts = line.split(/(https?:\/\/\S+)/g);
    return urlParts.map((seg, k) =>
      /^https?:\/\//.test(seg) ? (
        <a
          key={`${keyPrefix}-u${k}`}
          href={seg}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 underline underline-offset-2"
        >
          open ↗
        </a>
      ) : (
        <React.Fragment key={`${keyPrefix}-t${k}`}>{renderInlineText(seg, `${keyPrefix}-t${k}`)}</React.Fragment>
      )
    );
  }
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, j) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-${j}`} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    const plain = part.replace(/`+/g, '').replace(/\*+/g, '').replace(/_{2,}/g, '');
    return <span key={`${keyPrefix}-${j}`}>{plain}</span>;
  });
};

const formatMessageText = (text: string) => {
  const lines = cleanChatReply(text).split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (/^\s*(?:-{3,}|_{3,}|\*{3,}|—{2,})\s*$/.test(line)) {
          return <div key={i} className="h-3" />;
        }
        const heading = line.match(/^(#{1,6})\s*(.+)$/);
        if (heading) {
          return <p key={i} className="text-[17px] font-semibold text-white mt-1">{renderInlineText(heading[2], `${i}`)}</p>;
        }
        const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-0.5">
              <span className="text-band-mute leading-relaxed">•</span>
              <span className="min-w-0">{renderInlineText(bullet[1], `${i}`)}</span>
            </div>
          );
        }
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2 pl-0.5">
              <span className="text-band-mute tabular-nums leading-relaxed">{numbered[1]}.</span>
              <span className="min-w-0">{renderInlineText(numbered[2], `${i}`)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <p key={i}>{renderInlineText(line, `${i}`)}</p>;
      })}
    </div>
  );
};

const ChatAction = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="relative group/chat-action flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
  >
    {children}
    <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-0.5 rounded-md bg-black text-white text-[11px] font-medium opacity-0 group-hover/chat-action:opacity-100 whitespace-nowrap shadow-lg z-20">
      {label}
    </span>
  </button>
);

type ChatMessageListProps = {
  messages: Message[];
  activeTitle: string;
  language: string;
  editingId: string | null;
  editDraft: string;
  maxMessageChars: number;
  t: any;
  isTimeUp: boolean;
  copiedId: string | null;
  isLoading: boolean;
  mediaStatus: string;
  onEditDraft: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (msg: Message) => void;
  onStartEdit: (msg: Message) => void;
  onCopy: (id: string, text: string) => void;
  onShare: (text: string) => void;
  onUpdateDocument: (id: string, text: string) => void;
  onSuggest: (question: string) => void;
};

const ChatMessageList = memo(function ChatMessageList({
  messages,
  activeTitle,
  language,
  editingId,
  editDraft,
  maxMessageChars,
  t,
  isTimeUp,
  copiedId,
  isLoading,
  mediaStatus,
  onEditDraft,
  onCancelEdit,
  onSaveEdit,
  onStartEdit,
  onCopy,
  onShare,
  onUpdateDocument,
  onSuggest,
}: ChatMessageListProps) {
  let lastDay = '';
  return (
    <>
      {messages.map((msg) => {
        const day = chatDayKey(msg.timestamp);
        const showDay = !!day && day !== lastDay;
        if (day) lastDay = day;
        const clock = formatChatTime(msg.timestamp, language);
        return (
        <div key={msg.id}>
          {showDay && (
            <div className="flex justify-center mb-4">
              <span className="px-3 py-1 rounded-full bg-ink-muted border border-ink-border text-[11px] font-medium text-band-mute">
                {formatChatDay(msg.timestamp, language)}
              </span>
            </div>
          )}
        <div
          className={`chat-row flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${msg.isDocument ? '' : 'chat-row-light'}`}
        >
          {msg.role === 'model' && (
            <div className="w-8 h-8 rounded-full overflow-hidden border border-ink-border flex items-center justify-center flex-shrink-0 mt-1 bg-black">
              <BrandLogo size={32} />
            </div>
          )}

          <div className={`${msg.isDocument ? 'w-full max-w-full min-w-0' : 'max-w-[85%] sm:max-w-[75%]'} ${msg.role === 'user' ? 'order-1' : 'order-2'}`}>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className={`flex flex-wrap gap-2 mb-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.attachments.map((att, i) => {
                  const isImage = !!att.mimeType?.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(att.name);
                  const chip = (
                    <div className={`flex items-center text-xs px-2.5 py-1.5 rounded-md border ${
                      att.type === 'case'
                        ? 'bg-sky-950/50 text-sky-200 border-sky-700/50'
                        : 'bg-amber-950/50 text-amber-200 border-amber-700/50'
                    }`}>
                      {att.url && isImage ? (
                        <img src={att.url} alt="" loading="lazy" decoding="async" className="w-8 h-8 rounded object-cover mr-1.5 flex-shrink-0" />
                      ) : att.type === 'case' ? (
                        <PaperclipIcon className="w-3 h-3 mr-1.5" />
                      ) : (
                        <TemplateIcon className="w-3 h-3 mr-1.5" />
                      )}
                      <span className="truncate max-w-[160px] font-medium">{att.name}</span>
                    </div>
                  );
                  return att.url ? (
                    <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-90">
                      {chip}
                    </a>
                  ) : (
                    <div key={i}>{chip}</div>
                  );
                })}
              </div>
            )}

            {msg.text && (
              <div className={`${msg.isDocument ? 'p-0 sm:p-1 overflow-hidden text-[15px]' : 'px-5 py-3.5'} rounded-2xl leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-white text-black rounded-tr-sm text-[15px]'
                  : msg.isDocument
                    ? 'bg-ink-muted border border-ink-border text-band-dim rounded-tl-sm'
                    : 'bg-ink-muted border border-ink-border text-band rounded-tl-sm text-[16.5px] sm:text-[17px] font-medium tracking-[0.01em]'
              }`}>
                {msg.isDocument ? (
                  <DocumentViewer
                    msg={msg}
                    title={activeTitle || 'Legal_Document'}
                    t={t}
                    onUpdate={onUpdateDocument}
                  />
                ) : editingId === msg.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editDraft}
                      onChange={(e) => onEditDraft(e.target.value.slice(0, maxMessageChars))}
                      className="w-full min-h-[88px] max-h-48 p-2 rounded-lg bg-neutral-100 text-black text-[15px] outline-none resize-y"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg bg-neutral-200 text-black hover:bg-neutral-300"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSaveEdit(msg)}
                        disabled={!editDraft.trim()}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg bg-black text-white hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {t.save}
                      </button>
                    </div>
                  </div>
                ) : (
                  formatMessageText(msg.text)
                )}
              </div>
            )}

            {editingId !== msg.id && (msg.role === 'model' || msg.role === 'user' || clock) && (
              <div className={`flex items-center gap-0.5 mt-1.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {clock && (
                  <span className={`text-[11px] text-band-mute px-1 ${msg.role === 'user' ? 'order-last' : ''}`}>{clock}</span>
                )}
                {msg.role === 'model' && (
                  <>
                    <ChatAction
                      label={copiedId === msg.id ? t.copied : t.copy}
                      onClick={() => void onCopy(msg.id, msg.text)}
                    >
                      {copiedId === msg.id ? <CheckIcon className="w-5 h-5" /> : <CopyIcon className="w-5 h-5" />}
                    </ChatAction>
                    <ChatAction
                      label={t.share}
                      onClick={() => void onShare(msg.text)}
                    >
                      <ShareIcon className="w-5 h-5" />
                    </ChatAction>
                  </>
                )}
                {msg.role === 'user' && (
                  <ChatAction label={t.editMessage} onClick={() => onStartEdit(msg)}>
                    <EditIcon className="w-5 h-5" />
                  </ChatAction>
                )}
              </div>
            )}
            {msg.role === 'model' && (msg.suggestedQuestions?.length || 0) > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-band-mute flex items-center gap-1.5 px-0.5">
                  <span aria-hidden="true">✦</span>
                  {t.suggestedQuestions || 'Suggested questions'}
                </p>
                {msg.suggestedQuestions!.map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={isLoading}
                    onClick={() => onSuggest(question)}
                    className="w-full text-left px-3 py-2.5 rounded-xl bg-ink border border-ink-border text-sm text-band hover:bg-white/5 disabled:opacity-50 flex items-start gap-2"
                  >
                    <span aria-hidden="true" className="mt-0.5">💡</span>
                    <span>{question}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {msg.role === 'user' && (
            <div className="w-8 h-8 rounded-full bg-white/10 border border-ink-border flex items-center justify-center flex-shrink-0 mt-1 order-2">
              <UserIcon className="w-5 h-5 text-band-dim" />
            </div>
          )}
        </div>
        </div>
        );
      })}

      {isLoading && (
        <div className="flex gap-4 justify-start">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-ink-border flex items-center justify-center flex-shrink-0 mt-1 bg-black">
            <BrandLogo size={32} />
          </div>
          <div className="bg-ink-muted border border-ink-border px-5 py-4 rounded-2xl rounded-tl-sm flex flex-col gap-2 max-w-[85%]">
            <div className="flex items-center gap-1.5">
              <span className="typing-band" style={{ animationDelay: '0ms' }} />
              <span className="typing-band" style={{ animationDelay: '160ms' }} />
              <span className="typing-band" style={{ animationDelay: '320ms' }} />
            </div>
            {mediaStatus && (
              <p className="text-xs text-band-mute">{mediaStatus}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
});

export const ChatArea = memo(function ChatArea() {
  const { activeSessionId, setActiveSessionId, chatSessions, addMessageToActiveSession, updateMessageText, updateMessageFields, trimMessagesAfter, nameChatFromClient, isTimeUp, language, isSidebarOpen, setIsSidebarOpen, incrementDraftCount, decrementDraftCount, setIsSubscriptionModalOpen, setIsUpgradeModalOpen, user, draftCount, cloudTemplates, caseLearnings, upsertCaseLearning, userMode } = useAppContext();
  const [chatLimitOpen, setChatLimitOpen] = useState(false);
  const [chatLimitReason, setChatLimitReason] = useState<'near' | 'reached'>('near');
  const [inputText, setInputText] = useState('');
  const [caseFiles, setCaseFiles] = useState<File[]>([]);
  const planLimits = getPlanLimits(user?.plan, user?.email, user);
  const [formatFiles, setFormatFiles] = useState<File[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [openTemplateGroup, setOpenTemplateGroup] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mediaStatus, setMediaStatus] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hideContinueHint, setHideContinueHint] = useState(() => {
    try { return sessionStorage.getItem('casemate_hide_continue_hint') === '1'; } catch { return false; }
  });
  const [transferBusy, setTransferBusy] = useState<{
    title: string;
    detail?: string;
    done?: number;
    total?: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesListRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const formatFileInputRef = useRef<HTMLInputElement>(null);
  const formatCameraInputRef = useRef<HTMLInputElement>(null);
  const caseFileInputRef = useRef<HTMLInputElement>(null);
  const caseCameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const speechBaseTextRef = useRef('');
  const wantListeningRef = useRef(false);
  const sendAbortRef = useRef<AbortController | null>(null);
  const sendLockRef = useRef(false);
  const [communityStyles, setCommunityStyles] = useState('');

  const t = translations[language] || translations['English'];
  const activeSession = chatSessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];
  const webSpeechOk = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const [nativeSpeechOk, setNativeSpeechOk] = useState(isAndroidSpeechPlatform());
  const isSpeechSupported = nativeSpeechOk || webSpeechOk;

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  };

  useEffect(() => {
    resizeTextarea();
  }, [inputText]);

  useEffect(() => {
    if (!user?.id) return;
    void loadCommunityStyles().then(setCommunityStyles);
  }, [user?.id]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (attachMenuRef.current && !attachMenuRef.current.contains(target)) {
        setShowAttachMenu(false);
        setShowTemplateMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [showAttachMenu]);

  const builtInTemplateOptions = [
    { id: 'bail', name: t.bailApplication },
    { id: 'notice', name: t.legalNotice },
    { id: 'divorce', name: t.divorcePetition },
    { id: 'nda', name: t.nda }
  ];

  // Judges get judgment / order formats; advocates keep the pleading templates.
  const isJudgeMode = userMode === 'judge';
  const templateContentMap: Record<string, string> = isJudgeMode
    ? { ...JUDGEMENT_TEMPLATES }
    : { ...PREDEFINED_TEMPLATES };
  const templateOptions: { id: string; name: string; group?: string; collapsible?: boolean }[] = isJudgeMode
    ? JUDGEMENT_TEMPLATE_OPTIONS.map((o) => ({ ...o }))
    : [...builtInTemplateOptions];
  for (const ct of cloudTemplates) {
    if (!ct?.id) continue;
    // Admin-added templates are for advocates unless marked audience: 'judge'.
    if ((ct.audience === 'judge') !== isJudgeMode) continue;
    templateContentMap[ct.id] = ct.content || '';
    const idx = templateOptions.findIndex((o) => o.id === ct.id);
    if (idx >= 0) {
      templateOptions[idx] = { id: ct.id, name: ct.name || ct.id };
    } else {
      templateOptions.push({ id: ct.id, name: ct.name || ct.id });
    }
  }

  // Advocates also get the full case-type catalogue (28 practice areas), grouped
  // and collapsible; its layouts are built only when one is picked.
  if (!isJudgeMode) templateOptions.push(...ADVOCATE_CATALOGUE_OPTIONS);

  // Menu labels follow the app language (names and practice-area headings).
  const templateOptionLabel = (opt?: { name: string }) => (opt ? templateLabel(opt.name, language) : '');
  const templateSearching = templateSearchQuery.trim().length > 0;
  const templateQuery = templateSearchQuery.trim().toLowerCase();
  const filteredTemplates = showTemplateMenu
    ? templateOptions.filter(opt =>
        opt.name.toLowerCase().includes(templateQuery) ||
        templateOptionLabel(opt).toLowerCase().includes(templateQuery) ||
        (templateSearching && !!opt.collapsible && !!opt.group && (
          opt.group.toLowerCase().includes(templateQuery) ||
          templateLabel(opt.group, language).toLowerCase().includes(templateQuery)
        ))
      )
    : [];
  const templateGroupCounts: Record<string, number> = {};
  for (const opt of filteredTemplates) {
    if (opt.collapsible && opt.group) templateGroupCounts[opt.group] = (templateGroupCounts[opt.group] || 0) + 1;
  }

  useEffect(() => {
    stickToBottomRef.current = true;
    lastMessageIdRef.current = null;
    setCaseFiles([]);
    setFormatFiles([]);
    setSelectedTemplateId(null);
    setInputText('');
    setShowAttachMenu(false);
    setShowTemplateMenu(false);
    setTemplateSearchQuery('');
    setEditingId(null);
    setEditDraft('');
    if (caseFileInputRef.current) caseFileInputRef.current.value = '';
    if (caseCameraInputRef.current) caseCameraInputRef.current.value = '';
    if (formatFileInputRef.current) formatFileInputRef.current.value = '';
    if (formatCameraInputRef.current) formatCameraInputRef.current.value = '';
  }, [activeSessionId]);

  // A template chosen under one mode must not carry over to the other.
  useEffect(() => {
    setSelectedTemplateId(null);
    setTemplateSearchQuery('');
  }, [userMode]);

  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null;
    const isNewMessage = lastId !== lastMessageIdRef.current;
    lastMessageIdRef.current = lastId;
    if (!isNewMessage || !lastId) return;
    if (!stickToBottomRef.current) return;
    const el = messagesListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!isAndroidSpeechPlatform()) return;
    void nativeSpeechAvailable().then(setNativeSpeechOk);
    return () => {
      wantListeningRef.current = false;
      void stopNativeSpeech();
    };
  }, []);

  useEffect(() => {
    if (isAndroidSpeechPlatform()) return;
    if (!webSpeechOk) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = languageLocale(language);

    recognition.onresult = (event: any) => {
      let interim = '';
      let finals = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          finals += piece;
        } else {
          interim += piece;
        }
      }

      if (finals) {
        const base = speechBaseTextRef.current;
        const needsSpace = base.length > 0 && !/\s$/.test(base) && !/^\s/.test(finals);
        speechBaseTextRef.current = base + (needsSpace ? ' ' : '') + finals.trim() + ' ';
      }

      setInputText(speechBaseTextRef.current + interim);
    };

    recognition.onerror = (event: any) => {
      const err = event?.error;
      // Transient / expected — keep listening when user still wants it
      if (err === 'no-speech' || err === 'aborted' || err === 'audio-capture') return;
      console.error('Speech recognition error', err);
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        wantListeningRef.current = false;
        setIsListening(false);
        alert('Microphone access is blocked. Please allow mic permission and try again.');
        return;
      }
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch {
          /* Chrome restarts on onend */
        }
        return;
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      // Chrome often stops after a pause; auto-restart while mic is on
      if (wantListeningRef.current) {
        window.setTimeout(() => {
          if (!wantListeningRef.current) return;
          try {
            recognition.start();
          } catch {
            wantListeningRef.current = false;
            setIsListening(false);
          }
        }, 120);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      wantListeningRef.current = false;
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, [webSpeechOk, language]);

  const applyNativeTranscript = (text: string, isFinal: boolean) => {
    const piece = (text || '').trim();
    if (!piece) return;
    if (isFinal) {
      const base = speechBaseTextRef.current;
      const needsSpace = base.length > 0 && !/\s$/.test(base);
      speechBaseTextRef.current = base + (needsSpace ? ' ' : '') + piece + ' ';
      setInputText(speechBaseTextRef.current);
      return;
    }
    setInputText(speechBaseTextRef.current + piece);
  };

  const toggleListening = async () => {
    if (isListening || wantListeningRef.current) {
      wantListeningRef.current = false;
      if (isAndroidSpeechPlatform()) {
        try { await stopNativeSpeech(); } catch { /* ignore */ }
      } else {
        try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      }
      setIsListening(false);
      speechBaseTextRef.current = inputText;
      return;
    }

    speechBaseTextRef.current = inputText;
    wantListeningRef.current = true;

    if (isAndroidSpeechPlatform()) {
      setIsListening(true);
      try {
        await startNativeSpeech({
          language: languageLocale(language),
          onResult: applyNativeTranscript,
          onError: (err) => {
            if (!wantListeningRef.current) return;
            if (err === '7' || err === '6' || err === '5' || err === '8') return;
            if (err === '9' || err === 'unavailable') {
              wantListeningRef.current = false;
              setIsListening(false);
              alert('Microphone access is blocked. Please allow mic permission and try again.');
              void stopNativeSpeech();
            }
          },
        });
      } catch (e) {
        console.error(e);
        wantListeningRef.current = false;
        setIsListening(false);
        alert('Microphone access is blocked. Please allow mic permission and try again.');
      }
      return;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      wantListeningRef.current = false;
      return;
    }
    recognition.lang = languageLocale(language);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error(e);
      wantListeningRef.current = false;
      setIsListening(false);
      alert('Microphone access is blocked. Please allow mic permission and try again.');
    }
  };

  /** Normalize camera/gallery picks so each photo keeps a unique name and always appends */
  const appendIncomingFiles = (incoming: FileList | File[], setFiles: React.Dispatch<React.SetStateAction<File[]>>) => {
    const picked = Array.from(incoming).filter(Boolean);
    const problems: string[] = [];
    const list = picked.filter((f) => {
      const problem = validateUploadFile(f, language);
      if (problem) problems.push(problem);
      return !problem;
    });
    if (problems.length > 0) alert(problems.join('\n'));
    if (list.length === 0) {
      if (problems.length === 0) {
        alert(language === 'Hindi' ? 'फ़ाइल पढ़ी नहीं जा सकी। कृपया फिर चुनें।' : 'Could not read files. Please pick again.');
      }
      return;
    }
    // Wake the server now (it sleeps when idle) so the analysis does not pay for the cold start.
    void warmBackend();
    const stamped = list.map((file, idx) => {
      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name);
      if (!isImage) return file;
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const uniqueName = `photo_${Date.now()}_${idx}.${ext}`;
      return new File([file], uniqueName, { type: file.type || 'image/jpeg', lastModified: file.lastModified || Date.now() });
    });
    setFiles((prev) => [...prev, ...stamped]);
  };

  const handleCaseFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      appendIncomingFiles(e.target.files, setCaseFiles);
    }
    e.target.value = '';
  };

  const handleFormatFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      appendIncomingFiles(e.target.files, setFormatFiles);
      setSelectedTemplateId(null);
    }
    e.target.value = '';
  };

  const openCaseFilePicker = async () => {
    if (transferBusy) return;
    if (isNativeApp()) {
      setTransferBusy({
        title: language === 'Hindi' ? 'गैलरी खुल रही है…' : 'Opening gallery…',
      });
      try {
        const files = await pickMultipleNativeFiles((info) => {
          if (info.file) appendIncomingFiles([info.file], setCaseFiles);
          setTransferBusy({
            title: language === 'Hindi' ? 'फ़ोटो लोड हो रही हैं…' : 'Loading photos…',
            detail: info.name,
            done: info.done,
            total: info.total,
          });
        });
        if (!files || files.length === 0) {
          caseFileInputRef.current?.click();
        }
      } catch {
        caseFileInputRef.current?.click();
      } finally {
        setTransferBusy(null);
      }
      return;
    }
    caseFileInputRef.current?.click();
  };

  const openCaseCamera = () => {
    caseCameraInputRef.current?.click();
  };

  const openFormatFilePicker = async () => {
    if (transferBusy) return;
    if (isNativeApp()) {
      setTransferBusy({
        title: language === 'Hindi' ? 'गैलरी खुल रही है…' : 'Opening gallery…',
      });
      try {
        const files = await pickMultipleNativeFiles((info) => {
          if (info.file) {
            appendIncomingFiles([info.file], setFormatFiles);
            setSelectedTemplateId(null);
          }
          setTransferBusy({
            title: language === 'Hindi' ? 'फ़ॉर्मेट लोड हो रहा है…' : 'Loading format…',
            detail: info.name,
            done: info.done,
            total: info.total,
          });
        });
        if (!files || files.length === 0) {
          formatFileInputRef.current?.click();
        }
      } catch {
        formatFileInputRef.current?.click();
      } finally {
        setTransferBusy(null);
      }
      return;
    }
    formatFileInputRef.current?.click();
  };

  const openFormatCamera = () => {
    formatCameraInputRef.current?.click();
  };

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplateId(id);
    setFormatFiles([]);
    setShowTemplateMenu(false);
    setTemplateSearchQuery('');
  };

  const removeCaseFile = (index: number) => {
    setCaseFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeFormatFile = (index: number) => {
    setFormatFiles(prev => prev.filter((_, i) => i !== index));
  };

  const abortInFlight = () => {
    sendLockRef.current = false;
    sendAbortRef.current?.abort();
    setIsLoading(false);
    setMediaStatus('');
    setTransferBusy(null);
  };

  const copyReply = useCallback(async (id: string, text: string) => {
    const cleaned = cleanChatReply(text);
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
    } catch {
      try {
        await sharePlainText(cleaned, 'casemate');
      } catch {
        /* ignore */
      }
    }
  }, []);

  const shareReply = useCallback(async (text: string) => {
    await sharePlainText(cleanChatReply(text), 'casemate');
  }, []);

  const startEditMessage = useCallback((msg: Message) => {
    abortInFlight();
    setEditingId(msg.id);
    setEditDraft(msg.text);
  }, []);

  const handleSend = async (isGenerate: boolean, presetText?: string) => {
    const hasFilesOrTemplate = presetText ? false : caseFiles.length > 0 || formatFiles.length > 0 || selectedTemplateId !== null;
    const uploadedNow = [...caseFiles, ...formatFiles];
    const onlyDocUploads =
      uploadedNow.length > 0 &&
      uploadedNow.every((f) =>
        /\.pdf|application\/pdf|\.docx?|msword|officedocument|\.rtf|\.txt|text\/plain/i.test(
          `${f.type || ''} ${f.name || ''}`
        )
      );
    const mixingCaseAndFormat = caseFiles.length > 0 && (formatFiles.length > 0 || !!selectedTemplateId);
    const typed = presetText !== undefined ? presetText.trim() : inputText.trim();
    const textToSend =
      typed ||
      (isGenerate && onlyDocUploads && !mixingCaseAndFormat
        ? (language === 'Hindi'
          ? 'अपलोड की गई फ़ाइल को एडिटर में ज्यों का त्यों डालो। सारांश मत बनाओ। हर पॉइंट वही रखो।'
          : 'Put the uploaded file in the editor exactly as it is. Do not summarize. Keep every point.')
        : isGenerate
        ? "Please generate the document based on the provided context and files."
        : hasFilesOrTemplate
          ? analysisUploadPrompt(language)
          : '');

    if (!textToSend && !hasFilesOrTemplate) return;
    const asDocument = isGenerate && !userAskedForSummary(textToSend);
    if (!activeSessionId || isLoading || transferBusy || sendLockRef.current) return;
    sendLockRef.current = true;

    // Plan-wise single-message + total session character limits
    const charCheck = validateChatCharacterLimits(user?.plan, textToSend, messages, user?.email, user);
    if (!charCheck.ok) {
      sendLockRef.current = false;
      if (charCheck.code === 'SESSION_LIMIT') {
        setChatLimitReason('reached');
        setChatLimitOpen(true);
        return;
      }
      alert(charCheck.error);
      return;
    }

    const photoCheck = validatePhotoLimit(user?.plan, messages, caseFiles.length, user?.email, user);
    if (!photoCheck.ok) {
      sendLockRef.current = false;
      alert(photoCheck.error);
      return;
    }

    const serverCheck = await validateChatLimits({
      chatId: activeSessionId,
      message: textToSend,
      sessionMessages: messages.map((m) => ({ text: m.text })),
      photoCount: countCasePhotos(messages, caseFiles.length),
      uploadPhotoCount: caseFiles.length,
    });
    if (!serverCheck.ok && !hasUnlimitedAccess(user?.email, user)) {
      sendLockRef.current = false;
      if (serverCheck.error === 'SESSION_LIMIT_EXCEEDED') {
        setChatLimitReason('reached');
        setChatLimitOpen(true);
        return;
      }
      alert(serverCheck.message || 'This chat is over the limit for your plan.');
      return;
    }

    // Draft limit check
    if (asDocument && !hasUnlimitedAccess(user?.email, user) && draftCount >= planLimits.draftLimit) {
      sendLockRef.current = false;
      setIsSubscriptionModalOpen(true);
      return;
    }

    // Limit check for document generation
    if (asDocument) {
      if (!incrementDraftCount()) {
        sendLockRef.current = false;
        setIsSubscriptionModalOpen(true);
        return;
      }
    }

    if (isListening) {
      toggleListening();
    }

    const templateName = selectedTemplateId ? templateOptionLabel(templateOptions.find(t => t.id === selectedTemplateId)) : null;
    const msgId = Date.now().toString();
    const currentHistory = [...messages];
    const pendingCaseFiles = [...caseFiles];
    const pendingFormatFiles = [...formatFiles];
    const currentTemplateContent = selectedTemplateId
      ? (templateContentMap[selectedTemplateId] || (!isJudgeMode ? catalogueTemplateContent(selectedTemplateId) : null) || null)
      : null;
    const sessionId = activeSessionId;

    const previewOf = (files: File[], type: 'case' | 'format'): Attachment[] =>
      files.map((f) => {
        const isImage = f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(f.name);
        return {
          name: f.name,
          type,
          mimeType: f.type,
          size: f.size,
          url: isImage ? URL.createObjectURL(f) : undefined,
        };
      });
    const previewUrls: string[] = [];
    const previewAttachments: Attachment[] = [
      ...previewOf(pendingCaseFiles, 'case'),
      ...previewOf(pendingFormatFiles, 'format'),
      ...(templateName ? [{ name: `${t.templatePrefix}: ${templateName}`, type: 'format' as const }] : []),
    ];
    previewAttachments.forEach((att) => {
      if (att.url?.startsWith('blob:')) previewUrls.push(att.url);
    });

    const newUserMsg: Message = {
      id: msgId,
      role: 'user',
      text: textToSend,
      timestamp: Date.now(),
      attachments: previewAttachments
    };

    const ctrl = new AbortController();
    sendAbortRef.current = ctrl;

    stickToBottomRef.current = true;
    addMessageToActiveSession(newUserMsg);
    if (presetText === undefined) setInputText('');
    speechBaseTextRef.current = '';
    setIsLoading(true);
    setMediaStatus('');
    const workKind = asDocument ? 'draft' : 'analysis';
    let workStatus: 'ok' | 'fail' | 'cancel' = 'fail';

    setCaseFiles([]);
    setFormatFiles([]);
    setSelectedTemplateId(null);

    try {
      await beginBackgroundWork(workKind, language);
      const savedAttachments: Attachment[] = [];
      const totalFiles = pendingCaseFiles.length + pendingFormatFiles.length;
      let preparedCount = 0;

      if (totalFiles > 0) {
        setTransferBusy({
          title: language === 'Hindi' ? 'फ़ोटो तैयार हो रही हैं…' : 'Preparing photos…',
          done: 0,
          total: totalFiles,
        });
        setMediaStatus(
          language === 'Hindi'
            ? 'फ़ोटो तैयार हो रही हैं…'
            : 'Preparing photos…'
        );
      }

      if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { userAbort: true, name: 'AbortError' });

      const reportPrepare = (name: string) => {
        preparedCount += 1;
        setTransferBusy({
          title: language === 'Hindi' ? 'फ़ोटो तैयार हो रही हैं…' : 'Preparing photos…',
          detail: name,
          done: preparedCount,
          total: totalFiles,
        });
        setMediaStatus(
          language === 'Hindi'
            ? `फ़ोटो तैयार (${preparedCount}/${totalFiles})…`
            : `Preparing photos (${preparedCount}/${totalFiles})…`
        );
      };

      const [caseForAi, formatForAi] = await Promise.all([
        pendingCaseFiles.length
          ? prepareFilesForAi(pendingCaseFiles, { onProgress: (_d, _t, name) => reportPrepare(name) })
          : Promise.resolve([] as File[]),
        pendingFormatFiles.length
          ? prepareFilesForAi(pendingFormatFiles, {
              maxEdge: 1800,
              quality: 0.88,
              skipBelow: 750_000,
              onProgress: (_d, _t, name) => reportPrepare(name),
            })
          : Promise.resolve([] as File[]),
      ]);

      if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { userAbort: true, name: 'AbortError' });

      let uploadedAttachments: Attachment[] = [];

      const uploadJob = async () => {
        if (totalFiles === 0) {
          if (templateName) uploadedAttachments = [{ name: `${t.templatePrefix}: ${templateName}`, type: 'format' }];
          return;
        }
        setMediaStatus(
          language === 'Hindi' ? 'फ़ोटो सेव हो रही हैं…' : 'Saving photos…'
        );
        try {
          let uploadedCount = 0;
          const report = (name: string) => {
            if (!name) return;
            uploadedCount += 1;
            setMediaStatus(
              language === 'Hindi'
                ? `फ़ोटो सेव (${uploadedCount}/${totalFiles}): ${name}…`
                : `Saving photo (${uploadedCount}/${totalFiles}): ${name}…`
            );
          };
          const jobs: Promise<Attachment[]>[] = [];
          if (caseForAi.length > 0) {
            jobs.push(
              uploadPreparedAttachments(
                caseForAi,
                pendingCaseFiles.map((f) => f.name),
                'case',
                sessionId,
                (_d, _t, name) => report(name)
              ).then((res) => res.attachments)
            );
          }
          if (formatForAi.length > 0) {
            jobs.push(
              uploadPreparedAttachments(
                formatForAi,
                pendingFormatFiles.map((f) => f.name),
                'format',
                sessionId,
                (_d, _t, name) => report(name)
              ).then((res) => res.attachments)
            );
          }
          const groups = await Promise.all(jobs);
          uploadedAttachments = groups.flat();
          if (templateName) {
            uploadedAttachments.push({ name: `${t.templatePrefix}: ${templateName}`, type: 'format' });
          }
          if (uploadedAttachments.length > 0) {
            savedAttachments.push(...uploadedAttachments);
            updateMessageFields(msgId, { attachments: [...uploadedAttachments] });
            previewUrls.forEach((url) => URL.revokeObjectURL(url));
            previewUrls.length = 0;
          }
        } catch (e) {
          console.warn('Cloud save failed; analysis continues', e);
        }
      };

      const learnedStyleText = buildLearnedStylePrompt(chatSessions, caseLearnings, communityStyles);

      const generateJob = generateLegalResponse(
        newUserMsg.text,
        currentHistory,
        caseForAi,
        formatForAi,
        currentTemplateContent,
        asDocument,
        language,
        ({ phase, batch, totalBatches }) => {
          if (phase === 'analyzing') {
            setMediaStatus(
              language === 'Hindi'
                ? `फ़ोटो विश्लेषण बैच ${batch}/${totalBatches}…`
                : `Analyzing photos batch ${batch}/${totalBatches}…`
            );
          } else if (phase === 'format') {
            setMediaStatus(
              language === 'Hindi' ? 'फ़ॉर्मेट पढ़ा जा रहा है…' : 'Reading format…'
            );
          } else {
            setMediaStatus(
              language === 'Hindi' ? 'उत्तर तैयार हो रहा है…' : 'Writing reply…'
            );
          }
        },
        learnedStyleText,
        ctrl.signal,
        userMode
      );

      setTransferBusy(null);

      const [result] = await Promise.all([generateJob, uploadJob()]);

      if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { userAbort: true, name: 'AbortError' });

      if (result.evidenceNotes) {
        updateMessageFields(msgId, {
          attachments: (uploadedAttachments && uploadedAttachments.length)
            ? uploadedAttachments
            : (savedAttachments.length ? savedAttachments : newUserMsg.attachments),
          evidenceNotes: result.evidenceNotes,
        });
        const hasCasePhoto = pendingCaseFiles.some((f) =>
          f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name)
        );
        if (hasCasePhoto) {
          const client = parseClientFromEvidence(result.evidenceNotes);
          if (client.name || client.caseDate) {
            nameChatFromClient(sessionId, client.name || '', client.caseDate);
          }
        }
      }

      const replyFailed =
        !result.text ||
        result.text.startsWith('API Error') ||
        /The AI is busy|request was too large|Could not generate|This is taking too long|Network is slow|Photos were read, but|No readable text|पढ़ने योग्य पाठ|सेवा व्यस्त|अनुरोध बहुत बड़ा|उत्तर नहीं बन सका|फ़ोटो पढ़ ली गईं|बहुत समय लग रहा है|नेटवर्क धीमा/.test(result.text);

      const newAiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: asDocument ? result.text : cleanChatReply(result.text),
        timestamp: Date.now(),
        isDocument: asDocument && !replyFailed,
        ...(!replyFailed && result.suggestedQuestions?.length
          ? { suggestedQuestions: result.suggestedQuestions }
          : {}),
      };

      addMessageToActiveSession(newAiMsg);
      if (!replyFailed && result.filledTemplate) {
        void saveFilledTemplate(newAiMsg.id, result.filledTemplate.docx, newAiMsg.text, result.filledTemplate.fileName);
      }
      if (!replyFailed && result.scanDraft) {
        void saveScanDraft({
          id: newAiMsg.id,
          profileId: result.scanDraft.profile.id,
          draft: result.scanDraft.draft,
          docx: result.scanDraft.docx,
          baseText: newAiMsg.text,
          fileName: result.scanDraft.fileName,
          review: result.scanDraft.review,
          checks: result.scanDraft.checks,
        });
      }
      const scanFailed = (result.scanDraft?.checks || []).filter((c) => !c.ok);
      const noteLines = [
        ...(result.notices || []),
        ...(!replyFailed && result.filledTemplate
          ? [
              ...(result.filledTemplate.review.length
                ? [language === 'Hindi' ? 'कृपया जाँचें:' : 'Please check:', ...result.filledTemplate.review.map((r: string) => `• ${r}`)]
                : []),
              ...(scanFailed.length
                ? scanFailed.map((c) => `⚠ ${c.detail}`)
                : []),
              result.scanDraft
                ? (language === 'Hindi'
                  ? 'DOCX टेम्पलेट की पढ़ी गई संरचना से बना वास्तविक Word फ़ाइल है, स्कैन की तस्वीर नहीं। PDF याचिकाओं के लिए बहते पृष्ठों से बनता है; छोटे फ़ॉर्म पर मूल स्कैन पृष्ठ चुना जा सकता है। हेडिंग/शैली सुधारने के लिए "टेम्पलेट जाँच" खोलें। मूल से मिलाकर देखें — स्कैन से पूर्ण समानता का दावा नहीं।'
                  : 'DOCX is a real Word file rebuilt from the template reading, not a picture of the scan. PDF uses flowing pages for petitions; short form fills can keep the original scan as the page. Open "Template check" to correct headings or styles. Compare with your original — this is not claimed to be a perfect visual copy of the scan.')
                : (language === 'Hindi'
                  ? 'यह ड्राफ्ट आपके अपने Word टेम्पलेट को सीधे भरकर बना है। हूबहू फ़ॉर्मेट के लिए "Download DOCX" इस्तेमाल करें; PDF एडिटर व्यू से बनता है।'
                  : 'This draft was made by filling your own Word template in place. Use "Download DOCX" for the exact template formatting; PDF is produced from the editor view.'),
            ]
          : []),
      ];
      if (noteLines.length > 0) {
        addMessageToActiveSession({
          id: (Date.now() + 2).toString(),
          role: 'model',
          text: noteLines.join('\n'),
          timestamp: Date.now() + 1,
        });
      }
      workStatus = replyFailed ? 'fail' : 'ok';
      if (asDocument && replyFailed) decrementDraftCount();

      if (asDocument && result.text && !replyFailed) {
        void rememberUserStyle(result.text, language);
        void (async () => {
          try {
            const learning = await distillCaseLearning(
              [...currentHistory, newUserMsg, newAiMsg],
              language
            );
            if (learning) {
              upsertCaseLearning(learning);
              void rememberUserStyle(result.text, language, {
                caseType: learning.caseType,
                notes: learning.notes,
              });
            }
          } catch (e) {
            console.warn('case learning distill skipped', e);
          }
        })();
      }
    } catch (err: any) {
      if (asDocument) decrementDraftCount();
      if (isUserAbortError(err) || ctrl.signal.aborted) {
        workStatus = 'cancel';
        return;
      }
      console.error(err);
      const failText =
        err?.message ||
        (language === 'Hindi'
          ? 'फ़ाइल सेव/विश्लेषण असफल। कृपया फिर कोशिश करें।'
          : 'Failed to save/analyze files. Please try again.');
      addMessageToActiveSession({
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: failText,
        timestamp: Date.now(),
      });
    } finally {
      if (sendAbortRef.current === ctrl) sendAbortRef.current = null;
      sendLockRef.current = false;
      setIsLoading(false);
      setMediaStatus('');
      setTransferBusy(null);
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      void endBackgroundWork(workStatus, workKind, language);
    }
  };

  const handleSaveEdit = useCallback(async (msg: Message) => {
    const next = editDraft.trim();
    if (!next) return;
    abortInFlight();
    setEditingId(null);

    const editedIndex = messages.findIndex((m) => m.id === msg.id);
    const historyBefore = editedIndex >= 0 ? messages.slice(0, editedIndex) : messages;

    updateMessageText(msg.id, next);
    trimMessagesAfter(msg.id);

    const ctrl = new AbortController();
    sendAbortRef.current = ctrl;
    setIsLoading(true);
    setMediaStatus(language === 'Hindi' ? 'उत्तर तैयार हो रहा है…' : 'Writing reply…');
    stickToBottomRef.current = true;
    let workStatus: 'ok' | 'fail' | 'cancel' = 'fail';

    try {
      await beginBackgroundWork('analysis', language);
      const learnedStyleText = buildLearnedStylePrompt(chatSessions, caseLearnings, communityStyles);
      const result = await generateLegalResponse(
        next,
        historyBefore,
        [],
        [],
        null,
        false,
        language,
        ({ phase, batch, totalBatches }) => {
          if (phase === 'analyzing') {
            setMediaStatus(
              language === 'Hindi'
                ? `फ़ोटो विश्लेषण बैच ${batch}/${totalBatches}…`
                : `Analyzing photos batch ${batch}/${totalBatches}…`
            );
          } else {
            setMediaStatus(language === 'Hindi' ? 'उत्तर तैयार हो रहा है…' : 'Writing reply…');
          }
        },
        learnedStyleText,
        ctrl.signal
      );

      if (ctrl.signal.aborted) {
        workStatus = 'cancel';
        return;
      }

      addMessageToActiveSession({
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: cleanChatReply(result.text),
        timestamp: Date.now(),
        isDocument: false,
        ...(result.suggestedQuestions?.length ? { suggestedQuestions: result.suggestedQuestions } : {}),
      });
      workStatus = 'ok';
    } catch (err: any) {
      if (isUserAbortError(err) || ctrl.signal.aborted) {
        workStatus = 'cancel';
        return;
      }
      addMessageToActiveSession({
        id: (Date.now() + 1).toString(),
        role: 'model',
        text:
          err?.message ||
          (language === 'Hindi' ? 'उत्तर नहीं बन सका। कृपया फिर कोशिश करें।' : 'Could not generate a reply. Please try again.'),
        timestamp: Date.now(),
      });
    } finally {
      if (sendAbortRef.current === ctrl) sendAbortRef.current = null;
      setIsLoading(false);
      setMediaStatus('');
      void endBackgroundWork(workStatus, 'analysis', language);
    }
  }, [editDraft, isTimeUp, messages, language, chatSessions, caseLearnings, communityStyles, updateMessageText, trimMessagesAfter, addMessageToActiveSession]);

  const onUpdateDocument = useCallback((id: string, text: string) => {
    updateMessageText(id, text);
    void rememberUserStyle(text, language);
  }, [updateMessageText, language]);

  const onCancelEdit = useCallback(() => setEditingId(null), []);
  const onEditDraft = useCallback((value: string) => setEditDraft(value), []);

  if (!activeSessionId || !activeSession) {
    return (
      <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden app-bottom-glow">
        <div className="app-safe-top flex items-center p-4 border-b border-ink-border bg-ink-soft text-band flex-shrink-0">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="mr-3 text-band-mute hover:text-white transition-colors">
            <MenuIcon className="w-6 h-6" />
          </button>
          <h1 className="font-semibold text-lg truncate">{t.appTitle}</h1>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center app-safe-bottom">
          <div className="text-center text-band-mute animate-fade-up">
            <div className="mx-auto mb-5 w-20 h-20 brand-ring flex items-center justify-center animate-mark-reveal">
              <BrandLogo size={72} className="rounded-full" />
            </div>
            <h2 className="text-2xl font-display font-semibold text-band-dim">{t.welcome}</h2>
            <p className="mt-2 text-band-mute">{t.selectCase}</p>
          </div>
        </div>
      </div>
    );
  }

  const canSend = inputText.trim().length > 0 || caseFiles.length > 0 || formatFiles.length > 0 || selectedTemplateId !== null;
  const canGenerate = canSend || messages.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden overflow-x-hidden app-bottom-glow relative z-[1]">
      {transferBusy && (
        <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-ink-border bg-ink-soft px-6 py-7 text-center shadow-2xl">
            <div className="casemate-spinner mx-auto mb-4" />
            <h3 className="text-white font-semibold text-base">{transferBusy.title}</h3>
            {typeof transferBusy.total === 'number' && transferBusy.total > 0 && (
              <>
                <div className="mt-4 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round(((transferBusy.done || 0) / transferBusy.total) * 100))}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-band-dim">
                  {transferBusy.done || 0}/{transferBusy.total}
                </p>
              </>
            )}
            {transferBusy.detail && (
              <p className="mt-2 text-xs text-band-mute truncate">{transferBusy.detail}</p>
            )}
            <p className="mt-3 text-xs text-band-mute">
              {language === 'Hindi' ? 'कृपया प्रतीक्षा करें, फ़ोटो अभी अपलोड हो रही हैं।' : 'Please wait — photos are still loading.'}
            </p>
          </div>
        </div>
      )}
      {isTimeUp && (
        <div className="app-safe-top bg-amber-950/90 border-b border-amber-700/60 text-amber-100 text-xs sm:text-sm py-2.5 px-4 z-20 flex flex-wrap items-center justify-center gap-2 sm:gap-3 flex-shrink-0">
          <span className="font-semibold uppercase tracking-wide text-amber-300">{language === 'Hindi' ? 'दैनिक विंडो' : 'Daily window'}</span>
          <span className="text-center">
            {t.limitOverBanner
              || `Today's app-time window is used. You can still open saved cases and continue until the daily AI allowance runs out. Resets at ${nextIstMidnightLabel()}.`}
          </span>
          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink text-xs font-bold transition-colors"
          >
            {t.upgradeNow}
          </button>
        </div>
      )}

      <div className={`${isTimeUp ? '' : 'app-safe-top'} flex items-center p-4 border-b border-ink-border bg-ink-soft text-band shadow-sm z-10 flex-shrink-0`}>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="mr-3 text-band-mute hover:text-white transition-colors">
          <MenuIcon className="w-6 h-6" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-lg truncate">{activeSession?.title || t.newChat}</h1>
          {activeSession && (
            <p className="text-xs text-band-mute truncate">
              {activeSession.caseDate
                ? `${language === 'Hindi' ? `दिनांक ${activeSession.caseDate}` : activeSession.caseDate} · ${formatChatDay(chatStartedAt(activeSession), language)}`
                : formatChatDay(chatStartedAt(activeSession), language)}
            </p>
          )}
          <FreeUsageStrip compact />
        </div>
      </div>

      <div
        ref={messagesListRef}
        onScroll={() => {
          const el = messagesListRef.current;
          if (!el) return;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        }}
        className={`flex-1 min-h-0 min-w-0 overflow-x-hidden ${
          messages.length === 0 && !isLoading && !transferBusy
            ? 'overflow-hidden overscroll-none flex items-center justify-center p-4 sm:p-6'
            : 'overflow-y-auto overscroll-contain custom-scrollbar p-4 sm:p-6 space-y-8'
        }`}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-band-mute max-w-lg mx-auto text-center space-y-4 animate-fade-up">
            <div className="brand-ring w-20 h-20 flex items-center justify-center animate-mark-reveal">
              <BrandLogo size={72} className="rounded-full" />
            </div>
            <h3 className="text-xl font-display font-semibold text-band-dim">{t.howCanIAssist}</h3>
            <p className="text-sm text-band-mute">{t.uploadPrompt}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {ANALYSIS_ACTIONS(language).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => void handleSend(false, action.prompt)}
                  className="px-3 py-1.5 rounded-full border border-ink-border bg-ink-muted/70 text-xs text-band hover:bg-ink-muted transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
            {!hideContinueHint && (() => {
              const unfinished = chatSessions.find((s) =>
                s.id !== activeSessionId && s.messages.some((m) => m.isDocument)
              );
              if (!unfinished) return null;
              return (
                <div className="w-full rounded-xl border border-ink-border bg-ink-muted/60 px-3 py-2 text-left">
                  <p className="text-xs text-band-dim">
                    {language === 'Hindi' ? 'अधूरा ड्राफ्ट' : 'Unfinished draft'}: {unfinished.title}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-white underline"
                      onClick={() => setActiveSessionId(unfinished.id)}
                    >
                      {language === 'Hindi' ? 'जारी रखें' : 'Continue'}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-band-mute"
                      onClick={() => {
                        setHideContinueHint(true);
                        try { sessionStorage.setItem('casemate_hide_continue_hint', '1'); } catch { /* ignore */ }
                      }}
                    >
                      {language === 'Hindi' ? 'छिपाएँ' : 'Hide'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <ChatMessageList
          messages={messages}
          activeTitle={activeSession?.title || 'Legal_Document'}
          language={language}
          editingId={editingId}
          editDraft={editDraft}
          maxMessageChars={planLimits.maxMessageChars}
          t={t}
          isTimeUp={isTimeUp}
          copiedId={copiedId}
          isLoading={isLoading}
          mediaStatus={mediaStatus}
          onEditDraft={onEditDraft}
          onCancelEdit={onCancelEdit}
          onSaveEdit={handleSaveEdit}
          onStartEdit={startEditMessage}
          onCopy={copyReply}
          onShare={shareReply}
          onUpdateDocument={onUpdateDocument}
          onSuggest={(question) => void handleSend(false, question)}
        />
        <div ref={messagesEndRef} />
      </div>

      <div className="app-safe-bottom px-3 pt-2 bg-transparent flex-shrink-0 relative z-10">
        <div className="max-w-4xl mx-auto">
          {(() => {
            const used = getSessionCharCount(messages);
            const proximity = chatLimitProximity(used, planLimits.maxSessionChars);
            if (hasUnlimitedAccess(user?.email, user) || proximity === 'ok') return null;
            return (
              <div className="mb-2 rounded-xl border border-amber-800/70 bg-amber-950/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-amber-100">
                  {used.toLocaleString('en-IN')} / {planLimits.maxSessionChars.toLocaleString('en-IN')} characters in this chat.
                  {proximity === 'reached' ? ' The cap is reached.' : ' This chat is close to its cap.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setChatLimitReason(proximity);
                    setChatLimitOpen(true);
                  }}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-400 text-ink"
                >
                  Increase Chat Limit
                </button>
              </div>
            );
          })()}
          {caseFiles.length > 0 && messages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {ANALYSIS_ACTIONS(language).slice(0, 4).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => void handleSend(false, action.prompt)}
                  className="px-2.5 py-1 rounded-full border border-sky-800/60 bg-sky-950/40 text-[11px] text-sky-100 hover:bg-sky-900/50"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
          {(caseFiles.length > 0 || formatFiles.length > 0 || selectedTemplateId) && (
            <div className="flex flex-wrap gap-2 mb-2 max-h-24 overflow-y-auto custom-scrollbar">
              {caseFiles.map((f, i) => (
                <div key={`case-${i}-${f.name}`} className="flex items-center bg-sky-950/50 text-sky-200 text-xs px-3 py-1.5 rounded-lg border border-sky-700/50 shadow-sm">
                  <PaperclipIcon className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
                  <span className="truncate max-w-[150px] font-medium">{f.name}</span>
                  <button onClick={() => removeCaseFile(i)} className="ml-2 hover:text-sky-100 hover:bg-sky-900/50 rounded-full p-0.5 transition-colors flex-shrink-0"><XIcon className="w-3 h-3" /></button>
                </div>
              ))}
              {caseFiles.length > 0 && (
                <button
                  type="button"
                  onClick={openCaseCamera}
                  className="flex items-center gap-1 bg-sky-900/40 text-sky-200 text-xs px-2.5 py-1.5 rounded-lg border border-sky-700/60 hover:bg-sky-900/60 transition-colors"
                  title="Add another case photo"
                >
                  <PlusIcon className="w-3.5 h-3.5" /> Photo
                </button>
              )}
              {formatFiles.map((f, i) => (
                <div key={`fmt-${i}-${f.name}`} className="flex items-center bg-amber-950/50 text-amber-200 text-xs px-3 py-1.5 rounded-lg border border-amber-700/50 shadow-sm">
                  <TemplateIcon className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
                  <span className="truncate max-w-[150px] font-medium">{f.name}</span>
                  <button onClick={() => removeFormatFile(i)} className="ml-2 hover:text-amber-100 hover:bg-amber-900/50 rounded-full p-0.5 transition-colors flex-shrink-0"><XIcon className="w-3 h-3" /></button>
                </div>
              ))}
              {formatFiles.length > 0 && (
                <button
                  type="button"
                  onClick={openFormatCamera}
                  className="flex items-center gap-1 bg-amber-900/40 text-amber-200 text-xs px-2.5 py-1.5 rounded-lg border border-amber-700/60 hover:bg-amber-900/60 transition-colors"
                  title="Add another format photo"
                >
                  <PlusIcon className="w-3.5 h-3.5" /> Photo
                </button>
              )}
              {selectedTemplateId && (
                <div className="flex items-center bg-amber-950/50 text-amber-200 text-xs px-3 py-1.5 rounded-lg border border-amber-700/50 shadow-sm">
                  <TemplateIcon className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
                  <span className="truncate max-w-[150px] font-medium">{t.templatePrefix}: {templateOptionLabel(templateOptions.find(o => o.id === selectedTemplateId))}</span>
                  <button onClick={() => setSelectedTemplateId(null)} className="ml-2 hover:text-amber-100 hover:bg-amber-900/50 rounded-full p-0.5 transition-colors flex-shrink-0"><XIcon className="w-3 h-3" /></button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 pb-1">
            <div ref={attachMenuRef} className="relative flex flex-col border-2 border-white/55 rounded-2xl bg-ink-soft shadow-lg focus-within:ring-1 focus-within:ring-white/40 focus-within:border-white transition-all">
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-2 mx-1 rounded-xl border border-ink-border bg-ink-soft shadow-2xl z-50 overflow-hidden">
                  <div className="p-2 space-y-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { void openCaseFilePicker(); setShowAttachMenu(false); setShowTemplateMenu(false); }}
                        className="flex-1 flex items-center gap-2 px-3 py-2.5 text-sm text-band-dim hover:bg-ink-muted rounded-lg transition-colors"
                      >
                        <PaperclipIcon className="w-4 h-4 text-sky-400" />
                        <span className="font-medium">{t.uploadCase}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { openCaseCamera(); setShowAttachMenu(false); setShowTemplateMenu(false); }}
                        className="flex items-center justify-center w-10 h-10 text-sky-300 hover:bg-ink-muted rounded-lg border border-ink-border"
                        title="Case photo"
                      >
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { void openFormatFilePicker(); setShowAttachMenu(false); setShowTemplateMenu(false); }}
                        className="flex-1 flex items-center gap-2 px-3 py-2.5 text-sm text-band-dim hover:bg-ink-muted rounded-lg transition-colors"
                      >
                        <TemplateIcon className="w-4 h-4 text-amber-400" />
                        <span className="font-medium">{t.uploadFormat}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { openFormatCamera(); setShowAttachMenu(false); setShowTemplateMenu(false); }}
                        className="flex items-center justify-center w-10 h-10 text-amber-300 hover:bg-ink-muted rounded-lg border border-ink-border"
                        title="Format photo"
                      >
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTemplateMenu((v) => !v)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-band-dim hover:bg-ink-muted rounded-lg transition-colors"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <TemplateIcon className="w-4 h-4 text-amber-400" />
                        {t.selectTemplate}
                      </span>
                      <svg className={`w-4 h-4 transition-transform ${showTemplateMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    {showTemplateMenu && (
                      <div className="px-1 pb-1 space-y-2">
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-band-mute">
                            <SearchIcon className="w-3.5 h-3.5" />
                          </span>
                          <input
                            type="text"
                            value={templateSearchQuery}
                            onChange={(e) => setTemplateSearchQuery(e.target.value)}
                            placeholder={t.searchTemplates}
                            className="w-full bg-ink border border-ink-border text-white text-xs rounded-lg pl-8 pr-3 py-1.5 outline-none focus:border-white/40"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className={`${isJudgeMode ? 'max-h-56' : 'max-h-64'} overflow-y-auto space-y-1 custom-scrollbar`}>
                          {filteredTemplates.length > 0 ? (
                            filteredTemplates.map((option, optionIndex) => {
                              const firstOfGroup = !!option.group && option.group !== filteredTemplates[optionIndex - 1]?.group;
                              // Catalogue practice areas fold away unless opened or searching.
                              if (option.collapsible && !templateSearching) {
                                const isOpen = openTemplateGroup === option.group;
                                if (!firstOfGroup && !isOpen) return null;
                                return (
                                  <React.Fragment key={option.id}>
                                    {firstOfGroup && (
                                      <button
                                        onClick={() => setOpenTemplateGroup(isOpen ? null : option.group!)}
                                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[11px] font-semibold text-band-dim hover:bg-neutral-800 rounded-lg transition-colors"
                                      >
                                        <span className="truncate">{templateLabel(option.group!, language)}</span>
                                        <span className="flex items-center gap-1.5 shrink-0 text-band-mute">
                                          {templateGroupCounts[option.group!]}
                                          <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </span>
                                      </button>
                                    )}
                                    {isOpen && (
                                      <button
                                        onClick={() => {
                                          handleTemplateSelect(option.id);
                                          setShowAttachMenu(false);
                                          setShowTemplateMenu(false);
                                        }}
                                        className="w-full text-left pl-5 pr-3 py-2 text-xs text-band-dim hover:bg-neutral-800 hover:text-white rounded-lg transition-colors"
                                      >
                                        {templateOptionLabel(option)}
                                      </button>
                                    )}
                                  </React.Fragment>
                                );
                              }
                              return (
                              <React.Fragment key={option.id}>
                                {firstOfGroup && (
                                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-band-mute">
                                    {templateLabel(option.group!, language)}
                                  </div>
                                )}
                                <button
                                  onClick={() => {
                                    handleTemplateSelect(option.id);
                                    setShowAttachMenu(false);
                                    setShowTemplateMenu(false);
                                  }}
                                  className="w-full text-left px-3 py-2 text-xs text-band-dim hover:bg-neutral-800 hover:text-white rounded-lg transition-colors"
                                >
                                  {templateOptionLabel(option)}
                                </button>
                              </React.Fragment>
                              );
                            })
                          ) : (
                            <div className="px-3 py-2 text-xs text-band-mute text-center">{t.noTemplatesFound}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <input
                ref={caseFileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*"
                className="hidden"
                onChange={handleCaseFileChange}
              />
              <input
                ref={caseCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleCaseFileChange}
              />
              <input
                ref={formatFileInputRef}
                id="format-file-upload"
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*"
                className="hidden"
                onChange={handleFormatFileChange}
              />
              <input
                ref={formatCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFormatFileChange}
              />

              <div className="flex items-end p-1.5 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu((v) => !v);
                    if (showAttachMenu) setShowTemplateMenu(false);
                  }}
                  className={`mb-1 flex items-center justify-center w-10 h-10 rounded-xl border transition-colors flex-shrink-0 ${
                    showAttachMenu
                      ? 'bg-white border-white text-black'
                      : 'bg-ink-muted border-ink-border text-band-dim hover:text-white hover:bg-neutral-800'
                  }`}
                  title="Attach files or template"
                  aria-expanded={showAttachMenu}
                >
                  <PlusIcon className="w-5 h-5" />
                </button>

                <textarea
                  ref={textareaRef}
                  value={inputText}
                  maxLength={planLimits.maxMessageChars}
                  onChange={(e) => {
                    const next = e.target.value.slice(0, planLimits.maxMessageChars);
                    setInputText(next);
                    if (!wantListeningRef.current) {
                      speechBaseTextRef.current = next;
                    }
                  }}
                  placeholder={t.messagePlaceholder}
                  className="flex-1 min-h-[44px] max-h-36 p-2.5 bg-transparent resize-none outline-none text-band placeholder-band-mute text-base font-semibold leading-relaxed custom-scrollbar"
                  rows={1}
                  onKeyDown={(e) => { 
                    if (e.key === 'Enter' && !e.shiftKey) { 
                      e.preventDefault();
                      if (!isLoading) handleSend(false);
                    } 
                  }}
                />

                <div className="pb-1 pr-1 flex gap-1.5 flex-shrink-0">
                  {isSpeechSupported && (
                    <button
                      onClick={() => void toggleListening()}
                      disabled={isLoading}
                      className={`p-2 rounded-xl transition-all duration-150 shadow-sm ${isListening ? 'bg-white text-black hover:bg-neutral-200' : 'bg-ink-muted text-band-mute hover:bg-neutral-800 hover:text-white'} disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={isListening ? 'Stop voice typing' : 'Speech to Text'}
                      aria-pressed={isListening}
                    >
                      <MicIcon className={`w-5 h-5 ${isListening ? 'animate-pulse' : ''}`} />
                    </button>
                  )}
                  {isLoading ? (
                    <button
                      type="button"
                      onClick={abortInFlight}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white text-black rounded-xl hover:bg-neutral-200 active:scale-[0.97] transition-all duration-150 shadow-sm text-sm font-medium"
                      title={t.stopGenerating}
                    >
                      <StopIcon className="w-4 h-4" />
                      {t.stop}
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleSend(false)}
                      disabled={!canSend}
                      className="p-2 bg-white text-black rounded-xl hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                      <SendIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="px-3 pb-1.5 text-[10px] text-band-mute text-right">
                {inputText.length.toLocaleString()}/{planLimits.maxMessageChars.toLocaleString()}
              </div>
            </div>

            <button 
              onClick={() => handleSend(true)}
              disabled={!canGenerate || isLoading}
              className="w-full flex items-center justify-center gap-2 bg-white text-black py-3 rounded-2xl font-medium hover:bg-neutral-200 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <SparklesIcon className="w-5 h-5 text-yellow-300 group-hover:animate-pulse" />
              {t.generateDoc}
            </button>
          </div>
        </div>
      </div>
      <IncreaseChatLimitModal
        open={chatLimitOpen}
        reason={chatLimitReason}
        usedChars={getSessionCharCount(messages)}
        onClose={() => setChatLimitOpen(false)}
      />
    </div>
  );
});