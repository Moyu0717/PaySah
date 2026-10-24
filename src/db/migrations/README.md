# 数据库迁移

设置 DATABASE_URL 后执行 `npm run db:migrate`。001 建立 tenants、users、customers、orders、demo_sessions、idempotency_keys 和 activity_events；关联客户和操作者使用 tenant 复合外键。

runner 在事务内持有迁移锁，按文件名执行 SQL 并保存 SHA-256。已执行文件被修改时拒绝继续；后续变更应新增迁移。当前没有下行迁移或自动清库。002 已增加收款账户、独立入账、结构化收据字段、修正审计、核实、审批、分配和活动实体校验；003 已增加图片元数据、OCR 运行及持久化任务；后续变更新增 004，不改 001–003。
