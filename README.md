# A Little Further, Together

A separate, mobile-first interactive storybook proposal for Saanvi. The existing CRIMSON `../index.html` is preserved as-is.

## Run locally

From this directory, run `npm install`, then `npm run dev`. Open the local URL Vite prints (usually `http://localhost:5173/`). The experience is a standalone Vite app and can also be built with `npm run build`; use `npm run preview` to preview the production build.

## Personal copy

The editable letter is centralized in `src/content.js`. Its paragraphs are supplied draft copy, not represented as a transcript. That file also holds the short story and ending lines. The mirror quotation is rendered exactly as supplied in `src/main.jsx`.

## Notes

Responses stay local to the page; there is no messaging, tracking, or audio. Motion respects the reduced-motion preference and the full copy is rendered in the page's reading order.
