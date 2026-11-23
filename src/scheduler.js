import * as store from './db.js';
import { sendQuizPoll, sendText, stopPoll, isTelegramRunning } from './telegram.js';

let timer = null;
let busy = false;

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error('Scheduler:', err.message));
  }, 4000);
  console.log('Scheduler: شغّال (يفحص كل 4 ثواني)');
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await closePolls();
    if (isTelegramRunning()) await sendQuestions();
    await finalizeRuns();
  } finally {
    busy = false;
  }
}

async function closePolls() {
  const now = Date.now();

  for (const poll of store.duePolls(now)) {
    if (isTelegramRunning()) {
      await stopPoll(poll.chat_id, poll.message_id).catch(() => {});
    }
    store.markPollClosed(poll.id);
  }

  const stopped = store.db
    .prepare(
      `SELECT p.* FROM polls p JOIN runs r ON r.id = p.run_id
       WHERE r.status = 'stopped' AND p.closed_at IS NULL`
    )
    .all();
  for (const poll of stopped) {
    if (isTelegramRunning()) {
      await stopPoll(poll.chat_id, poll.message_id).catch(() => {});
    }
    store.markPollClosed(poll.id);
  }
}

async function sendQuestions() {
  const now = Date.now();

  for (const run of store.dueRuns(now)) {
    const questions = store.getQuestions(run.quiz_id);
    if (run.current_index >= questions.length) continue;

    const question = questions[run.current_index];
    if (question.correct_index === null || question.correct_index === undefined) {
      store.finishRun(run.id, 'failed', `سؤال ${question.position} بدون إجابة صحيحة محددة`);
      continue;
    }

    try {
      const { pollId, messageId } = await sendQuizPoll(
        run.chat_id,
        question.text,
        question.options,
        question.correct_index
      );

      const answerSec = Math.max(15, Number(run.answer_sec) || 60);
      store.insertPoll({
        pollId,
        runId: run.id,
        questionId: question.id,
        chatId: run.chat_id,
        messageId,
        correctIndex: question.correct_index,
        closeAt: Date.now() + answerSec * 1000,
      });

      const interval = Math.max(1500, Number(run.interval_sec) || 0);
      store.advanceRun(run.id, run.current_index + 1, Date.now() + interval);
      console.log(`Telegram: أُرسل سؤال ${question.position}/${questions.length} إلى ${run.chat_id}`);
    } catch (err) {
      console.error('Telegram send failed:', err.message);
      store.finishRun(run.id, 'failed', err.message || 'فشل الإرسال');
    }
  }
}

async function finalizeRuns() {
  const active = store.db.prepare("SELECT * FROM runs WHERE status = 'active'").all();

  for (const run of active) {
    const questions = store.getQuestions(run.quiz_id);
    if (run.current_index < questions.length) continue;
    if (store.openPollsCount(run.id) > 0) continue;
    if (store.pollsByRun(run.id).length === 0) continue;

    store.finishRun(run.id, 'done');
    if (run.summary_sent) continue;

    const quiz = store.getQuiz(run.quiz_id);
    const rows = store.runLeaderboard(run.id);
    let text = `📊 انتهى كويز «${quiz ? quiz.title : 'بدون عنوان'}»`;

    if (rows.length === 0) {
      text += '\nما وصلت أي إجابات هالمرة.';
    } else {
      text += `\n👥 المشاركون: ${rows.length}\n`;
      rows.forEach((row, i) => {
        const place = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
        text += `${place} ${row.user_name} — ${row.correct}/${questions.length}\n`;
      });
      text += 'التفاصيل الكاملة في لوحة التحكم.';
    }

    try {
      await sendText(run.chat_id, text);
    } catch (err) {
      console.error('Telegram summary failed:', err.message);
    }
    store.markRunSummarySent(run.id);
  }
}
