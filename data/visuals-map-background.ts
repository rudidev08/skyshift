/** Shared background settings — applies to all maps. Map-specific nebula placements live in data/map-nebulas.ts. */
export const backgroundConfig = {
  backgroundColor: "#0a0a1a", // deep navy, visible behind star layers
  backgroundScale: 2,         // tile scale for both star layers
  parallaxFar: 0.3,           // distant star layer scroll speed (0 = fixed, 1 = moves with camera)
  parallaxNear: 0.7,          // near star layer scroll speed
};
