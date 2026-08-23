# Remote orchestration

OpenCLI's Browser Bridge is **Native Messaging**. Chrome on this machine parents `opencli-host`. The CLI only connects to a unix socket under `~/.opencli/run/`.

There is no TCP port to forward. A reverse SSH tunnel to `:19825` does not apply.

If you need a remote agent to drive a browser, run `opencli` on the same machine as Chrome. Do not expose Native Messaging stdio or the unix socket on a network interface.
