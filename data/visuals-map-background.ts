/** The scrolling parallax starfield behind the map canvas, visible the whole time during gameplay and overview mode. */
export const backgroundConfig = {
  color: "#0a0a1a", // visible behind star layers
  tileScale: 2, // tile scale for both star layers
  parallaxFar: 0.3, // distant star layer scroll speed (0 = fixed, 1 = moves with camera)
  parallaxNear: 0.7, // near star layer scroll speed
};
