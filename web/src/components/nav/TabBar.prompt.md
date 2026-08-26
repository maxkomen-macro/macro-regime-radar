# TabBar
Primary navigation. Text tabs on a hairline rule with a 2px accent underline on the active one.

```jsx
<TabBar tabs={["Dashboard","Intelligence","Markets"]} active={tab} onChange={setTab} />
```

- Labels are title case and short. The real product runs eleven of them; scroll rather than wrap.
- Never use pills, boxes or background fills for tabs.
- `touch` on narrow viewports (<768px) raises each tab to a 40px hit area — padding only, so the
  active underline still sits on the rule. Drive it from `useBreakpoint().isNarrow`.