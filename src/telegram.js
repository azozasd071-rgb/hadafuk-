import { Bot } from 'grammy';
import { getSetting } from './db.js';

let bot = null;
let botInfo = null;
let lastError = '';
let dbRef = null;

function token() {
  return (getSetting('tg_token') || process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

export function telegramStatus() {
  return {
    configured: !!token(),
    running: !!bot,
    username: botInfo?.username || null,
    error: lastError,
  };
}

export function isTelegramRunning() {
  return !!bot;
}

function clip(text, max) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export async function startTelegram(db) {
  dbRef = db;
  if (bot) return;
  const t = token();
  if (!t) return;

  try {
    const instance = new Bot(t);

    instance.on('my_chat_member', (ctx) => {
      const chat = ctx.chat;
      if (chat.type === 'group' || chat.type === 'supergroup') {
        dbRef.upsertTgGroup(String(chat.id), chat.title || '');
        console.log(`Telegram: تم حفظ القروب «${chat.title}» (${chat.id})`);
      }
    });

    instance.on('message:text', async (ctx) => {
      const chat = ctx.chat;
      if (chat.type === 'private') return;
      if (/^\/id(@\w+)?\b/.test(ctx.message.text.trim())) {
        dbRef.upsertTgGroup(String(chat.id), chat.title || '');
        await ctx.reply(`معرّف القروب: ${chat.id}\nتم حفظه في لوحة التحكم ✅`).catch(() => {});
      }
    });

    instance.on('poll_answer', (ctx) => {
      const a = ctx.pollAnswer;
      if (!a || !a.option_ids || a.option_ids.length === 0) return;
      const name =
        [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') ||
        a.user.username ||
        String(a.user.id);
      dbRef.recordAnswer(a.poll_id, String(a.user.id), name, a.option_ids[0], Date.now());
    });

    instance.catch((err) => {
      lastError = err?.message || String(err);
      console.error('Telegram error:', lastError);
    });

    await instance.api.getMe().then((me) => {
      botInfo = me;
      lastError = '';
    });

    instance
      .start({ allowed_updates: ['message', 'poll_answer', 'my_chat_member'] })
      .catch((err) => {
        lastError = err?.message || String(err);
        console.error('Telegram start failed:', lastError);
        bot = null;
      });

    bot = instance;
    console.log(`Telegram: البوت @${botInfo.username} شغّال`);
  } catch (err) {
    lastError = err?.message || String(err);
    bot = null;
    console.error('Telegram init failed:', lastError);
  }
}

export async function stopTelegram() {
  if (!bot) return;
  const old = bot;
  bot = null;
  botInfo = null;
  try {
    await old.stop();
  } catch {
    // تجاهل
  }
}

export async function restartTelegram(db) {
  await stopTelegram();
  await startTelegram(db);
}

export async function sendQuizPoll(chatId, question, options, correctIndex) {
  if (!bot) throw new Error('بوت تليجرام غير مفعّل.');
  const res = await bot.api.sendPoll(
    chatId,
    clip(question, 300),
    options.slice(0, 10).map((o) => ({ text: clip(o, 100) })),
    {
      type: 'quiz',
      correct_option_id: Number(correctIndex),
      is_anonymous: false,
      allow_multiple_answers: false,
    }
  );
  return { pollId: res.poll.id, messageId: res.message_id };
}

export async function stopPoll(chatId, messageId) {
  if (!bot) return;
  await bot.api.stopPoll(chatId, Number(messageId));
}

export async function sendText(chatId, text) {
  if (!bot) return;
  await bot.api.sendMessage(chatId, text);
}
