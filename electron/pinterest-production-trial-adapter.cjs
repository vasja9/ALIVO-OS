const { createPinterestProductionTrial } = require('./pinterest-production-trial.cjs');
const { createPinterestProductionTrialTransport } = require('./pinterest-production-trial-transport.cjs');
const { createPinterestPublicationResults } = require('./pinterest-publication-results.cjs');

function createPinterestProductionTrialAdapter(app, getProductionAccessToken) {
  const transport = createPinterestProductionTrialTransport(getProductionAccessToken);
  const publicationResults = createPinterestPublicationResults(app);
  const controller = createPinterestProductionTrial(app, Object.freeze({
    create: (input, requestedEnvironment) => {
      if (String(requestedEnvironment || '').toLowerCase() !== 'production-trial') {
        return Promise.resolve({ state: 'Production Trial Locked', message: 'Controlled production trial adapter only accepts the production-trial lane.' });
      }
      return transport.create(input);
    },
  }));
  return Object.freeze({
    state: () => controller.state(),
    approve: (request) => controller.approve(request),
    revoke: () => controller.revoke(),
    publish: async (input = {}) => {
      const result = await controller.publish(input);
      if (result?.state === 'Published') await publicationResults.capture(result, input, 'controlled-production-trial');
      return result;
    },
  });
}

module.exports = { createPinterestProductionTrialAdapter };