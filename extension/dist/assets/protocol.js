const OFFSCREEN_DOCUMENT = "offscreen.html";
const MSG_EXECUTE_COMMAND = "opencli:execute-command";
const MSG_BRIDGE_INIT = "opencli:bridge-init";
const DAEMON_PORT = 19825;
const DAEMON_HOST = "localhost";
const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
const DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
const WS_RECONNECT_BASE_DELAY = 2e3;
const WS_RECONNECT_MAX_DELAY = 5e3;

export { DAEMON_PING_URL as D, MSG_EXECUTE_COMMAND as M, OFFSCREEN_DOCUMENT as O, WS_RECONNECT_BASE_DELAY as W, MSG_BRIDGE_INIT as a, DAEMON_WS_URL as b, WS_RECONNECT_MAX_DELAY as c };
