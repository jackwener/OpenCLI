# Remote Orchestration

Run an OpenCLI command from a remote machine (a CI runner, an agent server, a sandbox) while the **browser session stays on your local laptop**. The remote command sees `localhost:19825` like usual; behind the scenes, traffic is tunneled back to the daemon and Chrome on your machine.

## When you need this

- An autonomous agent (OpenClaw, a CI job, a server-side script) needs to drive a logged-in browser session, but only your local Chrome has the cookies.
- Target sites do IP-based throttling or risk control — you want web traffic to leave from your home network, not from the agent's data center.
- The remote machine has no display and no Chrome installed.

## What not to do (and why)

The first instinct is "let the extension connect to a remote daemon" — type a public host into the popup, expose port 19825 with frp, done. **Don't.** The daemon's WebSocket protocol has no built-in authentication. Anything that can reach the port can:

- Read cookies for every site you're logged into
- Execute arbitrary JavaScript in any of your tabs
- Take screenshots, send arbitrary HTTP requests, dump page content

Treat the daemon port the way you'd treat your unlocked desktop: never put it on a network you don't fully trust. Native "extension talks to remote daemon" support was [proposed in #636](https://github.com/jackwener/OpenCLI/pull/636) and deferred until daemon authentication exists.

## The pattern: reverse-tunnel a localhost daemon

Keep Chrome, the extension, and the daemon **all on your local machine**. Use a reverse port forward so the remote process can reach your daemon by connecting to its own `localhost:19825`. The daemon itself never leaves localhost.

```
┌─ Local ─────────────────────────────────┐    ┌─ Remote ──────────┐
│  Chrome ↔ Extension ↔ Daemon (127.0.0.1) │ ←┐ │  opencli-cli      │
└──────────────────────────────────────────┘  │ │  (talks to        │
                                              │ │   localhost:19825)│
                       reverse tunnel ────────┘ └───────────────────┘
                       (SSH -R / frpc / VPN)
```

The remote `opencli` process needs **no flags, no env vars, no extension changes** — it connects to its own loopback, which the tunnel forwards to your laptop.

## Option A — SSH reverse port forward (recommended)

From your local machine, SSH to the remote with `-R` to expose your local daemon to the remote's loopback:

```bash
ssh -R 19825:127.0.0.1:19825 user@remote-server
```

While that session is open, anything on the remote connecting to `localhost:19825` is forwarded back to your local daemon. The remote-side workflow is unchanged:

```bash
# On the remote server
opencli twitter feed
opencli browser open https://example.com
```

::: tip
Use `127.0.0.1` (not `localhost`) on the `-R` clause to avoid IPv6 resolution stalls.
:::

For long-lived agent runs, use `autossh` so the tunnel reconnects automatically:

```bash
autossh -M 0 -N -R 19825:127.0.0.1:19825 user@remote-server
```

Or as a systemd unit / launchd plist on the local side.

### Why this is safe

- The daemon stays bound to `127.0.0.1` on your machine.
- The tunnel rides on SSH's authenticated transport — no new auth surface.
- If the SSH session drops, the tunnel drops; the remote `opencli` simply fails to connect rather than reaching some stale endpoint.

## Option B — frp reverse TCP proxy

If SSH from your local machine to the remote isn't an option (NAT, firewalls), use [frp](https://github.com/fatedier/frp) to expose the local daemon through a public relay. **This is more complex than SSH and has more failure modes — prefer Option A unless you have a hard reason not to.**

1. Run **frps** on a public relay you control.
2. Run **frpc** on your local machine, exposing daemon port 19825:

   ```toml
   # ~/frpc.toml on your local machine
   serverAddr = "<public-relay-ip>"
   serverPort = 7000
   auth.method = "token"
   auth.token  = "<long-random-token>"

   [[proxies]]
   name = "opencli-daemon"
   type = "tcp"
   localIP = "127.0.0.1"
   localPort = 19825
   remotePort = 19825
   ```

3. On the remote server, run a second **frpc** that maps the relay's exposed port back to the remote's `localhost:19825` (a `stcp` visitor or a plain `tcp` client+visitor pair). This way `opencli` on the remote keeps talking to its own loopback.

::: warning
- Always set a strong `auth.token` on frps and frpc. Without it, anyone who learns the relay address has full control of your browser.
- Bind the relay's exposed port to a private interface or restrict it with iptables / security groups. A daemon port on the public internet is the same risk as the rejected #636 design.
- If you find yourself debugging frp auth, revisit Option A — it's cheaper and safer.
:::

## Verification

After setting up the tunnel, confirm the remote sees the daemon:

```bash
# On the remote server
curl -sf http://127.0.0.1:19825/ping && echo "daemon reachable"
opencli doctor
```

`opencli doctor` from the remote should report the same extension version your local Chrome is running.

## Caveats

- **Local Chrome must be running** for the duration of the remote command. Closing Chrome closes the extension's WebSocket; remote `opencli` calls will fail with a "no daemon" error until Chrome is reopened.
- **Tunnel latency adds to every call**. Each browser command crosses the tunnel twice; expect 50–200ms overhead per call on a typical SSH link, more on transcontinental links.
- **One tunnel per local daemon**. If you start multiple SSH sessions all forwarding 19825, only the first wins; the rest log a "remote port already in use" warning.
