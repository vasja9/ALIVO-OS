const pinterestRuntime = (() => {
  let loading = false;
  let lastSnapshot;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (value) => value ? new Date(value).toLocaleString() : '—';

  function liveCard() {
    let card = document.querySelector('#pinterest-live-runtime');
    const host = document.querySelector('#pin-overview');
    if (!host) return null;
    if (!card) {
      card = document.createElement('article');
      card.id = 'pinterest-live-runtime';
      card.className = 'card';
      card.style.marginBottom = '16px';
      host.prepend(card);
    }
    return card;
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
    const card = liveCard();
    if (!card) return;
    if (!snapshot || snapshot.state !== 'Connected') {
      card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Live Pinterest API</p><h2>Provider data unavailable</h2></div></div><p>${esc(snapshot?.message || snapshot?.state || 'No live Pinterest data is available.')}</p>`;
      return;
    }
    const account = snapshot.account || {};
    const boards = Array.isArray(snapshot.boards) ? snapshot.boards : [];
    const pins = Array.isArray(snapshot.pins) ? snapshot.pins : [];
    const boardRows = boards.slice(0, 8).map(board => `<tr><td>${esc(board.name || 'Untitled board')}</td><td>${esc(board.pinCount ?? '—')}</td><td>${esc(board.privacy || '—')}</td></tr>`).join('');
    const pinRows = pins.slice(0, 8).map(pin => `<tr><td>${esc(pin.title || '(untitled)')}</td><td>${esc(pin.boardId || '—')}</td><td>${esc(fmt(pin.createdAt))}</td></tr>`).join('');
    card.innerHTML = `
      <div class="card-head"><div><p class="eyebrow">Live Pinterest API</p><h2>${esc(account.businessName || account.username || 'Pinterest account')}</h2></div><button id="pinterest-live-refresh" class="secondary">↻ Refresh live data</button></div>
      <div class="metric-strip">
        <div class="metric"><span>Boards returned</span><strong>${esc(snapshot.counts?.boards ?? boards.length)}</strong></div>
        <div class="metric"><span>Pins returned</span><strong>${esc(snapshot.counts?.pins ?? pins.length)}</strong></div>
        <div class="metric"><span>Followers</span><strong>${esc(account.followerCount ?? 'Unavailable')}</strong></div>
        <div class="metric"><span>Monthly views</span><strong>${esc(account.monthlyViews ?? 'Unavailable')}</strong></div>
      </div>
      <small class="freshness">Live provider snapshot · ${esc(fmt(snapshot.collectedAt))}${snapshot.partial ? ' · First API page only' : ''}</small>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div><h3>Boards</h3><div class="data-table"><table><thead><tr><th>Name</th><th>Pins</th><th>Privacy</th></tr></thead><tbody>${boardRows || '<tr><td colspan="3">No boards returned.</td></tr>'}</tbody></table></div></div>
        <div><h3>Recent Pins</h3><div class="data-table"><table><thead><tr><th>Title</th><th>Board ID</th><th>Created</th></tr></thead><tbody>${pinRows || '<tr><td colspan="3">No Pins returned.</td></tr>'}</tbody></table></div></div>
      </div>`;
    card.querySelector('#pinterest-live-refresh')?.addEventListener('click', refresh);
  }

  async function refresh() {
    if (loading || !window.alivoPinterest?.read) return;
    loading = true;
    const card = liveCard();
    if (card && !lastSnapshot) card.innerHTML = '<p>Loading live Pinterest account data…</p>';
    try {
      render(await window.alivoPinterest.read());
    } catch {
      render({ state: 'Unavailable', message: 'Pinterest provider data could not be loaded.' });
    } finally {
      loading = false;
    }
  }

  const observer = new MutationObserver(() => {
    const workspace = document.querySelector('#pinterest-workspace');
    if (workspace && !workspace.hidden && !document.querySelector('#pinterest-live-runtime')) {
      if (lastSnapshot) render(lastSnapshot); else refresh();
    }
  });

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('click', event => {
      const route = event.target?.closest?.('[data-route="Pinterest"]');
      if (route) setTimeout(refresh, 0);
    });
    document.querySelector('#refresh')?.addEventListener('click', () => {
      const workspace = document.querySelector('#pinterest-workspace');
      if (workspace && !workspace.hidden) refresh();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.alivoPinterestRuntime = Object.freeze({ refresh });
  return { refresh };
})();
