/**
 * GestureVerse - simple rigid-body physics for thrown objects.
 *
 * Not a full engine: gravity, linear drag, a floor plane with restitution and
 * friction, and wall/ceiling clamps. Deterministic and pure, so throw
 * trajectories are unit-testable.
 */

import { clamp } from '../core/math.js';

/**
 * Advance one object by dt seconds.
 * @param {object} obj   object with position/velocity/radius
 * @param {number} dt    seconds
 * @param {object} config GestureVerse config
 * @returns {string[]}   list of events, e.g. ['bounce','settle']
 */
export function stepPhysics(obj, dt, config) {
  const cfg = config.objects;
  const world = config.world;
  const events = [];
  if (obj.state !== 'flying') return events;

  const radius = (obj.size || 1) * 0.5 * (obj.scale || 1);

  // Gravity + air drag
  obj.velocity.y += cfg.gravity * dt;
  const drag = Math.max(0, 1 - cfg.linearDamping * dt);
  obj.velocity.x *= drag;
  obj.velocity.y *= drag;
  obj.velocity.z *= drag;

  obj.position.x += obj.velocity.x * dt;
  obj.position.y += obj.velocity.y * dt;
  obj.position.z += obj.velocity.z * dt;

  // Spin follows horizontal speed for a bit of life
  const spin = Math.hypot(obj.velocity.x, obj.velocity.z) * 0.12;
  obj.rotation.z += spin * dt;
  obj.rotation.x += spin * 0.4 * dt;

  // Floor collision
  const floorY = world.floorY + radius;
  if (obj.position.y <= floorY) {
    obj.position.y = floorY;
    if (obj.velocity.y < 0) {
      obj.velocity.y = -obj.velocity.y * cfg.restitution;
      events.push('bounce');
    }
    obj.velocity.x *= cfg.friction;
    obj.velocity.z *= cfg.friction;
    if (Math.abs(obj.velocity.y) < cfg.restSpeed) obj.velocity.y = 0;
  }

  // Ceiling + walls
  const halfW = world.width / 2 - radius;
  const halfD = world.depth / 2 - radius;
  const topY = world.height / 2 - radius;
  if (obj.position.x > halfW) {
    obj.position.x = halfW;
    obj.velocity.x = -Math.abs(obj.velocity.x) * cfg.restitution;
    events.push('bounce');
  } else if (obj.position.x < -halfW) {
    obj.position.x = -halfW;
    obj.velocity.x = Math.abs(obj.velocity.x) * cfg.restitution;
    events.push('bounce');
  }
  if (obj.position.z > halfD) {
    obj.position.z = halfD;
    obj.velocity.z = -Math.abs(obj.velocity.z) * cfg.restitution;
    events.push('bounce');
  } else if (obj.position.z < -halfD) {
    obj.position.z = -halfD;
    obj.velocity.z = Math.abs(obj.velocity.z) * cfg.restitution;
    events.push('bounce');
  }
  if (obj.position.y > topY) {
    obj.position.y = topY;
    obj.velocity.y = -Math.abs(obj.velocity.y) * cfg.restitution;
  }

  // Settle test: on the floor and slow
  const speed = Math.hypot(obj.velocity.x, obj.velocity.y, obj.velocity.z);
  if (speed < cfg.restSpeed && obj.position.y <= floorY + 0.02) {
    obj.velocity.x = 0;
    obj.velocity.y = 0;
    obj.velocity.z = 0;
    obj.position.y = floorY;
    obj.state = 'idle';
    events.push('settle');
  }

  // Safety net: if it somehow leaves the volume, stop it.
  obj.position = {
    x: clamp(obj.position.x, -world.width / 2, world.width / 2),
    y: clamp(obj.position.y, world.floorY, world.height / 2),
    z: clamp(obj.position.z, -world.depth / 2, world.depth / 2),
  };

  return events;
}

/**
 * Smooth exponential follow used while an object is held.
 * Frame-rate independent: alpha = 1 - e^(-k*dt).
 */
export function followAlpha(stiffness, dt) {
  return 1 - Math.exp(-stiffness * dt);
}
