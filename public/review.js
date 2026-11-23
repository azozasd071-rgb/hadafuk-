function makeCard(idx) {
  const opts = [0, 1, 2, 3]
    .map(
      (j) => `<label class="opt">
        <input type="radio" name="q_${idx}_correct" value="${j}">
        <input type="text" class="q-opt" name="q_${idx}_opt_${j}" placeholder="خيار ${j + 1}">
      </label>`
    )
    .join('');

  return `<div class="qcard" data-idx="${idx}">
    <div class="qhead">
      <span class="qnum">سؤال جديد</span>
      <label class="del"><input type="checkbox" class="q-del" name="q_${idx}_del" value="1"> حذف</label>
    </div>
    <input type="hidden" name="q_${idx}_n" value="4" class="q-n">
    <textarea class="q-text" name="q_${idx}_text" rows="2" placeholder="نص السؤال"></textarea>
    <div class="opts">${opts}</div>
    <button type="button" class="btn ghost small add-opt">+ إضافة خيار</button>
  </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('questions');
  const form = document.getElementById('quiz-form');
  if (!container || !form) return;

  const cards = [...container.querySelectorAll('.qcard')];
  let nextIdx = cards.reduce((max, c) => Math.max(max, Number(c.dataset.idx) + 1), 0);

  document.getElementById('add-question')?.addEventListener('click', () => {
    container.insertAdjacentHTML('beforeend', makeCard(nextIdx++));
    container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.add-opt');
    if (!btn) return;
    const card = btn.closest('.qcard');
    const idx = card.dataset.idx;
    const hidden = card.querySelector('.q-n');
    let n = Number(hidden.value) || 0;
    if (n >= 10) return;

    const label = document.createElement('label');
    label.className = 'opt';
    label.innerHTML = `<input type="radio" name="q_${idx}_correct" value="${n}">
      <input type="text" class="q-opt" name="q_${idx}_opt_${n}" placeholder="خيار ${n + 1}">`;
    card.querySelector('.opts').appendChild(label);
    hidden.value = n + 1;
    label.querySelector('input[type="text"]').focus();
    if (n + 1 >= 10) btn.remove();
  });

  container.addEventListener('change', (e) => {
    if (!e.target.classList.contains('q-del')) return;
    e.target.closest('.qcard').classList.toggle('deleted', e.target.checked);
  });

  form.addEventListener('submit', (e) => {
    for (const card of container.querySelectorAll('.qcard')) {
      if (card.classList.contains('deleted')) continue;
      const text = card.querySelector('.q-text').value.trim();
      if (!text) {
        e.preventDefault();
        alert('فيه سؤال بدون نص — عدله أو احذفه.');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const filled = [...card.querySelectorAll('.q-opt')].filter((i) => i.value.trim());
      if (filled.length < 2) {
        e.preventDefault();
        alert('كل سؤال يحتاج خيارين على الأقل.');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const checked = card.querySelector('input[type="radio"]:checked');
      if (!checked) {
        e.preventDefault();
        alert('حدد الإجابة الصحيحة لكل سؤال.');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const correctInput = checked.parentElement.querySelector('.q-opt');
      if (!correctInput || !correctInput.value.trim()) {
        e.preventDefault();
        alert('الإجابة الصحيحة المحددة فارغة — اختر خيار فيه نص.');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  });
});
