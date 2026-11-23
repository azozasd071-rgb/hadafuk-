import './bootstrap.js';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, SESSION_SECRET, PORT, ADMIN_USER } from './config.js';
import * as store from './db.js';
import {
  ensureAdmin,
  checkAdminPassword,
  checkCredentials,
  setAdminPassword,
  requireAuth,
  tooManyAttempts,
  recordAttempt,
} from './auth.js';
import { parseQuizPdf } from './pdf-parse.js';
import * as views from './views.js';
import { startTelegram, restartTelegram, telegramStatus } from './telegram.js';
import {
  connectWhatsApp,
  logoutWhatsApp,
  refreshGroups,
  waStatus,
  startBroadcast,
  autoConnectWhatsApp,
} from './whatsapp.js';
import { startScheduler } from './scheduler.js';
import { startHfBackup } from './hf-sync.js';

const app = express();

app.use(express.urlencoded({ extended: true, limit: '3mb', parameterLimit: 60000 }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 },
  })
);

app.use((req, res, next) => {
  req.flash = (type, text) => {
    req.session.flash = { type, text };
  };
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;

  const originalSend = res.send.bind(res);
  res.send = (body) => {
    if (
      res.locals.flash &&
      typeof body === 'string' &&
      body.includes('<main class="container">') &&
      !body.includes('class="alert ')
    ) {
      body = views.injectFlash(body, res.locals.flash);
    }
    return originalSend(body);
  };

  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function waConnectedNow() {
  return waStatus().status === 'connected';
}

// ---------- auth ----------
app.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/');
  res.status(200).type('html').send(views.loginPage({}));
});

app.post('/login', (req, res) => {
  const ip = req.ip || 'local';
  if (tooManyAttempts(ip)) {
    return res.status(429).type('html').send(views.loginPage({ error: 'محاولات كثيرة — انتظر 10 دقائق.' }));
  }
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!checkCredentials(username, password)) {
    recordAttempt(ip);
    return res.status(401).type('html').send(views.loginPage({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }));
  }
  req.session.admin = true;
  req.session.adminUser = username;
  req.flash('ok', 'حياك الله 👋');
  res.redirect('/');
});

app.post('/logout', wrap(async (req, res) => {
  await logoutWhatsApp().catch(() => {});
  store.clearWaGroups();
  store.clearBroadcasts();
  req.session.destroy(() => res.redirect('/login'));
}));

app.use(requireAuth);

// ---------- dashboard ----------
app.get('/', (req, res) => {
  res.type('html').send(
    views.dashboardPage({
      stats: store.counts(),
      quizzes: store.listQuizzes(),
      tg: telegramStatus(),
      wa: waStatus(),
    })
  );
});

// ---------- upload & review ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function fixFileName(name) {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (/[\u0600-\u06FF]/.test(decoded) && !/[\u0600-\u06FF]/.test(name)) return decoded;
  } catch {
    // تجاهل
  }
  return name;
}

app.get('/upload', (req, res) => {
  res.type('html').send(views.uploadPage());
});

const parseJobs = new Map();

function pruneParseJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of parseJobs) if (job.createdAt < cutoff) parseJobs.delete(id);
}

app.post(
  '/upload',
  upload.single('pdf'),
  wrap(async (req, res) => {
    if (!req.file) {
      req.flash('err', 'ارفع ملف PDF أولاً.');
      return res.redirect('/upload');
    }

    pruneParseJobs();
    const id = randomUUID();
    const filename = fixFileName(req.file.originalname || 'اختبار.pdf');
    const job = {
      id,
      filename,
      title: filename.replace(/\.pdf$/i, '').slice(0, 120),
      status: 'parsing',
      page: 0,
      total: 0,
      createdAt: Date.now(),
      result: null,
      error: null,
    };
    parseJobs.set(id, job);

    parseQuizPdf(req.file.buffer, {
      onProgress: (page, total) => {
        job.page = page;
        job.total = total;
      },
    })
      .then((parsed) => {
        job.result = parsed;
        job.status = 'done';
      })
      .catch((err) => {
        job.error = err.message;
        job.status = 'error';
        console.error('PDF parse failed:', err.message);
      });

    res.redirect(303, `/upload/${id}`);
  })
);

app.get('/api/upload/:id', (req, res) => {
  const job = parseJobs.get(req.params.id);
  if (!job) return res.status(404).json({ status: 'error', error: 'انتهت الجلسة' });
  res.json({ status: job.status, page: job.page, total: job.total, error: job.error });
});

