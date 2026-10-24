import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createConfig } from '../src/core/config.js';
import { ObjectManager, OBJ_STATE } from '../src/objects/objectManager.js';

const cfg = createConfig();
const DT = 1 / 60;

function manager(overrides) {
  return new ObjectManager(createConfig(overrides));
}

test('grab selects the nearest object inside the grab radius', () => {
  const om = manager();
  const a = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.add({ kind: 'box', position: { x: 3, y: 0, z: 0 } });
  const grabbed = om.grab({ x: 0.2, y: 0, z: 0 });
  assert.equal(grabbed.id, a.id);
  assert.equal(om.held.id, a.id);
  assert.equal(a.state, OBJ_STATE.HELD);
});

test('grab fails when nothing is close enough', () => {
  const om = manager();
  om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  assert.equal(om.grab({ x: 5, y: 0, z: 0 }), null);
  assert.equal(om.held, null);
});

test('grabbing preserves the offset so the object never jumps into the palm', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 1, y: 0, z: 0 } });
  const before = { ...obj.position };
  om.grab({ x: 0.7, y: 0, z: 0 });
  assert.deepEqual(obj.position, before);
  assert.ok(Math.abs(obj.grabOffset.x - 0.3) < 1e-9);
});

test('the held object follows the hand smoothly and monotonically, then reaches it', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  let prev = Infinity;
  for (let i = 0; i < 90; i++) {
    om.drag({ x: 2, y: 0.5, z: 0 }, DT);
    const d = Math.hypot(obj.position.x - 2, obj.position.y - 0.5);
    assert.ok(d <= prev + 1e-9, 'distance to target must never increase (no overshoot)');
    prev = d;
  }
  assert.ok(Math.hypot(obj.position.x - 2, obj.position.y - 0.5) < 0.02);
});

test('releasing a still hand places the object and it stays put', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 60; i++) om.drag({ x: 1.5, y: 0.6, z: 0 }, DT);
  const placed = { ...obj.position };

  const released = om.release();
  assert.equal(released.state, OBJ_STATE.IDLE);
  assert.deepEqual(obj.position, placed);
  assert.equal(om.held, null);

  // The hand moves far away; the object must not follow.
  om.update(DT);
  om.updateHover({ x: -3, y: 2, z: 0 });
  assert.deepEqual(obj.position, placed);
});

test('releasing a fast-moving hand throws the object', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  let x = 0;
  for (let i = 0; i < 10; i++) {
    x += 0.35;
    om.drag({ x, y: 0, z: 0 }, DT);
  }
  const released = om.release();
  assert.equal(released.state, OBJ_STATE.FLYING);
  assert.ok(released.velocity.x > 0, 'throw impulse should point in the direction of travel');
  assert.ok(om.events.some((e) => e.type === 'throw'), 'a throw event should be recorded');
});

test('throwing can be disabled for controlled demos', () => {
  const om = manager({ throwEnabled: false });
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  let x = 0;
  for (let i = 0; i < 10; i++) {
    x += 0.35;
    om.drag({ x, y: 0, z: 0 }, DT);
  }
  const released = om.release();
  assert.equal(released.state, OBJ_STATE.IDLE);
  assert.equal(released.velocity.x, 0);
});

test('a thrown object falls, bounces and settles on the floor', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 1, z: 0 }, size: 1 });
  obj.state = OBJ_STATE.FLYING;
  obj.velocity = { x: 0.6, y: 0, z: 0 };

  let bounced = false;
  for (let i = 0; i < 900; i++) {
    const events = om.update(DT);
    if (events.some((e) => e.type === 'bounce')) bounced = true;
    if (obj.state === OBJ_STATE.IDLE) break;
  }
  assert.ok(bounced, 'the object should bounce at least once');
  assert.equal(obj.state, OBJ_STATE.IDLE);
  assert.ok(Math.abs(obj.position.y - (cfg.world.floorY + 0.5)) < 0.05);
});

