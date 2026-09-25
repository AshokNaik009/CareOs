export const STALE_AFTER_MS = 10000;
export const CONNECT_TIMEOUT_MS = 20000;

export function parseHeartRate(value) {
  if (!(value instanceof DataView) || value.byteLength < 2) return null;
  const flags = value.getUint8(0);
  const wide = Boolean(flags & 1);
  let offset = wide ? 3 : 2;
  if (value.byteLength < offset) return null;
  const bpm = wide ? value.getUint16(1, true) : value.getUint8(1);
  if (flags & 8) offset += 2;
  if (value.byteLength < offset) return null;
  const remaining = value.byteLength - offset;
  if (flags & 16 ? remaining < 2 || remaining % 2 !== 0 : remaining !== 0) return null;
  return { bpm, contact: flags & 4 ? Boolean(flags & 2) : null };
}

export function createHeartRateConnection({ bluetooth, secureContext, onChange = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const unavailable = !secureContext
    ? 'Bluetooth requires HTTPS or localhost. Open the app directly in Chrome or Edge, not inside a preview frame.'
    : !bluetooth?.requestDevice ? 'This browser does not support Web Bluetooth. Open the app in Chrome or Edge on your Mac; Safari and Firefox are not supported.' : '';
  const empty = { connected: false, deviceName: null, bpm: null, receivedAt: null };
  let state = { ...empty, status: unavailable ? 'unavailable' : 'idle', message: unavailable || 'Enable Heart Rate Broadcast in the WHOOP app, then select your WHOOP below.' };
  let active = null;
  let disposed = false;

  function publish(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    onChange({ ...state });
  }

  function release(context) {
    clearTimer(context.connectTimer);
    clearTimer(context.staleTimer);
    context.characteristic?.removeEventListener('characteristicvaluechanged', context.onReading);
    context.device?.removeEventListener('gattserverdisconnected', context.onDisconnect);
    if (context.device && (active === context || active?.device !== context.device)) {
      try { context.device.gatt?.disconnect(); } catch {}
    }
  }

  function finish(context, status, message) {
    if (active !== context) return;
    active = null;
    release(context);
    publish({ ...empty, status, message });
  }

  function current(context) {
    if (!disposed && active === context) return true;
    release(context);
    return false;
  }

  function checkFreshness() {
    if (active && state.connected && active.lastPacketAt != null && now() - active.lastPacketAt >= STALE_AFTER_MS && state.status !== 'stale') {
      publish({ status: 'stale', bpm: null, message: 'No fresh Bluetooth reading for 10 seconds. Check the broadcast, fit and distance, or disconnect and reconnect.' });
    }
  }

  function armFreshness(context) {
    clearTimer(context.staleTimer);
    context.staleTimer = setTimer(() => { if (active === context) checkFreshness(); }, Math.max(0, STALE_AFTER_MS - (now() - context.lastPacketAt)));
  }

  function onReading(context, event) {
    if (active !== context || disposed) return;
    context.lastPacketAt = now();
    const reading = parseHeartRate(event.target.value);
    if (!reading) publish({ status: 'invalid', bpm: null, message: 'The sensor sent an unreadable measurement. No live value is shown until a valid reading arrives.' });
    else if (reading.contact === false) publish({ status: 'no_contact', bpm: null, message: 'The sensor reports no skin contact. Check that your WHOOP is fitted securely.' });
    else if (reading.bpm === 0) publish({ status: 'no_signal', bpm: null, message: 'The sensor reported zero, so no usable live reading is shown. Check its fit and Heart Rate Broadcast.' });
    else publish({ status: 'live', bpm: reading.bpm, receivedAt: now(), message: 'Receiving heart rate directly over Bluetooth.' });
    armFreshness(context);
  }

  async function connect() {
    if (disposed || active || unavailable) return;
    const context = {};
    active = context;
    publish({ ...empty, status: 'requesting', message: 'Choose your WHOOP in the browser’s Bluetooth device picker.' });
    try {
      context.device = await bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }, { namePrefix: 'WHOOP' }], optionalServices: ['heart_rate'] });
      if (!current(context)) return;
      if (!context.device.gatt) throw new DOMException('Bluetooth GATT is unavailable.', 'NotSupportedError');
      context.onDisconnect = () => finish(context, 'disconnected', 'Bluetooth disconnected. Keep your WHOOP nearby and reconnect when ready.');
      context.device.addEventListener('gattserverdisconnected', context.onDisconnect);
      publish({ status: 'connecting', deviceName: context.device.name || 'Selected heart-rate sensor', message: 'Connecting to the sensor’s heart-rate service…' });
      context.connectTimer = setTimer(() => finish(context, 'error', 'Bluetooth connection timed out. Check Heart Rate Broadcast and disconnect other fitness receivers before trying again.'), CONNECT_TIMEOUT_MS);
      const server = await context.device.gatt.connect();
      if (!current(context)) return;
      publish({ connected: true });
      const service = await server.getPrimaryService('heart_rate');
      if (!current(context)) return;
      context.characteristic = await service.getCharacteristic('heart_rate_measurement');
      if (!current(context)) return;
      context.onReading = event => onReading(context, event);
      context.characteristic.addEventListener('characteristicvaluechanged', context.onReading);
      await context.characteristic.startNotifications();
      if (!current(context)) return;
      clearTimer(context.connectTimer);
      context.lastPacketAt ??= now();
      if (state.status === 'connecting') publish({ status: 'waiting', message: 'Bluetooth connected. Waiting for the first heart-rate reading; no saved value is used.' });
      armFreshness(context);
    } catch (error) {
      if (!current(context)) return;
      const cancelled = !context.device && error.name === 'NotFoundError';
      const message = cancelled ? 'No device selected. Enable Heart Rate Broadcast and choose your WHOOP when ready.'
        : ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'Bluetooth permission was blocked. Open this app directly in Chrome or Edge, allow Bluetooth in browser and macOS Privacy & Security settings, then try again.'
        : ['NotFoundError', 'NotSupportedError'].includes(error.name) ? 'The selected device did not expose the heart-rate service. Enable Heart Rate Broadcast in the WHOOP app and select your WHOOP again.'
        : 'Could not connect to the heart-rate sensor. Turn on Bluetooth and Heart Rate Broadcast, keep WHOOP nearby, and disconnect other fitness receivers before trying again.';
      finish(context, cancelled ? 'idle' : 'error', message);
    }
  }

  function disconnect() {
    if (active) finish(active, 'disconnected', 'Bluetooth disconnected. Live readings have been cleared.');
  }

  return {
    getState: () => ({ ...state }),
    connect,
    disconnect,
    checkFreshness,
    dispose() {
      disposed = true;
      const context = active;
      active = null;
      if (context) release(context);
      state = { ...empty, status: 'disconnected', message: '' };
    },
  };
}
