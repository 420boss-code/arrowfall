// Browser side of online play: one WebSocket to the game server.
export class NetClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.ping = 0;
    this.closedByUs = false;
  }

  static url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  // Resolves with the server's welcome message once we have a slot in the room.
  connect(roomId, name) {
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const ws = new WebSocket(NetClient.url());
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: roomId, name }));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') { this.game.applySnapshot(ev.data); return; }
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { welcomed = true; this._startPing(); resolve(m); return; }
        if (m.t === 'error') { if (!welcomed) reject(new Error(m.msg)); return; }
        if (m.t === 'pong') { this.ping = performance.now() - m.c; return; }
        this.game.applyNetMessage(m);
      };
      ws.onerror = () => { if (!welcomed) reject(new Error('Could not reach the game server.')); };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (!welcomed) { reject(new Error('Connection closed.')); return; }
        if (!this.closedByUs && this.game.net === this) this.game.quitToMenu('Disconnected from the server.');
      };
    });
  }

  _startPing() {
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    if (this.ws) this.ws.close();
  }
}