test('an object can be picked up again after being placed', () => {
  const om = manager();
  const obj = om.add({ kind: 'box', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  for (let i = 0; i < 60; i++) om.drag({ x: 2, y: 1, z: 0 }, DT);
  om.release();
  const placed = { ...obj.position };

  // A second grab at the new location works.
  const again = om.grab({ x: placed.x, y: placed.y, z: placed.z });
  assert.equal(again.id, obj.id);
  assert.equal(obj.state, OBJ_STATE.HELD);
});

test('losing tracking while holding does not make the object fly', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  // Carry it across, then let the hand settle for well over the throw window.
  for (let i = 1; i <= 10; i++) om.drag({ x: i * 0.1, y: i * 0.1, z: 0 }, DT);
  for (let i = 0; i < 20; i++) om.drag({ x: 1, y: 1, z: 0 }, DT);
  // The app calls release() with no further hand motion on tracking loss.
  om.release();
  const settled = { ...obj.position };
  for (let i = 0; i < 120; i++) om.update(DT);
  assert.deepEqual(obj.position, settled);
  assert.equal(obj.state, OBJ_STATE.IDLE);
});

test('two-hand transform scales the object and clamps to the configured range', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });

  om.beginTransform();
  om.applyTransform(100, 0);
  assert.ok(obj.scale <= cfg.objects.maxScale + 1e-9);

  om.beginTransform();
  om.applyTransform(0.0001, 0);
  assert.ok(obj.scale >= cfg.objects.minScale - 1e-9);
});

test('two-hand rotation is written to the object rotation', () => {
  const om = manager();
  const obj = om.add({ kind: 'box', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  om.beginTransform();
  om.applyTransform(1, 90);
  assert.ok(Math.abs(obj.rotation.z - Math.PI / 2) < 1e-6);
});

test('hover highlights only the nearest object', () => {
  const om = manager();
  const near = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  const far = om.add({ kind: 'box', position: { x: 0.6, y: 0, z: 0 } });
  const hit = om.updateHover({ x: 0.1, y: 0, z: 0 });
  assert.equal(hit.id, near.id);
  assert.equal(near.selectable, true);
  assert.equal(far.selectable, false);
});

test('serialisation round-trips the object set', () => {
  const om = manager();
  om.add({ kind: 'sphere', position: { x: 1, y: 2, z: 3 }, color: '#fff' });
  om.add({ kind: 'star', position: { x: -1, y: 0, z: 0 }, color: '#000' });
  const json = JSON.parse(JSON.stringify(om.toJSON()));

  const om2 = manager();
  om2.loadJSON(json);
  assert.equal(om2.all().length, 2);
  assert.equal(om2.all()[0].position.x, 1);
});

test('a flying object is not re-tagged by hover (which would freeze it mid-air)', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  obj.state = OBJ_STATE.FLYING;
  obj.velocity = { x: 3, y: 2, z: 0 };
  const before = { ...obj.position };

  om.updateHover({ x: 0, y: 0, z: 0 }); // cursor right on top of it
  assert.equal(obj.state, OBJ_STATE.FLYING, 'hover must not cancel a throw');
  assert.equal(obj.selectable, false);

  om.update(DT);
  assert.notDeepEqual(obj.position, before, 'the object should keep flying');
});

test('drop() releases without a throw impulse even after a fast carry', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  let x = 0;
  for (let i = 0; i < 10; i++) {
    x += 0.35;
    om.drag({ x, y: 0, z: 0 }, DT);
  }
  const dropped = om.drop();
  assert.equal(dropped.state, OBJ_STATE.IDLE, 'drop must never throw');
  assert.equal(dropped.velocity.x, 0);
});

test('a flick whose speed is only present in the recent window still throws', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  let x = 0;
  for (let i = 0; i < 10; i++) {
    x += 0.4;
    om.drag({ x, y: 0, z: 0 }, DT);
  }
  // The hand stalls for two frames while the pinch release is confirmed.
  om.drag({ x, y: 0, z: 0 }, DT);
  om.drag({ x, y: 0, z: 0 }, DT);
  const released = om.release();
  assert.equal(released.state, OBJ_STATE.FLYING, 'the recent peak speed should still count');
  assert.ok(released.velocity.x > 0);
});

test('a hand that has been still for a while places rather than throws', () => {
  const om = manager();
  const obj = om.add({ kind: 'sphere', position: { x: 0, y: 0, z: 0 } });
  om.grab({ x: 0, y: 0, z: 0 });
  for (let i = 1; i <= 10; i++) om.drag({ x: i * 0.2, y: 0, z: 0 }, DT);
  for (let i = 0; i < 20; i++) om.drag({ x: 2, y: 0, z: 0 }, DT); // > 140 ms of stillness
  const released = om.release();
  assert.equal(released.state, OBJ_STATE.IDLE);
});
