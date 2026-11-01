# TradeDesk 出海工作台

**INTERCITY HACK 宁波站 · 赛道二（AI+外贸/跨境）参赛作品**

给中小外贸工厂的 AI 助手：**询盘 → 回复 → 上架**，每一条风险提示都能查到出处。

- **工作流 A · 询盘回复**：读买家询盘（英语、西语等），找出买家要求和工厂资料对不上的地方。用买家的语言写阿里国际站 RFQ 回复，同时给采购和生产写一份中文内部备忘。
- **询盘收件箱 + 跨岗位任务**：理解每条询盘，按公开公式打优先级（每一分挂询盘原文）；回复时把需要采购、生产、美工跟进的事派成任务，任务同样必须挂询盘原文。
- **评测**：两份由没看过检查代码的人写的盲测集，首次运行精确率 97.1% / 92.3%、召回率 94.4% / 82.8%（修复前冻结在 `app/eval/*_first_run.json`）；评测页逐条展示。
- **对照实验**：同样 8 条询盘、同一个模型、同一套检查，比较四组回复。直接用通用 AI：8 条回复 8 条带红色问题（声称有 UL/ETL/NOM 认证、承诺免费样品、按低于起订量报价）；附上工厂资料：0 条红、20 条需确认；TradeDesk 第 1 轮：0 条红、13 条需确认；改一轮后：0 条红、8 条需确认、3 条可直接发。**差距主要来自工厂资料**，TradeDesk 的作用是每次自动带上资料、减少需人工确认的地方。结果在 `app/eval/baseline_run.json`，评测页可逐条查看回复全文。
- **调用成本**：按 Claude 官方价和录制时的实测用量，每条询盘第 1 轮 3 次调用 0.087–0.150 美元（中位数 0.135），加改一轮中位数 0.236 美元（`python3 tools/cost_report.py`，结果在 `app/eval/cost_run.json`）。
- **红队测试**：往审核结果里注入编造的模型提示（不存在的规则编号、原文里没有的话、不适用的规则、空引用），出处守卫逐条拦下并说明原因；评测页上可以自己改 JSON 再试。
- **降本测算**：评测页里列出替换掉的工作、实测的模型费用和耗时（从仓库记录算出，写明出处），以及可改的示例假设（询盘量、人工用时、时薪、外包单价），按算式给出每月测算。人工节省没有实测，页面上写明了。
- **工作流串联**：询盘回复结果下方一键带着同一份产品资料去生成上架文案，上架结果再写进商品看板。上架页顶部由代码逐项核对回复和 Listing 有没有说法打架（没有的认证被写成有、没检测的材料宣称、容量、电压），不经过模型。
- **换工厂、换品类**：第二家示例工厂（宁海杯壶，500ml 保温杯）只写了一张资料卡，加了一个认证名的识别；回复提示词里的工厂品类从资料卡读。保温杯的上架、文案体检、询盘回复都录了回放，原工厂的请求一字不变（有测试逐条回放保证）。
- **新增商品**：商品看板“新增商品”，填资料卡（已有 / 没有的认证、材料宣称、MOQ、FOB 价格阶梯、规格、卖点），可从现有商品复制；存在 `app/state/custom_products.json`（不进仓库），上架、体检、询盘、看板都能用。示例商品不能改（录好的结果要保持能回放）。新商品要在实时模式下生成。
- **CSV 导入询盘**：收件箱“导入 CSV”，有一列询盘内容即可（列名中英文都认，逗号 / 分号 / Tab 分隔），可写产品列，重复的跳过；示例文件在 `app/static/samples/inquiries-sample.csv`。导入的是新内容，要在实时模式下整理和回复。
- **规则出处自检**：`python3 tools/check_rule_sources.py`（或知识库页“重新抓取出处”）重新抓取每条规则的官方页面，看原文还在不在。10-31 结果：61 条中 24 条原文仍在，35 条是脚本页面或 PDF（程序看不到正文，建档时已人工逐字核对），2 条网站拒绝程序，0 条没找到。
- **智能体配置页**：界面里看 6 个智能体和 11 个上架角色的职责、输入、输出、护栏和提示词全文，按工作流标出哪步是模型、哪步是代码；和 `app/config/agents.json` 是同一份配置。
- **实时验证新输入**：开摊自检页随机生成一条没录过的询盘，真调用模型走完理解 → 回复 → 审核（3 次调用，不读也不写缓存），结果和耗时记在 `app/state/live_checks.json`，也写进调用日志。
- **现场实测人工用时**：评测页“降本测算 → 现场实测”，计时或填分钟，按“人工回一条 / 用 TradeDesk 生成 + 复核”分开记，显示中位数和 n；只有点“用实测替换假设”才会进入测算，算式里标明哪些是实测。
- **真实使用度量**（11-01 赛后，按现场交流的建议加）：询盘回复结果下方的“业务员确认”记下这版最后怎么处理（原样发出 / 改后发出 / 没用）、每条提示有用还是误报、资料卡缺什么、用了几分钟；TradeDesk 不替人发送。评测页“真实使用”只用这些记录算采纳率、改动比例、提示有用率、误报最多的规则和资料卡最常缺的信息，可导出 CSV；不放示例数据，记录存在 `app/state/feedback.json`（不进仓库）。
- **编排与终止条件**：智能体之间不互相调用，由代码按固定步骤调用，跑完就停；下一轮只在人提交修改意见时开始，最多 5 轮，超过后代码拒绝再生成；单次调用有超时，网络错误最多尝试 3 次；每轮最多几次模型调用写在智能体配置页，有测试按真实调用次数核对。
- **开摊自检**：把 13 步演示路径在回放模式下离线走一遍，检查模型模式、知识库、出处自检、本地数据；“一键预热”把演示路径回放进看板和收件箱。
- **六个市场**：除美国、墨西哥外，示例询盘还覆盖欧盟（德国，德语）、日本（日语）、哈萨克斯坦（欧亚经济联盟，俄语）、尼日利亚（英语）。市场按询盘标注的国家判断，各市场的认证要求（CE / RoHS、PSE、EAC、SONCAP）写在 `app/data/markets.json`，只并入该市场的提示词和代码校验，美国、墨西哥的请求一字不变（有测试用录好的缓存逐条回放来保证）。
- **语音输入**：询盘原文和中文意图、修改意见旁边有麦克风按钮，由浏览器把语音转成文字（Chrome / Edge，需联网，音频发到浏览器的语音服务，不经过模型）。
- **自动演示**：右上角一键播放 12 步带字幕的走查，`#tour=loop` 可在摊位循环播放。
- **角色模式**：打开 `#roles`（或点右上角“选角色”），评委选“商户 / 合规审查员 / 消费者”，左边只留这个角色用得到的页面，顶部步骤条逐步执行真实操作；三条线在回放模式下都能离线走完。
- **游园会找茬**：`python3 server.py --lan` 后手机扫码答题，答案由代码规则计算；局域网访问只开放找茬页面，其余接口一律 403。
- **工作流 C · 商品看板**：所有产品 × 主图 / Amazon / TikTok 的最新状态一屏看清；一键批量生成上品，导出 CSV。主图按 Amazon 美国站的 10 条要求检查：尺寸、白底、产品占比、是否贴边由代码测量，文字、徽章、道具、是否实拍由模型看图判断。
- **工作流 B · 多平台上架**：一份中文产品资料，可选 Amazon 美国 / 英国 / 德国 / 日本站、TikTok Shop 墨西哥、eBay、Shopify、Etsy、Walmart 美国站、Mercado Libre 墨西哥和 AliExpress；每个平台可单独选择英语、西班牙语、中文、德语、日语或俄语。Amazon 美国站与 TikTok 墨西哥保留原有请求、专属文案格式和已核实规则；其他平台使用各自提示词与岗位、通用 Listing 格式及产品事实校验，未核实的平台政策不会被冒充为已核实。
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
LLM_ENDPOINT=https://api.tokenhubcloud.net/v1
LLM_MODEL=...
```

任何 OpenAI 兼容的 Chat Completions 接口都可以用。赛事赞助的 Tokenhub 填到 `/v1` 即可，程序会补上 `/chat/completions`。模型名因 key 而异，用"模型设置"里的「查可用模型」从列表里选（等同于调用 `/v1/models`）。

现场用的就是这条路：赛事发的 Tokenhub key 属于 Codex 周卡分组，`/v1/models` 里只有 GPT 系列。2026-10-30 用 `gpt-5.5` 实测跑通工作流 A（3 次调用，共 22.3 秒，记录见 `docs/demo-runs/live-gpt-5.5-INQ-US-01.json`）。

也可以用 Claude（Anthropic 官方 SDK，`pip install anthropic`）：

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
LLM_MODEL=claude-opus-5-5
# 走赛事 Tokenhub 时加上这一行（不带 /v1），key 用 Tokenhub 的 key，按 Bearer 方式发送：
# ANTHROPIC_API_BASE=https://api.tokenhubcloud.net
```

