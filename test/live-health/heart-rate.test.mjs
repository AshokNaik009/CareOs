import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeartRateConnection, parseHeartRate, STALE_AFTER_MS, CONNECT_TIMEOUT_MS } from '../../web/src/live-health/heart-rate.mjs';

const packet = bytes => new DataView(Uint8Array.from(bytes).buffer);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function sensor() {
  const characteristic = new EventTarget();
  characteristic.startNotifications = async () => characteristic;
  characteristic.emit = bytes => {
    characteristic.value = packet(bytes);
    characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  };
  const device = new EventTarget();
  device.name = 'WHOOP test sensor';
  device.disconnects = 0;
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    disconnect() { device.disconnects++; this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    async getPrimaryService(name) {
      assert.equal(name, 'heart_rate');
      return { async getCharacteristic(name) { assert.equal(name, 'heart_rate_measurement'); return characteristic; } };
    },
  };
  return { device, characteristic };
}

function setup(options = {}) {
  const { device, characteristic } = sensor();
  let clock = 100000;
  const timers = new Map();
  const states = [];
  const requests = [];
  const bluetooth = { async requestDevice(options) { requests.push(options); return device; } };
  const connection = createHeartRateConnection({
    bluetooth, secureContext: true, onChange: state => states.push(state), now: () => clock,
    setTimer: (fn, delay) => { const id = Symbol(); timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimer: id => timers.delete(id), ...options,
  });
  const advance = millis => {
    clock += millis;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
  };
  return { connection, bluetooth, device, characteristic, states, requests, advance, timers, setClock: value => { clock = value; } };
}

test('parses unsigned 8-bit and little-endian 16-bit heart rate', () => {
  assert.deepEqual(parseHeartRate(packet([0, 72])), { bpm: 72, contact: null });
  assert.deepEqual(parseHeartRate(packet([1, 44, 1])), { bpm: 300, contact: null });
});

test('respects the DataView byte offset', () => {
  const bytes = Uint8Array.from([255, 0, 81, 255]);
  assert.equal(parseHeartRate(new DataView(bytes.buffer, 1, 2)).bpm, 81);
});

test('contact support and contact detection are independent flags', () => {
  assert.equal(parseHeartRate(packet([4, 72])).contact, false);
  assert.equal(parseHeartRate(packet([6, 72])).contact, true);
  assert.equal(parseHeartRate(packet([2, 72])).contact, null);
});

test('validates optional energy and RR fields without deriving HRV', () => {
  assert.deepEqual(parseHeartRate(packet([24, 72, 10, 0, 0, 4, 0, 4])), { bpm: 72, contact: null });
  assert.equal(parseHeartRate(packet([8, 72])), null);
  assert.equal(parseHeartRate(packet([16, 72])), null);
  assert.equal(parseHeartRate(packet([16, 72, 1])), null);
});

test('empty, truncated and invalid values do not produce invented readings', () => {
  for (const value of [null, undefined, {}, packet([]), packet([0]), packet([1, 72])]) assert.equal(parseHeartRate(value), null);
  assert.equal(parseHeartRate(packet([0, 0])).bpm, 0);
});

test('unsupported or insecure browsers never request a Bluetooth device', async () => {
  for (const options of [{ bluetooth: undefined }, { secureContext: false }]) {
    const { connection, requests } = setup(options);
    assert.equal(connection.getState().status, 'unavailable');
    await connection.connect();
    assert.equal(requests.length, 0);
    assert.equal(connection.getState().bpm, null);
  }
});

test('pairing is explicit and asks only for the standard heart rate service', async () => {
  const { connection, requests, characteristic } = setup();
  assert.equal(requests.length, 0);
  await connection.connect();
  assert.deepEqual(requests[0], { filters: [{ services: ['heart_rate'] }, { namePrefix: 'WHOOP' }], optionalServices: ['heart_rate'] });
  assert.equal(connection.getState().status, 'waiting');
  assert.equal(connection.getState().bpm, null);
  characteristic.emit([0, 79]);
  assert.deepEqual(connection.getState(), { status: 'live', connected: true, deviceName: 'WHOOP test sensor', bpm: 79, receivedAt: 100000, message: 'Receiving heart rate directly over Bluetooth.' });
});

test('repeated connect clicks do not open multiple choosers', async () => {
  const choice = deferred();
  let requests = 0;
  const { connection, device } = setup({ bluetooth: { requestDevice: () => { requests++; return choice.promise; } } });
  const pending = connection.connect();
  await connection.connect();
  assert.equal(requests, 1);
  choice.resolve(device);
  await pending;
  await connection.connect();
  assert.equal(requests, 1);
});

test('fresh readings expire and resume without retaining a misleading live value', async () => {
  const { connection, characteristic, advance } = setup();
  await connection.connect();
  characteristic.emit([0, 80]);
  advance(STALE_AFTER_MS - 1);
  assert.equal(connection.getState().bpm, 80);
  advance(1);
  assert.equal(connection.getState().status, 'stale');
  assert.equal(connection.getState().bpm, null);
  assert.equal(connection.getState().receivedAt, 100000);
  characteristic.emit([0, 82]);
  assert.equal(connection.getState().status, 'live');
  assert.equal(connection.getState().bpm, 82);
});

test('waiting without any notifications becomes stale, not live', async () => {
  const { connection, advance } = setup();
  await connection.connect();
  advance(STALE_AFTER_MS);
  assert.equal(connection.getState().status, 'stale');
  assert.equal(connection.getState().receivedAt, null);
});

test('freshness can be checked when returning from a suspended tab', async () => {
  const { connection, characteristic, setClock } = setup();
  await connection.connect();
  characteristic.emit([0, 78]);
  setClock(100000 + STALE_AFTER_MS);
  connection.checkFreshness();
  assert.equal(connection.getState().status, 'stale');
  assert.equal(connection.getState().bpm, null);
});

test('contact loss, zero and malformed packets clear the previous reading immediately', async () => {
  const { connection, characteristic } = setup();
  await connection.connect();
  for (const [bytes, status] of [[[4, 72], 'no_contact'], [[0, 0], 'no_signal'], [[1, 72], 'invalid']]) {
    characteristic.emit([0, 75]);
    characteristic.emit(bytes);
    assert.equal(connection.getState().status, status);
    assert.equal(connection.getState().bpm, null);
  }
});

test('manual disconnect clears readings, listeners and timers', async () => {
  const { connection, device, characteristic, states, timers } = setup();
  await connection.connect();
  characteristic.emit([0, 70]);
  connection.disconnect();
  assert.equal(device.gatt.connected, false);
  assert.equal(connection.getState().bpm, null);
  assert.equal(connection.getState().receivedAt, null);
  assert.equal(connection.getState().deviceName, null);
  assert.equal(timers.size, 0);
  const count = states.length;
  characteristic.emit([0, 100]);
  assert.equal(states.length, count);
});

test('unexpected disconnect clears the live reading and permits explicit reconnection', async () => {
  const { connection, device, characteristic } = setup();
  await connection.connect();
  characteristic.emit([0, 70]);
  device.gatt.disconnect();
  assert.equal(connection.getState().status, 'disconnected');
  assert.equal(connection.getState().bpm, null);
  await connection.connect();
  characteristic.emit([0, 71]);
  assert.equal(connection.getState().bpm, 71);
});

test('chooser cancellation and permission denial have actionable states', async () => {
  for (const [name, status, message] of [['NotFoundError', 'idle', /No device selected/], ['NotAllowedError', 'error', /permission/i], ['SecurityError', 'error', /permission/i]]) {
    const { connection } = setup({ bluetooth: { requestDevice: async () => { throw new DOMException('test', name); } } });
    await connection.connect();
    assert.equal(connection.getState().status, status);
    assert.match(connection.getState().message, message);
  }
});

test('missing heart rate service fails clearly and releases the device', async () => {
  const { connection, device } = setup();
  device.gatt.getPrimaryService = async () => { throw new DOMException('test', 'NotFoundError'); };
  await connection.connect();
  assert.equal(connection.getState().status, 'error');
  assert.match(connection.getState().message, /Heart Rate Broadcast/);
  assert.equal(device.gatt.connected, false);
});

test('notification setup failure releases listeners and never shows a live reading', async () => {
  const { connection, characteristic, device } = setup();
  characteristic.startNotifications = async () => { throw new DOMException('test', 'NetworkError'); };
  await connection.connect();
  assert.equal(connection.getState().status, 'error');
  assert.equal(device.gatt.connected, false);
  characteristic.emit([0, 72]);
  assert.equal(connection.getState().bpm, null);
});

test('connection timeout releases the device and late completion cannot resurrect readings', async () => {
  const pendingService = deferred();
  const { connection, device, advance } = setup();
  device.gatt.getPrimaryService = () => pendingService.promise;
  const pending = connection.connect();
  await new Promise(resolve => setImmediate(resolve));
  advance(CONNECT_TIMEOUT_MS);
  assert.equal(connection.getState().status, 'error');
  assert.match(connection.getState().message, /timed out/);
  pendingService.resolve({ getCharacteristic: async () => { throw new Error('Cancelled connection must not proceed'); } });
  await pending;
  assert.equal(connection.getState().status, 'error');
});

test('late chooser result after cancellation does not replace a newer connection', async () => {
  const choice = deferred();
  const { connection, bluetooth, device, characteristic } = setup();
  bluetooth.requestDevice = () => choice.promise;
  const oldAttempt = connection.connect();
  connection.disconnect();
  bluetooth.requestDevice = async () => device;
  await connection.connect();
  characteristic.emit([0, 77]);
  choice.resolve(device);
  await oldAttempt;
  assert.equal(connection.getState().bpm, 77);
  assert.equal(device.gatt.connected, true);
});

test('disposing during setup disconnects late results without publishing state', async () => {
  const choice = deferred();
  const { connection, device, states } = setup({ bluetooth: { requestDevice: () => choice.promise } });
  const pending = connection.connect();
  connection.dispose();
  const count = states.length;
  choice.resolve(device);
  await pending;
  assert.equal(states.length, count);
  assert.equal(device.gatt.connected, false);
  await connection.connect();
  assert.equal(states.length, count);
});
