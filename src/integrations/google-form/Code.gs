/**
 * PaySah Google Form receipt intake (Apps Script, V8 runtime, bound to the form).
 *
 * Wire contract: docs/INTAKE_CONTRACT.md "Google Form" (intake contract 1.0).
 * Setup and limits: docs/GOOGLE_FORM_SETUP.md.
 *
 * Only Script Properties hold configuration and secrets. Pending state keeps the
 * Google response ID and attempt counters, never image bytes, tokens or the key.
 * Logs contain the wire response ID, HTTP status and generic reason only.
 */

var PAYSAH = {
  PREFIX: 'paysah.pending.',
  ALLOWED_MIME: {'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/webp': 'image/webp'},
  MAX_IMAGE_BYTES: 10485760,
  DEFAULT_MAX_ATTEMPTS: 5,
  BASE_DELAY_MS: 60000,
  MAX_DELAY_MS: 1800000,
  LEASE_MS: 600000,
  LOCK_WAIT_MS: 20000,
  BATCH: 5,
  PATH: '/api/v1/intake/google-form'
};

/** Installable "On form submit" trigger handler. */
function onFormSubmit(e) {
  if (!e || !e.response || typeof e.response.getId !== 'function') throw new Error('PaySah: form submit event without a response');
  var config = paysahConfig_();
  var wire = paysahRegister_([e.response.getId()])[0];
  paysahDispatch_(config, [wire]);
}

/** Time-driven retry/backfill sweep. Safe to run manually from the editor. */
function retryPendingReceipts() {
  var config = paysahConfig_();
  return paysahDispatch_(config, null);
}

/**
 * Manual backfill: queue every response since the given ISO time (for example after
 * a trigger outage). Already-delivered responses are replayed by the server, not duplicated.
 */
function enqueueResponsesSince(isoTime) {
  var since = new Date(isoTime);
  if (isNaN(since.getTime())) throw new Error('PaySah: provide an ISO date such as 2026-10-24T00:00:00+08:00');
  var ids = paysahForm_().getResponses(since).map(function (r) { return r.getId(); });
  paysahRegister_(ids);
  console.log('PaySah backfill queued ' + ids.length + ' response(s)');
  return ids.length;
}

/** Lists queued and manual-attention items without secrets. */
function listPendingReceipts() {
  var all = PropertiesService.getScriptProperties().getProperties(), out = [];
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(PAYSAH.PREFIX) !== 0) return;
    var item = paysahParse_(all[key]);
    if (item) out.push({response: key.slice(PAYSAH.PREFIX.length), state: item.state, attempts: item.attempts, last: item.last || null, next_at: item.next_at ? new Date(item.next_at).toISOString() : null});
  });
  out.forEach(function (item) { console.log('PaySah ' + item.state + ' ' + item.response + ' attempts=' + item.attempts + ' last=' + item.last); });
  return out;
}

/** Operator decision after fixing configuration: queue one manual item again from attempt 0. */
function requeueReceipt(wireId) {
  return paysahWithLock_(function (props) {
    var key = PAYSAH.PREFIX + wireId, item = paysahParse_(props.getProperty(key));
    if (!item) return false;
    item.state = 'PENDING'; item.attempts = 0; item.next_at = 0; item.lease_until = 0; item.last = 'REQUEUED';
    props.setProperty(key, JSON.stringify(item));
    return true;
  });
}

/** Operator decision: stop tracking one item (the customer will resubmit or staff uploads manually). */
function dismissReceipt(wireId) {
  return paysahWithLock_(function (props) {
    var key = PAYSAH.PREFIX + wireId, had = props.getProperty(key) !== null;
    props.deleteProperty(key);
    return had;
  });
}

/**
 * Creates the two installable triggers. Run it once by hand after the setup checklist;
 * it is never called automatically and only adds triggers that are missing.
 */
function installPaysahTriggers() {
  paysahConfig_();
  var form = paysahForm_(), existing = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (existing.indexOf('onFormSubmit') < 0) ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  if (existing.indexOf('retryPendingReceipts') < 0) ScriptApp.newTrigger('retryPendingReceipts').timeBased().everyMinutes(5).create();
}

function paysahConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('PAYSAH_INTAKE_URL'), key = p.getProperty('PAYSAH_INTAKE_KEY');
  var tokenItem = p.getProperty('PAYSAH_TOKEN_ITEM_ID'), receiptItem = p.getProperty('PAYSAH_RECEIPT_ITEM_ID');
  var max = Number(p.getProperty('PAYSAH_MAX_ATTEMPTS') || PAYSAH.DEFAULT_MAX_ATTEMPTS);
  var missing = [];
  if (!url) missing.push('PAYSAH_INTAKE_URL');
  if (!key) missing.push('PAYSAH_INTAKE_KEY');
  if (!tokenItem) missing.push('PAYSAH_TOKEN_ITEM_ID');
  if (!receiptItem) missing.push('PAYSAH_RECEIPT_ITEM_ID');
  if (missing.length) throw new Error('PaySah: missing Script Properties ' + missing.join(', '));
  // The key may only travel to the intake route over HTTPS (loopback HTTP is for local doubles).
  var match = /^(https):\/\/[^\/?#@]+(\/[^?#]*)$/.exec(url) || /^(http):\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(\/[^?#]*)$/.exec(url);
  if (!match || match[2].slice(-PAYSAH.PATH.length) !== PAYSAH.PATH) throw new Error('PaySah: PAYSAH_INTAKE_URL must be https://<host>' + PAYSAH.PATH);
  if (key.length < 32 || key.length > 256) throw new Error('PaySah: PAYSAH_INTAKE_KEY must be 32-256 characters');
  if (!/^\d+$/.test(tokenItem) || !/^\d+$/.test(receiptItem)) throw new Error('PaySah: item IDs must be numeric form item IDs');
  if (!(max >= 1 && max <= 10 && Math.floor(max) === max)) throw new Error('PaySah: PAYSAH_MAX_ATTEMPTS must be an integer 1-10');
  return {url: url, key: key, tokenItem: tokenItem, receiptItem: receiptItem, maxAttempts: max};
}

/** Setup helper: prints item IDs (not the entry.N prefill IDs) so they can go into Script Properties. */
function logPaysahItems() {
  return paysahForm_().getItems().map(function (item) {
    console.log('item ' + item.getId() + ' ' + item.getType() + ' ' + item.getTitle());
    return {id: String(item.getId()), type: String(item.getType()), title: item.getTitle()};
  });
}

function paysahForm_() {
  // Bound script only, so the manifest can stay on forms.currentonly.
  var form = FormApp.getActiveForm();
  if (!form) throw new Error('PaySah: open the script from the form (Extensions > Apps Script)');
  return form;
}