注意：赛事这把 key 走 Claude 路线时，请求 `claude-opus-5-5` 也会"成功"，但网关实际换成了 GPT（回答自称 ChatGPT，返回 id 以 `resp_` 开头）。现场请用上面的 OpenAI 兼容方式。

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
python3 -m unittest discover -s tests -v             # 测试
python3 tools/cost_report.py                         # 每条询盘的调用成本（先跑 record_demo 生成日志）
TRADEDESK_MODE=replay python3 tools/run_baseline.py  # 对照实验（缓存齐全时不联网）
TRADEDESK_MODE=replay python3 server.py --lan        # 游园会：手机扫码访问 /play，大屏打开 /play#screen
python3 tools/export_config.py                       # 导出平台配置 → app/config/agents.json
```

要准备多平台 Listing 的离线回放缓存，先在应用「模型设置」配置可用模型与 key，再从 `app/` 目录按产品、平台、语言小批量预览/录制：

```bash
python3 tools/warm_listing_cache.py                                      # 只预览全量规模，不调用模型
python3 tools/warm_listing_cache.py --product KET-17S --platform ebay --language zh  # 单组合预览
python3 tools/warm_listing_cache.py --product KET-17S --platform ebay --language zh --execute
```

`--execute` 会真实调用模型并可能产生费用；每个组合会录制生成结果及适用的模型审核。全部 4 个示例产品覆盖 11 个平台和 6 种语言，最多约 312 次请求（264 次生成与至多 48 次审核，已有缓存命中会减少调用）。缓存只适用于完全相同的产品资料、平台、语言、提示词和首轮请求；修改资料或提交新一轮修改不会自动命中。录制完成后使用 `TRADEDESK_MODE=replay` 离线回放。

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
  tradedesk/cost.py      从调用日志统计每条询盘的 token 与费用
  tradedesk/handoff.py   询盘回复 → 上架文案的交接核对（代码）
  tradedesk/importer.py  CSV 导入询盘
  tradedesk/catalog_edit.py 新增 / 编辑商品资料卡
  tradedesk/sources.py   规则出处自检（重新抓取来源页）
  tradedesk/selfcheck.py 开摊自检、一键预热
  tradedesk/config_export.py 智能体与工作流配置（界面和导出共用）
  data/redteam.json      红队测试的注入样例
  prompts/*.md           各角色提示词（含主图审核员、对照组的通用助手）
  kb/rules.json          规则知识库（61 条，每条带原文摘录与来源 URL）
  config/check_map.json  内置检查 → 依据的知识库规则
  config/agents.json     平台配置导出
  data/                  两家示例工厂、5 个产品、13 条询盘、各市场认证状态、文案体检示例、3 道找茬题（虚构）
  static/samples/        示例主图（示意图，不是实拍照片）
  static/                网页界面（设计规范移植自 shadcn/ui，图标 Lucide，全部本地文件）
  tests/                 单元测试
eval/                    （在 app/ 下）开发集、两份盲测集、首次运行冻结记录
docs/                    交付文档（方案说明、配置与调用说明、演示说明、数据来源说明、路演稿、路演问答、摊位讲解稿、海报）
```

