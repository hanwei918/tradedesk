# TradeDesk 出海工作台

**INTERCITY HACK 宁波站 · 赛道二（AI+外贸/跨境）参赛作品**

给中小外贸工厂的 AI 助手：**询盘 → 回复 → 上架**，每一条风险提示都能查到出处。

- **工作流 A · 询盘回复**：读买家询盘（英语、西语等），找出买家要求和工厂资料对不上的地方。用买家的语言写阿里国际站 RFQ 回复，同时给采购和生产写一份中文内部备忘。
- **询盘收件箱 + 跨岗位任务**：理解每条询盘，按公开公式打优先级（每一分挂询盘原文）；回复时把需要采购、生产、美工跟进的事派成任务，任务同样必须挂询盘原文。
- **评测**：两份由没看过检查代码的人写的盲测集，首次运行精确率 97.1% / 92.3%、召回率 94.4% / 82.8%（修复前冻结在 `app/eval/*_first_run.json`）；评测页逐条展示。
- **对照实验**：同样 8 条询盘、同一个模型、同一套检查，比较四组回复。直接用通用 AI：8 条回复 8 条带红色问题（声称有 UL/ETL/NOM 认证、承诺免费样品、按低于起订量报价）；附上工厂资料：0 条红、20 条需确认；TradeDesk 第 1 轮：0 条红、13 条需确认；改一轮后：0 条红、8 条需确认、3 条可直接发。**差距主要来自工厂资料**，TradeDesk 的作用是每次自动带上资料、减少需人工确认的地方。结果在 `app/eval/baseline_run.json`，评测页可逐条查看回复全文。
- **红队测试**：往审核结果里注入编造的模型提示（不存在的规则编号、原文里没有的话、不适用的规则、空引用），出处守卫逐条拦下并说明原因；评测页上可以自己改 JSON 再试。
- **自动演示**：右上角一键播放 12 步带字幕的走查，`#tour=loop` 可在摊位循环播放。
- **游园会找茬**：`python3 server.py --lan` 后手机扫码答题，答案由代码规则计算；局域网访问只开放找茬页面，其余接口一律 403。
- **工作流 C · 商品看板**：所有产品 × 主图 / Amazon / TikTok 的最新状态一屏看清；一键批量生成上品，导出 CSV。主图按 Amazon 美国站的 10 条要求检查：尺寸、白底、产品占比、是否贴边由代码测量，文字、徽章、道具、是否实拍由模型看图判断。
- **工作流 B · 多平台上架**：一份中文产品资料，同时生成 Amazon 美国站英文 Listing 和 TikTok Shop 墨西哥站西语种草脚本。
- **校验**：分两层。第一层是代码规则：产品事实、合同条款、平台格式。第二层是模型审核：模型提出的问题必须带上**知识库规则编号**和**原文片段**，带不上就由代码丢弃，不显示。
- **反馈**：原文高亮批注，加上红、黄、绿三档风险等级，再加上与上一轮的逐词对比。业务员可以用中文多轮提修改意见。

## 运行

只用 Python 3.9+ 标准库，**不需要安装任何依赖**。主图的像素检查需要 Pillow（`pip install pillow`）；没装的话，这几项会显示为"未运行"，风险等级不会显示绿色。

```bash
cd app
python3 server.py                          # 打开 http://127.0.0.1:8765
```

模型配置可以在网页左下角的"模型设置"里填写（key 只存在本机的 `app/.env`，页面只显示末 4 位），也可以直接编辑 `app/.env`（不会提交，参考 `app/.env.example`）：

```
LLM_API_KEY=...
LLM_ENDPOINT=https://tokenhub-intl.tencentcloudmaas.com/v1/chat/completions
LLM_MODEL=deepseek/deepseek-flash
```

任何 OpenAI 兼容的 Chat Completions 接口都可以用，例如赛事赞助的 Tokenhub。也可以用 Claude（Anthropic 官方 SDK，`pip install anthropic`）：

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
LLM_MODEL=claude-opus-5-5
```

仓库里的回放缓存（`app/cache/`）是用 `claude-opus-5-5` 录制的。换了模型或提示词，要重新运行 `tools/record_demo.py`。

三种模式，用 `TRADEDESK_MODE` 切换：

| 模式 | 用途 |
|---|---|
| `live` | 每次实时调用模型（有 key 时默认用这个） |
| `record` | 实时调用，并把每次返回缓存到 `app/cache/` |
| `replay` | 不联网，只用缓存回答（现场演示的备用方案；没有 key 时默认用这个） |

```bash
cd app
TRADEDESK_MODE=record python3 tools/record_demo.py   # 把固定演示输入跑一遍并缓存
TRADEDESK_MODE=replay python3 server.py              # 断网也能演示
python3 -m unittest discover -s tests -v             # 测试（46 项）
TRADEDESK_MODE=replay python3 tools/run_baseline.py  # 对照实验（缓存齐全时不联网）
TRADEDESK_MODE=replay python3 server.py --lan        # 游园会：手机扫码访问 /play，大屏打开 /play#screen
python3 tools/export_config.py                       # 导出平台配置 → app/config/agents.json
```

## 目录

```
app/
  server.py              本地服务（标准库 http.server）
  tradedesk/llm.py       OpenAI 兼容客户端 + 录制/回放缓存
  tradedesk/kb.py        规则知识库、产品资料卡
  tradedesk/checks.py    代码规则校验 + 模型审核的出处守卫
  tradedesk/workflows.py 工作流 A / B / 主图检查，调用日志
  tradedesk/images.py    主图像素测量 + 看图审核的出处守卫
  tradedesk/board.py     商品看板状态（state/，不提交）
  tradedesk/inbox.py     收件箱优先级打分 + 跨岗位任务
  tradedesk/evaluate.py  评测：开发集 + 两份盲测集（eval/）
  tradedesk/compare.py   对照实验汇总：通用 AI vs TradeDesk
  data/redteam.json      红队测试的注入样例
  prompts/*.md           各角色提示词（含主图审核员、对照组的通用助手）
  kb/rules.json          规则知识库（38 条，每条带原文摘录与来源 URL）
  config/check_map.json  内置检查 → 依据的知识库规则
  config/agents.json     平台配置导出
  data/                  示例工厂、4 个产品、8 条询盘、3 道找茬题（虚构）
  static/samples/        示例主图（示意图，不是实拍照片）
  static/                网页界面（设计规范移植自 shadcn/ui，图标 Lucide，全部本地文件）
  tests/                 单元测试
eval/                    （在 app/ 下）开发集、两份盲测集、首次运行冻结记录
docs/                    交付文档（方案说明、配置与调用说明、演示说明、数据来源说明、路演稿、海报）
```

## 诚信说明

- 示例工厂、产品、询盘、买家都是**虚构的**，不对应任何真实企业或个人。示例主图是团队画的示意图，系统会把它们判为"不是实拍照片"。
- 知识库里的每条规则都附有原文摘录和来源链接，抓取日期为 2026-10-26。没有对照原文核实过的规则**不参与检查**。规则以来源页面的最新版本为准，本工具不构成法律或合规意见。
- 第三方组件见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 许可

MIT
