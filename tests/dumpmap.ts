// debug: print the map grid to terminal + a simple connectivity flood from spawns
import { floorCells, COLS, ROWS, isFloorCell, navBlocked, cellWorldX, cellWorldZ } from '../shared/mapdef.ts';

for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (floorCells[i] === 0) line += '#';
    else if (navBlocked[i]) line += 'O';
    else line += '.';
  }
  console.log(line);
}

// connectivity: BFS from attacker spawn cell over floor cells
function bfs(c0: number, r0: number): number {
  const seen = new Set<number>();
  const q: number[] = [r0 * COLS + c0];
  seen.add(r0 * COLS + c0);
  while (q.length) {
    const cur = q.shift()!;
    const cc = cur % COLS, rr = Math.floor(cur / COLS);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cc + dx, nr = rr + dy;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (seen.has(ni)) continue;
      if (!isFloorCell(nc, nr)) continue;
      seen.add(ni);
      q.push(ni);
    }
  }
  return seen.size;
}
const totalFloor = floorCells.reduce((a, b) => a + b, 0);
console.log('floor cells:', totalFloor, 'from atk spawn reachable:', bfs(16, 2), 'from siteA', bfs(27, 17), 'from siteB', bfs(5, 17));
