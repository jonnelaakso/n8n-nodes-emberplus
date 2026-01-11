/**
 * Ember+ Error Types and Utilities
 */

export enum EmberPlusErrorCode {
	CONNECTION_FAILED = 'CONNECTION_FAILED',
	CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
	NOT_CONNECTED = 'NOT_CONNECTED',
	DISCONNECTION_FAILED = 'DISCONNECTION_FAILED',
	PATH_NOT_FOUND = 'PATH_NOT_FOUND',
	INVALID_PATH = 'INVALID_PATH',
	INVALID_VALUE = 'INVALID_VALUE',
	OPERATION_FAILED = 'OPERATION_FAILED',
	SUBSCRIPTION_FAILED = 'SUBSCRIPTION_FAILED',
	PERMISSION_DENIED = 'PERMISSION_DENIED',
	DEVICE_ERROR = 'DEVICE_ERROR',
}

export interface EmberPlusErrorContext {
	code: EmberPlusErrorCode;
	path?: string;
	host?: string;
	port?: number;
	operation?: string;
	originalError?: Error;
}

export class EmberPlusError extends Error {
	public readonly code: EmberPlusErrorCode;
	public readonly context: Omit<EmberPlusErrorContext, 'code'>;
	public readonly timestamp: Date;

	constructor(message: string, context: EmberPlusErrorContext) {
		super(message);
		this.name = 'EmberPlusError';
		this.code = context.code;
		this.context = context;
		this.timestamp = new Date();

		// Maintains proper stack trace for where error was thrown
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, EmberPlusError);
		}
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			context: this.context,
			timestamp: this.timestamp.toISOString(),
			stack: this.stack,
		};
	}
}

/**
 * Factory functions for common errors
 */
export function createConnectionError(
	host: string,
	port: number,
	originalError?: Error,
): EmberPlusError {
	return new EmberPlusError(
		`Failed to connect to Ember+ device at ${host}:${port}${originalError ? `: ${originalError.message}` : ''}`,
		{
			code: EmberPlusErrorCode.CONNECTION_FAILED,
			host,
			port,
			originalError,
		},
	);
}

export function createTimeoutError(host: string, port: number, timeoutMs: number): EmberPlusError {
	return new EmberPlusError(
		`Connection to Ember+ device at ${host}:${port} timed out after ${timeoutMs}ms`,
		{
			code: EmberPlusErrorCode.CONNECTION_TIMEOUT,
			host,
			port,
		},
	);
}

export function createNotConnectedError(): EmberPlusError {
	return new EmberPlusError('Not connected to Ember+ device', {
		code: EmberPlusErrorCode.NOT_CONNECTED,
	});
}

export function createPathNotFoundError(path: string): EmberPlusError {
	return new EmberPlusError(`Node not found at path: ${path}`, {
		code: EmberPlusErrorCode.PATH_NOT_FOUND,
		path,
	});
}

export function createInvalidPathError(path: string, reason?: string): EmberPlusError {
	return new EmberPlusError(
		`Invalid path "${path}"${reason ? `: ${reason}` : ''}`,
		{
			code: EmberPlusErrorCode.INVALID_PATH,
			path,
		},
	);
}

export function createInvalidValueError(value: unknown, expectedType: string): EmberPlusError {
	return new EmberPlusError(
		`Invalid value "${String(value)}": expected ${expectedType}`,
		{
			code: EmberPlusErrorCode.INVALID_VALUE,
		},
	);
}

export function createOperationError(
	operation: string,
	path: string,
	originalError?: Error,
): EmberPlusError {
	return new EmberPlusError(
		`Operation "${operation}" failed for path "${path}"${originalError ? `: ${originalError.message}` : ''}`,
		{
			code: EmberPlusErrorCode.OPERATION_FAILED,
			operation,
			path,
			originalError,
		},
	);
}

/**
 * Type guard to check if error is EmberPlusError
 */
export function isEmberPlusError(error: unknown): error is EmberPlusError {
	return error instanceof EmberPlusError;
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return 'Unknown error occurred';
}

/**
 * Get appropriate error code for n8n NodeOperationError
 */
export function getNodeErrorDescription(error: EmberPlusError): string {
	switch (error.code) {
		case EmberPlusErrorCode.CONNECTION_FAILED:
			return 'Check that the Ember+ device is online and the host/port are correct';
		case EmberPlusErrorCode.CONNECTION_TIMEOUT:
			return 'The device did not respond in time. Check network connectivity or increase timeout';
		case EmberPlusErrorCode.NOT_CONNECTED:
			return 'Connection was lost. The workflow may need to be restarted';
		case EmberPlusErrorCode.PATH_NOT_FOUND:
			return 'Verify the path exists on the device using the Browse operation';
		case EmberPlusErrorCode.INVALID_PATH:
			return 'Check path format: use numeric (0.1.2) or identifier-based (Root.Device.Param) paths';
		case EmberPlusErrorCode.INVALID_VALUE:
			return 'Check that the value matches the expected parameter type';
		case EmberPlusErrorCode.PERMISSION_DENIED:
			return 'The device rejected the operation. Check if the parameter is writable';
		default:
			return 'An unexpected error occurred with the Ember+ device';
	}
}
