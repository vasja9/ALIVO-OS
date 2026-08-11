const pinterestRuntime = (() => {
  let loading = false;
  let publishing = false;
  let lastSnapshot;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (value) => value ? new Date(value).toLocaleString() : '—';

  function liveCard() {
    let card = document.querySelector('#pinterest-live-runtime');
    const host = document.querySelector('#pin-overview');
    if (!host) return null;
    if (!card) { card = document.createElement('article'); card.id = 'pinterest-live-runtime'; card.className = 'card'; card.style.marginBottom = '16px'; host.prepend(card); }
    return card;
  }

  function publishCard() {
    let card = document.querySelector('#pinterest-publish-runtime');
    const host = document.querySelector('#pin-overview');
    if (!host || !lastSnapshot || lastSnapshot.state !== 'Connected') return null;
    if (!card) { card = document.createElement('article'); card.id = 'pinterest-publish-runtime'; card.className = 'card'; card.style.marginBottom = '16px'; const live = liveCard(); if (live?.nextSibling) host.insertBefore(card, live.nextSibling); else host.appendChild(card); }
    return card;
  }

  function renderPublisher() {
    const card = publishCard(); if (!card) return;
    const boards = (lastSnapshot.boards || []).filter(board => String(board.privacy || '').toUpperCase() === 'PUBLIC');
    const options = boards.map(board => `<option value="existing:${esc(board.id)}" data-name="${esc(board.name || board.id)}">${esc(board.name || board.id)}</option>`).join('');
    card.innerHTML = `
      <div class="card-head"><div><p class="eyebrow">Controlled write test · Pinterest Sandbox</p><h2>Publish one Sandbox test Pin</h2></div><span class="status-chip">MANUAL ONLY</span></div>
      <p class="quiet">Trial access writes are sent only to api-sandbox.pinterest.com. Choose an existing production board name to mirror into Sandbox, or create a new Sandbox board. Nothing is published until final confirmation.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
        <label>Board name<select id="pin-test-board" style="width:100%;margin-top:6px"><option value="">Select board…</option>${options}<option value="__create_new__">＋ Create new Sandbox board…</option></select></label>
        <label id="pin-test-new-board-wrap" hidden>New Sandbox board name<input id="pin-test-new-board" maxlength="180" placeholder="Enter new board name" style="width:100%;margin-top:6px" /></label>
        <label>Title<input id="pin-test-title" maxlength="100" placeholder="ALIVO OS Sandbox publishing test" style="width:100%;margin-top:6px" /></label>
        <label style="grid-column:1/-1">Destination URL<input id="pin-test-link" type="url" placeholder="https://alivo.eu/..." style="width:100%;margin-top:6px" /></label>
        <label style="grid-column:1/-1">Public image URL<input id="pin-test-image" type="url" placeholder="https://alivo.eu/.../image.jpg" style="width:100%;margin-top:6px" /></label>
        <label style="grid-column:1/-1">Description<textarea id="pin-test-description" maxlength="500" rows="3" placeholder="Controlled ALIVO OS Pinterest Sandbox publishing test." style="width:100%;margin-top:6px"></textarea></label>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button id="pin-test-publish" class="secondary">Review & Publish Sandbox Pin</button><span id="pin-test-result" class="quiet"></span></div>`;
    const boardSelect = card.querySelector('#pin-test-board');
    const newBoardWrap = card.querySelector('#pin-test-new-board-wrap');
    boardSelect?.addEventListener('change', () => {
      const creating = boardSelect.value === '__create_new__';
      if (newBoardWrap) newBoardWrap.hidden = !creating;
      if (creating) card.querySelector('#pin-test-new-board')?.focus();
    });
    card.querySelector('#pin-test-publish')?.addEventListener('click', publishTestPin);
  }

  async function publishTestPin() {
    if (publishing || !window.alivoPinterest?.publishTestPin) return;
    const card = publishCard();
    const boardSelect = card?.querySelector('#pin-test-board');
    const createNewBoard = boardSelect?.value === '__create_new__';
    const boardName = createNewBoard
      ? card?.querySelector('#pin-test-new-board')?.value?.trim()
      : boardSelect?.selectedOptions?.[0]?.dataset?.name || '';
    const title = card?.querySelector('#pin-test-title')?.value?.trim();
    const link = card?.querySelector('#pin-test-link')?.value?.trim();
    const imageUrl = card?.querySelector('#pin-test-image')?.value?.trim();
    const description = card?.querySelector('#pin-test-description')?.value?.trim();
    const result = card?.querySelector('#pin-test-result');
    if (!boardName || !title || !link || !imageUrl) { if (result) result.textContent = 'Board name, title, destination URL and image URL are required.'; return; }
    const approved = window.confirm(`FINAL SANDBOX WRITE CONFIRMATION\n\nEnvironment: Pinterest Sandbox\nBoard: ${boardName}${createNewBoard ? ' (create if missing)' : ''}\nTitle: ${title}\nDestination: ${link}\nImage: ${imageUrl}\n\nCreate exactly ONE Sandbox Pin now?`);
    if (!approved) { if (result) result.textContent = 'Publishing cancelled. Nothing was sent to Pinterest Sandbox.'; return; }
    publishing = true; if (result) result.textContent = 'Publishing one Sandbox Pin…';
    try {
      const response = await window.alivoPinterest.publishTestPin({ boardName, title, link, imageUrl, description, altText: title });
      if (response?.state === 'Published') {
        if (result) result.textContent = `Sandbox Published successfully${response.pinId ? ` · Pin ${response.pinId}` : ''}${response.sandboxBoardCreated ? ' · Sandbox board created' : ''}.`;
      } else if (result) result.textContent = response?.message || response?.state || 'Pinterest Sandbox did not confirm publication.';
    } catch { if (result) result.textContent = 'Pinterest Sandbox publishing request failed.'; }
    finally { publishing = false; }
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
    const card = liveCard(); if (!card) return;
    if (!snapshot || snapshot.state !== 'Connected') { document.querySelector('#pinterest-publish-runtime')?.remove(); card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Live Pinterest API</p><h2>Provider data unavailable</h2></div></div><p>${esc(snapshot?.message || snapshot?.state || 'No live Pinterest data is available.')}</p>`; return; }
    const account = snapshot.account || {}, boards = Array.isArray(snapshot.boards) ? snapshot.boards : [], pins = Array.isArray(snapshot.pins) ? snapshot.pins : [];
    const boardRows = boards.slice(0, 8).map(board => `<tr><td>${esc(board.name || 'Untitled board')}</td><td>${esc(board.pinCount ?? '—')}</td><td>${esc(board.privacy || '—')}</td></tr>`).join('');
    const pinRows = pins.slice(0, 8).map(pin => `<tr><td>${esc(pin.title || '(untitled)')}</td><td>${esc(pin.boardId || '—')}</td><td>${esc(fmt(pin.createdAt))}</td></tr>`).join('');
    const pageInfo = snapshot.pages ? ` · API pages: Boards ${esc(snapshot.pages.boards ?? '—')}, Pins ${esc(snapshot.pages.pins ?? '—')}` : '';
    const completeness = snapshot.partial ? ' · Partial snapshot' : ' · Complete paginated snapshot';
    card.innerHTML = `<div class="card-head"><div><p class="eyebrow">Live Pinterest API · Production Read</p><h2>${esc(account.businessName || account.username || 'Pinterest account')}</h2></div><button id="pinterest-live-refresh" class="secondary">↻ Refresh live data</button></div>
      <div class="metric-strip"><div class="metric"><span>Boards returned</span><strong>${esc(snapshot.counts?.boards ?? boards.length)}</strong></div><div class="metric"><span>Pins returned</span><strong>${esc(snapshot.counts?.pins ?? pins.length)}</strong></div><div class="metric"><span>Followers</span><strong>${esc(account.followerCount ?? 'Unavailable')}</strong></div><div class="metric"><span>Monthly views</span><strong>${esc(account.monthlyViews ?? 'Unavailable')}</strong></div></div>
      <small class="freshness">Live provider snapshot · ${esc(fmt(snapshot.collectedAt))}${completeness}${pageInfo}</small>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px"><div><h3>Boards</h3><div class="data-table"><table><thead><tr><th>Name</th><th>Pins</th><th>Privacy</th></tr></thead><tbody>${boardRows || '<tr><td colspan="3">No boards returned.</td></tr>'}</tbody></table></div></div><div><h3>Recent Pins</h3><div class="data-table"><table><thead><tr><th>Title</th><th>Board ID</th><th>Created</th></tr></thead><tbody>${pinRows || '<tr><td colspan="3">No Pins returned.</td></tr>'}</tbody></table></div></div></div>`;
    card.querySelector('#pinterest-live-refresh')?.addEventListener('click', refresh); renderPublisher();
  }

  async function refresh() {
    if (loading || !window.alivoPinterest?.readLive) return;
    loading = true; const card = liveCard(); if (card && !lastSnapshot) card.innerHTML = '<p>Loading live Pinterest account data…</p>';
    try { render(await window.alivoPinterest.readLive()); } catch { render({ state: 'Unavailable', message: 'Pinterest provider data could not be loaded.' }); } finally { loading = false; }
  }

  const observer = new MutationObserver(() => { const workspace = document.querySelector('#pinterest-workspace'); if (workspace && !workspace.hidden && !document.querySelector('#pinterest-live-runtime')) { if (lastSnapshot) render(lastSnapshot); else refresh(); } });
  const start = () => { observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); document.addEventListener('click', event => { const route = event.target?.closest?.('[data-route="Pinterest"]'); if (route) setTimeout(refresh, 0); }); document.querySelector('#refresh')?.addEventListener('click', () => { const workspace = document.querySelector('#pinterest-workspace'); if (workspace && !workspace.hidden) refresh(); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.alivoPinterestRuntime = Object.freeze({ refresh }); return { refresh };
})();
