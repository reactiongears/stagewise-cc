export interface AuthCredentials {
  apiKey: string;
  lastValidated?: Date;
  isValid: boolean;
}

export interface AuthValidationResult {
  isValid: boolean;
  error?: string;
  capabilities?: string[];
}

export enum AuthStatus {
  NOT_CONFIGURED = 'not_configured',
  VALIDATING = 'validating',
  VALID = 'valid',
  INVALID = 'invalid',
  ERROR = 'error',
}

export interface AuthStatusChangeEvent {
  previousStatus: AuthStatus;
  currentStatus: AuthStatus;
  timestamp: Date;
}
