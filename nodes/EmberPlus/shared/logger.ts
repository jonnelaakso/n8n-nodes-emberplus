/**
 * Ember+ Logger Utility
 *
 * Provides structured logging for debugging Ember+ operations.
 * Respects LOG_LEVEL environment variable.
 */

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	NONE = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: 'DEBUG',
	[LogLevel.INFO]: 'INFO',
	[LogLevel.WARN]: 'WARN',
	[LogLevel.ERROR]: 'ERROR',
	[LogLevel.NONE]: 'NONE',
};

function getLogLevelFromEnv(): LogLevel {
	const envLevel = process.env.EMBER_PLUS_LOG_LEVEL?.toUpperCase();
	switch (envLevel) {
		case 'DEBUG':
			return LogLevel.DEBUG;
		case 'INFO':
			return LogLevel.INFO;
		case 'WARN':
			return LogLevel.WARN;
		case 'ERROR':
			return LogLevel.ERROR;
		case 'NONE':
			return LogLevel.NONE;
		default:
			// Default to WARN in production, DEBUG if explicitly requested
			return process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN;
	}
}

export class EmberPlusLogger {
	private readonly prefix: string;
	private readonly minLevel: LogLevel;

	constructor(context?: string) {
		this.prefix = context ? `[EmberPlus:${context}]` : '[EmberPlus]';
		this.minLevel = getLogLevelFromEnv();
	}

	private formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
		const timestamp = new Date().toISOString();
		const levelName = LOG_LEVEL_NAMES[level];
		let formatted = `${timestamp} ${levelName} ${this.prefix} ${message}`;

		if (data && Object.keys(data).length > 0) {
			formatted += ` ${JSON.stringify(data)}`;
		}

		return formatted;
	}

	private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
		if (level < this.minLevel) {
			return;
		}

		const formatted = this.formatMessage(level, message, data);

		switch (level) {
			case LogLevel.DEBUG:
			case LogLevel.INFO:
				console.log(formatted);
				break;
			case LogLevel.WARN:
				console.warn(formatted);
				break;
			case LogLevel.ERROR:
				console.error(formatted);
				break;
		}
	}

	debug(message: string, data?: Record<string, unknown>): void {
		this.log(LogLevel.DEBUG, message, data);
	}

	info(message: string, data?: Record<string, unknown>): void {
		this.log(LogLevel.INFO, message, data);
	}

	warn(message: string, data?: Record<string, unknown>): void {
		this.log(LogLevel.WARN, message, data);
	}

	error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
		const errorData: Record<string, unknown> = { ...data };

		if (error instanceof Error) {
			errorData.errorMessage = error.message;
			errorData.errorName = error.name;
			if (this.minLevel === LogLevel.DEBUG && error.stack) {
				errorData.stack = error.stack;
			}
		} else if (error !== undefined) {
			errorData.error = String(error);
		}

		this.log(LogLevel.ERROR, message, errorData);
	}

	/**
	 * Create a child logger with additional context
	 */
	child(context: string): EmberPlusLogger {
		const currentContext = this.prefix.replace('[EmberPlus:', '').replace(']', '');
		const newContext = currentContext ? `${currentContext}:${context}` : context;
		return new EmberPlusLogger(newContext);
	}

	/**
	 * Log operation start for debugging
	 */
	operationStart(operation: string, data?: Record<string, unknown>): void {
		this.debug(`Starting ${operation}`, data);
	}

	/**
	 * Log operation success for debugging
	 */
	operationSuccess(operation: string, data?: Record<string, unknown>): void {
		this.debug(`Completed ${operation}`, data);
	}

	/**
	 * Log operation failure
	 */
	operationFailed(operation: string, error: Error | unknown, data?: Record<string, unknown>): void {
		this.error(`Failed ${operation}`, error, data);
	}
}

// Default logger instance
export const logger = new EmberPlusLogger();

// Factory function for creating contextual loggers
export function createLogger(context: string): EmberPlusLogger {
	return new EmberPlusLogger(context);
}