## 诚信说明

- 示例工厂、产品、询盘、买家都是**虚构的**，不对应任何真实企业或个人。示例主图是用程序画的示意图，系统会把它们判为"不是实拍照片"。
- 知识库里的每条规则都附有原文摘录和来源链接，抓取日期为 2026-10-26。没有对照原文核实过的规则**不参与检查**。规则以来源页面的最新版本为准，本工具不构成法律或合规意见。
- 开发过程中使用了 AI 编程助手辅助编写代码和文档。
- 第三方组件见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 许可

MIT

## 浏览器插件（原型）

`extension/` 是一个 Chrome / Edge 插件原型：在 WhatsApp 网页版、Facebook 或任何网页里选中一段回复，右键“TradeDesk 发出前检查”，用本机的 TradeDesk 检查（也可以把回复粘贴进插件窗口）。插件只做检查，不会替你发送消息。

1. 启动 TradeDesk（见上），打开“开摊自检”页，记下“浏览器插件”卡片上的配对码。
2. 浏览器打开 `chrome://extensions`，打开“开发者模式”，点“加载已解压的扩展程序”，选 `extension` 文件夹。
3. 点插件图标 → “设置”，填配对码。

只有带本机配对码的插件请求能调用 `/api/check` 和 `/api/plugin/meta`，其他网页和其他接口照旧返回 403（配对码存在 `app/state/plugin_code.txt`）。默认只跑代码规则，不花额度；勾选“加上模型审核”且工作台在实时模式时才调用模型。
