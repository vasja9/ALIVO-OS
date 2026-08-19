/*
 * 006A-2: remove optimal-time presentation from the UI only.
 *
 * Timing domain models, read-model fields, historical evidence, and command
 * contracts remain available for compatibility. Operational schedule data
 * such as scheduled time, timezone, cadence interval, and publication history
 * is intentionally preserved.
 */
const text = (element) => element?.textContent?.trim() ?? "";

const removeTimingTab = () => {
  document.querySelectorAll('[data-pin-view="timing"]').forEach((element) => element.remove());
  document.querySelectorAll("#pin-view-content .timing-grid").forEach((element) => element.remove());
};

const removeRecommendedColumns = () => {
  document.querySelectorAll("#pin-view-content .pin-table").forEach((table) => {
    const header = table.querySelector(".pin-head");
    if (!header) return;

    const index = [...header.children].findIndex((cell) =>
      /^(Recommended Time|Recommended Window)$/i.test(text(cell)),
    );
    if (index < 0) return;

    table.querySelectorAll(".pin-row").forEach((row) => row.children[index]?.remove());
  });
};

const cleanOverview = () => {
  document.querySelectorAll("#pin-overview .card").forEach((card) => {
    const eyebrow = card.querySelector(".eyebrow");
    if (text(eyebrow) !== "Current Timing Policy") return;

    card.querySelectorAll(".pin-metric").forEach((metric) => {
      if (/^(Adaptive Timezone|Resolved timezone)$/i.test(text(metric.querySelector("span")))) {
        metric.remove();
      }
    });
    if (eyebrow) eyebrow.textContent = "Current Cadence Policy";
  });
};

const cleanDetail = () => {
  document.querySelectorAll("#pin-detail h3").forEach((heading) => {
    if (text(heading) === "Timing") heading.textContent = "Schedule";
  });

  document.querySelectorAll("#pin-detail p").forEach((paragraph) => {
    const first = paragraph.firstChild;
    if (!(first instanceof Text) || !first.textContent.trimStart().startsWith("Recommended ")) return;
    first.remove();
    paragraph.querySelector("br")?.remove();
  });
};

const cleanSettings = () => {
  document.querySelectorAll("#settings-content label.setting-field").forEach((field) => {
    if (text(field.querySelector("strong")) === "Timing Mode") {
      // Keep the field in the DOM because the existing save handler and
      // settings contract still expect it, but remove it from presentation.
      field.hidden = true;
    }
  });

  document.querySelectorAll("#settings-content small").forEach((small) => {
    if (/Adaptive Timing|Adaptive Timezone/i.test(text(small))) small.hidden = true;
  });

  document.querySelectorAll("#settings-content .eyebrow").forEach((eyebrow) => {
    if (text(eyebrow) === "Pinterest · Timing") eyebrow.textContent = "Pinterest · Cadence";
  });

  document.querySelectorAll("#settings-content h2").forEach((heading) => {
    if (text(heading) === "Timing & Cadence") heading.textContent = "Cadence & Queue";
  });
};

const cleanGlobalLabels = () => {
  document.querySelectorAll(".sidebar-footer small").forEach((label) => {
    if (/adaptive scheduling shown separately/i.test(text(label))) {
      label.textContent = "Local time · publication schedule is operational";
    }
  });

  document.querySelectorAll('#dashboard [data-settings-link="pinterest"]').forEach((link) => {
    if (/timing settings/i.test(text(link))) link.textContent = "Pinterest cadence settings →";
  });
};

const cleanOptimalTimeUI = () => {
  removeTimingTab();
  removeRecommendedColumns();
  cleanOverview();
  cleanDetail();
  cleanSettings();
  cleanGlobalLabels();
};

new MutationObserver(cleanOptimalTimeUI).observe(document.body, {
  childList: true,
  subtree: true,
});

cleanOptimalTimeUI();