# Arcy Workspace design

Use `.agents/skills/design-taste-frontend/SKILL.md` as a reference for relevant redesign guidance. Upstream: https://github.com/Leonxlnx/taste-skill, skill blob `b72132fcd466da605623ffe96e370b3991fc5285` (MIT).

Arcy is a personal productivity application. Preserve its data flows and existing React, Tailwind, shadcn, and Lucide foundation. Apply Taste's typography, spacing, interaction, and theme consistency guidance without adding marketing layouts to product screens.

- Direction: calm, minimal workspace with restrained green accents.
- Dials: design variance 4, motion intensity 3, visual density 5.
- Corners: 12px surfaces, 8px controls, circular avatars.
- Keep account actions and appearance controls in the left sidebar.
- Keep the sidebar toggle visible on desktop and mobile; remember the desktop preference.
- Use English for interface labels, help, notifications, errors, and generated search summaries. Preserve user-authored content and imported source text.
- Support light and dark themes, keyboard navigation, reduced motion, and mobile layouts.

Apply `.agents/skills/ponytail/SKILL.md` in full mode for coding work. Reuse existing components, prefer native browser features, and remove unused code before adding abstractions. Preserve validation, data-loss protection, security, and accessibility. Upstream: https://github.com/DietrichGebert/ponytail (MIT).
