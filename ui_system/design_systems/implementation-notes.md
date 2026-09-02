# Implementation notes

- Import tokens from this directory into both applications.
- Adapt public MIT beUI source patterns rather than installing a runtime beUI package.
- Use Radix for dialogs, menus, tooltips, and accessible overlays.
- Use Motion from `motion/react` and honor `useReducedMotion`.
- Use Recharts inside a fixed-size accessible shell.
- Use Lucide icons with a consistent 1.75 stroke width.
- Verify 320, 375, 768, 1024, 1280, and 1440px widths.
- Search for conflicting legacy CSS and the em dash character before release.
- User-selected direction: Black Vector. Detailed implementation decisions were agent-selected under the approved plan.
