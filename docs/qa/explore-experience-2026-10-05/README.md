# Explore browser-preview QA

This folder contains a small renderer plus preserved `before` and `after` screenshots/reports. It reads the current Explore WXML, Page data, and WXSS (including CSS imports), and expands the page's knowledge-scene template branches. Route checks compare source `href` values after intercepted click events; they do not open destination pages. The report labels every result `browser-preview`; its viewport represents page content without native navigation or tab bars.

Run the full 320/375/430 light/dark capture:

```powershell
node docs/qa/explore-experience-2026-10-05/render-explore.cjs --label=after
```

Run only the 375px light capture:

```powershell
node docs/qa/explore-experience-2026-10-05/render-explore.cjs --label=after --widths=375 --themes=light
```

Run the two compact content viewports in both themes:

```powershell
node docs/qa/explore-experience-2026-10-05/render-explore.cjs --label=after-small-320x480 --widths=320 --height=480
node docs/qa/explore-experience-2026-10-05/render-explore.cjs --label=after-small-375x568 --widths=375 --height=568
```

Serve the current Explore page at a local URL:

```powershell
node docs/qa/explore-experience-2026-10-05/render-explore.cjs --serve
```

These are browser-preview results, not WeChat simulator or device results.
