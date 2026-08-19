/*
 * 006A-1: optimal-time and cadence recommendation controls are intentionally
 * inactive. Keep the underlying read models and command contracts intact for
 * compatibility; only the active advisory UI actions are removed/blocked.
 */
const recommendationControls = [
  "#apply-recommendation",
  "[data-recommend]",
  "[data-apply-recommendation]",
  "#settings-content .recommendation",
  ".learning-card .recommendation",
];

const deactivateRecommendationControls = () => {
  document
    .querySelectorAll(recommendationControls.join(","))
    .forEach((element) => element.remove());
};

document.addEventListener(
  "click",
  (event) => {
    if (event.target instanceof Element && event.target.closest(recommendationControls.join(","))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

new MutationObserver(deactivateRecommendationControls).observe(document.body, {
  childList: true,
  subtree: true,
});

deactivateRecommendationControls();