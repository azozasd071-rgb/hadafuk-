const fmt = new Intl.DateTimeFormat('ar', {
  dateStyle: 'medium',
  timeStyle: 'short',
  numberingSystem: 'latn',
});

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtDate(ms) {
  if (!ms) return '—';
  try {
    return fmt.format(new Date(Number(ms)));
  } catch {
    return '—';
  }
}

export function injectFlash(html, flash) {
  if (!flash) return html;
  const cls = flash.type === 'ok' ? 'ok' : flash.type === 'err' ? 'err' : 'info';
  const div = `<div class="alert ${cls}">${esc(flash.text)}</div>`;
  return html.replace('<main class="container">', `<main class="container">\n${div}`);
}

export function layout({ title, active = '', content, flash = null, showNav = true, waConnected = false, bare = false }) {
  const nav = showNav
    ? `<header class="topbar">
        <a class="brand" href="/">
          <img class="brand-logo" src="/brand/hadafuk-logo.png" alt="شعار هدفك">
          <span class="brand-copy"><b>هدفك</b><i>لوحة دكتور أيمن</i></span>
        </a>
        <nav>
          <a href="/" class="${active === 'home' ? 'on' : ''}">الرئيسية</a>
          <a href="/upload" class="${active === 'upload' ? 'on' : ''}">أسئلة جديدة</a>
          <a href="/stats" class="${active === 'stats' ? 'on' : ''}">الإحصاءات</a>
          <a href="/whatsapp" class="${active === 'wa' ? 'on' : ''}">واتساب <span class="dot ${waConnected ? 'on' : ''}"></span></a>
          <a href="/settings" class="${active === 'settings' ? 'on' : ''}">الإعدادات</a>
        </nav>
        <form method="post" action="/logout"><button class="linkbtn">خروج</button></form>
      </header>`
    : '';

  const flashHtml = flash
    ? `<div class="alert ${flash.type === 'ok' ? 'ok' : flash.type === 'err' ? 'err' : 'info'}">${esc(flash.text)}</div>`
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | هدفك</title>
  <link rel="icon" type="image/png" href="/brand/hadafuk-logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&family=Reem+Kufi:wght@700&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${nav}
  <main class="${bare ? 'bare' : 'container'}">
    ${flashHtml}
    ${content}
  </main>
  ${bare ? '' : '<footer class="foot">هدفك — لوحة دكتور أيمن · اختبارات تليجرام + بث واتساب</footer>'}
</body>
</html>`;
}

export function loginPage({ error = '', showNav = false }) {
  return layout({
    title: 'دخول',
    showNav,
    bare: true,
    content: `
      <div class="login-shell">
        <section class="login-art">
          <div class="la-grid"></div>
          <div class="la-glow teal"></div>
          <div class="la-glow orange"></div>

          <div class="la-body">
            <div class="la-mark">
              <div class="la-card"></div>
              <img src="/brand/hadafuk-strokes.png" alt="شعار هدفك">
            </div>
            <div class="la-eyebrow"><i></i> سلسلة هدفك للقدرات</div>
            <div class="la-name"><small>دكتور</small><strong>أيمن</strong></div>
            <div class="la-word">هدفك</div>
            <div class="la-chips">
              <span>اختبارات تليجرام</span>
              <span>بث واتساب</span>
              <span>إحصائيات الطلاب</span>
            </div>
          </div>

          <div class="la-foot"><span class="ltr">@hadafukbot</span></div>
        </section>

        <section class="login-side">
          <div class="login-card">
            <div class="lc-eyebrow">لوحة التحكم</div>
            <h1>تسجيل الدخول</h1>
            <p class="muted small">ادخل بياناتك للوصول إلى لوحة دكتور أيمن.</p>
            ${error ? `<div class="alert err">${esc(error)}</div>` : ''}
            <form method="post" action="/login" autocomplete="off">
              <label>اسم المستخدم
                <input type="text" name="username" autocomplete="off" required autofocus>
              </label>
              <label>كلمة المرور
                <input type="password" name="password" autocomplete="new-password" required>
              </label>
              <button class="btn primary wide">دخول</button>
            </form>
            <p class="login-note">🔒 الوصول خاص بالدكتور فقط</p>
          </div>
        </section>
      </div>`,
  });
}

export function dashboardPage({ stats, quizzes, tg, wa }) {
  const quizRows = quizzes.length
    ? quizzes
        .map(
          (q) => `<tr>
            <td><a href="/quiz/${q.id}">${esc(q.title)}</a></td>
            <td>${q.question_count}</td>
            <td class="muted">${fmtDate(q.created_at)}</td>
            <td class="actions">
              <a class="btn small" href="/quiz/${q.id}/stats">📊 الإحصاءات</a>
              <form method="post" action="/quiz/${q.id}/delete" onsubmit="return confirm('متأكد من حذف الكويز وكل إحصاءاته؟')">
                <button class="btn danger small">حذف</button>
              </form>
            </td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="muted center">ما فيه اختبارات بعد — ابدأ برفع ملف PDF.</td></tr>`;

  return layout({
    title: 'الرئيسية',
    active: 'home',
    waConnected: wa.status === 'connected',
    content: `
      <div class="hero">
        <h1>مرحباً دكتور أيمن 👋</h1>
        <p class="muted">ارفع ملف الأسئلة، والبوت ينشرها في قروب تليجرام ويرسل روابط المحاضرات لكل قروبات واتساب.</p>
        <div class="row">
          <a class="btn primary" href="/upload">📄 رفع ملف أسئلة</a>
          <a class="btn" href="/whatsapp">إرسال رابط بث</a>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><span>${stats.quizzes}</span><label>اختبار</label></div>
        <div class="stat"><span>${stats.questions}</span><label>سؤال</label></div>
        <div class="stat"><span>${stats.answers}</span><label>إجابة طالب</label></div>
        <div class="stat"><span>${stats.quizzesDone}</span><label>اختبار مكتمل</label></div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>بوت تليجرام</h3>
          ${
            tg.running
              ? `<p class="ok-text">✅ شغّال — @${esc(tg.username)}</p>`
              : tg.configured
                ? `<p class="err-text">⚠️ التوكن محفوظ لكن البوت لا يعمل${tg.error ? `: ${esc(tg.error)}` : ''}</p>`
                : `<p class="err-text">⚠️ غير مفعّل — أضف توكن البوت من <a href="/settings">الإعدادات</a></p>`
          }
          <p class="muted small">تأكد إن البوت عضو أو أدمن في القروب، وأرسل له <code>/id</code> داخل القروب ليُحفظ تلقائياً.</p>
        </div>
        <div class="card">
          <h3>واتساب</h3>
          ${waStatusLine(wa)}
          <p class="muted small">أول مرة تحتاج مسح QR من صفحة <a href="/whatsapp">واتساب</a>.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>الاختبارات</h3>
          <a class="btn small" href="/upload">+ جديد</a>
        </div>
        <table class="table">
          <thead><tr><th>الاسم</th><th>الأسئلة</th><th>أُنشئ</th><th></th></tr></thead>
          <tbody>${quizRows}</tbody>
        </table>
      </div>`,
  });
}

export function waStatusLine(wa) {
  if (wa.status === 'connected') return `<p class="ok-text">✅ متصل${wa.number ? ` — ${esc(wa.number)}` : ''}</p>`;
  if (wa.status === 'qr') return `<p class="info-text">📱 بانتظار مسح رمز QR من صفحة واتساب</p>`;
  if (wa.status === 'connecting') return `<p class="info-text">⏳ جارٍ الاتصال...</p>`;
  if (wa.status === 'reconnecting') return `<p class="info-text">🔄 إعادة الاتصال...</p>`;
  if (wa.status === 'logged_out') return `<p class="err-text">⚠️ تم تسجيل الخروج — يحتاج ربط جديد</p>`;
  return `<p class="err-text">⚠️ غير متصل</p>`;
}

export function uploadPage() {
  return layout({
    title: 'رفع أسئلة',
    active: 'upload',
    content: `
      <div class="card narrow">
        <h1>رفع ملف الأسئلة (PDF)</h1>
        <p class="muted">النظام يقرأ الأسئلة والخيارات، ويكشف الإجابة الصحيحة من <b>الهايلايت الأصفر</b>. إذا كانت الإجابات في مفتاح آخر الملف يدعمها بعد.</p>
        <ul class="muted small list">
          <li>كل سؤال بخياراته في سطور منفصلة (أ، ب، ج، د أو A، B، C، D).</li>
          <li>الإجابة الصحيحة مظللة باللون الأصفر (أو مفتاح إجابات مثل: Answer key: 1-B).</li>
          <li>بعد الرفع تظهر شاشة مراجعة تعدل فيها أي شي قبل النشر.</li>
        </ul>
        <form method="post" action="/upload" enctype="multipart/form-data" class="stack">
          <label>ملف PDF
            <input type="file" name="pdf" accept="application/pdf,.pdf" required>
          </label>
          <button class="btn primary">رفع وتحليل</button>
        </form>
        <p class="muted small">الحد الأقصى 30 ميجا.</p>
      </div>`,
  });
}

export function uploadProgressPage({ id, filename, pages }) {
  return layout({
    title: 'جارٍ تحليل الملف',
    active: 'upload',
    content: `
      <div class="card narrow center">
        <h1>⏳ جارٍ تحليل الملف</h1>
        <p class="muted">${esc(filename)}</p>
        <div class="parse">
          <div class="parsebar"><i id="bar" style="width:2%"></i></div>
          <p class="muted small" id="label">تجهيز الملف…</p>
        </div>
        <p class="muted small">الملف الكبير (300+ صفحة) ياخذ حول دقيقة. لا تسكّر الصفحة.</p>
        <p><a class="btn ghost small" href="/upload">إلغاء والعودة</a></p>
      </div>
      <script>
        (function () {
          var total = ${Number(pages) || 0};
          var id = ${JSON.stringify(id)};
          function tick() {
            fetch('/api/upload/' + id, { headers: { 'accept': 'application/json' } })
              .then(function (r) { return r.json(); })
              .then(function (s) {
                if (s.status === 'done') { location.replace('/upload/' + id); return; }
                if (s.status === 'error') {
                  document.getElementById('label').textContent = 'تعذر التحليل: ' + (s.error || 'خطأ');
                  return;
                }
                var pct = s.total ? Math.max(2, Math.round((s.page / s.total) * 100)) : 2;
                document.getElementById('bar').style.width = pct + '%';
                document.getElementById('label').textContent =
                  'تم تحليل ' + s.page + ' من ' + (s.total || total) + ' صفحة (' + pct + '%)';
                setTimeout(tick, 900);
              })
              .catch(function () { setTimeout(tick, 1500); });
          }
          tick();
        })();
      </script>`,
  });
}

function questionCard(q, i) {
  const opts = q.options && q.options.length >= 2 ? q.options : [...(q.options || []), '', ''].slice(0, Math.max(2, (q.options || []).length + 1));
  const n = opts.length;
  const needsPick = q.correct_index === null || q.correct_index === undefined;
  return `
    <div class="qcard" data-idx="${i}" id="q-${i + 1}">
      <div class="qhead">
        <span class="qnum">سؤال ${i + 1}</span>
        ${needsPick ? '<span class="badge warn">حدد الإجابة الصحيحة</span>' : '<span class="badge ok">جاهز</span>'}
        <label class="del"><input type="checkbox" class="q-del" name="q_${i}_del" value="1"> حذف</label>
      </div>
      <input type="hidden" name="q_${i}_n" value="${n}" class="q-n">
      <textarea class="q-text" name="q_${i}_text" rows="2" placeholder="نص السؤال">${esc(q.text)}</textarea>
      <div class="opts">
        ${opts
          .map(
            (o, j) => `<label class="opt">
              <input type="radio" name="q_${i}_correct" value="${j}" ${q.correct_index === j ? 'checked' : ''}>
              <input type="text" class="q-opt" name="q_${i}_opt_${j}" value="${esc(o)}" placeholder="خيار ${j + 1}">
            </label>`
          )
          .join('')}
      </div>
      <button type="button" class="btn ghost small add-opt">+ إضافة خيار</button>
    </div>`;
}

export function reviewPage({ title, questions, warnings, action, heading, note = '' }) {
  return layout({
    title: heading,
    active: 'upload',
    content: `
      <div class="card-head page-head">
        <div>
          <h1>${esc(heading)}</h1>
          <p class="muted">راجع الأسئلة قبل الحفظ — عدّل النص، اختر الإجابة الصحيحة، واحذف أي سؤال مو لازم.</p>
        </div>
        <span class="badge info">${questions.length} سؤال</span>
      </div>
      ${note ? `<div class="alert info">${esc(note)}</div>` : ''}
      ${
        warnings && warnings.length
          ? `<div class="alert err"><b>تنبيهات تحتاج مراجعة:</b><ul class="list">${warnings
              .map((w) => {
                const m = String(w).match(/^سؤال\s+(\d+)/);
                return `<li>${m ? `<a href="#q-${m[1]}">${esc(w)}</a>` : esc(w)}</li>`;
              })
              .join('')}</ul></div>`
          : ''
      }
      <form method="post" action="${esc(action)}" id="quiz-form" class="stack">
        <div class="card">
          <label>عرض الاختبار في تليجرام
            <input type="text" name="title" value="${esc(title)}" required maxlength="120">
          </label>
        </div>
        <div id="questions">${questions.map((q, i) => questionCard(q, i)).join('')}</div>
        <div class="sticky-actions">
          <button type="button" class="btn ghost" id="add-question">+ إضافة سؤال</button>
          <button class="btn primary">💾 حفظ الاختبار</button>
        </div>
      </form>
      <script src="/review.js"></script>`,
  });
}

const RUN_STATUS = {
  active: ['جارٍ', 'ok'],
  done: ['منتهي', 'info'],
  stopped: ['متوقف', 'warn'],
  failed: ['فشل', 'err'],
};

export function quizPage({ quiz, questions, runs, tgGroups, tgRunning, note = '' }) {
  const hasRuns = runs.length > 0;
  const runsRows = hasRuns
    ? runs
        .map((r) => {
          const [label, kind] = RUN_STATUS[r.status] || [r.status, 'info'];
          const total = questions.length;
          const progress = r.status === 'active' ? `${Math.min(r.current_index, total)}/${total}` : '—';
          return `<tr>
            <td>${esc(r.chat_title || r.chat_id)}</td>
            <td><span class="badge ${kind}">${label}</span></td>
            <td>${progress}</td>
            <td class="muted">${fmtDate(r.created_at)}</td>
            <td>${r.last_error ? `<span class="muted small">${esc(r.last_error)}</span>` : ''}</td>
            <td>${
              r.status === 'active'
                ? `<form method="post" action="/quiz/${quiz.id}/stop" onsubmit="return confirm('إيقاف الاختبار وإغلاق الأسئلة المفتوحة؟')">
                    <input type="hidden" name="run_id" value="${r.id}">
                    <button class="btn danger small">إيقاف</button>
                  </form>`
                : ''
            }</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="muted center">لم يُشغّل بعد.</td></tr>`;

  const groupsOptions = tgGroups.length
    ? tgGroups
        .map((g) => `<option value="${esc(g.chat_id)}">${esc(g.title || 'بدون اسم')} (${esc(g.chat_id)})</option>`)
        .join('')
    : `<option value="">— ما فيه قروبات محفوظة بعد —</option>`;

  const questionList = questions
    .map(
      (q) => `<li>
        <b>${q.position}.</b> ${esc(q.text)}
        <div class="muted small">${q.options
          .map((o, j) => `${j === q.correct_index ? '✅ ' : ''}${esc(o)}`)
          .join(' • ')}</div>
      </li>`
    )
    .join('');

  return layout({
    title: quiz.title,
    active: 'home',
    content: `
      <div class="card-head page-head">
        <div>
          <h1>${esc(quiz.title)}</h1>
          <p class="muted">${questions.length} سؤال — أُنشئ ${fmtDate(quiz.created_at)}</p>
        </div>
        <div class="row">
          <a class="btn" href="/quiz/${quiz.id}/stats">📊 الإحصاءات</a>
          ${hasRuns ? '' : `<a class="btn" href="/quiz/${quiz.id}/edit">✏️ تعديل الأسئلة</a>`}
        </div>
      </div>
      ${note ? `<div class="alert info">${esc(note)}</div>` : ''}

      <div class="card">
        <h3>🚀 تشغيل في تليجرام</h3>
        ${
          tgRunning
            ? ''
            : `<div class="alert err">بوت تليجرام غير جاهز — أضف التوكن من <a href="/settings">الإعدادات</a> وشغّله أولاً.</div>`
        }
        <form method="post" action="/quiz/${quiz.id}/launch" class="formgrid">
          <label>القروب
            <select name="chat_id">${groupsOptions}</select>
          </label>
          <label>أو معرّف القروب يدوياً
            <input type="text" name="chat_id_custom" placeholder="-100123456789" inputmode="numeric">
          </label>
          <label>وتيرة الأسئلة
            <select name="interval_sec">
              <option value="0">كل الأسئلة بسرعة (خيارات قابلة للإجابة 60 ثانية)</option>
              <option value="60">سؤال كل دقيقة</option>
              <option value="120" selected>سؤال كل دقيقتين</option>
              <option value="300">سؤال كل 5 دقائق</option>
            </select>
          </label>
          <label>مدة الإجابة لكل سؤال
            <select name="answer_sec">
              <option value="30">30 ثانية</option>
              <option value="60">60 ثانية</option>
              <option value="120">دقيقتان</option>
              <option value="300">5 دقائق</option>
              <option value="18000" selected>5 ساعات (وقت الاختبار)</option>
            </select>
          </label>
          <button class="btn primary" ${questions.length ? '' : 'disabled'}>إرسال الأسئلة الآن</button>
        </form>
        <p class="muted small">الأسئلة تُنشر كـ Quiz رسمي وتُغلق تلقائياً بعد المدة المحددة، ثم تتحدث الإحصاءات لحظياً.</p>
      </div>

      <div class="card">
        <h3>تشغيلات سابقة</h3>
        <table class="table">
          <thead><tr><th>القروب</th><th>الحالة</th><th>التقدم</th><th>الوقت</th><th>ملاحظة</th><th></th></tr></thead>
          <tbody>${runsRows}</tbody>
        </table>
      </div>

      <div class="card">
        <h3>الأسئلة</h3>
        <ol class="qview">${questionList}</ol>
      </div>`,
  });
}

export function quizStatsPage({ quiz, leaderboard, breakdown }) {
  const lbRows = leaderboard.length
    ? leaderboard
        .map(
          (r, i) => `<tr>
            <td>${['🥇', '🥈', '🥉'][i] || i + 1}</td>
            <td>${esc(r.user_name)}</td>
            <td>${r.correct}</td>
            <td>${r.answered}</td>
            <td>${r.answered ? Math.round((r.correct / r.answered) * 100) : 0}%</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted center">لا توجد إجابات بعد.</td></tr>`;

  const breakdownRows = breakdown
    .map((b) => {
      const answered = Number(b.answered) || 0;
      const options = b.options
        .map((o, j) => {
          const count = b.distribution[j] || 0;
          const pct = answered ? Math.round((count / answered) * 100) : 0;
          return `<div class="bar-row ${j === b.correct_index ? 'correct' : ''}">
            <span class="bar-label">${esc(o)}</span>
            <div class="bar"><i style="width:${pct}%"></i></div>
            <span class="bar-pct">${count} (${pct}%)</span>
          </div>`;
        })
        .join('');
      return `<div class="breakdown">
        <h4>${b.position}. ${esc(b.text)}</h4>
        <p class="muted small">أجاب: ${answered}${b.correct_count ? ` • صح: ${b.correct_count}` : ''}</p>
        ${options}
      </div>`;
    })
    .join('');

  return layout({
    title: `إحصاءات ${quiz.title}`,
    active: 'stats',
    content: `
      <div class="card-head page-head">
        <div>
          <h1>📊 إحصاءات: ${esc(quiz.title)}</h1>
          <p class="muted">ترتيب الطلاب + تفصيل كل سؤال.</p>
        </div>
        <a class="btn" href="/quiz/${quiz.id}">رجوع للاختبار</a>
      </div>
      <div class="card">
        <h3>ترتيب الطلاب</h3>
        <table class="table">
          <thead><tr><th>#</th><th>الطالب</th><th>صح</th><th>إجابات</th><th>النسبة</th></tr></thead>
          <tbody>${lbRows}</tbody>
        </table>
      </div>
      <div class="card">
        <h3>تفصيل الأسئلة</h3>
        ${breakdownRows || '<p class="muted">لا توجد أسئلة مرسلة بعد.</p>'}
      </div>`,
  });
}

