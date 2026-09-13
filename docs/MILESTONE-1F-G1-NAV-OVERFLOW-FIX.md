# Navigation overflow regression fix

Date: 2026-09-13  
Branch: `fix/indelitech-nav-overflow`  
Baseline: `22df9c1d1c7fa1e4fb931a4cc9ee5ef66827a703`

## Problem

The Indelitech workspace has six desktop navigation tabs. When the available nav track became narrower than the tab row, `.main-nav` combined horizontal scrolling with `justify-content: center`. Centered flex overflow could place content beyond both scroll edges, leaving the first `Today` tab and last `Settings` tab partially clipped.

## Fix

- Add a desktop-only navigation overflow guard.
- Allow the nav grid item to shrink with `min-width: 0`.
- Replace unsafe centered overflow with collapsible before/after flex spacers: the row remains visually centered while space exists, then falls back to a reachable leading edge when it does not.
- Keep individual buttons non-shrinking and horizontally scrollable.
- Slightly reduce Indelitech tab padding without hiding labels.
- Leave the existing mobile menu behavior unchanged.

## Boundaries

- No workspace-routing changes.
- No task, Calendar, Today, Intel, MCP, D1, Access, or collector changes.
- No files under `upload/`.

## Validation

Static regression coverage verifies the stylesheet is loaded, desktop overflow uses a reachable leading edge, centering spacers collapse safely, tab buttons do not shrink, and Indelitech labels are not hidden.
