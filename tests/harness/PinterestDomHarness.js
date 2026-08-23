import { readFileSync } from "node:fs";
import vm from "node:vm";

class HarnessNode {
  constructor(tagName = "fragment") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = undefined;
    this.dataset = Object.create(null);
    this.attributes = Object.create(null);
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.type = "";
    this.onclick = undefined;
    this._text = "";
  }
  append(...nodes) {
    for (const node of nodes.flat()) {
      if (!node) continue;
      if (node instanceof HarnessFragment) {
        this.append(...node.children.splice(0));
        continue;
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  addEventListener(name, handler) {
    if (name === "click") this.onclick = handler;
  }
  click() {
    if (!this.disabled && typeof this.onclick === "function") return this.onclick({ currentTarget: this });
  }
  pressKey(key) {
    if (this.tagName === "BUTTON" && (key === "Enter" || key === " ")) return this.click();
  }
  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }
  get childElementCount() {
    return this.children.length;
  }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const data = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
    if (data) {
      const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Object.prototype.hasOwnProperty.call(this.dataset, key) && (data[2] === undefined || this.dataset[key] === data[2]);
    }
    const className = selector.match(/^\.([a-z-]+)$/);
    return !!className && this.className.split(/\s+/).includes(className[1]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0];
  }
  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

class HarnessFragment extends HarnessNode {
  constructor() {
    super("fragment");
  }
}

class HarnessDocument extends HarnessNode {
  constructor() {
    super("document");
  }
  createElement(tagName) {
    return new HarnessNode(tagName);
  }
  createDocumentFragment() {
    return new HarnessFragment();
  }
}

function createDocument() {
  const document = new HarnessDocument();
  const ids = ["pin-loading", "pin-error", "pin-overview", "pin-view-content", "pin-attention-count"];
  document.append(...ids.map(id => {
    const node = new HarnessNode("div");
    node.setAttribute("id", id);
    return node;
  }));
  const tabs = ["overview", "queue", "all", "timing", "scheduled", "published", "performance", "attention"].map(view => {
    const tab = new HarnessNode("button");
    tab.dataset.pinView = view;
    return tab;
  });
  document.append(...tabs);
  return document;
}

const settle = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

export function pinterestUiModuleToHarnessScript(source) {
  const expectedImport = /^\uFEFF?import\s*\{[\s\S]*?\}\s*from\s*["']\.\/pinterest-connection-state\.js["'];?(?:\r\n|\n|$)/;
  const match = source.match(expectedImport);
  if (!match) {
    throw new Error("Unexpected Pinterest UI ESM import in DOM harness");
  }
  const script = source.slice(match[0].length);
  if (/^\s*import\b/m.test(script)) {
    throw new Error("Unexpected Pinterest UI ESM import in DOM harness");
  }
  return script;
}

export function createPinterestDomHarness(preload = {}) {
  const document = createDocument();
  const snapshotHistory = [];
  const calls = [];
  const timers = [];
  const listeners = new Map();
  const logs = [];
  let nextTimerId = 1;
  for (const selector of ["#pin-overview", "#pin-view-content"]) {
    const target = document.querySelector(selector);
    const append = target.append.bind(target);
    target.append = (...nodes) => {
      append(...nodes);
      snapshotHistory.push(document.textContent);
    };
  }
  const window = {
    alivoPinterest: preload,
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
  };
  const context = {
    window,
    document,
    history: { replaceState() {} },
    location: { hash: "" },
    URLSearchParams,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    setTimeout(handler, delay) {
      const timer = { id: nextTimerId++, handler, delay, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find(item => item.id === id);
      if (timer) timer.cleared = true;
    },
    console: {
      log(...args) { logs.push(["log", ...args]); },
      warn(...args) { logs.push(["warn", ...args]); },
      error(...args) { logs.push(["error", ...args]); },
    },
    __state: undefined,
  };
  const vmContext = vm.createContext(context);
  const stateSource = readFileSync(new URL("../../ui/pinterest-connection-state.js", import.meta.url), "utf8")
    .replace(/^export /gm, "")
    .concat("\nglobalThis.__state = { actionAllowed, createPinterestUiState, hasPinterestContract, PINTEREST_UI_STATE, safeObservation, transition };\n");
  const uiSource = `(function({ actionAllowed, createPinterestUiState, hasPinterestContract, PINTEREST_UI_STATE, safeObservation, transition }) {
 ${pinterestUiModuleToHarnessScript(readFileSync(new URL("../../ui/pinterest.js", import.meta.url), "utf8"))}
})(globalThis.__state);`;
  const run = async () => {
    vm.runInContext(stateSource, vmContext, { filename: "ui/pinterest-connection-state.js" });
    vm.runInContext(uiSource, vmContext, { filename: "ui/pinterest.js" });
    await settle();
  };
  const callCount = name => calls.filter(call => call.name === name && call.type === "invoke").length;
  const invoke = (name, input, original) => {
    calls.push({ name, type: "invoke", input });
    return original(input);
  };
  for (const name of ["startOAuth", "connectionStatus", "verifyConnection", "readObservation", "readAccountPerformance", "readPerformance"]) {
    if (typeof preload[name] === "function") {
      const original = preload[name];
      preload[name] = input => invoke(name, input, original);
    }
  }
  return {
    async start() {
      await run();
      return this;
    },
    async settle() {
      await settle();
      return this;
    },
    async runNextTimer() {
      const timer = timers.find(item => !item.cleared);
      if (!timer) return false;
      timer.cleared = true;
      timer.handler();
      await settle();
      return true;
    },
    async reopen() {
      const handler = listeners.get("alivo:pinterest:open");
      if (handler) handler();
      await settle();
      return this;
    },
    async clickAction(action) {
      const button = document.querySelector(`[data-pin-action="${action}"]`);
      if (!button) throw new Error(`Missing Pinterest action: ${action}`);
      const result = button.click();
      await settle();
      return result;
    },
    clickActionWithoutWaiting(action) {
      const button = document.querySelector(`[data-pin-action="${action}"]`);
      if (!button) throw new Error(`Missing Pinterest action: ${action}`);
      return button.click();
    },
    invokeActionHandlerWithoutWaiting(action) {
      const button = document.querySelector(`[data-pin-action="${action}"]`);
      if (!button || typeof button.onclick !== "function") throw new Error(`Missing Pinterest action handler: ${action}`);
      return button.onclick({ currentTarget: button });
    },
    snapshot() {
      return document.textContent;
    },
    snapshotHistory,
    hasText(value) {
      return this.snapshot().includes(value);
    },
    calls,
    callCount,
    logs,
    document,
    timers,
  };
}

export function sequence(...values) {
  let index = 0;
  return async () => values[Math.min(index++, values.length - 1)];
}
