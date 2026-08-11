const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const DEFAULT_INTERVAL_MINUTES = 90;
const STATES = new Set(['Scheduled','Publishing','Published','Failed','Cancelled']);

function createPinterestScheduler(app, publisher, options = {}) {
  const stateDir = path.join(app.getPath('userData'), 'state');
  const queuePath = path.join(stateDir, 'pinterest-scheduler.json');
  const tickMs = Number(options.tickMs || 30000);
  const defaultIntervalMinutes = Number(options.defaultIntervalMinutes || DEFAULT_INTERVAL_MINUTES);
  let timer;
  let running = false;
  let executionLock = false;

  async function readState() {
    try {
      const data = JSON.parse(await fs.readFile(queuePath, 'utf8'));
      return {
        schemaVersion: 1,
        enabled: data.enabled === true,
        environment: 'sandbox',
        defaultIntervalMinutes: Number(data.defaultIntervalMinutes || defaultIntervalMinutes),
        jobs: Array.isArray(data.jobs) ? data.jobs : [],
        history: Array.isArray(data.history) ? data.history : [],
        updatedAt: data.updatedAt || null,
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion:1, enabled:false, environment:'sandbox', defaultIntervalMinutes, jobs:[], history:[], updatedAt:null };
      throw error;
    }
  }

  async function writeState(state) {
    await fs.mkdir(stateDir, { recursive: true });
    const next = { ...state, environment:'sandbox', updatedAt:new Date().toISOString() };
    const tmp = `${queuePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding:'utf8', mode:0o600 });
    await fs.rename(tmp, queuePath);
    return next;
  }

  function sanitizePin(input = {}) {
    return {
      boardName: String(input.boardName || '').trim(),
      title: String(input.title || '').trim(),
      description: String(input.description || '').trim(),
      link: String(input.link || '').trim(),
      imageUrl: String(input.imageUrl || '').trim(),
      altText: String(input.altText || input.title || '').trim(),
    };
  }

  async function schedule(input = {}) {
    const pin = sanitizePin(input.pin || input);
    if (!pin.boardName || !pin.title || !pin.link || !pin.imageUrl) return { state:'Configuration Invalid', message:'Board name, title, destination URL and image URL are required.' };
    const scheduledFor = new Date(input.scheduledFor || Date.now());
    if (Number.isNaN(scheduledFor.getTime())) return { state:'Configuration Invalid', message:'A valid scheduled time is required.' };
    const state = await readState();
    const id = crypto.randomUUID();
    const job = {
      id,
      environment:'sandbox',
      status:'Scheduled',
      scheduledFor:scheduledFor.toISOString(),
      createdAt:new Date().toISOString(),
      attempts:0,
      pin,
      result:null,
    };
    state.jobs.push(job);
    await writeState(state);
    return { state:'Scheduled', job };
  }

  async function cancel(jobId) {
    const state = await readState();
    const job = state.jobs.find(x => x.id === jobId);
    if (!job) return { state:'Not Found', message:'Scheduler job was not found.' };
    if (job.status === 'Published') return { state:'Conflict', message:'Published jobs cannot be cancelled.' };
    job.status = 'Cancelled';
    job.cancelledAt = new Date().toISOString();
    await writeState(state);
    return { state:'Cancelled', jobId };
  }

  async function list() {
    const state = await readState();
    const counts = state.jobs.reduce((acc, job) => { acc[job.status] = (acc[job.status] || 0) + 1; return acc; }, {});
    return { state:'Connected', ...state, counts };
  }

  async function executeDue(now = new Date()) {
    if (executionLock) return { state:'Busy' };
    executionLock = true;
    try {
      const state = await readState();
      if (!state.enabled) return { state:'Disabled' };
      const due = state.jobs
        .filter(job => job.status === 'Scheduled' && Date.parse(job.scheduledFor) <= now.getTime())
        .sort((a,b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
      const results = [];
      for (const job of due) {
        job.status = 'Publishing';
        job.lastAttemptAt = new Date().toISOString();
        job.attempts = Number(job.attempts || 0) + 1;
        await writeState(state);
        const result = await publisher.create(job.pin);
        job.result = result;
        if (result?.state === 'Published') {
          job.status = 'Published';
          job.publishedAt = new Date().toISOString();
          state.history.unshift({ jobId:job.id, status:'Published', at:job.publishedAt, pinId:result.pinId, boardId:result.boardId, title:job.pin.title });
        } else {
          job.status = 'Failed';
          job.failedAt = new Date().toISOString();
          job.error = result?.message || result?.state || 'Unknown publishing failure';
          state.history.unshift({ jobId:job.id, status:'Failed', at:job.failedAt, message:job.error, title:job.pin.title });
        }
        state.history = state.history.slice(0, 500);
        await writeState(state);
        results.push({ jobId:job.id, status:job.status, result });
      }
      return { state:'Executed', processed:results.length, results };
    } finally {
      executionLock = false;
    }
  }

  async function setEnabled(enabled) {
    const state = await readState();
    state.enabled = enabled === true;
    await writeState(state);
    return { state:state.enabled ? 'Enabled' : 'Disabled', environment:'sandbox' };
  }

  async function initialize() {
    if (running) return;
    running = true;
    timer = setInterval(() => { executeDue().catch(() => {}); }, tickMs);
    timer.unref?.();
  }

  async function shutdown() {
    if (timer) clearInterval(timer);
    running = false;
  }

  return Object.freeze({ initialize, shutdown, schedule, cancel, list, executeDue, setEnabled });
}

module.exports = { createPinterestScheduler, DEFAULT_INTERVAL_MINUTES, STATES };
