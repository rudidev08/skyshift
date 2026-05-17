/** Lets selection handlers ignore the pointer-up that ends a camera pan or drag-pan — without this, finishing a drag would select whatever happened to be under the release point. 10px tolerance covers shaky-hand release. */
export function isClickNotDrag(pointer: Phaser.Input.Pointer): boolean {
  return Math.abs(pointer.upX - pointer.downX) < 10 && Math.abs(pointer.upY - pointer.downY) < 10;
}
