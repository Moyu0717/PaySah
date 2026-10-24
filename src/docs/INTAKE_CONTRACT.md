# Intake contract 1.0


## Google Form

`POST /api/v1/intake/google-form`, JSON, header `X-Intake-Key: <GOOGLE_FORM_INGEST_KEY>`. No employee bearer token. Connector and tenant come exclusively from server configuration. Never send tenant, actor, order ID or a download URL.

```json
{"response_id":"stable_response_id","submission_token":"43-character-base64url-token","mime_type":"image/png","image_base64":"canonical padded base64"}
```

Exactly these fields; MIME png/jpeg/webp. Maximum decoded image 10 MiB, JSON 15 MiB. Full image decode and 16M pixel limit apply. Base64 cannot contain whitespace or a data URL prefix. The actual decoded MIME must match. Response IDs: 1–128 ASCII letters, digits, `_` or `-`.

Success or permanent business rejection: HTTP 200, `{ "status": "ACCEPTED" | "REJECTED", "reason": null | "LINK_INVALID" | "IMAGE_INVALID" | "PAYMENT_STATE_CONFLICT" | "STALE_MESSAGE" | "ATTEMPTS_EXHAUSTED", "replayed": false | true }`. No order/customer/receipt details. ACCEPTED means receipt saved, never payment confirmed. Do not retry REJECTED.

Current implementation uses LINK_INVALID for expired/revoked/foreign-tenant tokens and tokens whose orders are already paid, without exposing which condition occurred. IMAGE_INVALID includes MIME mismatch and image decoding failure. These are deliberately generic external reasons.

Errors use `{code,message,correlation_id}`: disabled 404, bad credential 401 UNAUTHENTICATED, malformed JSON/schema/base64 422 INVALID_INPUT, body/image too large 413, ID with altered payload 409 IDEMPOTENCY_CONFLICT. Busy/concurrency/rate limit 429; temporary network/storage/database/in-progress 503 INTAKE_RETRY. Retry only 429/503/network with the same response ID and identical payload, bounded backoff and finite attempts; preserve pending IDs with Script Lock, not image bytes. No automatic deployment or triggers authorized.

Idempotency identity is `(configured tenant, GOOGLE_FORM, configured connector, response_id)`. SHA-256 binds exact validated request fields, including token and image bytes. Persisted ACCEPTED/REJECTED results are replayed. Changed-payload conflicts are audited durably before returning 409, without changing the original accepted/rejected result. Temporary failures can be retried; no duplicate receipt/job. URLs/tokens/keys must not enter logs or public feedback. Image and external network calls do not run under a database lock.

## Employee links

Bearer human session, `Idempotency-Key` (8–128 alphanumeric/underscore/hyphen). `POST /api/v1/orders/:id/intake-links` with `{expected_version,channel:"TELEGRAM"|"GOOGLE_FORM"}`; 201 `{link_id,url,expires_at}`. Replay returns 200 with the same link ID and `url:null`; token is not in the database, audit or idempotency cache. A new explicit generation revokes older links for that order/channel/connector. Token is 32 random bytes, SHA-256 stored, 24h expiry.

`POST /api/v1/orders/:id/intake-links/:linkId/revoke` with `{expected_version}`; 200 `{link_id,revoked:true}`. `GET /api/v1/orders/:id/intake-links` returns enabled channels and safe link metadata (no tokens). All routes enforce tenant, human role, order version and UNPAID. Disabled/mismatched tenant channels are unavailable. Links authorize submission only, never reading an order.

## Telegram

`POST /api/v1/intake/telegram`, `X-Telegram-Bot-Api-Secret-Token`, up to 1 MiB JSON. Only configured allowlisted private sender/chat pairs. `/start <token>` binds the sender HMAC to an order; newer update/message IDs cannot be replaced by older ones. Photo/document upload snapshots that binding durably before bounded download, then rechecks expiry/revocation/payment state. Retries use the stored order, never the current binding. Conflicting update IDs return 409. Permanent rejections return 200; transient failures 503. P1-5 sends a fixed private acknowledgement only after commit to an allowlisted sender; no amounts, submission tokens or tenant values are sent. The binding notice contains only the authorized order reference. Sending fails independently of reception, is bounded to five seconds, is not retried and has no outbox. Replayed/ignored updates do not resend. No real messages or webhook configuration were performed during local mock checks.

## Internal services

`ingestReceiptImage(context,config,storage,orderId,expectedVersion,preparedImage,fixtureId?,channel?,messageId?)` requires a tenant transaction lock and an explicit current order version. Dashboard fixture ID is internal only. `verifyReceipt(context,{orderId,receiptId,expectedVersion,expectedRevision?})` checks the current receipt and revision and reuses an unchanged active result. Extraction completion and automatic verification job creation are atomic; only external channels get automatic jobs. SYSTEM is an internal database identity, excluded from account listing, login/session restoration and every human write wrapper. It cannot approve, confirm or release. Automation never calls those functions.

Preserve RunPod/CPU provenance, MODEL_UNCONFIRMED, private storage, human corrections and all payment/release rules. A later receipt or correction cancels stale tasks. Independent feed changes may cause a new verification; final human confirmation reevaluates evidence. Form/Telegram real endpoints, sender allowlist, Secrets, public webhook installation, Google trigger authorization and proof remain separate platform work.


I0–I2本地实施／mock已验证，最新证据见evaluation/intake/README.md与WORK_LOG。I3仅写 `integrations/google-form/`、`tests/integration/google-form-script.test.ts`、`docs/GOOGLE_FORM_SETUP.md`；不改API／schema／契约／UI／依赖／共享日志。按item ID、Script Properties、Script Lock和有限补发实现；本地HTTP替身验证，不安装真实触发器或发送真实请求。I4默认只读，结果写 `docs/INTAKE_REVIEW_RESULTS.md`；发现契约问题交主整合者。

P0-1（2026-10-24）：员工与渠道入口先在租户事务外调用prepareReceiptImage完成一次整图校验／解码及私有存储上传，再传PreparedImage给ingest。最终事务只重验身份／链接／版本、去重、插入与入队；拒绝／重放删除未使用对象，已知回滚用afterRollback，未知COMMIT保留对象待孤儿核对。验证／人员付款确认仍在锁内重读原图核验hash，这是刻意保留的保守边界，本次不改。

P0-2（2026-10-24）：Telegram secret认证成功后，无message／结构不合schema、群聊／chat与sender不符／非白名单、非start且无图片的更新均HTTP200 `{"status":"IGNORED"}`，不落消息／绑定／活动日志，只受入口限流。secret错误仍401。共享TelegramIntakeResult支持IGNORED；Form的IntakeResult及脚本契约不变。

P1-6 retry clarification: 503 may omit `Retry-After`; clients must use their own bounded backoff (and honor the header when supplied). The server allows at most three reception attempts for one message identity; the next redelivery returns fixed REJECTED/ATTEMPTS_EXHAUSTED. Apps Script defaults to five client delivery attempts, which also cover failures before a server reservation; this does not raise/reset the server cap. Invalid LINK_INVALID submissions with no order remain in intake_messages but do not enter employee activity. Reused older images still return ACCEPTED; their activity carries reused=true/current=false and explicitly says the current evidence is unchanged.
