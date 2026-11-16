// WebSocket connection with automatic reconnecting.
//
// The server only accepts sockets from logged-in browsers (the session cookie
// is checked during the upgrade), so nothing connects until start() is called.
// close() stops it and prevents reconnecting; start() can be called again later.
//
// Frames are JSON: { type, id, payload }. send() returns false if the socket
// is not open so callers can tell the user instead of silently dropping data.
// onClose runs after every drop; main.js uses it to notice an ended session.

export function createConnection({ url, onStatus, onOpen, onMessage, onClose }) {
  let socket = null;
  let attempts = 0;
  let retryTimer = null;
  let active = false;
  let counter = 0;

  function connect() {
    if (!active) return;
    onStatus('connecting');
    const mine = new WebSocket(url);
    socket = mine;

    mine.addEventListener('open', () => {
      if (socket !== mine) return;
      attempts = 0;
      onStatus('connected');
      onOpen();
    });

    mine.addEventListener('message', (event) => {
      if (socket !== mine) return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame && typeof frame.type === 'string') onMessage(frame);
    });

    mine.addEventListener('close', () => {
      if (socket !== mine) return; // an old socket we already replaced or closed
      socket = null;
      onStatus('disconnected');
      if (active) scheduleRetry();
      onClose();
    });

    // 'error' is always followed by 'close', which handles the retry.
    mine.addEventListener('error', () => {});
  }

  function scheduleRetry() {
    const delay = Math.min(10000, 500 * 2 ** attempts);
    attempts += 1;
    retryTimer = setTimeout(connect, delay);
  }

  function start() {
    if (active) return;
    active = true;
    attempts = 0;
    connect();
  }

  function send(type, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    counter += 1;
    socket.send(JSON.stringify({ type, id: String(counter), payload }));
    return true;
  }

  function close() {
    active = false;
    clearTimeout(retryTimer);
    const old = socket;
    socket = null;
    if (old) old.close();
    onStatus('disconnected');
  }

  return { start, send, close };
}
