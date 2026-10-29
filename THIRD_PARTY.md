# 第三方组件声明

| 组件 | 用途 | 许可 / 说明 |
|---|---|---|
| Python 标准库（http.server、urllib、json、difflib、unittest 等） | 服务端、HTTP 调用、逐词对比、测试 | PSF License |
| [shadcn/ui](https://github.com/shadcn-ui/ui) 的设计 token（zinc 主题的颜色、圆角、阴影）和组件样式 | 界面视觉规范；移植成原生 CSS（`app/static/style.css`），没有引入 React 或 Tailwind | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) 图标（lucide-static 0.468.0，40 个） | 界面图标，打包为本地 SVG sprite（`app/static/icons.svg`） | ISC，许可原文见 `app/static/LUCIDE-LICENSE.txt` |
| Pillow（可选） | 主图像素测量（尺寸、白底、占比、贴边） | MIT-CMU（HPND） |
| Anthropic Python SDK（`anthropic`） | 选用 Claude 作为模型时调用 Messages API；只在 `LLM_PROVIDER=anthropic` 时导入 | MIT |
| 大模型接口（OpenAI 兼容 Chat Completions 或 Claude Messages API；默认地址是赛事赞助的 Tokenhub `api.tokenhubcloud.net`，模型名以 key 能用的列表为准） | 理解、生成、合规审核 | 按服务商条款调用，代码里不含任何密钥 |
| 规则知识库里引用的公开页面（见 `app/kb/rules.json` 和 `app/kb/SOURCES.md`） | 规则出处 | 只引用简短原文摘录并附链接，版权归原网站所有 |

前端没有使用任何框架、CDN、字体文件或第三方脚本：原生 HTML、CSS、JavaScript，图标和样式都在本地，断网也能正常显示。
