// Player names are generated from fixed word lists, never typed. Kids play on web portals
// and Roblox, so this avoids offensive names without needing a moderation system.

export const ADJECTIVES = [
  'Zippy', 'Fluffy', 'Speedy', 'Bouncy', 'Rolling', 'Turbo', 'Sleepy', 'Cheeky', 'Dizzy', 'Mighty',
  'Tiny', 'Brave', 'Sneaky', 'Jolly', 'Snappy', 'Wobbly', 'Lucky', 'Sunny', 'Frosty', 'Rocket',
  'Nutty', 'Peppy', 'Zesty', 'Swift', 'Plucky', 'Giddy', 'Bubbly', 'Crunchy', 'Dashing', 'Nimble',
] as const;

export const NOUNS = [
  'Hammy', 'Nibbles', 'Peanut', 'Whiskers', 'Pip', 'Biscuit', 'Muffin', 'Pebble', 'Acorn', 'Button',
  'Cocoa', 'Mochi', 'Noodle', 'Pretzel', 'Sprout', 'Waffle', 'Toffee', 'Bean', 'Crumb', 'Squeak',
  'Dumpling', 'Cashew', 'Maple', 'Pudding', 'Tater', 'Clover', 'Sesame', 'Popcorn', 'Truffle', 'Nugget',
] as const;

export function randomName(rand: () => number = Math.random): string {
  const a = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(rand() * NOUNS.length)];
  return `${a} ${n}`;
}

export function isValidName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const [a, n, ...rest] = name.split(' ');
  return rest.length === 0 && (ADJECTIVES as readonly string[]).includes(a) && (NOUNS as readonly string[]).includes(n);
}
