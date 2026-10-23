# AnyDesk Web Client — real session launcher + WebRTC viewer

An install-free page that takes an AnyDesk address and does the two things a web
page actually can:

1. **Launch a real AnyDesk session** by handing the address to your installed
   client through the documented `anydesk:<address>` URL handler.
2. **Fall back to a browser session** — one side shares a screen, the other
   watches it live over WebRTC (view-only).

**Live:** https://methylphetamine.github.io/anydesk-web-client/

> **Not affiliated with AnyDesk GmbH.** There is no public protocol a third-party
> web page can use to open a session to an arbitrary AnyDesk ID — their transport
> is closed and encrypted end-to-end, and their own browser client
> ([my.anydesk II](https://my.anydesk.com/)) requires an account. Anything that
> asks you to type your AnyDesk password into a web form is phishing. This page
> never asks for one.

## What actually happens when you press Connect

```
you type 123 456 789
        │
        ├─ "Open in AnyDesk" ──►  anydesk:123456789
        │                          └─ OS hands off to the installed app
        │                             (accept prompt / unattended password
        │                              stays inside AnyDesk)
        │
        └─ "Watch" + access code ──►  PeerJS broker (signalling only)
                                      └─ RTCPeerConnection, media P2P
                                         host: getDisplayMedia()
                                         viewer: <video>, view-only
```

If no handler is registered, the browser stays put and the page offers a copy
button, the download link and the official web client instead.

## Features

| | |
|---|---|
| **Address handling** | 9–10 digits formatted as `123 456 7890`, or aliases like `desk@company` |
| **Real handoff** | `anydesk:<address>` — the same handler AnyDesk documents for links and my.anydesk |
| **Fallback viewer** | Real `getDisplayMedia()` → WebRTC → `<video>`, no relay |
| **Access code** | Six digits, checked by the host before media is sent; 8 failed attempts/minute locks it |
| **Live stats** | RTT, fps, resolution, bitrate, codec and candidate route from `getStats()` |
| **Quality control** | Speed / Balanced / Quality → `sender.setParameters({ maxBitrate })` |
| **Chat + fullscreen** | Data-channel chat, `F` fullscreen, `Esc` disconnect |
| **Deep link** | `#desk/123456789` or `#desk/123456789/123456` |
| **Mobile** | Viewer works on phones; screen capture stays desktop-only |

No build step, no framework, no analytics. One vendored dependency (PeerJS, MIT).

## Why not just "connect to any AnyDesk ID"?

Because it is not possible from a web page:

- AnyDesk's protocol is proprietary and mutually authenticated; there is no SDK
  for third-party browser clients and no public endpoint to dial an ID.
- Even AnyDesk's own web client is account-bound and runs on their infrastructure.
- A browser cannot inject mouse/keyboard into another OS, so "control" is off the
  table regardless.

The handoff is the real, supported integration point. The WebRTC path covers the
"neither side can install anything" case honestly, as a viewer.

## Run locally

ES modules need HTTP:

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Test the launcher on a machine with AnyDesk installed. Test the viewer with two
tabs: *Start sharing* in one, paste the address + code into the other.

## Structure

```
index.html                  home / sharing / session views + documentation
assets/css/app.css          design tokens and layout
assets/js/app.js            launcher, PeerJS host/viewer, stats, chat
assets/vendor/peerjs.min.js PeerJS 1.5.5 (MIT)
.github/workflows/pages.yml GitHub Pages deployment
```

## Deploy

Push to `main`; the workflow uploads the repo as a Pages artifact.

```bash
gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow
```

## Security notes

- The launcher constructs a URL; it never reads, stores or transmits credentials.
- Browser media is DTLS-SRTP encrypted. The broker sees signalling, not frames.
- The access code gates media, not the address alone. Still: treat the code like
  a meeting link, and self-host PeerJS if you depend on this.
- Strict NATs need a TURN server; the default config uses public STUN only.

## Licence

MIT — see [LICENSE](LICENSE). PeerJS is MIT, © its authors. "AnyDesk" is a
trademark of AnyDesk Software GmbH, used only to describe compatibility.
