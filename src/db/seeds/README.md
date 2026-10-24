# 合成数据初始化

迁移后，设置 DEMO_MODE=true 并执行 `npm run db:seed`。创建两个虚构商家、各自 Owner/Cashier、两个合成客户和三笔订单（RM128、RM780、RM100）。固定 UUID 便于演示复现。

重复执行使用 ON CONFLICT DO NOTHING，不覆盖已有状态或删除数据；它不是重置命令。只能在专用演示数据库使用，不能导入真实商家资料。

002 增加两个合成收款账户和三笔独立入账（RM128、RM780、RM50）；七种预置字段由 apps/api/src/modules/verification/fixtures.ts 定义，不是识别结果或图片。