app.get('/upload/:id', (req, res) => {
  const job = parseJobs.get(req.params.id);
  if (!job) {
    req.flash('err', 'انتهت صلاحية التحليل — ارفع الملف مرة ثانية.');
    return res.redirect('/upload');
  }
  if (job.status === 'parsing') {
    return res.type('html').send(
      views.uploadProgressPage({ id: job.id, filename: job.filename, pages: job.total })
    );
  }
  if (job.status === 'error') {
    req.flash('err', `تعذر قراءة الملف: ${job.error}`);
    return res.redirect('/upload');
  }

  const parsed = job.result;
  if (!parsed.questions.length) {
    req.flash(
      'err',
      `ما لقيت أسئلة في الملف (هايلايتات صفراء: ${parsed.yellowHighlights}). تأكد إن الخيارات تبدأ بأ/ب/ج/د أو فيه مفتاح إجابات.`
    );
    return res.redirect('/upload');
  }

  const html = views.reviewPage({
    heading: 'مراجعة الأسئلة المستخرجة',
    title: job.title,
    questions: parsed.questions,
    warnings: parsed.warnings,
    action: '/quiz/new',
    note: `تم اكتشاف ${parsed.questions.length} سؤال في ${parsed.pages} صفحة (${parsed.yellowHighlights} هايلايت أصفر).`,
  });
  res.type('html').send(html);
});

function parseFormQuestions(body) {
  const list = [];
  const errors = [];

  for (let i = 0; i < 3000; i++) {
    const textKey = `q_${i}_text`;
    if (!(textKey in body)) break;
    if (body[`q_${i}_del`] === '1') continue;

    const text = String(body[textKey] || '').trim();
    const n = Math.min(10, Math.max(0, Number(body[`q_${i}_n`] || 0)));
    const raw = [];
    for (let j = 0; j < n; j++) {
      const value = String(body[`q_${i}_opt_${j}`] || '').trim();
      if (value) raw.push({ text: value, idx: j });
    }

    if (!text) continue;
    if (raw.length < 2) {
      errors.push(`سؤال ${i + 1}: يحتاج خيارين على الأقل.`);
      continue;
    }

    const chosen = Number(body[`q_${i}_correct`]);
    const mapped = raw.findIndex((r) => r.idx === chosen);
    if (mapped === -1) {
      errors.push(`سؤال ${i + 1}: اختر الإجابة الصحيحة.`);
      continue;
    }

    list.push({ text, options: raw.map((r) => r.text), correct_index: mapped });
  }

  if (!list.length) errors.push('ما فيه أسئلة صالحة للحفظ.');
  return { list, errors };
}

app.post('/quiz/new', (req, res) => {
  const title = String(req.body.title || '').trim() || 'اختبار بدون عنوان';
  const { list, errors } = parseFormQuestions(req.body);
  if (errors.length) {
    req.flash('err', errors.join(' | '));
    return res.redirect('/upload');
  }
  const quizId = store.createQuiz(title);
  store.insertQuestions(quizId, list);
  req.flash('ok', `تم حفظ الاختبار «${title}» — ${list.length} سؤال.`);
  res.redirect(`/quiz/${quizId}`);
});

function loadQuiz(id) {
  const quiz = store.getQuiz(id);
  if (!quiz) return null;
  return {
    quiz,
    questions: store.getQuestions(quiz.id),
    runs: store.runsByQuiz(quiz.id),
  };
}

app.get('/quiz/:id', (req, res) => {
  const data = loadQuiz(req.params.id);
  if (!data) {
    req.flash('err', 'الاختبار غير موجود.');
    return res.redirect('/');
  }
  const tg = telegramStatus();
  res.type('html').send(
    views.quizPage({
      ...data,
      tgGroups: store.listTgGroups(),
      tgRunning: tg.running,
    })
  );
});

app.get('/quiz/:id/edit', (req, res) => {
  const data = loadQuiz(req.params.id);
  if (!data) {
    req.flash('err', 'الاختبار غير موجود.');
    return res.redirect('/');
  }
  if (data.runs.length) {
    req.flash('err', 'ما ينفع تعديل الأسئلة بعد بدء التشغيل — سوّ اختبار جديد.');
    return res.redirect(`/quiz/${data.quiz.id}`);
  }
  res.type('html').send(
    views.reviewPage({
      heading: 'تعديل الأسئلة',
      title: data.quiz.title,
      questions: data.questions,
      warnings: [],
      action: `/quiz/${data.quiz.id}/save`,
    })
  );
});

