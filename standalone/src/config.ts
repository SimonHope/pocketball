// All tuning lives here so "game feel" can be tweaked in one place
// (and carried over when porting to Roblox later).

/** Gameplay + physics. Shared by the client, tests, and (later) the game server. */
export const SIM = {
  dt: 1 / 120,  // fixed physics step
  gravity: 25,

  ball: {
    radius: 1,
    mass: 1,
    linearDamping: 0.08,
    angularDamping: 0.43,
  },

  move: {
    force: 32,        // push applied in the input direction
    airControl: 0.4,  // fraction of force applied while airborne
    maxSpeed: 22,     // no extra push beyond this horizontal speed
  },

  friction: 0.6,       // floors and platforms
  wallFriction: 0.05,  // rails, walls, bumpers, arms: low so a spinning ball can't climb them
  restitution: 0.15,
  bumperRestitution: 0.5,
  bumperImpulse: 18,
  ballBounce: 0.9,     // restitution between two players' balls
  ballBumpBoost: 4,    // extra push on ball-to-ball hits, so bumping feels punchy

  conveyorAccel: 20,  // how hard a belt drags you toward its speed (rolling push is 32)
  springCooldown: 0.3, // seconds before the same spring can launch you again

  fallDepth: 18,      // respawn once this far below the last floor touched
  fallPenalty: 2,     // seconds added on fall
  countdown: 3,
  checkpointRadius: 2.5,
  starRadius: 1.9,    // ball centre within this (sideways) of a star's centre collects it
  buttonRadius: 1.6,  // ball centre within this of a switch star's button presses it
};

/** Client-only presentation settings. */
export const VIEW = {
  camera: {
    lookAhead: 0.25,   // seconds of velocity to lead the camera by
    followLerp: 6,
    rotateSpeed: 2.2,  // radians/sec for Q/E
    dragSpeed: 0.006,  // radians per pixel of mouse drag
    manualHold: 1.5,   // seconds auto-turn stays off after you rotate manually
    shakeAmount: 0.6,

    // Chase camera (default). Speed-based values grow with horizontal speed.
    dynamic: {
      distance: 12, height: 7, focusHeight: 1, fov: 55,
      autoTurn: 2.2,     // how quickly it swings behind the ball
      minTurnSpeed: 2,   // no auto-swing below this speed
      speedZoom: 0.25, maxZoom: 5,
      speedFov: 0.7, maxFov: 72,
      slopeLift: 0.3, maxLift: 6,
    },

    // Classic fixed-angle view (toggle with C).
    fixed: {
      distance: 16, height: 13, focusHeight: 0, fov: 50,
      autoTurn: 0, minTurnSpeed: 0,
      speedZoom: 0, maxZoom: 0, speedFov: 0, maxFov: 50,
      slopeLift: 0, maxLift: 0,
    },

    // Nearly straight down, for mazes (toggle with C). Leads further ahead than the chase camera.
    top: {
      distance: 6, height: 26, focusHeight: 0, fov: 50,
      autoTurn: 0, minTurnSpeed: 0,
      speedZoom: 0, maxZoom: 0, speedFov: 0.35, maxFov: 58,
      slopeLift: 0, maxLift: 0,
    },
  },
};
