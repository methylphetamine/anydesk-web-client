# AnyDesk Web Client — unofficial demo

A single-page, install-free **remote desk console** you can host on GitHub Pages.
Enter a nine-digit address, watch the handshake, then land in a session with a
mirrored desktop, quality control, in-session chat and live counters.

> **This is a front-end demo, not a working AnyDesk client.**
> It is not affiliated with, endorsed by, or built from AnyDesk GmbH code or
> protocol details. AnyDesk's protocol is proprietary and needs their native
> agent; a static web page cannot open a real session. Everything on screen —
> the connection, the remote desktop, the statistics, the chat — is generated
> locally by JavaScript. No network requests are made, nothing you type leaves
> the tab, and no credentials are collected or stored.

**Live site:** https://methylphetamine.github.io/anydesk-web-client/

## What's in the box

| | |
|---|---|
| **Address entry** | 9-digit validation, live grouping, paste, random generator |
| **Local identity** | Your own demo address, generated once and kept in `localStorage` |
| **Handshake screen** | Staged progress with resolving / negotiating / attaching states |
| **Remote screen** | Procedural desktop painted on `<canvas>` — no video, no sockets |
| **Session chrome** | Latency, uptime, resolution, fps and bitrate tickers |
| **Quality modes** | Speed / Balanced / Quality change the canvas backing resolution |
| **Chat** | Local echo with canned replies, marked as a demo |
| **Shortcuts** | `Ctrl/⌘ K` focus address · `↵` connect · `F` fullscreen · `Esc` disconnect |
| **Deep link** | `#desk/123456789` jumps straight into a session |
| **Recent sessions** | Last four addresses, stored locally, clearable |

Zero dependencies, zero build step, no fonts or scripts from third parties.

## Run it locally

Any static file server works — ES modules need `http://`, not `file://`:

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

## Structure

```
index.html                  views: connect / connecting / session + docs sections
assets/css/app.css          design tokens and all styling
assets/js/app.js            state machine, forms, drawers, ticker, shortcuts
assets/js/remote-screen.js  canvas renderer for the simulated desktop
assets/img/favicon.svg      mark
.github/workflows/pages.yml GitHub Pages deployment
```

## Deploy

Pushing to `main` triggers the workflow, which uploads the repository as a Pages
artifact. To enable it from scratch:

```bash
gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow
```

Then `Settings → Pages → Source: GitHub Actions` (same thing via UI).

## Make it real

The UI is deliberately separated from transport. To drive a genuine
browser-to-browser session:

1. Replace the `startConnect` timers in `assets/js/app.js` with a signalling
   exchange (WebSocket/SSE) and an `RTCPeerConnection`.
2. Capture the host screen with `getDisplayMedia()` and push the track to the
   viewer.
3. Feed `RTCPeerConnection.getStats()` into `startTicker()` instead of the
   generated numbers, and point the canvas at the incoming `<video>` element.
4. Add authentication and consent on the host side — remote control without an
   explicit accept prompt is a security hole, not a feature.

For actual AnyDesk sessions, use [AnyDesk's official clients](https://anydesk.com/en/downloads).

## Licence

MIT — see [LICENSE](LICENSE). "AnyDesk" is a trademark of AnyDesk Software GmbH,
used here only to describe what this demo is modelled after.
