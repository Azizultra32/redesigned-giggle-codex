/**
 * DOM Utilities
 *
 * DOM element identification for overlay positioning.
 * Used by extension to position Ferrari overlay on EMR pages.
 */

export interface DOMElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  rect?: DOMRect;
  attributes?: Record<string, string>;
}

export interface DOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DOMSnapshot {
  timestamp: number;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: DOMElement[];
}

/**
 * Create a stable selector for an element
 */
export function createSelector(element: DOMElement): string {
  // Priority: ID > unique class > tag + index
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.className) {
    const classes = element.className.split(' ').filter(Boolean);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
  }

  return element.tagName.toLowerCase();
}

/**
 * Find best anchor point for overlay
 * Looks for common EMR patterns
 */
export function findAnchorElement(snapshot: DOMSnapshot): DOMElement | null {
  // Common EMR anchor patterns
  const patterns = [
    { id: 'patient-header' },
    { id: 'encounter-form' },
    { className: 'chart-container' },
    { className: 'patient-info' },
    { tagName: 'MAIN' },
    { tagName: 'ARTICLE' }
  ];

  for (const pattern of patterns) {
    const match = snapshot.elements.find((el) => {
      if (pattern.id && el.id === pattern.id) return true;
      if (pattern.className && el.className?.includes(pattern.className)) return true;
      if (pattern.tagName && el.tagName === pattern.tagName) return true;
      return false;
    });

    if (match) return match;
  }

  return null;
}

/**
 * Calculate overlay position relative to anchor
 */
export function calculateOverlayPosition(
  anchor: DOMElement,
  overlayWidth: number,
  overlayHeight: number,
  viewport: { width: number; height: number }
): { top: number; left: number; position: 'right' | 'left' | 'bottom' } {
  const rect = anchor.rect;

  if (!rect) {
    // Default to bottom-right corner
    return {
      top: viewport.height - overlayHeight - 20,
      left: viewport.width - overlayWidth - 20,
      position: 'right'
    };
  }

  // Prefer right side if space available
  const rightSpace = viewport.width - rect.right;
  if (rightSpace >= overlayWidth + 20) {
    return {
      top: rect.top,
      left: rect.right + 10,
      position: 'right'
    };
  }

  // Try left side
  if (rect.left >= overlayWidth + 20) {
    return {
      top: rect.top,
      left: rect.left - overlayWidth - 10,
      position: 'left'
    };
  }

  // Fall back to bottom
  return {
    top: rect.bottom + 10,
    left: Math.max(10, (viewport.width - overlayWidth) / 2),
    position: 'bottom'
  };
}

/**
 * Serialize DOM rect for transport
 */
export function serializeDOMRect(rect: DOMRect): DOMRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left
  };
}