export function statsPage({ rows, stats }) {
  const body = rows.length
    ? rows
        .map(
          (r, i) => `<tr>
            <td>${['🥇', '🥈', '🥉'][i] || i + 1}</td>
            <td>${esc(r.user_name)}</td>
            <td>${r.correct}</td>
            <td>${r.answered}</td>
            <td>${r.answered ? Math.round((r.correct / r.answered) * 100) : 0}%</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted center">لا توجد إجابات بعد.</td></tr>`;

  return layout({
    title: 'الإحصاءات',
    active: 'stats',
    content: `
      <div class="hero">
        <h1>🏆 ترتيب الطلاب (كل الاختبارات)</h1>
        <p class="muted">${stats.answers} إجابة مسجّلة من ${stats.quizzes} اختبار.</p>
      </div>
      <div class="card">
        <table class="table">
          <thead><tr><th>#</th><th>الطالب</th><th>صح</th><th>إجابات</th><th>النسبة</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`,
  });
}

const WA_TEXT = {
  disconnected: ['غير متصل', 'err'],
  connecting: ['جارٍ الاتصال...', 'info'],
  qr: ['بانتظار مسح QR', 'warn'],
  connected: ['متصل', 'ok'],
  reconnecting: ['إعادة اتصال...', 'warn'],
  logged_out: ['مسجّل الخروج', 'err'],
};

export function whatsappPage({ wa, groups, broadcasts, note = '' }) {
  const [label, kind] = WA_TEXT[wa.status] || [wa.status, 'info'];

  const qrBlock =
    wa.status === 'qr' && wa.qr
      ? `<div class="qr-box">
          <img id="wa-qr" src="${wa.qr}" alt="QR واتساب">
          <p class="muted small">افتح واتساب في جوالك → الأجهزة المرتبطة → ربط جهاز → امسح الرمز. يتحدث تلقائياً.</p>
        </div>`
      : '';

  const groupsHtml = groups.length
    ? groups
        .map(
          (g) => `<label class="check-row" title="${esc(g.jid)}">
            <input type="checkbox" name="groups" value="${esc(g.jid)}" checked>
            <span>${esc(g.name)}</span>
          </label>`
        )
        .join('')
    : `<p class="muted">ما فيه قروبات محفوظة — اربط واتساب وحدّث القروبات.</p>`;

  const history = broadcasts.length
    ? broadcasts
        .map((b) => {
          const pct = b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
          return `<tr>
            <td class="muted">${fmtDate(b.created_at)}</td>
            <td class="snippet">${esc(b.text)}</td>
            <td>${b.total}</td>
            <td class="ok-text">${b.sent}</td>
            <td class="${b.failed ? 'err-text' : 'muted'}">${b.failed}</td>
            <td><div class="bar mini"><i style="width:${pct}%"></i></div></td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="muted center">ما أُرسل شي بعد.</td></tr>`;

  return layout({
    title: 'واتساب',
    active: 'wa',
    waConnected: wa.status === 'connected',
    content: `
      ${note ? `<div class="alert info">${esc(note)}</div>` : ''}
      <div class="card-head page-head">
        <div>
          <h1>💬 واتساب</h1>
          <p class="muted">اربط رقم البوت مرة واحدة، وبعدها كل رابط محاضرة ينتشر على قروباتك تلقائياً.</p>
        </div>
        <span class="badge ${kind}">${label}</span>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>الاتصال</h3>
          ${wa.number ? `<p class="muted">الرقم: <b>${esc(wa.number)}</b></p>` : ''}
          ${wa.error ? `<p class="err-text small">${esc(wa.error)}</p>` : ''}
          ${qrBlock}
          <div class="row">
            ${
              wa.status === 'connected'
                ? `<form method="post" action="/whatsapp/logout" onsubmit="return confirm('تسجيل الخروج من واتساب؟ تنحذف القروبات والسجل وتحتاج مسح QR من جديد.')"><button class="btn danger">تسجيل الخروج</button></form>
                   <form method="post" action="/whatsapp/refresh"><button class="btn">🔄 تحديث القروبات</button></form>`
                : `<form method="post" action="/whatsapp/connect"><button class="btn primary">${wa.status === 'qr' ? 'عرض رمز QR من جديد' : 'ربط واتساب'}</button></form>`
            }
          </div>
        </div>

        <div class="card">
          <h3>إحصائيات سريعة</h3>
          <p class="muted">القروبات المحفوظة: <b>${groups.length}</b></p>
          <p class="muted small">يُرسل بفاصل 4-9 ثواني بين كل قروب لتقليل خطر الحظر، مع سجل كامل لكل إرسال.</p>
        </div>
      </div>

      <div class="card">
        <h3>إرسال رابط البث</h3>
        <form method="post" action="/whatsapp/send" class="stack">
          <label>رابط البث
            <input type="text" inputmode="url" name="link" placeholder="meet.google.com/gqz-ifhv-uoj" required>
          </label>
          <label>نص إضافي (اختياري)
            <textarea name="note" rows="2" placeholder="مثال: محاضرة اليوم الساعة 8 مساءً — لا تتأخرون"></textarea>
          </label>
          <div>
            <div class="check-head">
              <span>القروبات (${groups.length})</span>
            </div>
            <div class="check-list">${groupsHtml}</div>
          </div>
          <button class="btn primary" ${groups.length ? '' : 'disabled'}>📤 إرسال للقروبات المحددة</button>
        </form>
      </div>

      <div class="card">
        <h3>سجل الإرسال</h3>
        <table class="table">
          <thead><tr><th>الوقت</th><th>الرسالة</th><th>الكل</th><th>أُرسل</th><th>فشل</th><th>التقدم</th></tr></thead>
          <tbody>${history}</tbody>
        </table>
      </div>

      <script>
        (function () {
          const img = document.getElementById('wa-qr');
          if (!img) return;
          const timer = setInterval(async () => {
            try {
              const res = await fetch('/api/wa/status');
              const data = await res.json();
              if (data.status === 'connected') { location.reload(); return; }
              if (data.qr && data.qr !== img.src) img.src = data.qr;
            } catch (e) {}
          }, 2500);
        })();
      </script>`,
  });
}

export function settingsPage({ tgConfigured, tgRunning, tgUsername, tgError, tgMasked }) {
  return layout({
    title: 'الإعدادات',
    active: 'settings',
    content: `
      <div class="card narrow">
        <h1>إعدادات بوت تليجرام</h1>
        <p class="muted small">اصنع بوت من <b>@BotFather</b> في تليجرام، خذ التوكن، والصقه هنا. بعدها أضف البوت لقروبك وأرسل <code>/id</code> داخل القروب.</p>
        <p>الحالة: ${
          tgRunning
            ? `<span class="ok-text">✅ شغّال — @${esc(tgUsername)}</span>`
            : tgConfigured
              ? `<span class="err-text">⚠️ متوقف${tgError ? ` — ${esc(tgError)}` : ''}</span>`
              : '<span class="err-text">⚠️ غير مفعّل</span>'
        }</p>
        ${tgMasked ? `<p class="muted small">التوكن الحالي: <code>${esc(tgMasked)}</code></p>` : ''}
        <form method="post" action="/settings/telegram" class="stack">
          <label>توكن البوت
            <input type="text" name="token" placeholder="123456:ABC-DEF..." autocomplete="off">
          </label>
          <button class="btn primary">حفظ وتشغيل</button>
        </form>
      </div>

      <div class="card narrow">
        <h1>تغيير كلمة المرور</h1>
        <form method="post" action="/settings/password" class="stack">
          <label>كلمة المرور الحالية
            <input type="password" name="current" required>
          </label>
          <label>كلمة المرور الجديدة (6 أحرف على الأقل)
            <input type="password" name="next" minlength="6" required>
          </label>
          <button class="btn primary">تغيير</button>
        </form>
      </div>`,
  });
}
