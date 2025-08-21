#!/usr/bin/env node

/**
 * MCP Error Logger - Centralized error tracking and analytics
 * Designed to work with Canonical Reference System and other MCP tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';

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
  mostCommonErrors: Array<{ message: string; count: number }>;
  errorRate: number; // errors per hour
  lastError?: Date;
  timeRange: {
    start: Date;
    end: Date;
    hours: number;
  };
}

class ErrorLogger {
  private logDir: string;
  private errorLog: string;
  private analyticsCache: Map<string, any> = new Map();

  constructor(logDir = '/Users/bard/Code/canonical-references/logs') {
    this.logDir = logDir;
    this.errorLog = path.join(logDir, 'system-errors.jsonl');
    this.ensureLogDir();
  }

  private async ensureLogDir() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  private generateId(): string {
    return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log an error
   */
  async logError(errorData: Partial<ErrorLog>): Promise<string> {
    const error: ErrorLog = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      category: errorData.category || 'system',
      severity: errorData.severity || 'error',
      source: errorData.source || 'unknown',
      message: errorData.message || 'Unknown error',
      details: errorData.details || {},
      context: errorData.context || {},
      sessionId: errorData.sessionId,
      resolved: false,
      ...errorData
    };

    try {
      await fs.appendFile(this.errorLog, JSON.stringify(error) + '\n');
      // Clear analytics cache since we have new data
      this.analyticsCache.clear();
      return error.id;
    } catch (writeError) {
      console.error('Failed to write error log:', writeError);
      throw new Error(`Failed to log error: ${writeError.message}`);
    }
  }

  /**
   * Get errors by category
   */
  async getErrors(
    category?: string,
    limit: number = 50,
    severity?: string
  ): Promise<ErrorLog[]> {
    try {
      const content = await fs.readFile(this.errorLog, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const errors: ErrorLog[] = [];

      for (const line of lines) {
        try {
          const error = JSON.parse(line) as ErrorLog;
          
          // Apply filters
          if (category && error.category !== category) continue;
          if (severity && error.severity !== severity) continue;
          
          errors.push(error);
        } catch (parseError) {
          console.error('Error parsing log line:', parseError);
        }
      }

      // Return most recent first, limited
      return errors.slice(-limit).reverse();
    } catch (readError) {
      if ((readError as any).code === 'ENOENT') {
        return []; // No log file yet
      }
      throw new Error(`Failed to read errors: ${readError.message}`);
    }
  }

  /**
   * Get error analytics
   */
  async getAnalytics(hours: number = 24): Promise<ErrorAnalytics> {
    const cacheKey = `analytics-${hours}`;
    
    if (this.analyticsCache.has(cacheKey)) {
      return this.analyticsCache.get(cacheKey);
    }

    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
    const errors = await this.getErrors();
    const recentErrors = errors.filter(error => 
      new Date(error.timestamp) >= cutoff
    );

    const analytics: ErrorAnalytics = {
      totalErrors: recentErrors.length,
      errorsByCategory: {},
      errorsBySeverity: {},
      errorsBySource: {},
      mostCommonErrors: [],
      errorRate: 0,
      timeRange: {
        start: cutoff,
        end: new Date(),
        hours
      }
    };

    // Count by category, severity, source
    const messageCounts: Record<string, number> = {};
    
    for (const error of recentErrors) {
      // By category
      analytics.errorsByCategory[error.category] = 
        (analytics.errorsByCategory[error.category] || 0) + 1;
      
      // By severity
      analytics.errorsBySeverity[error.severity] = 
        (analytics.errorsBySeverity[error.severity] || 0) + 1;
      
      // By source
      analytics.errorsBySource[error.source] = 
        (analytics.errorsBySource[error.source] || 0) + 1;
      
      // Message frequency
      messageCounts[error.message] = (messageCounts[error.message] || 0) + 1;
    }

    // Most common errors
    analytics.mostCommonErrors = Object.entries(messageCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    // Error rate (errors per hour)
    analytics.errorRate = recentErrors.length / hours;

    // Last error
    if (recentErrors.length > 0) {
      analytics.lastError = new Date(recentErrors[0].timestamp);
    }

    // Cache for 5 minutes
    this.analyticsCache.set(cacheKey, analytics);
    setTimeout(() => this.analyticsCache.delete(cacheKey), 5 * 60 * 1000);

    return analytics;
  }

  /**
   * Mark an error as resolved
   */
  async resolveError(errorId: string, resolution: string): Promise<boolean> {
    // For now, we'll just log the resolution as a new entry
    // In a full implementation, we'd update the original entry
    await this.logError({
      category: 'system',
      severity: 'info',
      source: 'error-logger',
      message: `Resolution for error ${errorId}`,
      details: { originalErrorId: errorId, resolution },
      resolved: true
    });
    
    this.analyticsCache.clear();
    return true;
  }

  /**
   * Prune old errors
   */
  async pruneErrors(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
    const errors = await this.getErrors(undefined, Infinity);
    
    const keptErrors = errors.filter(error => 
      new Date(error.timestamp) >= cutoff
    );
    
    // Rewrite the log file with only kept errors
    const newContent = keptErrors.map(error => JSON.stringify(error)).join('\n');
    if (newContent) {
      await fs.writeFile(this.errorLog, newContent + '\n');
    } else {
      await fs.writeFile(this.errorLog, '');
    }
    
    this.analyticsCache.clear();
    return errors.length - keptErrors.length;
  }

  /**
   * Import errors from canonical reference system
   */
  async importCanonicalErrors(canonicalLogPath: string): Promise<number> {
    try {
      const content = await fs.readFile(canonicalLogPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let imported = 0;

      for (const line of lines) {
        try {
          const canonicalError = JSON.parse(line);
          
          // Convert to our format
          await this.logError({
            category: 'canonical',
            severity: canonicalError.severity || 'warning',
            source: 'canonical-resolver',
            message: canonicalError.message || 'Canonical resolution failed',
            details: {
              key: canonicalError.key || canonicalError.reference,
              fallback: canonicalError.fallback,
              originalError: canonicalError
            },
            context: canonicalError.context,
            sessionId: canonicalError.sessionId,
            timestamp: canonicalError.timestamp
          });
          
          imported++;
        } catch (parseError) {
          console.error('Error parsing canonical log line:', parseError);
        }
      }

      return imported;
    } catch (readError) {
      throw new Error(`Failed to import canonical errors: ${readError.message}`);
    }
  }
}

const server = new Server(
  {
    name: 'error-logger',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const errorLogger = new ErrorLogger();

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'error_log',
        description: 'Log an error to the centralized error tracking system',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['canonical', 'tool', 'protocol', 'system', 'user'],
              description: 'Error category'
            },
            severity: {
              type: 'string',
              enum: ['info', 'warning', 'error', 'critical'],
              description: 'Error severity level'
            },
            source: {
              type: 'string',
              description: 'Source system that generated the error'
            },
            message: {
              type: 'string',
              description: 'Error message'
            },
            details: {
              type: 'object',
              description: 'Additional error details'
            },
            context: {
              type: 'object',
              description: 'Context information'
            },
            sessionId: {
              type: 'string',
              description: 'Session identifier'
            }
          },
          required: ['message', 'source']
        }
      },
      {
        name: 'error_get',
        description: 'Retrieve errors by category, severity, or other filters',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['canonical', 'tool', 'protocol', 'system', 'user'],
              description: 'Filter by error category'
            },
            severity: {
              type: 'string',
              enum: ['info', 'warning', 'error', 'critical'],
              description: 'Filter by error severity'
            },
            limit: {
              type: 'number',
              default: 50,
              description: 'Maximum number of errors to return'
            }
          }
        }
      },
      {
        name: 'error_analytics',
        description: 'Get error analytics and statistics',
        inputSchema: {
          type: 'object',
          properties: {
            hours: {
              type: 'number',
              default: 24,
              description: 'Time range in hours for analytics'
            }
          }
        }
      },
      {
        name: 'error_resolve',
        description: 'Mark an error as resolved with a resolution description',
        inputSchema: {
          type: 'object',
          properties: {
            errorId: {
              type: 'string',
              description: 'ID of the error to resolve'
            },
            resolution: {
              type: 'string',
              description: 'Description of how the error was resolved'
            }
          },
          required: ['errorId', 'resolution']
        }
      },
      {
        name: 'error_prune',
        description: 'Remove old errors from the log',
        inputSchema: {
          type: 'object',
          properties: {
            olderThanDays: {
              type: 'number',
              default: 30,
              description: 'Remove errors older than this many days'
            }
          }
        }
      },
      {
        name: 'error_import_canonical',
        description: 'Import errors from canonical reference system log',
        inputSchema: {
          type: 'object',
          properties: {
            canonicalLogPath: {
              type: 'string',
              description: 'Path to canonical-errors.jsonl file'
            }
          },
          required: ['canonicalLogPath']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'error_log': {
        const errorId = await errorLogger.logError(args);
        return {
          content: [{
            type: 'text',
            text: `Error logged successfully with ID: ${errorId}`
          }]
        };
      }

      case 'error_get': {
        const errors = await errorLogger.getErrors(
          args.category,
          args.limit || 50,
          args.severity
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(errors, null, 2)
          }]
        };
      }

      case 'error_analytics': {
        const analytics = await errorLogger.getAnalytics(args.hours || 24);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(analytics, null, 2)
          }]
        };
      }

      case 'error_resolve': {
        const resolved = await errorLogger.resolveError(args.errorId, args.resolution);
        return {
          content: [{
            type: 'text',
            text: resolved ? 'Error marked as resolved' : 'Failed to resolve error'
          }]
        };
      }

      case 'error_prune': {
        const pruned = await errorLogger.pruneErrors(args.olderThanDays || 30);
        return {
          content: [{
            type: 'text',
            text: `Removed ${pruned} old errors from log`
          }]
        };
      }

      case 'error_import_canonical': {
        const imported = await errorLogger.importCanonicalErrors(args.canonicalLogPath);
        return {
          content: [{
            type: 'text',
            text: `Imported ${imported} errors from canonical reference system`
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Error Logger started');
}

main().catch(console.error);

export { ErrorLogger };
