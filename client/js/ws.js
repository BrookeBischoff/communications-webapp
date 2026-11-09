// WebSocket connection with automatic reconnecting.
//
// Frames are JSON: { type, id, payload }. send() returns false if the socket
// is not open so callers can tell the user instead of silently dropping data.

export function createConnection({ url, onStatus, onOpen, onMessage }) {
  let socket = null;
  let attempts = 0;
  let retryTimer = null;
  let closedByUser = false;
  let counter = 0;

  function connect() {
    onStatus('connecting');
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      attempts = 0;
      onStatus('connected');
      onOpen();
    });

    socket.addEventListener('message', (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame && typeof frame.type === 'string') onMessage(frame);
    });

    socket.addEventListener('close', () => {
      onStatus('disconnected');
      if (!closedByUser) scheduleRetry();
    });

    // 'error' is always followed by 'close', which handles the retry.
    socket.addEventListener('error', () => {});
  }

  function scheduleRetry() {
    const delay = Math.min(10000, 500 * 2 ** attempts);
    attempts += 1;
    retryTimer = setTimeout(connect, delay);
  }

  function send(type, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    counter += 1;
    socket.send(JSON.stringify({ type, id: String(counter), payload }));
    return true;
  }

  function close() {
    closedByUser = true;
    clearTimeout(retryTimer);
    if (socket) socket.close();
  }

  connect();
  return { send, close };
}
