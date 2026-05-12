export const cameraMinZoom = 0.2;
export const cameraMaxZoom = 1.1;
/** Overview mode allows zooming further out so dense maps fit on screen. */
export const overviewMinZoom = 0.1;
export const cameraZoomStep = 0.03;
export const cameraDragFriction = 0.92;

/** Off-screen visibility padding, as a fraction of screen dimensions. 0.5 = half a screen on each side. */
export const cullingMargin = 0.5;

/** Min ms between culling-bounds recomputations. Camera-move updates throttle to this rate. */
export const cullingRefreshIntervalMilliseconds = 200;
