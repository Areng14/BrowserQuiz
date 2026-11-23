---
name: arenguidesign
description: Arreng's UI design rules for building or changing any user interface (pages, screens, dialogs, tables, forms, menus, reports) - no slogans or taglines, no pill or badge statuses, one consistent set of control sizes and spacing, no scrolling unless the content needs it, few visible buttons with the rest under a menu, layouts anyone can pick up without help, and balanced alignment with breathing room. Use whenever you design, build, restyle, clean up or review UI, even small changes like adding a button, a column or a dialog, and before calling any UI work done.
---

# arenguidesign: good UI, the Arreng way

The goal is UI that someone picks up and uses without being told how, and that looks calm and
deliberate. Every rule here serves that. When a rule and the goal disagree, the goal wins, but
say why.

Work in this order: **cut, then arrange, then polish, then verify.** Most bad UI has too much on
it, so removing things comes before styling them.

## 1. Words: let the UI speak

- **No slogans, taglines or explainer lines** under headings, buttons, fields or dialogs. Add one
  only when the point really can't be made by the UI itself, like a consequence the screen can't
  show ("You can't come back to change these answers.").
- **No text that repeats what's on screen.** A heading "Students" over a list of students needs no
  "Here are your students".
- **Labels are short and concrete.** Buttons are verbs that say what happens: "Start quiz",
  "Remove", "Add a passkey". Not "Submit", "OK", "Go".
- **One name per thing.** If it's "Un-invalidate" in one place, it's "Un-invalidate" everywhere,
  never "Restore" somewhere else.
- **Errors sit next to what caused them** and say how to fix it, in plain words.
- **Empty states are one short line** ("None found."), not a paragraph.

## 2. Status: plain text, never pills

- **No pills, chips, badges or tags** for a status. Show it as plain text, colored only when the
  color carries meaning (red for bad, green for done), e.g. `Invalidated` in red, `Clean` in green.
- **Color never works alone.** A colored bar or dot also says it in words, as a label or a
  tooltip, and for screen readers.
- A small count next to a nav item is fine (a number, not a decorated tag).

## 3. Consistency: one system everywhere

- **One height per control size.** Buttons, selects, inputs and menu buttons that sit in a row are
  the same height. Pick from a fixed set (e.g. 40px regular, 34px small) and never mix sizes in one
  row. A dropdown next to a button is the same height as the button.
- **One spacing scale**, e.g. 4, 8, 12, 16, 24, 32, 48. Gaps between siblings are equal. Don't
  invent 13px or 22px.
- **One radius, one border color, one shadow** per kind of surface (cards, menus, dialogs).
- **One type scale.** A page has one h1. Sections use the same heading size everywhere.
- **Reuse what exists.** Before making a component, find the one the app already has (its button,
  its menu, its dialog, its table) and use it. Two ways of doing the same thing is a bug.
- **Same pattern, same place.** If rows end with their actions on the right, every list does.
  If the primary button is first, it's first everywhere.

## 4. No scrolling unless needed

- **Fit the screen.** A page that can fit the viewport should not scroll. Work out fixed chrome
  (bars, headers) and let the content take exactly the rest.
- **When content is long, scroll the content, not the page.** Side-by-side panes each get their
  own scroll, and the frame around them stays put.
- **Never a sideways scroll** on the page, at any width down to a phone (360px). Long names are
  cut short with "…" and the whole thing on hover; long code scrolls inside its own box.
- **Don't nest scrollbars** when one will do.

## 5. No clutter: few buttons, the rest one tap away

- **Show only what's needed now.** A row or a toolbar shows its one or two most likely actions.
  Everything else goes under a `⋯` menu (or "More"), which keeps its place while things update.
- **One primary action per screen or dialog**, visually stronger than the rest.
- **Destructive actions** (Delete, Reset) live in the menu, in red, and ask before acting, in the
  app's own dialog, not the browser's.
- **No duplicate paths.** If a list lives in its own tab, don't repeat it on another page.
- **Fold away what's rarely used** (advanced options in a collapsed section), and open it on its
  own when it's in use.
- **Remove columns and fields nobody acts on.** If two columns say the same thing, merge them
  ("3 · 0:06" instead of separate Strikes and Time away columns).

## 6. Easy to pick up

- **Familiar patterns over clever ones:** a sidebar for places, a table for records, a dialog for a
  decision, a menu for extra actions.
- **The next step is obvious.** The main action is the most visible thing. Disabled states say why
  through the UI, not a paragraph.
- **Good defaults.** The common choice is already selected.
- **Ask before anything that can't be undone**, and say what will happen in one sentence.
- **Keyboard and screen readers work:** every control is reachable with Tab, visible focus rings,
  menus with arrow keys and Escape, labels on icon-only buttons, dialogs that trap focus and give
  it back.
- **Phones count.** At phone width the layout stacks, rows keep only what needs doing now, and
  touch targets are at least 40px.
- **Dark mode counts.** Use the app's color tokens, never hard-coded colors, and check it.

## 7. Balance and breathing room

- **Align to edges.** Things in a column share a left edge; things in a row share a center line
  (or a baseline for text). A section under a form lines up with the form.
- **Nothing "slightly off".** No box a few pixels lower than its neighbor, no gap a little bigger
  on one side. If it's meant to be centered, it's exactly centered.
- **Breathing room.** Sections get clear space between them (24-48px), more than the space inside
  them, so groups read as groups. Don't pack things edge to edge.
- **Even weight.** Don't put all the visual weight on one side; balance a heavy left with something
  on the right, or center it.
- **Same width for things that stack.** A list under a form is the form's width, not its own.
- **Line lengths stay readable** (about 60-80 characters for prose).

## 8. Verify before calling it done

Look at it, don't just reason about it:

1. **Screenshots** at desktop (1440x900), small laptop (1280x800) and phone (390x844), in light and
   dark mode. Read them like a user seeing it for the first time.
2. **Measure, don't eyeball,** the things that should match. In Playwright:

   ```js
   // controls in one row: same height, same vertical center
   const row = await page.$$eval('.toolbar > :is(button, select, input, a)', (els) => els.map((e) => {
     const r = e.getBoundingClientRect();
     return { h: Math.round(r.height), mid: Math.round(r.top + r.height / 2) };
   }));
   // no sideways scroll
   const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
   // page scrolls only if the content needs it
   const scrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight);
   ```
3. **Check the checklist:**
   - [ ] No taglines or explainer lines the UI could have shown instead
   - [ ] No pills, badges or tags for status
   - [ ] Every control in a row is the same height and lines up
   - [ ] Spacing comes from the scale; sibling gaps are equal
   - [ ] No page scroll that isn't needed; no sideways scroll at 360px
   - [ ] At most two or three visible actions per row or bar; the rest under `⋯`
   - [ ] One clear primary action; destructive ones confirm and are red
   - [ ] Edges align; nothing is a few pixels off; sections have breathing room
   - [ ] Keyboard, focus, screen-reader labels, dark mode and phone width all work
   - [ ] Names and patterns match the rest of the app

If a project has its own UI rules (an AGENTS.md or CLAUDE.md), follow both; where they conflict,
the project's rules win.