app.post('/quiz/:id/save', (req, res) => {
  const data = loadQuiz(req.params.id);
  if (!data) {
    req.flash('err', 'الاختبار غير موجود.');
    return res.redirect('/');
  }
  if (data.runs.length) {
    req.flash('err', 'ما ينفع تعديل الأسئلة بعد بدء التشغيل.');
    return res.redirect(`/quiz/${data.quiz.id}`);
  }
  const { list, errors } = parseFormQuestions(req.body);
  if (errors.length) {
    req.flash('err', errors.join(' | '));
    return res.redirect(`/quiz/${data.quiz.id}/edit`);
  }
  store.renameQuiz(data.quiz.id, String(req.body.title || data.quiz.title));
  store.replaceQuestions(data.quiz.id, list);
  req.flash('ok', 'تم حفظ التعديلات.');
  res.redirect(`/quiz/${data.quiz.id}`);
});

app.post('/quiz/:id/launch', (req, res) => {
  const data = loadQuiz(req.params.id);
  if (!data) {
    req.flash('err', 'الاختبار غير موجود.');
    return res.redirect('/');
  }
  if (!telegramStatus().running) {
    req.flash('err', 'بوت تليجرام غير جاهز — أضف التوكن من الإعدادات.');
    return res.redirect(`/quiz/${data.quiz.id}`);
  }
  if (!data.questions.length) {
    req.flash('err', 'الاختبار بدون أسئلة.');
    return res.redirect(`/quiz/${data.quiz.id}`);
  }
  if (data.questions.some((q) => q.correct_index === null)) {
    req.flash('err', 'فيه أسئلة بدون إجابة صحيحة — عدّلها أولاً.');
    return res.redirect(`/quiz/${data.quiz.id}/edit`);
  }

  const chatId =
    String(req.body.chat_id_custom || '').trim() || String(req.body.chat_id || '').trim();
  if (!/^-?\d+$/.test(chatId)) {
    req.flash('err', 'اختر قروب أو أدخل معرّف صحيح (مثال: -100123456789).');
    return res.redirect(`/quiz/${data.quiz.id}`);
  }

  const group = store.listTgGroups().find((g) => g.chat_id === chatId);
  const interval = Math.max(0, Math.min(7200, Number(req.body.interval_sec || 0)));
  const answer = Math.max(15, Math.min(18000, Number(req.body.answer_sec || 60)));

  store.createRun({
    quizId: data.quiz.id,
    chatId,
    chatTitle: group ? group.title : '',
    intervalSec: interval,
    answerSec: answer,
    startAt: Date.now() + 2000,
  });

  req.flash('ok', 'بدأ الإرسال — أول سؤال يوصل خلال ثوانٍ.');
  res.redirect(`/quiz/${data.quiz.id}`);
});

app.post('/quiz/:id/stop', (req, res) => {
  const runId = Number(req.body.run_id);
  const run = store.getRun(runId);
  if (run && run.quiz_id === Number(req.params.id)) {
    store.finishRun(runId, 'stopped');
    req.flash('ok', 'تم إيقاف التشغيل وسيتم إغلاق الأسئلة المفتوحة.');
  }
  res.redirect(`/quiz/${req.params.id}`);
});

app.post('/quiz/:id/delete', (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (quiz) store.deleteQuiz(quiz.id);
  req.flash('ok', 'تم حذف الاختبار.');
  res.redirect('/');
});

// ---------- stats ----------
app.get('/quiz/:id/stats', (req, res) => {
  const data = loadQuiz(req.params.id);
  if (!data) {
    req.flash('err', 'الاختبار غير موجود.');
    return res.redirect('/');
  }
  res.type('html').send(
    views.quizStatsPage({
      quiz: data.quiz,
      leaderboard: store.leaderboard(data.quiz.id),
      breakdown: store.questionBreakdown(data.quiz.id),
    })
  );
});

app.get('/stats', (req, res) => {
  res.type('html').send(
    views.statsPage({
      rows: store.leaderboard(),
      stats: store.counts(),
    })
  );
});

// ---------- whatsapp ----------
app.get('/whatsapp', (req, res) => {
  res.type('html').send(
    views.whatsappPage({
      wa: waStatus(),
      groups: store.listWaGroups(),
      broadcasts: store.listBroadcasts(12),
    })
  );
});

app.post('/whatsapp/connect', (req, res) => {
  connectWhatsApp().catch(() => {});
  req.flash('info', 'جارٍ الاتصال بواتساب — انتظر ظهور رمز QR.');
  res.redirect('/whatsapp');
});

app.post('/whatsapp/logout', wrap(async (req, res) => {
  await logoutWhatsApp();
  store.clearWaGroups();
  store.clearBroadcasts();
  req.flash('ok', 'تم تسجيل الخروج من واتساب وحذف القروبات والسجل.');
  res.redirect('/whatsapp');
}));