/** Stable contract ID: Google IDs are used directly when they fit, otherwise a SHA-256 form. */
function paysahWireId_(raw) {
  raw = String(raw);
  if (/^[A-Za-z0-9_-]{1,128}$/.test(raw)) return raw;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return 'h_' + bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function paysahParse_(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (err) { return null; }
}

function paysahWithLock_(fn) {
  var lock = LockService.getScriptLock();
  // Throwing makes Google record the trigger failure; nothing is half-written.
  if (!lock.tryLock(PAYSAH.LOCK_WAIT_MS)) throw new Error('PaySah: script lock busy, run retryPendingReceipts later');
  try { return fn(PropertiesService.getScriptProperties()); } finally { lock.releaseLock(); }
}

function paysahRegister_(rawIds) {
  return paysahWithLock_(function (props) {
    return rawIds.map(function (raw) {
      var wire = paysahWireId_(raw), key = PAYSAH.PREFIX + wire;
      // A duplicate trigger fire keeps the existing record and its attempt count.
      if (props.getProperty(key) === null) props.setProperty(key, JSON.stringify({raw: String(raw), state: 'PENDING', attempts: 0, next_at: 0, lease_until: 0}));
      return wire;
    });
  });
}

/** Claims due items under the lock, sends outside it, then records each outcome under the lock. */
function paysahDispatch_(config, only) {
  var now = Date.now();
  var claimed = paysahWithLock_(function (props) {
    var all = props.getProperties(), picked = [];
    var keys = only ? only.map(function (w) { return PAYSAH.PREFIX + w; }) : Object.keys(all).filter(function (k) { return k.indexOf(PAYSAH.PREFIX) === 0; }).sort();
    for (var i = 0; i < keys.length && picked.length < PAYSAH.BATCH; i++) {
      var item = paysahParse_(all[keys[i]]);
      if (!item || item.state !== 'PENDING' || item.next_at > now || item.lease_until > now) continue;
      if (item.attempts >= config.maxAttempts) {
        // A run that died after its last claim (expired lease) must not get an extra attempt.
        item.state = 'MANUAL'; item.lease = null; item.lease_until = 0; item.last = 'RETRY_EXHAUSTED:LEASE_EXPIRED';
        props.setProperty(keys[i], JSON.stringify(item));
        continue;
      }
      item.attempts += 1; item.lease_until = now + PAYSAH.LEASE_MS;
      var lease = Utilities.getUuid(); item.lease = lease;
      props.setProperty(keys[i], JSON.stringify(item));
      picked.push({key: keys[i], wire: keys[i].slice(PAYSAH.PREFIX.length), raw: item.raw, attempts: item.attempts, lease: lease});
    }
    return picked;
  });
  var outcomes = claimed.map(function (job) {
    var outcome = paysahSend_(config, job);
    paysahRecord_(config, job, outcome);
    return {response: job.wire, kind: outcome.kind, last: outcome.last};
  });
  return outcomes;
}

function paysahRecord_(config, job, outcome) {
  paysahWithLock_(function (props) {
    var item = paysahParse_(props.getProperty(job.key));
    if (!item || item.lease !== job.lease) return; // dismissed or reclaimed meanwhile
    if (outcome.kind === 'DONE') { props.deleteProperty(job.key); return; }
    item.lease = null; item.lease_until = 0; item.last = outcome.last;
    if (outcome.kind === 'RETRY' && item.attempts < config.maxAttempts) {
      var delay = Math.min(PAYSAH.MAX_DELAY_MS, PAYSAH.BASE_DELAY_MS * Math.pow(2, item.attempts - 1));
      if (outcome.retryAfterMs) delay = Math.min(PAYSAH.MAX_DELAY_MS, Math.max(delay, outcome.retryAfterMs));
      item.next_at = Date.now() + delay;
    } else {
      item.state = 'MANUAL';
      if (outcome.kind === 'RETRY') item.last = 'RETRY_EXHAUSTED:' + outcome.last;
    }
    props.setProperty(job.key, JSON.stringify(item));
  });
  var tag = outcome.kind === 'DONE' ? 'done' : outcome.kind === 'RETRY' ? 'retryable' : 'needs attention';
  console.log('PaySah ' + tag + ' ' + job.wire + ' attempt=' + job.attempts + ' result=' + outcome.last);
}

/** Re-reads the response and its Drive file for every attempt; returns DONE, RETRY or MANUAL. */
function paysahSend_(config, job) {
  var payload;
  try {
    payload = paysahPayload_(config, job);
  } catch (err) {
    var code = err && err.paysah ? err.paysah : 'LOCAL_READ_FAILED';
    // Google read failures are transient; content problems are not.
    return {kind: code === 'LOCAL_READ_FAILED' ? 'RETRY' : 'MANUAL', last: code};
  }
  var response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
      headers: {'X-Intake-Key': config.key}, muteHttpExceptions: true, followRedirects: false
    });
  } catch (err) {
    return {kind: 'RETRY', last: 'NETWORK'};
  }
  var status = response.getResponseCode(), body = paysahParse_(response.getContentText());
  if (status === 200) {
    if (body && (body.status === 'ACCEPTED' || body.status === 'REJECTED')) {
      var last = body.status + (body.reason ? ':' + body.reason : '') + (body.replayed ? ':REPLAYED' : '');
      // REJECTED is final per contract; it still needs a human to follow up with the customer.
      return {kind: body.status === 'ACCEPTED' ? 'DONE' : 'MANUAL', last: last};
    }
    return {kind: 'MANUAL', last: 'HTTP_200_UNEXPECTED'};
  }
  var errorCode = body && typeof body.code === 'string' && /^[A-Z_]{1,40}$/.test(body.code) ? body.code : 'UNKNOWN';
  if (status === 429 || status === 503) {
    var headers = response.getHeaders() || {}, after = Number(headers['Retry-After'] || headers['retry-after']);
    return {kind: 'RETRY', last: 'HTTP_' + status + ':' + errorCode, retryAfterMs: after > 0 ? after * 1000 : 0};
  }
  // 401/404/409/413/422/5xx other than 503: not retryable under the contract.
  return {kind: 'MANUAL', last: 'HTTP_' + status + ':' + errorCode};
}

function paysahLocalError_(code) {
  var err = new Error('PaySah local check failed: ' + code);
  err.paysah = code;
  return err;
}

function paysahPayload_(config, job) {
  var response;
  try { response = paysahForm_().getResponse(job.raw); } catch (err) { throw paysahLocalError_('LOCAL_READ_FAILED'); }
  if (!response) throw paysahLocalError_('LOCAL_RESPONSE_MISSING');
  var token = null, files = null;
  response.getItemResponses().forEach(function (ir) {
    var id = String(ir.getItem().getId());
    if (id === config.tokenItem) token = ir.getResponse();
    if (id === config.receiptItem) files = ir.getResponse();
  });
  token = typeof token === 'string' ? token.trim() : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw paysahLocalError_('LOCAL_TOKEN_INVALID');
  if (!files || files.length !== 1) throw paysahLocalError_('LOCAL_FILE_COUNT');
  var blob;
  try { blob = DriveApp.getFileById(files[0]).getBlob(); } catch (err) { throw paysahLocalError_('LOCAL_READ_FAILED'); }
  var mime = PAYSAH.ALLOWED_MIME[String(blob.getContentType()).toLowerCase()];
  if (!mime) throw paysahLocalError_('LOCAL_MIME_UNSUPPORTED');
  var bytes = blob.getBytes();
  if (!bytes.length || bytes.length > PAYSAH.MAX_IMAGE_BYTES) throw paysahLocalError_('LOCAL_IMAGE_SIZE');
  return {response_id: job.wire, submission_token: token, mime_type: mime, image_base64: Utilities.base64Encode(bytes)};
}
