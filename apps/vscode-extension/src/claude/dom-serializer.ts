import type { DOMElementContext } from './prompt-context';
import { Logger } from './logger';

/**
 * Serializes DOM elements from browser context into structured data
 */
export class DOMSerializer {
  private readonly logger = new Logger('DOMSerializer');
  private readonly MAX_TEXT_LENGTH = 1000;
  private readonly MAX_ATTRIBUTE_LENGTH = 200;
  private readonly MAX_DEPTH = 5;

  /**
   * Serialize DOM element data from browser
   */
  serializeDOMElement(elementData: any, depth = 0): DOMElementContext | null {
    try {
      if (!elementData || depth > this.MAX_DEPTH) {
        return null;
      }

      const element: DOMElementContext = {
        tagName: this.normalizeTagName(elementData.tagName),
        attributes: this.extractAttributes(elementData.attributes),
        isVisible: elementData.isVisible !== false,
      };

      // Add optional identification
      if (elementData.id) element.id = elementData.id;
      if (elementData.className) element.className = elementData.className;
      if (elementData.xpath) element.xpath = elementData.xpath;
      if (elementData.selector) element.selector = elementData.selector;

      // Add content
      if (elementData.textContent) {
        element.textContent = this.truncateText(
          elementData.textContent,
          this.MAX_TEXT_LENGTH,
        );
      }
      if (elementData.innerHTML && this.shouldIncludeHTML(element.tagName)) {
        element.innerHTML = this.truncateText(
          elementData.innerHTML,
          this.MAX_TEXT_LENGTH,
        );
      }

      // Add position info
      if (elementData.boundingBox) {
        element.boundingBox = {
          x: Math.round(elementData.boundingBox.x || 0),
          y: Math.round(elementData.boundingBox.y || 0),
          width: Math.round(elementData.boundingBox.width || 0),
          height: Math.round(elementData.boundingBox.height || 0),
        };
      }

      // Add computed styles if provided
      if (elementData.computedStyles) {
        element.computedStyles = this.extractRelevantStyles(
          elementData.computedStyles,
        );
      }

      // Add event listeners if detected
      if (elementData.eventListeners && elementData.eventListeners.length > 0) {
        element.eventListeners = elementData.eventListeners;
      }

      // Process children recursively (limited depth)
      if (elementData.children && depth < this.MAX_DEPTH - 1) {
        const childElements = elementData.children
          .map((child: any) => this.serializeDOMElement(child, depth + 1))
          .filter((child: any) => child !== null);

        if (childElements.length > 0) {
          element.childElements = childElements;
        }
      }

      return element;
    } catch (error) {
      this.logger.error('Failed to serialize DOM element', error);
      return null;
    }
  }

  /**
   * Serialize multiple DOM elements
   */
  serializeDOMElements(elementsData: any[]): DOMElementContext[] {
    if (!Array.isArray(elementsData)) {
      return [];
    }

    return elementsData
      .map((elementData) => this.serializeDOMElement(elementData))
      .filter((element): element is DOMElementContext => element !== null);
  }

  /**
   * Extract and normalize attributes
   */
  private extractAttributes(attributes: any): Record<string, string> {
    const extracted: Record<string, string> = {};

    if (!attributes || typeof attributes !== 'object') {
      return extracted;
    }

    // Important attributes to always include
    const importantAttrs = [
      'id',
      'class',
      'name',
      'type',
      'href',
      'src',
      'alt',
      'title',
      'placeholder',
      'value',
      'data-testid',
      'data-test',
      'aria-label',
      'aria-describedby',
      'role',
    ];

    for (const [key, value] of Object.entries(attributes)) {
      // Include important attributes or data attributes
      if (
        importantAttrs.includes(key.toLowerCase()) ||
        key.startsWith('data-') ||
        key.startsWith('aria-')
      ) {
        extracted[key] = this.truncateText(
          String(value),
          this.MAX_ATTRIBUTE_LENGTH,
        );
      }
    }

    return extracted;
  }

  /**
   * Extract relevant computed styles
   */
  private extractRelevantStyles(styles: any): Record<string, string> {
    const relevant: Record<string, string> = {};

    if (!styles || typeof styles !== 'object') {
      return relevant;
    }

    // Styles that are often relevant for understanding UI
    const relevantProps = [
      'display',
      'position',
      'visibility',
      'opacity',
      'color',
      'backgroundColor',
      'fontSize',
      'fontWeight',
      'width',
      'height',
      'margin',
      'padding',
      'border',
      'zIndex',
      'overflow',
      'cursor',
    ];

    for (const prop of relevantProps) {
      if (prop in styles && styles[prop]) {
        relevant[prop] = String(styles[prop]);
      }
    }

    return relevant;
  }

