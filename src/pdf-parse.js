import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const ARABIC_RE = /[\u0600-\u06FF]/;
const BIDI_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const TATWEEL_RE = /\u0640/g;

// حروف بداية الخيارات: أ / ب / ج / د / هـ
// الفاصل قد يكون ) ( - . ـ أو فراغ فقط (بعض الصفحات: «أ لحظاتك ب . أيامنا»)
const OPTION_MARK = '(?:[أإآابجدهـ]|[a-eA-E])';
const OPTION_SPLIT_RE = new RegExp(
  `(^|[\\s(])(${OPTION_MARK})(?![\\u0621-\\u064A])(?:\\s*[)(\\-–—.ـ]\\s*|\\s+)`,
  'gu'
);

const MARK_INDEX = {
  'أ': 0, 'ا': 0, 'إ': 0, 'آ': 0,
  'ب': 1, 'ج': 2, 'د': 3, 'هـ': 4, 'ه': 4,
  'a': 0, 'A': 0, 'b': 1, 'B': 1,
  'c': 2, 'C': 2, 'd': 3, 'D': 3, 'e': 4, 'E': 4,
};

function normalizeText(text) {
  return String(text)
    .normalize('NFKC')
    .replace(BIDI_RE, '')
    .replace(TATWEEL_RE, '')
    // إعادة ترتيب الهمزة بعد اللام (األ -> الأ)
    .replace(/األ/g, 'الأ')
    .replace(/اإل/g, 'الإ')
    .replace(/اآل/g, 'الآ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeColor(color) {
  let raw = color;
  if (Array.isArray(raw) && raw.length === 1) raw = raw[0];

  if (typeof raw === 'string' && /^#?[0-9a-f]{6}$/i.test(raw)) {
    const hex = raw.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }

  if (!Array.isArray(raw) || raw.length < 3) return null;
  let [r, g, b] = raw.slice(0, 3).map(Number);
  if ([r, g, b].some((v) => !Number.isFinite(v))) return null;
  if (r > 1.5 || g > 1.5 || b > 1.5) [r, g, b] = [r / 255, g / 255, b / 255];
  return [r, g, b];
}

function isYellow(color) {
  if (!color) return false;
  const [r, g, b] = color;
  return r > 0.72 && g > 0.6 && b < 0.72 && r - b > 0.2 && g - b > 0.15;
}

function overlapArea(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

async function detectYellowRects(page) {
  const rects = [];
  const seen = new Set();
  const pushRect = (r) => {
    const w = r.x2 - r.x1;
    const h = r.y2 - r.y1;
    if (w < 6 || h < 4) return;
    const key = `${Math.round(r.x1)},${Math.round(r.y1)},${Math.round(r.x2)},${Math.round(r.y2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rects.push(r);
  };

  // هايلايت رسمي (Annotations) — موجود في ملفات كثيرة
  try {
    const annotations = await page.getAnnotations({ intent: 'display' });
    for (const a of annotations) {
      if (a.subtype !== 'Highlight') continue;
      if (!isYellow(normalizeColor(a.color))) continue;
      const r = a.rect;
      if (!Array.isArray(r) || r.length < 4) continue;
      pushRect({
        x1: Math.min(r[0], r[2]),
        y1: Math.min(r[1], r[3]),
        x2: Math.max(r[0], r[2]),
        y2: Math.max(r[1], r[3]),
      });
    }
  } catch {
    // ملف بدون أنوتيشن
  }

  try {
    const ops = await page.getOperatorList();
    const { OPS } = pdfjs;

    let lastFillIsYellow = false;

    // تتبّع CTM لمسارات rectangle + fill
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = (m, t) => [
      m[0] * t[0] + m[2] * t[1],
      m[1] * t[0] + m[3] * t[1],
      m[0] * t[2] + m[2] * t[3],
      m[1] * t[2] + m[3] * t[3],
      m[0] * t[4] + m[2] * t[5] + m[4],
      m[1] * t[4] + m[3] * t[5] + m[5],
    ];
    const applyCtm = (x, y) => [
      ctm[0] * x + ctm[2] * y + ctm[4],
      ctm[1] * x + ctm[3] * y + ctm[5],
    ];
    const rectToSpace = (x, y, w, h) => {
      const p1 = applyCtm(x, y);
      const p2 = applyCtm(x + w, y + h);
      return {
        x1: Math.min(p1[0], p2[0]),
        y1: Math.min(p1[1], p2[1]),
        x2: Math.max(p1[0], p2[0]),
        y2: Math.max(p1[1], p2[1]),
      };
    };

    let pendingRect = null;

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];

      if (fn === OPS.save) stack.push([...ctm]);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.setFillRGBColor || fn === OPS.setFillColor) {
        lastFillIsYellow = isYellow(normalizeColor(args));
      } else if (fn === OPS.setFillGray) {
        lastFillIsYellow = false;
      } else if (fn === OPS.rectangle) {
        pendingRect = rectToSpace(...args);
      } else if (
        fn === OPS.fill ||
        fn === OPS.eoFill ||
        fn === OPS.fillStroke ||
        fn === OPS.eoFillStroke
      ) {
        if (pendingRect && lastFillIsYellow) pushRect(pendingRect);
        pendingRect = null;
      } else if (fn === OPS.constructPath) {
        const paint = args[0];
        const mm = args[2];
        if (!mm || typeof mm !== 'object') continue;
        const mx1 = Number(mm[0] ?? mm['0']);
        const my1 = Number(mm[1] ?? mm['1']);
        const mx2 = Number(mm[2] ?? mm['2']);
        const my2 = Number(mm[3] ?? mm['3']);
        if (![mx1, my1, mx2, my2].every(Number.isFinite)) continue;
        const rect = { x1: mx1, y1: my1, x2: mx2, y2: my2 };
        const path = args[1] && args[1][0];
        const isQuad = path && path['12'] === 4 && path['0'] === 0;

        if ((paint === OPS.fill || paint === OPS.eoFill) && lastFillIsYellow && isQuad) {
          pushRect(rect);
        } else if (paint === OPS.eoFill) {
          // في ملفات التصميم (مثل ملف الدكتور) التظليل الأصفر يُرسم كـ eoFill مستطيل
          const w = rect.x2 - rect.x1;
          const h = rect.y2 - rect.y1;
          if (w >= 12 && h >= 6 && h <= 42 && w <= 560) pushRect(rect);
        }
      }
    }
  } catch {
    // تجاهل أخطاء قائمة العمليات
  }

  return rects;
}

function buildLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];

  for (const item of sorted) {
    const tolerance = Math.max(2.5, item.h * 0.45);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }

  for (const line of lines) {
    const rtl = line.items.some((i) => ARABIC_RE.test(i.str));
    line.items.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    line.rtl = rtl;

    let text = '';
    const owners = [];
    let prev = null;
    line.items.forEach((item, idx) => {
      if (prev) {
        const gap = rtl ? prev.x - (item.x + item.w) : item.x - (prev.x + prev.w);
        const space = Math.max(2, Math.max(item.h, prev.h) * 0.22);
        if (gap > space) {
          text += ' ';
          owners.push(-1);
        }
      }
      for (const ch of item.str) {
        text += ch;
        owners.push(idx);
      }
      prev = item;
    });

    line.text = normalizeText(text);
    line.owners = owners;
    line.x1 = Math.min(...line.items.map((i) => i.x));
    line.x2 = Math.max(...line.items.map((i) => i.x + i.w));
    line.y1 = Math.min(...line.items.map((i) => i.y));
    line.y2 = Math.max(...line.items.map((i) => i.y + i.h));
    line.rects = [];
  }

  return lines
    .filter((l) => l.text)
    .sort((a, b) => b.y - a.y || (a.items[0]?.x ?? 0) - (b.items[0]?.x ?? 0));
}

const JUNK_LINE_RE = [
  /^نص\s*آخر$/,
  /^[\sـ\-–—_\.٫]+$/,
  /^[\d٠-٩]{1,4}$/,
  /^(?:القسم|الفصل|الباب)\s/,
  /^قطعة\s/,
  /سلسلة\s+هدفك/,
  /دكتور\s+أيمن/,
  /^(?:صفحة|page)\s/i,
  /^جاري\s+التأكد/,
  /^لم\s+يرد\s+هذا\s+السؤال/,
  /^وورد\s+مكانه/,
];

const QUESTION_START_RE = /^[\d٠-٩]{1,3}\s*[\.\-]\s*/;

function isJunk(text) {
  return JUNK_LINE_RE.some((re) => re.test(text));
}

function stripStats(text) {
  let t = text.trim();
  for (let k = 0; k < 4; k++) {
    const m = t.match(
      /\s*(?:[\d٠-٩]{1,3}(?:\.[\d٠-٩]+)?\s*%|(?:100|99(?:\.\d+)?|98(?:\.\d+)?))\s*$/
    );
    if (!m || m.index === 0) break;
    t = t.slice(0, m.index).trim();
  }
  return t;
}

function hasStat100(text) {
  const t = text.trim();
  // النسبة قد تكون ملتصقة بالكلمة (مثال: «صفاتها100%»)
  const m = t.match(/(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/);
  if (m) {
    const v = Number(m[1].replace(',', '.'));
    return v >= 99.5;
  }
  return /(?:^|\s)100\s*$/.test(t);
}

function bboxFromOwners(line, start, end) {
  const idxs = new Set();
  for (let i = start; i < end; i++) {
    const o = line.owners[i];
    if (o >= 0) idxs.add(o);
  }
  if (!idxs.size) return null;
  let x1 = Infinity;
  let x2 = -Infinity;
  let y1 = Infinity;
  let y2 = -Infinity;
  for (const idx of idxs) {
    const it = line.items[idx];
    x1 = Math.min(x1, it.x);
    x2 = Math.max(x2, it.x + it.w);
    y1 = Math.min(y1, it.y);
    y2 = Math.max(y2, it.y + Math.max(it.h, 1));
  }
  return { x1, y1, x2, y2, rects: line.rects };
}

// يقسم سطرًا فيه خيارات إلى خيارات منفصلة مع موضع كل خيار
function splitOptionLine(line) {
  const text = line.text;
  const matches = [...text.matchAll(OPTION_SPLIT_RE)];
  if (!matches.length) return null;

  const segments = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index + m[1].length;
    const end =
      i + 1 < matches.length ? matches[i + 1].index + matches[i + 1][1].length : text.length;
    const raw = text.slice(start, end).trim();
    if (!raw) continue;
    const body = raw
      .replace(
        new RegExp(`^${OPTION_MARK}(?![\\u0621-\\u064A])(?:\\s*[)(\\-–—.ـ]\\s*|\\s+)`, 'u'),
        ''
      )
      .trim();
    if (!body) continue;
    const mark = MARK_INDEX[m[2]];
    segments.push({
      mark: mark === undefined ? null : mark,
      body,
      pct100: hasStat100(raw),
      bbox: bboxFromOwners(line, start, end),
    });
  }

  return segments.length ? segments : null;
}

// أول إشارة بعد السطر الحالي: سؤال جديد، أو خيارات (وحرفها)، أو نهاية
function nextSignal(lines, fromIndex) {
  for (let i = fromIndex; i < lines.length; i++) {
    const t = lines[i].text;
    if (!t || isJunk(t)) continue;
    if (QUESTION_START_RE.test(t)) return { kind: 'question' };
    const segs = splitOptionLine(lines[i]);
    if (segs) return { kind: 'options', first: segs[0].mark };
  }
  return { kind: 'end' };
}

function dedupeRects(rects) {
  const seen = new Set();
  const out = [];
  for (const r of rects) {
    const key = `${Math.round(r.x1)},${Math.round(r.y1)},${Math.round(r.x2)},${Math.round(r.y2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// الخيار الطويل قد ينكسر على سطر ثانٍ — نضمّه لآخر خيار ونمدّد حدوده
function extendOption(opt, line) {
  opt.body = `${opt.body} ${line.text}`.trim();
  const b = opt.bbox;
  opt.bbox = {
    x1: Math.min(b.x1, line.x1),
    y1: Math.min(b.y1, line.y1),
    x2: Math.max(b.x2, line.x2),
    y2: Math.max(b.y2, line.y2),
    rects: dedupeRects([...(b.rects || []), ...line.rects]),
  };
}

const QUESTION_LEAD_RE =
  /^(?:أي|اي|ما|ماذا|مّاذا|من|كيف|لماذا|متى|أين|اين|ذكر|يُفهم|يفهم|تدل|تعني|معنى|العلاقة|العالقة|يمكن|اختر|حدد|مما|علام|فيم|بم|ما الذي|ما هي|ما هو)\s/;

function cleanQuestionText(text) {
  let t = text;
  const parts = t.split('//').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) t = parts[0];
  t = stripStats(t);
  return t
    .replace(/^[\s:\-–—\.]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanOptionText(text) {
  let t = text;
  const parts = t.split('//').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) t = parts[0];
  return stripStats(t).replace(/\s+/g, ' ').trim();
}

function segmentQuestions(allLines) {
  const questions = [];
  const dropped = [];
  let current = null;

  const close = () => {
    if (!current) return;
    const options = current.options.filter((o) => o.body);
    const txt = cleanQuestionText(current.text);
    if (options.length >= 2) {
      if (txt) questions.push({ text: txt, options: options.slice(0, 10) });
    } else if (txt && (options.length === 1 || /[:؟]\s*$/.test(txt))) {
      // سؤال واضح لكن خياراته ما انقرأت
      dropped.push({ text: txt.slice(0, 60), options: options.length });
    }
    current = null;
  };

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const text = line.text;
    if (!text || isJunk(text)) continue;

    const qm = text.match(QUESTION_START_RE);
    if (qm) {
      close();
      current = { text: text.slice(qm[0].length), options: [] };
      continue;
    }

    const segs = splitOptionLine(line);
    if (segs) {
      if (!current) continue;
      current.options.push(...segs);
      continue;
    }

    if (current) {
      if (!current.options.length) {
        // السؤال قد يمتد على سطرين: نضم السطر إلا إذا كان السطر التالي سؤالاً مستقلاً
        if (current.text.length > 120 && QUESTION_LEAD_RE.test(text)) current.text = text;
        else current.text = `${current.text} ${text}`.trim();
      } else if (
        current.options.length < 4 &&
        (() => {
          const sig = nextSignal(allLines, i + 1);
          return sig.kind === 'options' && sig.first === current.options.length;
        })()
      ) {
        // الخيار الأخير مكسور على سطر إضافي (مثال: سطر 35 صفحة 35)
        extendOption(current.options[current.options.length - 1], line);
      } else {
        // سطر نص جديد بعد اكتمال الخيارات = بداية سؤال جديد بدون رقم
        close();
        current = { text, options: [] };
      }
    }
  }
  close();

  return { questions, dropped };
}

function finalize(questions, collectDebug = false) {
  const warnings = [];
  const result = [];
  const longTexts = [];

  for (const q of questions) {
    const text = cleanQuestionText(q.text);
    const options = q.options.map((o) => ({
      text: cleanOptionText(o.body),
      pct100: o.pct100 || hasStat100(o.body),
      bbox: o.bbox,
    }));
    const valid = options.filter((o) => o.text);
    if (!text) {
      warnings.push(`سؤال ${result.length + 1}: نص السؤال فارغ — تأكد من الملف.`);
      continue;
    }
    if (valid.length < 2) {
      warnings.push(`سؤال ${result.length + 1}: خيارات أقل من 2 — تم تجاهله.`);
      continue;
    }

    // مطابقة التظليل الأصفر مع حدود كل خيار
    let best = null;
    let bestScore = 0;
    let highlighted = 0;
    const dbg = collectDebug ? [] : null;
    for (const o of valid) {
      if (!o.bbox || !o.bbox.rects) {
        if (dbg) dbg.push({ text: o.text, score: 0, bbox: null });
        continue;
      }
      let score = 0;
      for (const r of o.bbox.rects) {
        const area = Math.max(1, (r.x2 - r.x1) * (r.y2 - r.y1));
        score += overlapArea(o.bbox, r) / area;
      }
      if (dbg) {
        dbg.push({
          text: o.text,
          score: +score.toFixed(2),
          bbox: o.bbox && {
            x1: +o.bbox.x1.toFixed(1),
            y1: +o.bbox.y1.toFixed(1),
            x2: +o.bbox.x2.toFixed(1),
            y2: +o.bbox.y2.toFixed(1),
          },
          rects: (o.bbox.rects || []).map((r) => ({
            x1: +r.x1.toFixed(1),
            y1: +r.y1.toFixed(1),
            x2: +r.x2.toFixed(1),
            y2: +r.y2.toFixed(1),
          })),
        });
      }
      if (score > 0.3) highlighted++;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }

    let correct = best && bestScore >= 0.3 ? valid.indexOf(best) : null;

    if (correct === null) {
      const hundreds = valid.filter((o) => o.pct100);
      if (hundreds.length === 1) correct = valid.indexOf(hundreds[0]);
      else if (hundreds.length > 1) {
        warnings.push(`سؤال ${result.length + 1}: أكثر من خيار عليه 100% — راجع الإجابة.`);
      } else {
        warnings.push(`سؤال ${result.length + 1}: ما قدرت أحدد الإجابة الصحيحة — اخترها يدوياً.`);
      }
    } else if (highlighted > 1) {
      warnings.push(`سؤال ${result.length + 1}: فيه أكثر من خيار مظلل — تأكد من الإجابة.`);
    }

    const item = {
      text,
      options: valid.map((o) => o.text),
      correct_index: correct === null ? null : correct,
      highlighted,
    };
    if (dbg) item.debug = dbg;
    if (text.length > 290) longTexts.push(result.length + 1);
    result.push(item);
  }

  if (longTexts.length) {
    warnings.push(
      `${longTexts.length} سؤال نصّه أطول من 290 حرف (أولها: ${longTexts
        .slice(0, 8)
        .join('، ')}) — تليجرام يقص عند 300 حرف، اختصره.`
    );
  }

  return { questions: result, warnings };
}

function attachRects(line, rects) {
  line.rects = rects.filter((r) => r.y2 >= line.y1 - 2 && r.y1 <= line.y2 + 2);
}

export async function buildLinesForPage(page) {
  const textContent = await page.getTextContent();
  const rects = await detectYellowRects(page);

  const items = [];
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    const str = normalizeText(item.str);
    if (!str) continue;
    const [, , , , x, y] = item.transform;
    const h = Math.abs(item.height || item.transform[3]) || 10;
    const w = Math.max(0, item.width || 0);
    items.push({ str, x, y, w: Math.max(w, 1), h });
  }

  const lines = buildLines(items);
  for (const line of lines) attachRects(line, rects);
  return { lines, rects };
}

export async function parseQuizPdf(buffer, { onProgress, collectDebug = false } = {}) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const allLines = [];
  let highlightCount = 0;
  const totalPages = doc.numPages;

  try {
    for (let p = 1; p <= totalPages; p++) {
      const page = await doc.getPage(p);
      const { lines, rects } = await buildLinesForPage(page);
      highlightCount += rects.length;
      for (const line of lines) allLines.push(line);

      if (onProgress) onProgress(p, totalPages);
    }
  } finally {
    await loadingTask.destroy();
  }

  const { questions: rawQuestions, dropped } = segmentQuestions(allLines);
  const { questions, warnings } = finalize(rawQuestions, collectDebug);

  if (dropped.length) {
    const oneOpt = dropped.filter((d) => d.options === 1).length;
    warnings.push(
      `${dropped.length} سؤال ما قدرت أكمّل خياراته${oneOpt ? ` (${oneOpt} منه خيار واحد فقط)` : ''} — أولها: ${dropped
        .slice(0, 6)
        .map((d) => `«${d.text}…»`)
        .join('، ')}. أضفها يدوياً إذا لزم.`
    );
  }

  if (!questions.length) {
    warnings.unshift(
      'ما لقيت أسئلة بصيغة (رقم السؤال + خيارات أ/ب/ج/د). تأكد أن الملف نصي (مو صورة) وأن الخيارات مرقّمة بحروف عربية.'
    );
  }

  return {
    questions,
    warnings,
    yellowHighlights: highlightCount,
    pages: totalPages,
    ...(collectDebug ? { dropped } : {}),
  };
}
