/**
 * ui/mapControls.js
 * Responsible for Map Viewport controls wiring:
 *   - Zoom In button (+)
 *   - Zoom Out button (−)
 *   - Reset View button
 *
 * Prevents event bubbling to Phaser to avoid unintended map clicks or robot dragging.
 */

/**
 * Set up map viewport controls.
 *
 * @param {{
 *   onZoomIn: Function,
 *   onZoomOut: Function,
 *   onResetView: Function
 * }} callbacks
 */
export function setupMapControls(callbacks) {
  const { onZoomIn, onZoomOut, onResetView } = callbacks;

  const container = document.getElementById('map-viewport-controls');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnReset = document.getElementById('btn-reset-view');

  // Prevent any pointer interaction on the overlay from bubbling to the Phaser canvas
  if (container) {
    const stopPropagationEvents = [
      'pointerdown',
      'pointerup',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'touchstart',
      'touchend'
    ];
    stopPropagationEvents.forEach((evt) => {
      container.addEventListener(evt, (e) => e.stopPropagation());
    });
  }

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      onZoomIn();
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      onZoomOut();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', (e) => {
      e.stopPropagation();
      onResetView();
    });
  }
}