  /**
   * Normalize tag name
   */
  private normalizeTagName(tagName: any): string {
    if (!tagName || typeof tagName !== 'string') {
      return 'unknown';
    }
    return tagName.toLowerCase();
  }

  /**
   * Determine if HTML content should be included
   */
  private shouldIncludeHTML(tagName: string): boolean {
    // Don't include HTML for large container elements
    const excludeTags = ['body', 'html', 'main', 'section', 'article', 'div'];
    return !excludeTags.includes(tagName.toLowerCase());
  }

  /**
   * Truncate text to maximum length
   */
  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength)}...`;
  }

  /**
   * Generate human-readable description of DOM element
   */
  generateElementDescription(element: DOMElementContext): string {
    const parts: string[] = [];

    // Basic element info
    parts.push(`<${element.tagName}`);

    if (element.id) {
      parts.push(`id="${element.id}"`);
    }

    if (element.className) {
      parts.push(`class="${element.className}"`);
    }

    parts.push('>');

    // Add key attributes
    const keyAttrs = ['type', 'name', 'placeholder', 'aria-label'];
    const attrs = keyAttrs
      .filter((attr) => element.attributes[attr])
      .map((attr) => `${attr}="${element.attributes[attr]}"`)
      .join(' ');

    if (attrs) {
      parts.push(`(${attrs})`);
    }

    // Add text content preview
    if (element.textContent) {
      const preview = element.textContent.substring(0, 50);
      parts.push(
        `- "${preview}${element.textContent.length > 50 ? '...' : ''}"`,
      );
    }

    // Add visibility info
    if (!element.isVisible) {
      parts.push('[hidden]');
    }

    // Add position info
    if (element.boundingBox) {
      const { x, y, width, height } = element.boundingBox;
      parts.push(`@ (${x},${y}) ${width}x${height}`);
    }

    return parts.join(' ');
  }

  /**
   * Extract form data from DOM elements
   */
  extractFormData(elements: DOMElementContext[]): Record<string, any> {
    const formData: Record<string, any> = {};

    for (const element of elements) {
      if (this.isFormElement(element)) {
        const name =
          element.attributes.name ||
          element.attributes.id ||
          `${element.tagName}_${Object.keys(formData).length}`;

        const value = this.getElementValue(element);
        if (value !== undefined) {
          formData[name] = value;
        }
      }

      // Recursively check children
      if (element.childElements) {
        Object.assign(formData, this.extractFormData(element.childElements));
      }
    }

    return formData;
  }

  /**
   * Check if element is a form element
   */
  private isFormElement(element: DOMElementContext): boolean {
    const formTags = ['input', 'select', 'textarea', 'button'];
    return formTags.includes(element.tagName.toLowerCase());
  }

  /**
   * Get value from form element
   */
  private getElementValue(element: DOMElementContext): any {
    const tagName = element.tagName.toLowerCase();
    const type = element.attributes.type?.toLowerCase();

    // Handle different input types
    if (tagName === 'input') {
      if (type === 'checkbox' || type === 'radio') {
        return element.attributes.checked === 'true';
      }
      return element.attributes.value || '';
    }

    // Handle select elements
    if (tagName === 'select') {
      // Would need selected option info from children
      return element.attributes.value || '';
    }

    // Handle textarea
    if (tagName === 'textarea') {
      return element.textContent || '';
    }

    return undefined;
  }

  /**
   * Find elements by selector path
   */
  findElementsByPath(
    elements: DOMElementContext[],
    path: string,
  ): DOMElementContext[] {
    const results: DOMElementContext[] = [];
    const pathParts = path.split(' > ').map((p) => p.trim());

    function matchElement(
      element: DOMElementContext,
      pathIndex: number,
    ): boolean {
      if (pathIndex >= pathParts.length) return true;

      const part = pathParts[pathIndex];
      const [tagName, ...modifiers] = part.split(/[.#\[]/).filter(Boolean);

      // Check tag name
      if (tagName && element.tagName.toLowerCase() !== tagName.toLowerCase()) {
        return false;
      }

      // Check modifiers (class, id, attributes)
      for (const modifier of modifiers) {
        if (part.includes(`#${modifier}`) && element.id !== modifier) {
          return false;
        }
        if (
          part.includes(`.${modifier}`) &&
          !element.className?.includes(modifier)
        ) {
          return false;
        }
      }

      return true;
    }

    function searchElements(
      elements: DOMElementContext[],
      pathIndex: number,
    ): void {
      for (const element of elements) {
        if (matchElement(element, pathIndex)) {
          if (pathIndex === pathParts.length - 1) {
            results.push(element);
          } else if (element.childElements) {
            searchElements(element.childElements, pathIndex + 1);
          }
        }
      }
    }

    searchElements(elements, 0);
    return results;
  }
}
