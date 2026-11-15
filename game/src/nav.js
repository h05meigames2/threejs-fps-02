// The waypoint graph over Ember Yard. Bots think in these nodes: attackers pick a site and
// walk a route to it, defenders walk to a hold spot and watch a lane. Pathfinding is plain
// breadth-first search — the graph is small, unweighted and static, so BFS is exact and cheap.
// Node heights (y) matter only on the catwalk and ramps; movement physics handles the rest.

import * as THREE from 'three';

// [x, z] pairs; y is filled in below for the raised nodes.
const NODE_XZ = [
  [0, -28],    // 0  warden spawn
  [-12, -25],  // 1  A back
  [12, -25],   // 2  B back
  [-23, -17],  // 3  site A centre
  [23, -17],   // 4  site B centre
  [-33, -10],  // 5  A lane north (lanes hug the fence, clear of the cover crates)
  [33, -10],   // 6  B lane north
  [-33, 4],    // 7  A lane mid
  [33, 4],     // 8  B lane mid
  [-33, 18],   // 9  A lane south
  [33, 18],    // 10 B lane south
  [0, 30],     // 11 breaker spawn
  [-4, 14],    // 12 mid south (west of the roadblock container)
  [3, 7.5],    // 13 mid underpass (beneath the catwalk, between pillars)
  [-9, 7.5],   // 14 catwalk west (y=3)
  [9, 7.5],    // 15 catwalk east (y=3)
  [0, 2],      // 16 warehouse south door
  [1.5, -4],   // 17 warehouse inside (east of the divider)
  [1.5, -13],  // 18 warehouse north door
  [0, -19],    // 19 mid north
  [-14, -14],  // 20 A connector
  [14, -14],   // 21 B connector
  [-19, 12],   // 22 west-mid choke
  [19, 12],    // 23 east-mid choke
  [-23, -5],   // 24 A approach south
  [23, -5],    // 25 B approach south
  [-19, 7.5],  // 26 west ramp base
  [19, 7.5],   // 27 east ramp base
  [-14, -3],   // 28 west-mid outside warehouse
  [-9, -4],    // 29 warehouse west door
  [14, -3],    // 30 east-mid outside warehouse
  [9, -2],     // 31 warehouse east door
  [-15.5, 8.8],  // 32 west choke wall, north end
  [-15.5, 17.2], // 33 west choke wall, south end
  [15.5, 8.8],   // 34 east choke wall, north end
];
const NODE_Y = { 14: 3, 15: 3 };

const EDGES = [
  [0, 1], [0, 2], [0, 19],
  [1, 3], [1, 19], [1, 20],
  [2, 4], [2, 19], [2, 21],
  [3, 5], [3, 20], [3, 24],
  [4, 6], [4, 21], [4, 25],
  [5, 7], [6, 8],
  [7, 9], [7, 22],
  [8, 10], [8, 23],
  [9, 11], [9, 22],
  [10, 11], [10, 23],
  [11, 12],
  [12, 13], [12, 33],
  [13, 16], [13, 32], [13, 34],
  [14, 15], [14, 26], [15, 27],
  [16, 17], [16, 13],
  [17, 18], [17, 29], [17, 31],
  [18, 19], [18, 20], [18, 21],
  [20, 24], [21, 25],
  [22, 26], [22, 33], [23, 27],
  [24, 28], [25, 30],
  [28, 29], [30, 31],
  [32, 22], [34, 23],
];

export class NavGraph {
  constructor() {
    this.nodes = NODE_XZ.map(([x, z], i) => new THREE.Vector3(x, NODE_Y[i] ?? 0, z));
    this.adj = this.nodes.map(() => []);
    for (const [a, b] of EDGES) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
    // Defensive hold spots: where Warden bots set up, and the node they path to.
    this.holdSpots = [
      { pos: new THREE.Vector3(-19.5, 0, -20.5), node: 3, watch: new THREE.Vector3(-26, 0, -8), site: 'A' },
      { pos: new THREE.Vector3(-26.5, 0, -11), node: 24, watch: new THREE.Vector3(-30, 0, 4), site: 'A' },
      { pos: new THREE.Vector3(19.5, 0, -20.5), node: 4, watch: new THREE.Vector3(26, 0, -8), site: 'B' },
      { pos: new THREE.Vector3(26.5, 0, -11), node: 25, watch: new THREE.Vector3(30, 0, 4), site: 'B' },
      { pos: new THREE.Vector3(0, 3, 7.5), node: 14, watch: new THREE.Vector3(0, 0, 20), site: 'M' },
      { pos: new THREE.Vector3(0, 0, -17.5), node: 19, watch: new THREE.Vector3(0, 0, -4), site: 'M' },
    ];
  }

  nearestNode(pos) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = this.nodes[i].distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Shortest node path from `from` to `to` (both node indices), inclusive of both ends.
  path(from, to) {
    if (from === to) return [from];
    const prev = new Array(this.nodes.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const next of this.adj[cur]) {
        if (prev[next] !== -1) continue;
        prev[next] = cur;
        if (next === to) {
          const out = [to];
          let n = to;
          while (n !== from) { n = prev[n]; out.push(n); }
          return out.reverse();
        }
        queue.push(next);
      }
    }
    return [from];
  }

  // World-space route from a position to a target node: node positions to steer through.
  routeTo(pos, targetNode) {
    const start = this.nearestNode(pos);
    return this.path(start, targetNode).map((i) => this.nodes[i]);
  }
}