app.post('/whatsapp/refresh', wrap(async (req, res) => {
  const groups = await refreshGroups();
  req.flash('ok', `تم تحديث القروبات (${groups.length}).`);
  res.redirect('/whatsapp');
}));

app.post('/whatsapp/send', (req, res) => {
  if (!waConnectedNow()) {
    req.flash('err', 'اربط واتساب أولاً.');
    return res.redirect('/whatsapp');
  }

  const rawLink = String(req.body.link || '').trim();
  const probe = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawLink) ? rawLink : `https://${rawLink}`;
  let parsed = null;
  try {
    parsed = new URL(probe);
  } catch {
    parsed = null;
  }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) {
    req.flash('err', 'أدخل رابط صحيح مثل meet.google.com/gqz-ifhv-uoj');
    return res.redirect('/whatsapp');
  }
  const note = String(req.body.note || '').trim();
  const text = note ? `${note}\n${rawLink}` : rawLink;

  const selected = [].concat(req.body.groups || []);
  const targets = store.listWaGroups().filter((g) => selected.includes(g.jid));
  if (!targets.length) {
    req.flash('err', 'اختر قروب واحد على الأقل.');
    return res.redirect('/whatsapp');
  }

  const broadcastId = store.createBroadcast(text, targets);
  startBroadcast(store.getDeliveries(broadcastId), text);
  req.flash('ok', `بدأ الإرسال إلى ${targets.length} قروب — يظهر التقدم في السجل.`);
  res.redirect('/whatsapp');
});

app.get('/api/wa/status', (req, res) => {
  res.json(waStatus());
});

app.get('/api/wa/broadcast/:id', (req, res) => {
  const broadcast = store.getBroadcast(req.params.id);
  if (!broadcast) return res.status(404).json({ error: 'not found' });
  res.json({ broadcast, deliveries: store.getDeliveries(broadcast.id) });
});

app.get('/api/tg/status', (req, res) => {
  res.json(telegramStatus());
});

// ---------- settings ----------
app.get('/settings', (req, res) => {
  const token = store.getSetting('tg_token') || process.env.TELEGRAM_BOT_TOKEN || '';
  const masked = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : '';
  const tg = telegramStatus();
  res.type('html').send(
    views.settingsPage({
      tgConfigured: tg.configured,
      tgRunning: tg.running,
      tgUsername: tg.username,
      tgError: tg.error,
      tgMasked: masked,
    })
  );
});

app.post('/settings/telegram', wrap(async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    req.flash('err', 'التوكن غير صحيح الشكل — انسخه كامل من BotFather.');
    return res.redirect('/settings');
  }
  store.setSetting('tg_token', token);
  await restartTelegram(store);
  const tg = telegramStatus();
  req.flash(tg.running ? 'ok' : 'err', tg.running ? `تم تشغيل البوت @${tg.username}` : `تعذر تشغيل البوت: ${tg.error || 'تحقق من التوكن'}`);
  res.redirect('/settings');
}));

app.post('/settings/password', (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  if (!checkAdminPassword(current)) {
    req.flash('err', 'كلمة المرور الحالية غلط.');
    return res.redirect('/settings');
  }
  if (next.length < 6) {
    req.flash('err', 'كلمة المرور الجديدة قصيرة (6 أحرف على الأقل).');
    return res.redirect('/settings');
  }
  setAdminPassword(next);
  req.flash('ok', 'تم تغيير كلمة المرور.');
  res.redirect('/settings');
});

app.use((req, res) => {
  res.status(404).type('html').send(views.loginPage({ error: 'الصفحة غير موجودة', showNav: false }));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (res.headersSent) return next(err);
  const flash = { type: 'err', text: `صار خطأ: ${err.message}` };
  res.status(500).type('html').send(
    views.layout({
      title: 'خطأ',
      content: '<div class="card"><h1>صار خطأ غير متوقع</h1><p class="muted">ارجع للرئيسية وجرب مرة ثانية.</p><p><a class="btn" href="/">الرئيسية</a></p></div>',
      flash,
    })
  );
});

ensureAdmin();
startTelegram(store).catch(() => {});
startScheduler();
autoConnectWhatsApp();
startHfBackup();

app.listen(PORT, () => {
  console.log('');
  console.log('==========================================');
  console.log(`  🎓 هدفك — لوحة دكتور أيمن شغّالة على: http://localhost:${PORT}`);
  console.log(`  🔑 اسم المستخدم: ${ADMIN_USER} — كلمة المرور من .env`);
  console.log('==========================================');
  console.log('');
});
