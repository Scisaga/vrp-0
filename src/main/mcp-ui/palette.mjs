const PALETTE = ['#4338ca','#047857','#b45309','#be123c','#0e7490','#7e22ce','#4d7c0f','#9f1239'];

export function colorFor(id) {
  let hash = 0;
  for (const character of String(id)) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
