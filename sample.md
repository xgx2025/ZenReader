---
title: 静夜思·禅读小引
author: 佚名
tags: [禅, 阅读, 测试]
date: 2026-08-27
---

# 静夜思

床前明月光，疑是地上霜。举头望明月，低头思故乡。

这是一段**中英混排**的测试文本。ZenReader is a zen reading app. It renders *markdown* beautifully and quietly.

## 目录测试

### 关于排版

> 做减法，是禅阅读的第一要义。

- 心流
- 慢思考
- 数字侘寂

1. 第一
2. 第二
3. 第三

- [x] 完成导入
- [ ] 完成划线笔记
- [ ] 白噪音（后续）

~~删除线测试~~ 与普通文本并存。

## 代码块

```js
function greet(name) {
  return `你好, ${name}`
}
console.log(greet('禅'))
```

```python
def zen(s):
    return f"静 · {s}"

print(zen("心流"))
```

## 表格

| 配色 | 名称 | 用途 |
| --- | --- | --- |
| #f7f2e9 | 宣纸白 | 背景 |
| #2b2a27 | 墨黑 | 正文 |
| #5f7a5c | 竹青 | 点缀 |

## 公式（LaTeX / KaTeX）

质能方程 $E=mc^2$ 简洁优雅，与中文自然混排。

行间公式：

$$
\int_0^\infty e^{-x^2}dx = \frac{\sqrt{\pi}}{2}
$$

对齐环境：

$$
\begin{aligned}
a &= b + c \\
d &= e \times f
\end{aligned}
$$

公式里的错误写法 $\frac{1}{2$ 会降级为红字源码，不会让整卷崩坏。

## 引用与脚注

这是一段带有脚注的文本[^1]。

[^1]: 这是脚注的内容，用于验证 markdown-it-footnote。

![宣纸](https://picsum.photos/seed/zen/800/400)

## 结束语

静，而后能安；安，而后能虑。愿你在阅读中，见本心。
