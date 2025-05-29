import { Logger } from '../logger';
import { ClaudeModel } from '../config-types';
import type {
  ClaudeSettings,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './settings-types';

type Validator = (
  value: any,
  settings: Partial<ClaudeSettings>,
) => ValidationResult;

interface ValidationRule {
  required?: boolean;
  type?: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  custom?: Validator;
  message?: string;
}

/**
 * Validates all configuration values
 */
export class SettingsValidator {
  private readonly logger = new Logger('SettingsValidator');
  private customValidators = new Map<string, Validator>();

  private readonly validationRules: Record<string, ValidationRule> = {
    'api.key': {
      required: true,
      pattern: /^sk-ant-[a-zA-Z0-9\-_]+$/,
      message: 'API key must start with sk-ant-',
    },
    'api.endpoint': {
      type: 'string',
      pattern: /^https?:\/\/.+$/,
      message: 'Endpoint must be a valid URL',
    },
    'api.timeout': {
      type: 'number',
      min: 1000,
      max: 300000,
      message: 'Timeout must be between 1 and 300 seconds',
    },
    'api.maxRetries': {
      type: 'number',
      min: 0,
      max: 10,
      message: 'Max retries must be between 0 and 10',
    },
    'model.name': {
      required: true,
      enum: Object.values(ClaudeModel),
      message: 'Invalid model name',
    },
    'model.temperature': {
      type: 'number',
      min: 0,
      max: 1,
      message: 'Temperature must be between 0 and 1',
    },
    'model.maxTokens': {
      type: 'number',
      min: 1,
      max: 200000,
      message: 'Max tokens must be between 1 and 200,000',
    },
    'model.topP': {
      type: 'number',
      min: 0,
      max: 1,
      message: 'Top P must be between 0 and 1',
    },
    'model.topK': {
      type: 'number',
      min: 1,
      max: 500,
      message: 'Top K must be between 1 and 500',
    },
    'context.maxFileSize': {
      type: 'number',
      min: 1024,
      max: 10 * 1024 * 1024,
      message: 'Max file size must be between 1KB and 10MB',
    },
    'context.maxFiles': {
      type: 'number',
      min: 1,
      max: 100,
      message: 'Max files must be between 1 and 100',
    },
    'behavior.retryDelay': {
      type: 'number',
      min: 100,
      max: 60000,
      message: 'Retry delay must be between 100ms and 60s',
    },
    'ui.theme': {
      enum: ['light', 'dark', 'auto'],
      message: 'Theme must be light, dark, or auto',
    },
    'advanced.proxy.port': {
      type: 'number',
      min: 1,
      max: 65535,
      message: 'Port must be between 1 and 65535',
    },
  };

  /**
   * Validate settings
   */
  validate(settings: Partial<ClaudeSettings>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate each field
    this.validateObject(settings, '', errors, warnings, settings);

    // Run custom validators
    for (const [key, validator] of this.customValidators) {
      const result = validator(this.getValueByPath(settings, key), settings);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }

    // Add cross-field validations
    this.validateCrossFields(settings, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a specific field
   */
  validateField(key: string, value: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const rule = this.validationRules[key];

    if (rule) {
      this.validateValue(key, value, rule, errors, warnings, {});
    }

    // Check custom validator
    const customValidator = this.customValidators.get(key);
    if (customValidator) {
      const result = customValidator(value, { [key]: value });
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get validation rules
   */
  getValidationRules(): Record<string, ValidationRule> {
    return { ...this.validationRules };
  }

  /**
   * Add custom validator
   */
  addCustomValidator(key: string, validator: Validator): void {
    this.customValidators.set(key, validator);
    this.logger.info(`Added custom validator for ${key}`);
  }

  /**
   * Validate an object recursively
   */
  private validateObject(
    obj: any,
    prefix: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    fullSettings: Partial<ClaudeSettings>,
  ): void {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const rule = this.validationRules[fullKey];

      if (rule) {
        this.validateValue(
          fullKey,
          value,
          rule,
          errors,
          warnings,
          fullSettings,
        );
      }

      // Recurse for nested objects
      if (typeof value === 'object' && !Array.isArray(value)) {
        this.validateObject(value, fullKey, errors, warnings, fullSettings);
      }
    }

    // Check required fields
    this.checkRequiredFields(prefix, obj, errors);
  }

  /**
   * Validate a single value
   */
  private validateValue(
    key: string,
    value: any,
    rule: ValidationRule,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    fullSettings: Partial<ClaudeSettings>,
  ): void {
    // Type validation
    if (rule.type) {
      const actualType = typeof value;
      if (actualType !== rule.type) {
        errors.push({
          key,
          message: rule.message || `${key} must be of type ${rule.type}`,
          value,
        });
        return;
      }
    }

    // Enum validation
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push({
        key,
        message:
          rule.message || `${key} must be one of: ${rule.enum.join(', ')}`,
        value,
        suggestion: `Valid values: ${rule.enum.join(', ')}`,
      });
    }

    // Pattern validation
    if (
      rule.pattern &&
      typeof value === 'string' &&
      !rule.pattern.test(value)
    ) {
      errors.push({
        key,
        message: rule.message || `${key} does not match required pattern`,
        value,
      });
    }

    // Range validation
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push({
          key,
          message: rule.message || `${key} must be at least ${rule.min}`,
          value,
          suggestion: `Set to ${rule.min} or higher`,
        });
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push({
          key,
          message: rule.message || `${key} must be at most ${rule.max}`,
          value,
          suggestion: `Set to ${rule.max} or lower`,
        });
      }
    }

    // Custom validation
    if (rule.custom) {
      const result = rule.custom(value, fullSettings);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  /**
   * Check required fields
   */
  private checkRequiredFields(
    prefix: string,
    obj: any,
    errors: ValidationError[],
  ): void {
    for (const [key, rule] of Object.entries(this.validationRules)) {
      if (!rule.required) continue;

      if (key.startsWith(prefix)) {
        const fieldKey = key.substring(prefix.length + 1);
        if (!fieldKey.includes('.')) {
          const value = obj[fieldKey];
          if (value === undefined || value === null || value === '') {
            errors.push({
              key,
              message: `${key} is required`,
              value: undefined,
            });
          }
        }
      }
    }
  }

  /**
   * Validate cross-field dependencies
   */
  private validateCrossFields(
    settings: Partial<ClaudeSettings>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    // Temperature and Top P warning
    if (
      settings.model?.temperature !== undefined &&
      settings.model?.topP !== undefined &&
      settings.model.temperature > 0.8 &&
      settings.model.topP < 0.9
    ) {
      warnings.push({
        key: 'model',
        message:
          'High temperature with low top-p may produce inconsistent results',
        impact: 'Consider increasing top-p or decreasing temperature',
      });
    }

    // Proxy configuration
    if (settings.advanced?.proxy?.enabled) {
      if (!settings.advanced.proxy.host) {
        errors.push({
          key: 'advanced.proxy.host',
          message: 'Proxy host is required when proxy is enabled',
          value: undefined,
        });
      }
      if (!settings.advanced.proxy.port) {
        errors.push({
          key: 'advanced.proxy.port',
          message: 'Proxy port is required when proxy is enabled',
          value: undefined,
        });
      }
    }

    // File context warnings
    if (settings.context?.maxFiles && settings.context.maxFiles > 50) {
      warnings.push({
        key: 'context.maxFiles',
        message: 'Large number of files may slow down processing',
        impact:
          'Consider reducing max files or using more specific file patterns',
      });
    }

    // API key and endpoint consistency
    if (
      settings.api?.key &&
      settings.api?.endpoint &&
      settings.api.key.startsWith('sk-ant-') &&
      !settings.api.endpoint.includes('anthropic')
    ) {
      warnings.push({
        key: 'api.endpoint',
        message: 'Using Anthropic API key with non-Anthropic endpoint',
        impact: 'This may not work as expected',
      });
    }

    // Debug mode warning
    if (settings.advanced?.debugMode) {
      warnings.push({
        key: 'advanced.debugMode',
        message: 'Debug mode is enabled',
        impact: 'This may expose sensitive information in logs',
      });
    }
  }

  /**
   * Get value by path
   */
  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      value = value?.[key];
    }

    return value;
  }

  /**
   * Create validation function for async validation
   */
  createAsyncValidator(
    key: string,
    validator: (value: any) => Promise<ValidationResult>,
  ): Validator {
    return (value: any, settings: Partial<ClaudeSettings>) => {
      // Return immediate result, async validation happens separately
      return {
        valid: true,
        errors: [],
        warnings: [
          {
            key,
            message: 'Async validation pending',
          },
        ],
      };
    };
  }

  /**
   * Validate API key with Claude API
   */
  async validateApiKey(apiKey: string): Promise<ValidationResult> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        }),
      });

      if (response.status === 401) {
        return {
          valid: false,
          errors: [
            {
              key: 'api.key',
              message: 'Invalid API key',
              value: apiKey,
              suggestion: 'Check your API key at https://console.anthropic.com',
            },
          ],
          warnings: [],
        };
      }

      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            key: 'api.key',
            message: 'Failed to validate API key',
            value: apiKey,
            suggestion: 'Check your internet connection',
          },
        ],
        warnings: [],
      };
    }
  }
}
