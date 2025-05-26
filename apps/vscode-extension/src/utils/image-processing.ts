import * as vscode from 'vscode';

export interface ImageData {
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'png' | 'jpeg' | 'webp';
}

/**
 * Converts a data URI to base64 string
 */
export function dataUriToBase64(dataUri: string): string {
  const matches = dataUri.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid data URI');
  }
  return matches[2];
}

/**
 * Converts base64 string to data URI
 */
export function base64ToDataUri(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Validates if a string is valid base64
 */
export function isValidBase64(str: string): boolean {
  try {
    return btoa(atob(str)) === str;
  } catch (err) {
    return false;
  }
}

/**
 * Gets image dimensions from base64 data
 * Note: This is a placeholder - actual implementation would require image parsing
 */
export async function getImageDimensions(
  base64: string,
  mimeType: string,
): Promise<{ width: number; height: number }> {
  // TODO: Implement actual image dimension detection
  // This would require using a library like sharp or jimp
  return { width: 0, height: 0 };
}

/**
 * Optimizes an image for Claude API
 * Claude has limits on image size, so we need to ensure images are within bounds
 */
export async function optimizeImageForClaude(
  imageData: ImageData,
): Promise<ImageData> {
  // Claude's image size limits:
  // - Max 5MB per image
  // - Recommended max dimensions: 2048x2048

  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  const MAX_DIMENSION = 2048;

  // Calculate current size
  const currentSizeBytes = (imageData.base64.length * 3) / 4; // Approximate base64 to bytes

  if (currentSizeBytes <= MAX_SIZE_BYTES) {
    return imageData;
  }

  // TODO: Implement actual image resizing
  // For now, return the original image with a warning
  vscode.window.showWarningMessage(
    `Image size (${Math.round(currentSizeBytes / 1024 / 1024)}MB) exceeds Claude's 5MB limit. Consider resizing.`,
  );

  return imageData;
}

/**
 * Creates a cache key for an image
 */
export function createImageCacheKey(
  source: string,
  options?: ImageProcessingOptions,
): string {
  const optionsStr = options ? JSON.stringify(options) : '';
  return `${source}_${optionsStr}`;
}

/**
 * Simple in-memory cache for processed images
 */
class ImageCache {
  private cache = new Map<string, ImageData>();
  private maxSize = 50; // Max number of cached images

  set(key: string, data: ImageData): void {
    // Simple LRU: remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, data);
  }

  get(key: string): ImageData | undefined {
    const data = this.cache.get(key);
    if (data) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, data);
    }
    return data;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const imageCache = new ImageCache();

/**
 * Captures a screenshot from VSCode
 * Note: VSCode doesn't have a built-in screenshot API, so this is a placeholder
 */
export async function captureVSCodeScreenshot(
  target: 'editor' | 'webview' | 'full',
): Promise<ImageData | null> {
  // TODO: Implement actual screenshot capture
  // This might require:
  // 1. Using VSCode's webview API if capturing a webview
  // 2. Using system-level screenshot tools
  // 3. Or requesting the browser toolbar to capture and send the screenshot

  vscode.window.showInformationMessage(
    `Screenshot capture for '${target}' is not yet implemented. This will be handled by the browser toolbar.`,
  );

  return null;
}
