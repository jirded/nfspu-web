// The keys, as data: the game's own (read off its Options, Controllers screens on 2026-11-15: the defaults
// of "game controls" and "advanced controls", and its "predefined keys", which cannot be changed) and the
// page's.  The page's keys are ones the game does not use: the game takes all of F1 to F12 itself.

export interface KeyRow { keys: string[]; what: string }

export const GAME_KEYS: readonly KeyRow[] = [
  { keys: ['↑'], what: 'Accelerate' },
  { keys: ['↓'], what: 'Brake' },
  { keys: ['Space'], what: 'Hand brake' },
  { keys: ['←'], what: 'Steer left' },
  { keys: ['→'], what: 'Steer right' },
  { keys: ['A'], what: 'Shift up' },
  { keys: ['Z'], what: 'Shift down' },
  { keys: ['R'], what: 'Reset car' },
  { keys: ['C'], what: 'Cameras' },
  { keys: ['B'], what: 'Look behind' },
];
export const ADVANCED_KEYS: readonly KeyRow[] = [
  { keys: ['L'], what: 'Lights' },
  { keys: ['H'], what: 'Horn' },
  { keys: ['T'], what: 'Hazards' },
  { keys: ['I'], what: 'Look right' },
  { keys: ['Y'], what: 'Look left' },
  { keys: ['W'], what: 'Left turn signal' },
  { keys: ['E'], what: 'Right turn signal' },
  { keys: ['U'], what: 'Look forward' },
];
export const FIXED_KEYS: readonly KeyRow[] = [
  { keys: ['F1'], what: 'Hide pause menu' },
  { keys: ['F2'], what: 'Rotate pause camera clockwise' },
  { keys: ['F3'], what: 'Stop pause camera rotation' },
  { keys: ['F4'], what: 'Rotate pause camera counter clockwise' },
  { keys: ['F5'], what: 'HUD on or off' },
  { keys: ['F6'], what: 'Rear view mirror on or off' },
  { keys: ['F7'], what: 'Map on or off' },
  { keys: ['F8'], what: 'Translucent or transparent HUD' },
  { keys: ['F9'], what: 'Music on or off' },
  { keys: ['F10'], what: 'Sound effects on or off' },
  { keys: ['F11'], what: 'View distance cycle' },
  { keys: ['F12'], what: 'Sky rendering cycle' },
  { keys: ['+', '−'], what: 'Map size' },
  { keys: ['Tab'], what: 'Map mode' },
  { keys: ['Esc'], what: 'Pause game' },
  { keys: ['Alt', 'P'], what: 'Save screen image' },
];

/** KeyboardEvent.code of the page's own keys while a game runs */
export const SITE = { menu: 'Home', counter: 'End', shot: 'Insert' } as const;
export const SITE_KEYS: readonly KeyRow[] = [
  { keys: ['Home'], what: 'Menu: full screen, frame-rate counter, controls, log, quit' },
  { keys: ['End'], what: 'Frame-rate counter: off, on, detailed' },
  { keys: ['Insert'], what: 'Screenshot, kept with your saves' },
  { keys: ['Hold Esc'], what: 'Leave full screen' },
];
