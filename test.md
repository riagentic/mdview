# Hello mdview 👋

A **lightweight** markdown viewer built with [aio](https://github.com).

## Features

- GitHub-flavored markdown rendering
- Syntax highlighting for code blocks
- File open dialog
- Clean, minimal UI

## Code Example

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`
}

const message = greet("world")
console.log(message)
```

```python
def fibonacci(n: int) -> list[int]:
    """Generate fibonacci sequence."""
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result
```

## Table

| Feature | Status |
|---------|--------|
| GFM | ✅ |
| Code blocks | ✅ |
| Tables | ✅ |
| Task lists | ✅ |

## Blockquote

> "The best way to predict the future is to invent it."
> — Alan Kay

## Task List

- [x] Parse markdown
- [x] Style like GitHub
- [x] Syntax highlighting
- [ ] Dark mode (maybe later)

---

*Built with aio framework* 🚀
