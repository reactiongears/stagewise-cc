/**
 * DOM element type definitions for Claude prompt context
 */

/**
 * Serialized DOM element data from the browser
 */
export interface DOMElementData {
  /**
   * HTML tag name (e.g., 'div', 'button', 'input')
   */
  tagName: string;

  /**
   * Element attributes as key-value pairs
   */
  attributes: Record<string, string>;

  /**
   * Text content of the element (excluding child elements)
   */
  textContent?: string;

  /**
   * Inner HTML if needed for complex content
   */
  innerHTML?: string;

  /**
   * Element position and dimensions
   */
  boundingRect?: DOMRect;

  /**
   * CSS selector that uniquely identifies this element
   */
  selector: string;

  /**
   * Parent element data (limited depth to avoid circular references)
   */
  parent?: DOMElementData;

  /**
   * Child elements (limited depth)
   */
  children?: DOMElementData[];

  /**
   * Additional metadata about the element
   */
  metadata: DOMElementMetadata;
}

/**
 * Rectangle describing element position and size
 */
export interface DOMRect {
  /**
   * X coordinate relative to viewport
   */
  x: number;

  /**
   * Y coordinate relative to viewport
   */
  y: number;

  /**
   * Element width
   */
  width: number;

  /**
   * Element height
   */
  height: number;

  /**
   * Top position
   */
  top: number;

  /**
   * Right position
   */
  right: number;

  /**
   * Bottom position
   */
  bottom: number;

  /**
   * Left position
   */
  left: number;
}

/**
 * Metadata about a DOM element
 */
export interface DOMElementMetadata {
  /**
   * Whether the element is visible in the viewport
   */
  isVisible: boolean;

  /**
   * Whether the element is interactive (clickable, focusable, etc.)
   */
  isInteractive: boolean;

  /**
   * Whether the element has event listeners attached
   */
  hasEventListeners: boolean;

  /**
   * Relevant computed styles
   */
  computedStyles?: Record<string, string>;

  /**
   * Detected component type (React, Vue, etc.)
   */
  componentType?: string;

  /**
   * Component name if detectable
   */
  componentName?: string;

  /**
   * Accessibility information
   */
  accessibility?: AccessibilityInfo;

  /**
   * Element's role in the page structure
   */
  structuralRole?: StructuralRole;
}

/**
 * Accessibility information for an element
 */
export interface AccessibilityInfo {
  /**
   * ARIA role
   */
  role?: string;

  /**
   * Accessible label (aria-label, aria-labelledby, etc.)
   */
  label?: string;

  /**
   * Accessible description
   */
  description?: string;

  /**
   * ARIA landmarks this element belongs to
   */
  landmarks?: string[];

  /**
   * Whether the element is focusable
   */
  focusable: boolean;

  /**
   * Tab index value
   */
  tabIndex?: number;

  /**
   * ARIA properties
   */
  ariaProperties?: Record<string, string>;
}

/**
 * Structural role of an element in the page
 */
export enum StructuralRole {
  /**
   * Main navigation
   */
  NAVIGATION = 'navigation',

  /**
   * Page header
   */
  HEADER = 'header',

  /**
   * Page footer
   */
  FOOTER = 'footer',

  /**
   * Main content area
   */
  MAIN = 'main',

  /**
   * Sidebar
   */
  SIDEBAR = 'sidebar',

  /**
   * Form element
   */
  FORM = 'form',

  /**
   * Interactive control
   */
  CONTROL = 'control',

  /**
   * Content container
   */
  CONTAINER = 'container',

  /**
   * Unknown or other
   */
  OTHER = 'other',
}

/**
 * Options for serializing DOM elements
 */
export interface DOMSerializationOptions {
  /**
   * Maximum depth to traverse child elements
   */
  maxDepth: number;

  /**
   * Whether to include computed styles
   */
  includeStyles: boolean;

  /**
   * Whether to include accessibility information
   */
  includeAccessibility: boolean;

  /**
   * Maximum text content length
   */
  maxTextLength: number;

  /**
   * CSS properties to include in computed styles
   */
  styleProperties?: string[];

  /**
   * Whether to include innerHTML
   */
  includeInnerHTML: boolean;
}

/**
 * Default serialization options
 */
export const DEFAULT_SERIALIZATION_OPTIONS: DOMSerializationOptions = {
  maxDepth: 3,
  includeStyles: true,
  includeAccessibility: true,
  maxTextLength: 1000,
  styleProperties: [
    'display',
    'position',
    'width',
    'height',
    'color',
    'backgroundColor',
    'fontSize',
    'fontWeight',
    'margin',
    'padding',
    'border',
    'visibility',
    'opacity',
  ],
  includeInnerHTML: false,
};

/**
 * Validates if an object conforms to the DOMElementData interface
 */
export function validateDOMElementData(
  element: any,
): element is DOMElementData {
  return (
    element &&
    typeof element === 'object' &&
    typeof element.tagName === 'string' &&
    typeof element.attributes === 'object' &&
    typeof element.selector === 'string' &&
    element.metadata &&
    typeof element.metadata === 'object'
  );
}

/**
 * Creates a minimal DOMElementData object
 */
export function createDOMElementData(
  tagName: string,
  selector: string,
): DOMElementData {
  return {
    tagName,
    selector,
    attributes: {},
    metadata: {
      isVisible: true,
      isInteractive: false,
      hasEventListeners: false,
    },
  };
}

/**
 * Determines if an element is likely interactive
 */
export function isInteractiveElement(element: DOMElementData): boolean {
  const interactiveTags = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
  ];
  const hasClickHandler =
    !!element.attributes.onclick || element.metadata.hasEventListeners;
  const hasRole =
    element.attributes.role === 'button' || element.attributes.role === 'link';

  return (
    interactiveTags.includes(element.tagName.toLowerCase()) ||
    hasClickHandler ||
    hasRole ||
    element.metadata.isInteractive
  );
}

/**
 * Estimates the importance of a DOM element for context
 */
export function estimateElementImportance(element: DOMElementData): number {
  let score = 0;

  // Interactive elements are important
  if (isInteractiveElement(element)) {
    score += 50;
  }

  // Visible elements are more important
  if (element.metadata.isVisible) {
    score += 20;
  }

  // Elements with text content are important
  if (element.textContent && element.textContent.trim().length > 0) {
    score += 30;
  }

  // Structural elements are important
  if (
    element.metadata.structuralRole &&
    element.metadata.structuralRole !== StructuralRole.OTHER
  ) {
    score += 25;
  }

  // Accessible elements are important
  if (element.metadata.accessibility?.label) {
    score += 15;
  }

  return score;
}

/**
 * Serializes a DOM element to a compact string representation
 */
export function serializeDOMElement(
  element: DOMElementData,
  compact = true,
): string {
  if (compact) {
    const attrs = Object.entries(element.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');

    return `<${element.tagName}${attrs ? ` ${attrs}` : ''}>${element.textContent || ''}`;
  }

  return JSON.stringify(element, null, 2);
}

/**
 * Truncates text content to a maximum length
 */
export function truncateTextContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.substring(0, maxLength - 3)}...`;
}
