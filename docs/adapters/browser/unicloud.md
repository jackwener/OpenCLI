# uniCloud

**模式**：浏览器 UI · **域名**：`unicloud.dcloud.net.cn`

复用浏览器中已登录的 DCloud 会话，查看服务空间到期时间，并为阿里云开发者免费套餐、支付宝云免费套餐续期。适配器仅接受明确显示 **0 元、1 个月** 的续费订单。

## 命令

| 命令 | 作用 |
|------|------|
| `opencli unicloud spaces` | 查询空间、服务商、套餐、到期时间及免费续期条件 |
| `opencli unicloud renew <space-id>` | 在到期窗口内预览续期，不提交订单 |
| `opencli unicloud renew <space-id> --confirm` | 在到期窗口内确认免费续期，并核验到期时间延长 |

```bash
opencli unicloud spaces -f json
opencli unicloud renew env-example-alipay -f json
opencli unicloud renew env-example-alipay --within-days 7 --confirm -f json
```

`space-id` 必须是 `spaces` 返回的完整 SpaceID，不能使用空间名称。`--within-days` 默认 `7`，允许 `0` 到 `30` 的整数。时间按中国标准时间 UTC+8 解析；超过到期窗口返回 `skipped`，不打开订单页面。`0` 表示仅处理已经到期的空间。

## 自动续期

可让现有任务调度器每天执行以下命令，每个空间单独调用：

```bash
opencli unicloud renew env-example-alipay --within-days 7 --confirm -f json
```

调度运行的前提是电脑、浏览器和 Browser Bridge 可用，且 DCloud 登录仍然有效。命令本身不会创建定时任务、开启平台扣费或保存密码、Cookie、令牌。只支持免费套餐，不支持付费续费、升级套餐、充值或修改超限按量设置。

状态字段：`preview` 表示订单只读预览，`skipped` 表示尚未进入窗口，`renewed` 表示已确认控制台到期日期延长。续费金额固定为 `0` 元，时长为 `1` 个月；平台公告通过 `notices` 返回。

确认执行前会复核官方订单 URL 中的 SpaceID、服务商、套餐 ID、原到期时间，以及页面上的空间名称、不可编辑名称输入框、免费套餐、选中时长和最终费用。非零或无法确认的费用、重复按钮、额外弹窗及禁用按钮均会阻止提交。创建订单和免费确认分别使用 `evaluateOnce`，每个动作只发送一次，浏览器不支持此接口时直接停止。

“立即购买”之后，平台会跳到订单确认页。命令会核对页面实付金额及 Vue hydration 中已加载的订单编号、SpaceID、空间名、服务商、续费类型、免费套餐和 1 个月时长，然后仅点击免费订单的“确认开通”。当前确认页仅支持桌面布局；缺少所需字段或出现付费操作时停止。

**提交后出现超时或连接中断时，不要立即重试。** 先运行 `unicloud spaces` 并查看 DCloud 订单中心，确认到期时间及订单结果；命令不会自动重放购买动作。平台可能要求人工登录、关注公众号或处理续费窗口限制，这些条件不会自动绕过。

阿里云页面可能显示服务停止或最晚续期日期公告；免费续期不能替代服务迁移，请遵循当前控制台提示。

## 验证

两个服务商的空间列表和创建订单页使用真实页面脱敏后的 DOM 样本；免费确认页使用支付宝云实际0元续期时捕获的最小 DOM 与订单 hydration 状态，阿里云变体复用已实测字段映射。测试覆盖免费报价、重复或隐藏元素、空间不一致、创建订单及确认期间价格变化、单次提交、日期延长核验和重复调用跳过。

2026-10-19 已通过阿里云和支付宝云各一次0元、1个月的真实端到端续期：分别完成创建订单、免费确认与控制台到期时间延长核验。再次调用时两个空间均因超出到期窗口返回 `skipped`，没有重复创建订单。真实执行使用 ego lite 的已登录页面桥接同一适配器函数；原生 Browser Bridge 仍需其自身浏览器会话已登录。未创建定时任务。

```bash
npx vitest run --project adapter clis/unicloud/commands.test.js
opencli adapter check unicloud
```
