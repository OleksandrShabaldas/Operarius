@AGENTS.md

When publishing on github, publish only from my account, so my account is the only contributor.

When scaling versions, follow the system of x.y.z (e.g. 1.0.0), when doing general fixes or changes across the same screen scale only version z (e.g. 1.0.1, 1.0.2, 1.0.3, ...) with max of number 9 after that scale number y (e.g. 1.0.9 => 1.1.0), when adding a whole new screen or a massive feature scale number y directly while resetting x to 0 (e.g. 1.1.3 => 1.2.0), scale number x only when y reached 9 (e.g. 1.9.9 => 2.0.0).

Every action, any action (such as opening screen, showing/hiding popup, clicking button, etc.) must be follow by an animation, not the cheap one but rather something that feels smooth and premium, ideally animate every element separately.

# Depth over minimum — how to implement anything here

Do NOT implement the literal request and stop. For every feature, fix, or change, first think it through like a senior product designer + engineer, then build to that standard:
- **Analyze the real need**: what the user actually wants, how it should behave and look, and the UI/UX principles that apply.
- **Design the whole thing**: structure and visual hierarchy (sections, delimiters, icons, spacing), premium per-element motion, and every state — empty, loading, disabled, error, validation, overflow, past/future, etc.
- **Cover the connected must-haves**: the adjacent details a polished app of this kind is expected to have (e.g. a required-field guard, gesture affordances that actually work, greying past items, reflecting a feature across every screen it touches). Ship those in the same pass.
- **Match the best comparable apps**, not "good enough to fit on screen." Use the theme tokens, correct shadows/colors, and real gestures/haptics.
- **Proactively fix related issues** you notice while working, and after finishing, audit the rest of the app for the same class of problem instead of waiting to be told.

The user considers this level of thought the default expectation, not extra. Half-effort work that merely "fits and works" is not acceptable.