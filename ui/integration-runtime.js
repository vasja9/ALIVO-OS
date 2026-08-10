const integrationRuntime = (() => {
  let refreshing = false;
  let lastSnapshot;

  const formatTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  const stateClass = (value) => String(value || 'Unavailable').toLowerCase().replaceAll(' ', '-');

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
      status.textContent = label;
      status.className = `state ${stateClass(label)}`;
    }
    const auth = definitionValue(card, 'Authentication');
    const success = definitionValue(card, 'Last success');
    const failure = definitionValue(card, 'Last failure');
    const error = definitionValue(card, 'Recent error');
    if (auth) auth.textContent = connected ? `Configured${summary.safeIdentity ? ` · ${summary.safeIdentity}` : ''}` : (summary?.state || 'Not Configured');
    if (success) success.textContent = connected ? formatTime(summary.checkedAt) : '—';
    if (failure) failure.textContent = '—';
    if (error) error.textContent = connected ? '—' : 'No verified runtime connection is available.';
    const button = card.querySelector('[data-auth]');
    if (button) button.textContent = connected ? 'Update Credential' : (name === 'WordPress' ? 'Open Authentication' : 'Connect');
  }

  function patchSettingsCard(card, summary) {
    if (!card) return;
    const connected = summary?.state === 'Connected';
    const status = card.querySelector('.state');
    if (status) {
      const label = connected ? 'Connected' : (summary?.state || 'Not Configured');
      status.textContent = label;
      status.className = `state ${stateClass(label)}`;
    }
    const credentialParagraph = [...card.querySelectorAll('p')].find(p => p.textContent.trim().startsWith('Credential:'));
    if (credentialParagraph) credentialParagraph.textContent = `Credential: ${connected ? 'Configured' : (summary?.state || 'Not Configured')}`;
    const button = card.querySelector('[data-auth]');
    if (button) button.textContent = connected ? 'Update' : 'Configure';
  }

  function patchPublishingLine(root, name, summary) {
    const line = [...root.querySelectorAll('.integration-line')].find(x => x.querySelector('strong')?.textContent?.trim() === name);
    if (!line) return;
    const connected = summary?.state === 'Connected';
    const status = line.querySelector('.state');
    if (status) {
      const label = connected ? 'Configured' : (summary?.state || 'Not Configured');
      status.textContent = label;
      status.className = `state ${stateClass(label)}`;
    }
    const button = line.querySelector('[data-auth]');
    if (button) button.textContent = connected ? 'Update' : 'Reauthorize';
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
    if (lastSnapshot) apply(lastSnapshot);
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
    document.querySelector('#refresh')?.addEventListener('click', refresh);
  });

  window.alivoIntegrationRuntime = Object.freeze({ refresh });
  return { refresh };
})();
