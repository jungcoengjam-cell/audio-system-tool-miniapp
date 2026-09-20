# Apple iOS 26 Liquid Glass Design System

## Purpose

本文件是本微信小程序的 UI 设计语言规范，约束视觉表现与界面交互体验。

Design language: Apple iOS 26 inspired Liquid Glass.

Goals:
- Premium
- Clear hierarchy
- Content first
- Functional glass
- Responsive
- Accessible

## Core Rules

1. Liquid Glass 仅用于有功能意义的浮层。
2. 不要让每个组件都使用玻璃效果。
3. 保持可读性、可用性和性能。
4. 不复制 Apple 商标或专有资源。

## Glass Usage

Use glass for:
- Navigation bars
- Tab bars
- Toolbars
- Floating buttons
- Search controls
- Sheets
- Context menus

Avoid:
- Glass everywhere
- Multiple blur layers
- Decorative reflections

## Typography

Use system fonts:

```text
-apple-system,
BlinkMacSystemFont,
SF Pro Display,
SF Pro Text,
Helvetica Neue,
Arial
```

Prioritize:
- Large readable titles
- Clear hierarchy
- Limited font weights

## Colors

Accent:
`#007AFF`

Light background:
`#F5F5F7`

Dark background:
`#000000`

Glass light:
`rgba(255,255,255,0.58)`

Glass dark:
`rgba(24,24,27,0.58)`

## Geometry

Rounded continuous shapes.

Radius:
- 10px
- 14px
- 20px
- 28px
- 999px capsule

## Components

交互组件按实际能力提供适用状态，例如 Default、Pressed、Disabled、Loading、Focused；需要时提供 Error 状态。

Touch target:
minimum 44x44

- Primary actions use a blue fill; secondary actions use a soft neutral or light blue fill.
- Ordinary buttons should not use a prominent outline; use spacing to keep adjacent actions distinct.
- Buttons in the same row share a height, use `box-sizing: border-box`, and remain at least 44px tall.
- Generation, copy, favorite, and project actions share the public `result-image-button`, `copy-result-button`, and `result-record-button` geometry; output and record rows use two equal columns with a 10px horizontal gap and a 10px vertical gap.
- These four result actions use `height: 88rpx`, `min-height: 44px`, `font-size: 27rpx`, `font-weight: 600`, `border-radius: 22rpx`, and `box-sizing: border-box`; keep at least 32rpx of viewport-side space and do not override this geometry per page.

## Motion

Recommended:

Button feedback:
100-160ms

Navigation:
240-360ms

Sheets:
300-450ms

Support reduced motion.

## Accessibility

Ensure:

- Text contrast
- Large text support
- Clear labels
- Keyboard support
- Safe touch areas

If glass reduces readability:
increase opacity or replace with solid surface.

## WeChat Mini Program

When adapting:

- Use rpx
- Respect safe areas
- Provide blur fallback
- Avoid heavy blur effects

## Final Direction

Clear content
+ functional glass
+ precise typography
+ smooth motion
+ accessibility

= Apple iOS 26 inspired Liquid Glass experience
