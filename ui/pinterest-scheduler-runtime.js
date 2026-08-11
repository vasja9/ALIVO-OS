(() => {
  let snapshot;
  let live;
  let busy = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = value => value ? new Date(value).toLocaleString() : '—';
  const scheduler = () => window.alivoPinterest?.scheduler;

  function host() {
    const overview = document.querySelector('#pin-overview');
    if (!overview) return null;
    let card = document.querySelector('#pinterest-scheduler-runtime');
    if (!card) {
      card = document.createElement('article');
      card.id = 'pinterest-scheduler-runtime';
      card.className = 'card';
      card.style.marginBottom = '16px';
      overview.appendChild(card);
    }
    return card;
  }

  function localInputValue(minutes = 10) {
    const d = new Date(Date.now() + minutes * 60000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function boardOptions() {
    const boards = Array.isArray(live?.boards) ? live.boards.filter(b => String(b.privacy || '').toUpperCase() === 'PUBLIC') : [];
    return boards.map(b => `<option value="${esc(b.name || b.id)}">${esc(b.name || b.id)}</option>`).join('');
  }

  function rows() {
    const jobs = Array.isArray(snapshot?.jobs) ? [...snapshot.jobs].sort((a,b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)) : [];
    if (!jobs.length) return '<tr><td colspan="5" class="quiet">No Sandbox jobs scheduled yet.</td></tr>';
    return jobs.slice(0, 12).map(job => `<tr>
      <td>${esc(job.pin?.title || '(untitled)')}</td>
      <td>${esc(job.pin?.boardName || '—')}</td>
      <td>${esc(fmt(job.scheduledFor))}</td>
      <td>${esc(job.status || '—')}${job.result?.pinId ? `<small style="display:block">Pin ${esc(job.result.pinId)}</small>` : ''}</td>
      <td>${job.status === 'Scheduled' ? `<button class="link" data-scheduler-cancel="${esc(job.id)}">Cancel</button>` : ''}</td>
    </tr>`).join('');
  }

  function render() {
    const card = host();
    if (!card) return;
    if (!snapshot || snapshot.state !== 'Connected') {
      card.innerHTML = '<p class="quiet">Loading Sandbox scheduler…</p>';
      return;
    }
    const enabled = snapshot.enabled === true;
    card.innerHTML = `
      <div class="card-head"><div><p class="eyebrow">RUNTIME-005B · Pinterest Sandbox</p><h2>Scheduler</h2></div><span class="status-chip">${enabled ? 'ENABLED' : 'DISABLED'}</span></div>
      <p class="quiet">Persistent Sandbox queue · default cadence ${esc(snapshot.defaultIntervalMinutes || 90)} minutes. Production publishing remains disabled.</p>
      <div class="metric-strip" style="margin-top:12px">
        <div class="metric"><span>Scheduled</span><strong>${esc(snapshot.counts?.Scheduled || 0)}</strong></div>
        <div class="metric"><span>Published</span><strong>${esc(snapshot.counts?.Published || 0)}</strong></div>
        <div class="metric"><span>Failed</span><strong>${esc(snapshot.counts?.Failed || 0)}</strong></div>
        <div class="metric"><span>Environment</span><strong>Sandbox</strong></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin:14px 0">
        <button id="scheduler-toggle" class="secondary">${enabled ? 'Disable Scheduler' : 'Enable Scheduler'}</button>
        <button id="scheduler-run" class="secondary">Run due now</button>
        <span id="scheduler-result" class="quiet"></span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Board<select id="scheduler-board" style="width:100%;margin-top:6px"><option value="">Select board…</option>${boardOptions()}<option value="__new__">＋ Create new Sandbox board…</option></select></label>
        <label id="scheduler-new-board-wrap" hidden>New Sandbox board<input id="scheduler-new-board" maxlength="180" placeholder="Board name" style="width:100%;margin-top:6px"></label>
        <label>Scheduled time<input id="scheduler-time" type="datetime-local" value="${localInputValue()}" style="width:100%;margin-top:6px"></label>
        <label>Title<input id="scheduler-title" maxlength="100" placeholder="Scheduled Sandbox Pin" style="width:100%;margin-top:6px"></label>
        <label style="grid-column:1/-1">Destination URL<input id="scheduler-link" type="url" placeholder="https://alivo.eu/..." style="width:100%;margin-top:6px"></label>
        <label style="grid-column:1/-1">Public image URL<input id="scheduler-image" type="url" placeholder="https://alivo.eu/.../image.jpg" style="width:100%;margin-top:6px"></label>
        <label style="grid-column:1/-1">Description<textarea id="scheduler-description" maxlength="500" rows="2" style="width:100%;margin-top:6px"></textarea></label>
      </div>
      <div style="margin-top:12px"><button id="scheduler-add" class="secondary">Schedule Sandbox Pin</button></div>
      <div class="data-table" style="margin-top:16px"><table><thead><tr><th>Pin</th><th>Board</th><th>Scheduled</th><th>Status</th><th></th></tr></thead><tbody>${rows()}</tbody></table></div>
      <small class="freshness">Queue updated ${esc(fmt(snapshot.updatedAt))}</small>`;

    const board = card.querySelector('#scheduler-board');
    const newWrap = card.querySelector('#scheduler-new-board-wrap');
    board?.addEventListener('change', () => { if (newWrap) newWrap.hidden = board.value !== '__new__'; });
    card.querySelector('#scheduler-toggle')?.addEventListener('click', toggle);
    card.querySelector('#scheduler-run')?.addEventListener('click', runDue);
    card.querySelector('#scheduler-add')?.addEventListener('click', scheduleOne);
    card.querySelectorAll('[data-scheduler-cancel]').forEach(button => button.addEventListener('click', () => cancel(button.dataset.schedulerCancel)));
  }

  async function refresh() {
    if (!scheduler()?.list) return;
    try {
      const [state, provider] = await Promise.all([scheduler().list(), window.alivoPinterest?.readLive?.()]);
      snapshot = state;
      live = provider;
      render();
    } catch {
      const card = host();
      if (card) card.innerHTML = '<p class="quiet">Sandbox scheduler could not be loaded.</p>';
    }
  }

  async function toggle() {
    if (busy) return; busy = true;
    try { await scheduler().enable(!(snapshot?.enabled === true)); await refresh(); }
    finally { busy = false; }
  }

  async function runDue() {
    if (busy) return; busy = true;
    const resultEl = host()?.querySelector('#scheduler-result');
    if (resultEl) resultEl.textContent = 'Checking due jobs…';
    try {
      const result = await scheduler().runDue();
      if (resultEl) resultEl.textContent = result?.state === 'Disabled' ? 'Scheduler is disabled.' : `Processed ${result?.processed ?? 0} due job(s).`;
      await refresh();
    } finally { busy = false; }
  }

  async function cancel(jobId) {
    if (!jobId || busy) return; busy = true;
    try { await scheduler().cancel(jobId); await refresh(); }
    finally { busy = false; }
  }

  async function scheduleOne() {
    if (busy) return;
    const card = host();
    const select = card?.querySelector('#scheduler-board');
    const boardName = select?.value === '__new__' ? card.querySelector('#scheduler-new-board')?.value?.trim() : select?.value?.trim();
    const scheduledFor = card?.querySelector('#scheduler-time')?.value;
    const title = card?.querySelector('#scheduler-title')?.value?.trim();
    const link = card?.querySelector('#scheduler-link')?.value?.trim();
    const imageUrl = card?.querySelector('#scheduler-image')?.value?.trim();
    const description = card?.querySelector('#scheduler-description')?.value?.trim();
    const resultEl = card?.querySelector('#scheduler-result');
    if (!boardName || !scheduledFor || !title || !link || !imageUrl) {
      if (resultEl) resultEl.textContent = 'Board, time, title, destination URL and image URL are required.';
      return;
    }
    const when = new Date(scheduledFor);
    if (Number.isNaN(when.getTime())) { if (resultEl) resultEl.textContent = 'Scheduled time is invalid.'; return; }
    const approved = window.confirm(`SCHEDULE SANDBOX PIN\n\nBoard: ${boardName}\nTitle: ${title}\nScheduled: ${when.toLocaleString()}\n\nAdd this Pin to the persistent Sandbox queue?`);
    if (!approved) return;
    busy = true;
    try {
      const result = await scheduler().schedule({ scheduledFor: when.toISOString(), pin: { boardName, title, link, imageUrl, description, altText:title } });
      if (resultEl) resultEl.textContent = result?.state === 'Scheduled' ? 'Pin scheduled successfully.' : (result?.message || result?.state || 'Scheduling failed.');
      await refresh();
    } finally { busy = false; }
  }

  const start = () => {
    refresh();
    scheduler()?.onChanged?.(() => refresh());
    window.addEventListener('alivo:pinterest:open', () => setTimeout(refresh, 0));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
})();
