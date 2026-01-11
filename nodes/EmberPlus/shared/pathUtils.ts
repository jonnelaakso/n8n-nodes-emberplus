/**
 * Ember+ Path Utilities
 *
 * Ember+ supports two path formats:
 * - Numeric paths: "0.0.1" (using node numbers in the tree)
 * - Identifier paths: "Root.Device.Parameter" (using node identifiers)
 */

export type PathSegment = string | number;

export interface ParsedPath {
	segments: PathSegment[];
	isNumeric: boolean;
	original: string;
}

export interface PathValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Determines if a path segment is numeric
 */
export function isNumericSegment(segment: string): boolean {
	return /^\d+$/.test(segment);
}

/**
 * Determines if the entire path is numeric (e.g., "0.0.1")
 */
export function isNumericPath(path: string): boolean {
	if (!path || path.trim() === '') {
		return false;
	}
	const segments = path.split('.');
	return segments.every((seg) => isNumericSegment(seg));
}

/**
 * Determines if the path is identifier-based (e.g., "Root.Device.Param")
 */
export function isIdentifierPath(path: string): boolean {
	if (!path || path.trim() === '') {
		return false;
	}
	return !isNumericPath(path);
}

/**
 * Parses an Ember+ path string into its components
 */
export function parsePath(path: string): ParsedPath {
	const trimmed = path.trim();

	if (!trimmed) {
		return {
			segments: [],
			isNumeric: false,
			original: path,
		};
	}

	const parts = trimmed.split('.');
	const isNumeric = parts.every((p) => isNumericSegment(p));

	const segments: PathSegment[] = parts.map((p) => {
		if (isNumericSegment(p)) {
			return parseInt(p, 10);
		}
		return p;
	});

	return {
		segments,
		isNumeric,
		original: path,
	};
}

/**
 * Validates an Ember+ path string
 */
export function validatePath(path: string): PathValidationResult {
	if (path === undefined || path === null) {
		return { valid: false, error: 'Path is required' };
	}

	const trimmed = path.trim();

	// Empty path is valid (represents root)
	if (trimmed === '') {
		return { valid: true };
	}

	// Check for invalid characters
	if (/[/\\:*?"<>|]/.test(trimmed)) {
		return { valid: false, error: 'Path contains invalid characters' };
	}

	// Check for empty segments (double dots)
	if (/\.\./.test(trimmed)) {
		return { valid: false, error: 'Path contains empty segments' };
	}

	// Check for leading or trailing dots
	if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
		return { valid: false, error: 'Path cannot start or end with a dot' };
	}

	const segments = trimmed.split('.');

	// Validate each segment
	for (const segment of segments) {
		if (segment.length === 0) {
			return { valid: false, error: 'Path contains empty segments' };
		}

		// Mixed paths (some numeric, some identifier) are valid in Ember+
		// but each segment should be valid on its own
		if (!isNumericSegment(segment) && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment)) {
			// Allow more flexible identifier names (spaces, special chars used in some devices)
			if (!/^[^.\n\r]+$/.test(segment)) {
				return { valid: false, error: `Invalid path segment: "${segment}"` };
			}
		}
	}

	return { valid: true };
}

/**
 * Normalizes a path by trimming whitespace and standardizing format
 */
export function normalizePath(path: string): string {
	if (!path) {
		return '';
	}

	return path
		.trim()
		.split('.')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.join('.');
}

/**
 * Joins path segments into a path string
 */
export function joinPath(...segments: PathSegment[]): string {
	return segments
		.map((s) => String(s).trim())
		.filter((s) => s.length > 0)
		.join('.');
}

/**
 * Appends a segment to an existing path
 */
export function appendToPath(basePath: string, segment: PathSegment): string {
	const normalized = normalizePath(basePath);
	const segmentStr = String(segment).trim();

	if (!normalized) {
		return segmentStr;
	}

	if (!segmentStr) {
		return normalized;
	}

	return `${normalized}.${segmentStr}`;
}

/**
 * Gets the parent path (removes the last segment)
 */
export function getParentPath(path: string): string {
	const normalized = normalizePath(path);

	if (!normalized) {
		return '';
	}

	const segments = normalized.split('.');

	if (segments.length <= 1) {
		return '';
	}

	return segments.slice(0, -1).join('.');
}

/**
 * Gets the last segment (leaf) of a path
 */
export function getLeafSegment(path: string): PathSegment {
	const normalized = normalizePath(path);

	if (!normalized) {
		return '';
	}

	const segments = normalized.split('.');
	const last = segments[segments.length - 1];

	if (isNumericSegment(last)) {
		return parseInt(last, 10);
	}

	return last;
}

/**
 * Gets the depth (number of segments) of a path
 */
export function getPathDepth(path: string): number {
	const normalized = normalizePath(path);

	if (!normalized) {
		return 0;
	}

	return normalized.split('.').length;
}

/**
 * Checks if a path is a descendant of another path
 */
export function isDescendantOf(path: string, ancestorPath: string): boolean {
	const normalizedPath = normalizePath(path);
	const normalizedAncestor = normalizePath(ancestorPath);

	if (!normalizedAncestor) {
		// Everything is a descendant of root
		return normalizedPath.length > 0;
	}

	if (!normalizedPath) {
		return false;
	}

	return normalizedPath.startsWith(normalizedAncestor + '.');
}

/**
 * Checks if a path is a direct child of another path
 */
export function isChildOf(path: string, parentPath: string): boolean {
	if (!isDescendantOf(path, parentPath)) {
		return false;
	}

	const normalizedPath = normalizePath(path);
	const normalizedParent = normalizePath(parentPath);

	const pathDepth = getPathDepth(normalizedPath);
	const parentDepth = getPathDepth(normalizedParent);

	return pathDepth === parentDepth + 1;
}

/**
 * Converts a numeric path array to a path string
 */
export function numericArrayToPath(numbers: number[]): string {
	return numbers.join('.');
}

/**
 * Converts a path string to a numeric array (only works for numeric paths)
 */
export function pathToNumericArray(path: string): number[] | null {
	const normalized = normalizePath(path);

	if (!normalized) {
		return [];
	}

	if (!isNumericPath(normalized)) {
		return null;
	}

	return normalized.split('.').map((s) => parseInt(s, 10));
}

/**
 * Escapes special characters in an identifier for use in a path
 */
export function escapeIdentifier(identifier: string): string {
	// Ember+ identifiers shouldn't contain dots
	// If they do, we need to handle them specially
	return identifier.replace(/\./g, '_');
}

/**
 * Compares two paths for equality (normalized comparison)
 */
export function pathsEqual(path1: string, path2: string): boolean {
	return normalizePath(path1) === normalizePath(path2);
}

/**
 * Sorts paths by depth (shallow first) and then alphabetically
 */
export function sortPaths(paths: string[]): string[] {
	return [...paths].sort((a, b) => {
		const depthA = getPathDepth(a);
		const depthB = getPathDepth(b);

		if (depthA !== depthB) {
			return depthA - depthB;
		}

		return normalizePath(a).localeCompare(normalizePath(b));
	});
}
