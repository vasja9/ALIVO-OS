const integrationRuntime = (() => {
  let refreshing = false;
  let lastSnapshot;
  let observerStarted = false;
  let applyScheduled = false;

  const formatTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  const stateClass = (value) => String(value || 'Unavailable').toLowerCase().replaceAll(' ', '-');
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  const setClass = (node, value) => { if (node && node.className !== value) node.className = value; };

  function findIntegrationCard(root, name) {
    return [...root.querySelectorAll('.integration-card')].find(card => {
      const heading = card.querySelector('h2,h3');
      return heading?.textContent?.trim().toLowerCase() === name.toLowerCase();
    });
  }

  function definitionValue(card, label) {
    const terms = [...card.querySelectorAll('dt')];
    const term = terms.find(x => x.textContent.trim() === label);
    return term?.nextElementSibling || null;
  }

  function patchSystemCard(card, name, summary) {
    if (!card) return;
    const connected = summary?.state === 'Connected';
    const status = card.querySelector('.card-head .state');
    if (status) {
      const label = connected ? 'Connected' : (summary?.state || 'Not Configured');
      setText(status, label);
      setClass(status, `state ${stateClass(label)}`);
    }
    const auth = definitionValue(card, 'Authentication');
    const success = definitionValue(card, 'Last success');
    const failure = definitionValue(card, 'Last failure');
    const error = definitionValue(card, 'Recent error');
    setText(auth, connected ? `Configured${summary.safeIdentity ? ` · ${summary.safeIdentity}` : ''}` : (summary?.state || 'Not Configured'));
    setText(success, connected ? formatTime(summary.checkedAt) : '—');
    setText(failure, '—');
    setText(error, connected ? '—' : 'No verified runtime connection is available.');
    const button = card.querySelector('[data-auth]');
    setText(button, connected ? 'Update Credential' : (name === 'WordPress' ? 'Open Authentication' : 'Connect'));
  }

  function patchSettingsCard(card, summary) {
    if (!card) return;
    const connected = summary?.state === 'Connected';
    const status = card.querySelector('.state');
    if (status) {
      const label = connected ? 'Connected' : (summary?.state || 'Not Configured');
      setText(status, label);
      setClass(status, `state ${stateClass(label)}`);
    }
    const credentialParagraph = [...card.querySelectorAll('p')].find(p => p.textContent.trim().startsWith('Credential:'));
    setText(credentialParagraph, `Credential: ${connected ? 'Configured' : (summary?.state || 'Not Configured')}`);
    const button = card.querySelector('[data-auth]');
    setText(button, connected ? 'Update' : 'Configure');
  }

  function patchPublishingLine(root, name, summary) {
    const line = [...root.querySelectorAll('.integration-line')].find(x => x.querySelector('strong')?.textContent?.trim() === name);
    if (!line) return;
    const connected = summary?.state === 'Connected';
    const status = line.querySelector('.state');
    if (status) {
      const label = connected ? 'Configured' : (summary?.state || 'Not Configured');
      setText(status, label);
      setClass(status, `state ${stateClass(label)}`);
    }
    const button = line.querySelector('[data-auth]');
    setText(button, connected ? 'Update' : 'Reauthorize');
  }

  function apply(snapshot) {
    if (!snapshot) return;
    const systemRoot = document.querySelector('#system-content');
    if (systemRoot) {
      patchSystemCard(findIntegrationCard(systemRoot, 'WordPress'), 'WordPress', snapshot.wordpress);
      patchSystemCard(findIntegrationCard(systemRoot, 'Pinterest'), 'Pinterest', snapshot.pinterest);
    }
    const settingsRoot = document.querySelector('#settings-content');
    if (settingsRoot) {
      patchSettingsCard(findIntegrationCard(settingsRoot, 'WordPress'), snapshot.wordpress);
      patchSettingsCard(findIntegrationCard(settingsRoot, 'Pinterest'), snapshot.pinterest);
      patchPublishingLine(settingsRoot, 'WordPress', snapshot.wordpress);
      patchPublishingLine(settingsRoot, 'Pinterest', snapshot.pinterest);
    }
  }

  async function refresh() {
    if (refreshing || !window.alivoSystem?.integrations) return;
    refreshing = true;
    try {
      lastSnapshot = await window.alivoSystem.integrations();
      apply(lastSnapshot);
    } catch {
      // UI remains explicit rather than manufacturing an integration state.
    } finally {
      refreshing = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (!lastSnapshot || applyScheduled) return;
    applyScheduled = true;
    queueMicrotask(() => {
      applyScheduled = false;
      apply(lastSnapshot);
    });
  });

  const start = () => {
    if (!observerStarted) {
      observerStarted = true;
      observer.observe(document.body, { childList: true, subtree: true });
    }
    refresh();
    document.querySelector('#refresh')?.addEventListener('click', refresh);
    window.alivoSystem?.onIntegrationChanged?.(refresh);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.alivoIntegrationRuntime = Object.freeze({ refresh });
  return { refresh };
})();
