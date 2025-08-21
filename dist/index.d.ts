#!/usr/bin/env node
/**
 * MCP Error Logger - Centralized error tracking and analytics
 * Designed to work with Canonical Reference System and other MCP tools
 */
/**
 * Error log entry interface
 */
interface ErrorLog {
    id: string;
    timestamp: string;
    sessionId?: string;
    category: 'canonical' | 'tool' | 'protocol' | 'system' | 'user';
    severity: 'info' | 'warning' | 'error' | 'critical';
    source: string;
    message: string;
    details: any;
    context?: any;
    resolution?: string;
    resolved?: boolean;
}
/**
 * Error analytics interface
 */
interface ErrorAnalytics {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    errorsBySource: Record<string, number>;
    mostCommonErrors: Array<{
        message: string;
        count: number;
    }>;
    errorRate: number;
    lastError?: Date;
    timeRange: {
        start: Date;
        end: Date;
        hours: number;
    };
}
declare class ErrorLogger {
    private logDir;
    private errorLog;
    private analyticsCache;
    constructor(logDir?: string);
    private ensureLogDir;
    private generateId;
    /**
     * Log an error
     */
    logError(errorData: Partial<ErrorLog>): Promise<string>;
    /**
     * Get errors by category
     */
    getErrors(category?: string, limit?: number, severity?: string): Promise<ErrorLog[]>;
    /**
     * Get error analytics
     */
    getAnalytics(hours?: number): Promise<ErrorAnalytics>;
    /**
     * Mark an error as resolved
     */
    resolveError(errorId: string, resolution: string): Promise<boolean>;
    /**
     * Prune old errors
     */
    pruneErrors(olderThanDays?: number): Promise<number>;
    /**
     * Import errors from canonical reference system
     */
    importCanonicalErrors(canonicalLogPath: string): Promise<number>;
}
export { ErrorLogger };
//# sourceMappingURL=index.d.ts.map