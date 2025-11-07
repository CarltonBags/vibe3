/**
 * Tool Orchestrator - Manages tool execution and state for the chat-based system
 * Similar to Lovable.dev's tool-based architecture
 */

import path from 'path';
import crypto from 'crypto';
import { Daytona } from '@daytonaio/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import { getProjectFiles } from '@/lib/db';

export interface ToolContext {
  projectId: string;
  sandboxId: string | null;
  sandbox: any | null; // Daytona sandbox instance
  userId: string;
  template: string;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

/**
 * Initialize or get sandbox for a project
 */
export async function getOrCreateSandbox(
  projectId: string,
  userId: string,
  template: string = 'vite-react'
): Promise<{ sandboxId: string; sandbox: any }> {
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_KEY || '',
    apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io',
  });

  // Check if project has existing sandbox
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('sandbox_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (project?.sandbox_id) {
    try {
      // Try to get existing sandbox - Daytona API may vary
      // For now, we'll create a new one if lookup fails
      const sandbox = await daytona.get(project.sandbox_id);
      if (sandbox) {
        return { sandboxId: project.sandbox_id, sandbox };
      }
    } catch (e) {
      console.warn(`Sandbox ${project.sandbox_id} not found, creating new one`);
    }
  }

  // Create new sandbox
  const sandbox = await daytona.create({
    image: 'node:20-alpine',
    public: true,
    ephemeral: true,
  });

  // Update project with sandbox ID
  await supabaseAdmin
    .from('projects')
    .update({ sandbox_id: sandbox.id })
    .eq('id', projectId);

  return { sandboxId: sandbox.id, sandbox };
}

/**
 * Get tool context for a project
 */
export async function getToolContext(
  projectId: string,
  userId: string,
  template: string = 'vite-react'
): Promise<ToolContext> {
  const { sandboxId, sandbox } = await getOrCreateSandbox(projectId, userId, template);
  
  return {
    projectId,
    sandboxId,
    sandbox,
    userId,
    template,
  };
}

/**
 * Tool: Read file from sandbox or database
 */
export async function toolView(
  context: ToolContext,
  filePath: string,
  lines?: string
): Promise<ToolResult> {
  try {
    if (context.sandbox) {
      // Read from sandbox
      const fullPath = filePath.startsWith('/workspace/') 
        ? filePath 
        : `/workspace/${filePath}`;
      
      const content = await context.sandbox.fs.downloadFile(fullPath);
      let fileContent = content.toString('utf-8');
      
      // Handle line ranges if specified (e.g., "1-100, 201-300")
      if (lines) {
        const allLines = fileContent.split('\n');
        const ranges = lines.split(',').map(r => r.trim());
        const selectedLines: string[] = [];
        
        for (const range of ranges) {
          if (range.includes('-')) {
            const [start, end] = range.split('-').map(n => parseInt(n.trim()));
            selectedLines.push(...allLines.slice(start - 1, end));
          } else {
            const lineNum = parseInt(range.trim());
            selectedLines.push(allLines[lineNum - 1]);
          }
        }
        
        fileContent = selectedLines.join('\n');
      }
      
      return {
        success: true,
        data: { content: fileContent, path: filePath },
      };
    } else {
      // Read from database
      const files = await getProjectFiles(context.projectId);
      const file = files.find(f => f.file_path === filePath);
      
      if (!file) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }
      
      return {
        success: true,
        data: { content: file.file_content, path: filePath },
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to read file',
    };
  }
}

/**
 * Protected template files that should not be modified by AI
 * Note: PostCSS config must be .js (PostCSS doesn't support TypeScript natively)
 * Tailwind config can be .ts
 */
const PROTECTED_FILES = [
  'src/main.tsx',
  'postcss.config.js',  // Must be .js - PostCSS doesn't support TypeScript
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'package.json',
  'index.html',
];

/**
 * Check if a file is protected and should not be modified
 */
function isProtectedFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/^\/workspace\//, '').replace(/^\.\//, '');
  return PROTECTED_FILES.some(protectedFile => normalizedPath === protectedFile || normalizedPath.endsWith(`/${protectedFile}`));
}

/**
 * Tool: Write file to sandbox
 */
/**
 * Unescape double-escaped JSON strings
 * Handles cases where content has \\" instead of " or \\n instead of \n
 * This happens when Gemini returns function call content that's been JSON-encoded twice
 */
function unescapeContent(content: string): string {
  // Check if content looks like it has escaped characters (escaped quotes, newlines, etc.)
  if (content.includes('\\"') || content.includes('\\n') || content.includes('\\\\')) {
    // First, handle the case where we have double-escaped strings
    // Pattern: \\" -> ", but we need to be careful not to break valid escape sequences
    
    // Count occurrences to determine if it's actually double-escaped
    const escapedQuoteCount = (content.match(/\\"/g) || []).length;
    const normalQuoteCount = (content.match(/[^\\]"/g) || []).length;
    
    // If we have significantly more escaped quotes than normal quotes, it's likely double-escaped
    if (escapedQuoteCount > normalQuoteCount * 2) {
      // Unescape common patterns (be careful with order - do \\ last)
      let unescaped = content
        .replace(/\\n/g, '\n')          // \n -> newline
        .replace(/\\t/g, '\t')          // \t -> tab
        .replace(/\\r/g, '\r')          // \r -> carriage return
        .replace(/\\"/g, '"')           // \" -> "
        .replace(/\\\\/g, '\\');        // \\ -> \
      
      return unescaped;
    }
  }
  return content;
}

export async function toolWrite(
  context: ToolContext,
  filePath: string,
  content: string
): Promise<ToolResult> {
  // Validate: prevent modifying protected template files
  if (isProtectedFile(filePath)) {
    console.warn(`⚠️ Attempted to modify protected file: ${filePath} - blocking modification`);
    return {
      success: false,
      error: `Cannot modify protected template file: ${filePath}. This file is managed by the template and should not be changed.`,
    };
  }
  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    const fullPath = filePath.startsWith('/workspace/')
      ? filePath
      : `/workspace/${filePath}`;

    // Ensure directory exists
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await context.sandbox.fs.createFolder(dirPath, '755').catch(() => {});

    // Unescape content if it has escaped characters
    const unescapedContent = unescapeContent(content);

    await context.sandbox.fs.uploadFile(
      Buffer.from(unescapedContent),
      fullPath
    );

    return {
      success: true,
      message: `File written: ${filePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to write file',
    };
  }
}

/**
 * Tool: Line-based search and replace
 */
export async function toolLineReplace(
  context: ToolContext,
  filePath: string,
  search: string,
  replace: string,
  firstLine: number,
  lastLine: number
): Promise<ToolResult> {
  // Validate: prevent modifying protected template files
  if (isProtectedFile(filePath)) {
    console.warn(`⚠️ Attempted to modify protected file: ${filePath} - blocking modification`);
    return {
      success: false,
      error: `Cannot modify protected template file: ${filePath}. This file is managed by the template and should not be changed.`,
    };
  }

  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    const fullPath = filePath.startsWith('/workspace/')
      ? filePath
      : `/workspace/${filePath}`;

    // Read current file
    const currentContent = await context.sandbox.fs.downloadFile(fullPath);
    const lines = currentContent.toString('utf-8').split('\n');

    // Validate line numbers
    if (firstLine < 1 || lastLine > lines.length || firstLine > lastLine) {
      return {
        success: false,
        error: `Invalid line range: ${firstLine}-${lastLine} (file has ${lines.length} lines)`,
      };
    }

    // Extract the section to replace (1-indexed to 0-indexed)
    const sectionToReplace = lines.slice(firstLine - 1, lastLine).join('\n');

    // Validate search matches
    if (!sectionToReplace.includes(search.replace(/\n/g, '\n'))) {
      return {
        success: false,
        error: `Search pattern does not match content at lines ${firstLine}-${lastLine}`,
      };
    }

    // Replace the section
    const newSection = sectionToReplace.replace(search, replace);
    const newLines = [
      ...lines.slice(0, firstLine - 1),
      ...newSection.split('\n'),
      ...lines.slice(lastLine),
    ];

    // Write back
    await context.sandbox.fs.uploadFile(
      Buffer.from(newLines.join('\n')),
      fullPath
    );

    return {
      success: true,
      message: `Replaced lines ${firstLine}-${lastLine} in ${filePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to replace lines',
    };
  }
}

/**
 * Tool: Delete file
 */
export async function toolDelete(
  context: ToolContext,
  filePath: string
): Promise<ToolResult> {
  // Validate: prevent deleting protected template files
  if (isProtectedFile(filePath)) {
    console.warn(`⚠️ Attempted to delete protected file: ${filePath} - blocking deletion`);
    return {
      success: false,
      error: `Cannot delete protected template file: ${filePath}. This file is required by the template.`,
    };
  }
  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    const fullPath = filePath.startsWith('/workspace/')
      ? filePath
      : `/workspace/${filePath}`;

    await context.sandbox.fs.deleteFile(fullPath);

    return {
      success: true,
      message: `Deleted file: ${filePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to delete file',
    };
  }
}

/**
 * Tool: Rename file
 */
export async function toolRename(
  context: ToolContext,
  originalPath: string,
  newPath: string
): Promise<ToolResult> {
  // Validate: prevent renaming protected template files
  if (isProtectedFile(originalPath)) {
    console.warn(`⚠️ Attempted to rename protected file: ${originalPath} - blocking rename`);
    return {
      success: false,
      error: `Cannot rename protected template file: ${originalPath}. This file is managed by the template.`,
    };
  }
  
  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    const fullOriginal = originalPath.startsWith('/workspace/')
      ? originalPath
      : `/workspace/${originalPath}`;
    
    const fullNew = newPath.startsWith('/workspace/')
      ? newPath
      : `/workspace/${newPath}`;

    // Read, write to new location, delete old
    const content = await context.sandbox.fs.downloadFile(fullOriginal);
    
    // Ensure new directory exists
    const newDir = fullNew.substring(0, fullNew.lastIndexOf('/'));
    await context.sandbox.fs.createFolder(newDir, '755').catch(() => {});
    
    await context.sandbox.fs.uploadFile(content, fullNew);
    await context.sandbox.fs.deleteFile(fullOriginal);

    return {
      success: true,
      message: `Renamed ${originalPath} to ${newPath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to rename file',
    };
  }
}

/**
 * Tool: Search files with regex
 */
export async function toolSearchFiles(
  context: ToolContext,
  query: string,
  includePattern: string,
  excludePattern?: string,
  caseSensitive: boolean = false
): Promise<ToolResult> {
  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    // Use grep to search files
    const flags = caseSensitive ? '' : '-i';
    const grepCommand = `cd /workspace && grep -r ${flags} -E "${query}" ${includePattern} ${excludePattern ? `--exclude=${excludePattern}` : ''} 2>/dev/null || true`;
    
    const result = await context.sandbox.process.executeCommand(grepCommand);
    const matches = result.result?.split('\n').filter(Boolean) || [];
    
    return {
      success: true,
      data: { matches, count: matches.length },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to search files',
    };
  }
}

/**
 * Tool: Read console logs (placeholder - would need browser integration)
 */
export async function toolReadConsoleLogs(
  context: ToolContext,
  search?: string
): Promise<ToolResult> {
  try {
    // This would require browser console integration
    // For now, return placeholder
    return {
      success: true,
      data: { logs: [], message: 'Console logs require browser integration' },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to read console logs',
    };
  }
}

/**
 * Tool: Read network requests (placeholder - would need browser integration)
 */
export async function toolReadNetworkRequests(
  context: ToolContext,
  search?: string
): Promise<ToolResult> {
  try {
    // This would require browser network monitoring
    // For now, return placeholder
    return {
      success: true,
      data: { requests: [], message: 'Network requests require browser integration' },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to read network requests',
    };
  }
}

/**
 * Tool: Add npm dependency
 * Instead of installing immediately, we update package.json and mark for batch install
 */
export async function toolAddDependency(
  context: ToolContext,
  packageName: string
): Promise<ToolResult> {
  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    // Read current package.json
    let packageJsonContent: string;
    try {
      const content = await context.sandbox.fs.downloadFile('/workspace/package.json');
      packageJsonContent = content.toString('utf-8');
    } catch (e) {
      return {
        success: false,
        error: 'package.json not found. Template files may not be set up.',
      };
    }

    // Parse and update package.json
    const packageJson = JSON.parse(packageJsonContent);
    
    // Extract package name and version (handle @scope/package@version format)
    let pkgName: string;
    let version: string = 'latest';
    
    if (packageName.startsWith('@')) {
      // Scoped package like @radix-ui/react-dialog@latest or @radix-ui/react-dialog
      const match = packageName.match(/^(@[^@]+)\/([^@]+)(?:@(.+))?$/);
      if (match) {
        pkgName = `${match[1]}/${match[2]}`;
        version = match[3] || 'latest';
      } else {
        // Fallback: try splitting by @
        const parts = packageName.split('@');
        if (parts.length >= 3) {
          pkgName = `@${parts[1]}/${parts[2]}`;
          version = parts[3] || 'latest';
        } else {
          pkgName = packageName;
        }
      }
    } else {
      // Regular package like react@18.0.0 or react
      const parts = packageName.split('@');
      pkgName = parts[0];
      version = parts[1] || 'latest';
    }

    // Add to dependencies (not devDependencies for now)
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }
    packageJson.dependencies[pkgName] = version;

    // Validate package.json before writing
    try {
      JSON.stringify(packageJson);
    } catch (e) {
      return {
        success: false,
        error: `Invalid package.json structure: ${e}`,
      };
    }

    // Write updated package.json
    const jsonString = JSON.stringify(packageJson, null, 2);
    await context.sandbox.fs.uploadFile(
      Buffer.from(jsonString),
      '/workspace/package.json'
    );

    // Verify the file was written correctly
    try {
      const verifyContent = await context.sandbox.fs.downloadFile('/workspace/package.json');
      JSON.parse(verifyContent.toString('utf-8'));
    } catch (e) {
      return {
        success: false,
        error: `Failed to verify package.json after write: ${e}`,
      };
    }

    return {
      success: true,
      message: `Added ${pkgName}@${version} to package.json (will be installed during build)`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to add dependency',
    };
  }
}

/**
 * Tool: Remove npm dependency
 */
export async function toolRemoveDependency(
  context: ToolContext,
  packageName: string
): Promise<ToolResult> {
  try {
    if (!context.sandbox) {
      return {
        success: false,
        error: 'Sandbox not available',
      };
    }

    const result = await context.sandbox.process.executeCommand(
      `cd /workspace && npm uninstall ${packageName}`
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to remove ${packageName}: ${result.result}`,
      };
    }

    return {
      success: true,
      message: `Removed dependency: ${packageName}`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to remove dependency',
    };
  }
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string,
  params: any,
  context: ToolContext
): Promise<ToolResult> {
  switch (toolName) {
    case 'lov-view':
      return toolView(context, params.file_path, params.lines);
    
    case 'lov-write':
      return toolWrite(context, params.file_path, params.content);
    
    case 'lov-line-replace':
      return toolLineReplace(
        context,
        params.file_path,
        params.search,
        params.replace,
        params.first_replaced_line,
        params.last_replaced_line
      );
    
    case 'lov-delete':
      return toolDelete(context, params.file_path);
    
    case 'lov-rename':
      return toolRename(context, params.original_file_path, params.new_file_path);
    
    case 'lov-search-files':
      return toolSearchFiles(
        context,
        params.query,
        params.include_pattern,
        params.exclude_pattern,
        params.case_sensitive
      );
    
    case 'lov-read-console-logs':
      return toolReadConsoleLogs(context, params.search);
    
    case 'lov-read-network-requests':
      return toolReadNetworkRequests(context, params.search);
    
    case 'lov-add-dependency':
      return toolAddDependency(context, params.package);
    
    case 'lov-remove-dependency':
      return toolRemoveDependency(context, params.package);
    
    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
  }
}

/**
 * Validate that all imported components exist and are properly exported
 */
export async function validateImports(context: ToolContext): Promise<{ valid: boolean; errors: string[] }> {
  if (!context.sandbox) {
    return { valid: false, errors: ['Sandbox not available'] };
  }

  const errors: string[] = [];
  
  try {
    // Get all TypeScript/TSX files
    const findResult = await context.sandbox.process.executeCommand(
      'cd /workspace && find src -type f \\( -name "*.ts" -o -name "*.tsx" \\) | head -50'
    );
    
    if (!findResult.result) {
      return { valid: true, errors: [] };
    }

    const files = findResult.result.trim().split('\n').filter((f: string) => f);
    
    for (const file of files) {
      try {
        const fullPath = file.startsWith('/workspace/') ? file : `/workspace/${file}`;
        const content = await context.sandbox.fs.downloadFile(fullPath);
        const fileContent = content.toString('utf-8');
        
        // Extract relative imports (e.g., import Swap from './pages/Swap' or '../components/Header')
        const relativeImportPattern = /import\s+(?:\{([^}]+)\}|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;
        let match;
        
        while ((match = relativeImportPattern.exec(fileContent)) !== null) {
          const defaultImport = match[2]; // Default import name
          const namedImports = match[1] || match[3]; // Named imports
          const importPath = match[4]; // Relative path like './pages/Swap' or '../components/Header'
          
          // Resolve the actual file path
          // Normalize file path (remove /workspace/ prefix if present, ensure it starts with src/)
          let normalizedFile = file.replace(/^\/workspace\//, '').replace(/^\.\//, '');
          if (!normalizedFile.startsWith('src/')) {
            normalizedFile = `src/${normalizedFile}`;
          }
          
          const currentDir = normalizedFile.substring(0, normalizedFile.lastIndexOf('/'));
          
          // Resolve relative path (handle both ./ and ../)
          let resolvedPath = importPath.replace(/^\.\//, '').replace(/\/$/, '');
          const pathParts = currentDir.split('/').filter((p: string) => p); // Remove empty strings
          const importParts = resolvedPath.split('/').filter((p: string) => p);
          
          // Handle parent directory navigation (../)
          for (const part of importParts) {
            if (part === '..') {
              if (pathParts.length > 0) {
                pathParts.pop();
              }
            } else if (part !== '.') {
              pathParts.push(part);
            }
          }
          
          resolvedPath = pathParts.join('/');
          
          // Try different extensions
          const possiblePaths = [
            `${resolvedPath}.tsx`,
            `${resolvedPath}.ts`,
            `${resolvedPath}/index.tsx`,
            `${resolvedPath}/index.ts`,
          ];
          
          let fileExists = false;
          let foundPath = '';
          
          for (const possiblePath of possiblePaths) {
            try {
              const fullPossiblePath = possiblePath.startsWith('/workspace/') 
                ? possiblePath 
                : `/workspace/${possiblePath}`;
              await context.sandbox.fs.downloadFile(fullPossiblePath);
              fileExists = true;
              foundPath = possiblePath;
              break;
            } catch (e) {
              // File doesn't exist at this path, try next
            }
          }
          
          if (!fileExists) {
            const importName = defaultImport || (namedImports ? namedImports.split(',')[0].trim() : 'unknown');
            // Don't report errors for imports that are likely correct but the validation path resolution is wrong
            // For example, if button.tsx imports from '../lib/utils', it should be '../../lib/utils', but we don't want to auto-create lib/utils
            const isLikelyPathIssue = importPath.includes('../lib/') && file.includes('components/ui/');
            
            if (isLikelyPathIssue) {
              // This is likely a path resolution issue, not a missing file - skip the error
              console.log(`⚠️ Import path issue detected: ${file} imports from '${importPath}' (resolved to ${resolvedPath}), but should probably be '../../lib/utils'`);
              continue; // Skip this import - the auto-fix will handle it during build
            }
            
            let errorMessage = `Missing file: ${file} imports '${importName}' from '${importPath}' (resolved to ${resolvedPath}) but file doesn't exist`;
            let autoCreated = false;
            
            // Try to auto-create missing component files
            if (defaultImport && (importPath.includes('/pages/') || resolvedPath.includes('/pages/'))) {
              // It's a page component - create a placeholder
              const pageName = defaultImport;
              const pageFile = `${resolvedPath}.tsx`;
              
              try {
                const placeholderContent = `import React from 'react';

export default function ${pageName}() {
  return (
    <div className="min-h-screen p-8">
      <h1 className="text-4xl font-bold mb-4">${pageName}</h1>
      <p className="text-lg text-gray-600">${pageName} page content</p>
    </div>
  );
}
`;
                const fullPagePath = pageFile.startsWith('/workspace/') ? pageFile : `/workspace/${pageFile}`;
                // Ensure directory exists
                const pageDir = fullPagePath.substring(0, fullPagePath.lastIndexOf('/'));
                try {
                  await context.sandbox.fs.createFolder(pageDir, '755');
                } catch (e) {
                  // Directory might already exist, that's fine
                }
                await context.sandbox.fs.uploadFile(Buffer.from(placeholderContent), fullPagePath);
                console.log(`✅ Auto-created missing page component: ${pageFile}`);
                autoCreated = true;
              } catch (createError: any) {
                console.warn(`Could not auto-create ${pageFile}:`, createError.message);
              }
            } else if (defaultImport && (importPath.includes('/components/') || resolvedPath.includes('/components/'))) {
              // It's a component - create a placeholder
              const componentName = defaultImport;
              const componentFile = `${resolvedPath}.tsx`;
              
              try {
                const placeholderContent = `import React from 'react';

export default function ${componentName}() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold">${componentName}</h2>
      <p>${componentName} component</p>
    </div>
  );
}
`;
                const fullComponentPath = componentFile.startsWith('/workspace/') ? componentFile : `/workspace/${componentFile}`;
                // Ensure directory exists
                const componentDir = fullComponentPath.substring(0, fullComponentPath.lastIndexOf('/'));
                try {
                  await context.sandbox.fs.createFolder(componentDir, '755');
                } catch (e) {
                  // Directory might already exist, that's fine
                }
                await context.sandbox.fs.uploadFile(Buffer.from(placeholderContent), fullComponentPath);
                console.log(`✅ Auto-created missing component: ${componentFile}`);
                autoCreated = true;
              } catch (createError: any) {
                console.warn(`Could not auto-create ${componentFile}:`, createError.message);
              }
            }
            
            // Only add error if we couldn't auto-create
            if (!autoCreated) {
              errors.push(errorMessage);
            }
          } else if (defaultImport) {
            // Check if default export exists
            try {
              const importedContent = await context.sandbox.fs.downloadFile(
                foundPath.startsWith('/workspace/') ? foundPath : `/workspace/${foundPath}`
              );
              const importedFileContent = importedContent.toString('utf-8');
              
              // Check for default export
              const hasDefaultExport = /export\s+default\s+/.test(importedFileContent) ||
                                     /export\s+(?:default\s+)?(?:function|const|class)\s+/.test(importedFileContent);
              
              if (!hasDefaultExport) {
                errors.push(`Missing default export: ${file} imports '${defaultImport}' from '${importPath}' but file has no default export`);
              }
            } catch (e) {
              // Couldn't read the file, skip validation
            }
          }
        }
      } catch (error: any) {
        // Skip files that can't be read
        console.warn(`Could not validate imports in ${file}:`, error.message);
      }
    }
  } catch (error: any) {
    console.warn('Error validating imports:', error.message);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Auto-fix JSX syntax errors
 */
async function autoFixJSXErrors(context: ToolContext, errorOutput: string): Promise<boolean> {
  if (!context.sandbox) return false;

  // Pattern: src/components/Header.tsx(19,24): error TS1127: Invalid character.
  // Pattern: src/components/Header.tsx(35,11): error TS17002: Expected corresponding JSX closing tag for 'nav'.
  const jsxErrorPattern = /([\w\/\.-]+)\((\d+),(\d+)\): error TS\d+: (Invalid character|Unexpected token|Expected corresponding JSX closing tag|Expected|Expression expected)/g;
  const filesToFix = new Set<string>();
  
  let match;
  while ((match = jsxErrorPattern.exec(errorOutput)) !== null) {
    const filePath = match[1].replace(/^src\//, 'src/');
    filesToFix.add(filePath);
  }

  let fixed = false;
  for (const filePath of Array.from(filesToFix)) {
    try {
      const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
      const content = await context.sandbox.fs.downloadFile(fullPath);
      let fileContent = content.toString('utf-8');
      let originalContent = fileContent;
      
      // Fix common JSX issues:
      // 1. Fix unescaped characters in JSX (like <, >, {, })
      // 2. Fix unclosed tags
      // 3. Fix invalid characters
      
      // Count opening and closing tags to find unclosed ones
      const tagPattern = /<(\w+)(?:\s[^>]*)?>/g;
      const closingTagPattern = /<\/(\w+)>/g;
      const selfClosingPattern = /<(\w+)(?:\s[^>]*)?\s*\/>/g;
      
      const openTags: string[] = [];
      const tagStack: string[] = [];
      
      // Find all tags
      let tagMatch;
      const allTags: Array<{ type: 'open' | 'close' | 'self'; name: string; pos: number }> = [];
      
      while ((tagMatch = tagPattern.exec(fileContent)) !== null) {
        allTags.push({ type: 'open', name: tagMatch[1], pos: tagMatch.index });
      }
      
      while ((tagMatch = closingTagPattern.exec(fileContent)) !== null) {
        allTags.push({ type: 'close', name: tagMatch[1], pos: tagMatch.index });
      }
      
      while ((tagMatch = selfClosingPattern.exec(fileContent)) !== null) {
        allTags.push({ type: 'self', name: tagMatch[1], pos: tagMatch.index });
      }
      
      // Sort by position
      allTags.sort((a, b) => a.pos - b.pos);
      
      // Find unclosed tags
      const unclosedTags: string[] = [];
      for (const tag of allTags) {
        if (tag.type === 'self') continue;
        if (tag.type === 'open') {
          tagStack.push(tag.name);
        } else if (tag.type === 'close') {
          const lastOpen = tagStack.pop();
          if (lastOpen !== tag.name) {
            // Mismatched tags - try to fix
            const index = tagStack.lastIndexOf(tag.name);
            if (index !== -1) {
              tagStack.splice(index, 1);
            }
          }
        }
      }
      
      // Add missing closing tags at the end
      if (tagStack.length > 0) {
        const missingClosings = tagStack.reverse();
        // Find the last opening tag position to insert closing tags
        const lastOpenTagMatch = fileContent.match(/<(\w+)(?:\s[^>]*)?>(?!\s*<\/\1>)[^<]*$/);
        if (lastOpenTagMatch) {
          const closingTags = missingClosings.map(tag => `</${tag}>`).join('\n');
          fileContent = fileContent.trimEnd() + '\n' + closingTags + '\n';
          fixed = true;
        }
      }
      
      // Fix invalid characters in JSX - read the specific error lines
      const lines = fileContent.split('\n');
      let fileModified = false;
      
      // Extract line numbers with errors
      const errorLinePattern = /\((\d+),(\d+)\): error TS\d+: (Invalid character|Unexpected token)/g;
      const errorLines = new Set<number>();
      let errorMatch;
      while ((errorMatch = errorLinePattern.exec(errorOutput)) !== null) {
        const lineNum = parseInt(errorMatch[1], 10);
        errorLines.add(lineNum);
      }
      
      // Fix each error line
      for (const lineNum of Array.from(errorLines)) {
        if (lineNum > 0 && lineNum <= lines.length) {
          const lineIndex = lineNum - 1;
          let line = lines[lineIndex];
          const originalLine = line;
          
          // Fix common issues:
          // 1. classNameName typo -> className
          if (line.includes('classNameName')) {
            line = line.replace(/classNameName/g, 'className');
            fileModified = true;
          }
          
          // 2. Unescaped < or > in JSX text content (should be &lt; or &gt; or in {})
          // 3. Unescaped { or } in JSX attributes
          // 4. Missing quotes around attribute values
          
          if (line !== originalLine) {
            lines[lineIndex] = line;
            fileModified = true;
          }
        }
      }
      
      // Also check for classNameName typos in the entire file
      if (fileContent.includes('classNameName')) {
        fileContent = fileContent.replace(/classNameName/g, 'className');
        fileModified = true;
      }
      
      if (fileModified) {
        fileContent = lines.join('\n');
      }
      
      if (fileContent !== originalContent) {
        await context.sandbox.fs.uploadFile(Buffer.from(fileContent), fullPath);
        console.log(`✅ Auto-fixed JSX errors in ${filePath}`);
        fixed = true;
      } else {
        // If heuristic fixes didn't work, try using AI to fix the file
        console.log(`⚠️ Could not auto-fix JSX errors in ${filePath} with heuristics - file may need manual review`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix JSX errors in ${filePath}:`, error.message);
    }
  }
  
  return fixed;
}

function normalizeComponentBaseName(name: string): string {
  return name
    .replace(/(?:Page|Screen|View|Component)$/i, '')
    .trim()
    .toLowerCase();
}

function scoreDuplicateCandidate(filePath: string, fileName: string): number {
  let score = 0;
  if (!/(Page|Screen|View|Component)$/i.test(fileName)) score += 5;
  if (filePath.includes('src/components/') && !filePath.includes('/lib/')) score += 3;
  if (filePath.includes('src/pages/')) score += 2;
  if (!filePath.includes('/lib/')) score += 1;
  score -= filePath.length * 0.001;
  return score;
}

async function normalizeComponentDuplicates(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;

  try {
    const groups = new Map<string, Array<{ path: string; name: string }>>();

    const collectFiles = async (dir: string) => {
      const command = `cd /workspace && find ${dir} -type f -name "*.tsx" 2>/dev/null || true`;
      const result = await context.sandbox.process.executeCommand(command);
      const files = (result.result || '').trim().split('\n').filter((f: string) => f);

      for (const absPath of files) {
        const relativePath = absPath.startsWith('/workspace/') ? absPath.replace('/workspace/', '') : absPath;
        const fileName = path.basename(relativePath, '.tsx');
        const normalized = normalizeComponentBaseName(fileName);
        if (!normalized) continue;

        if (!groups.has(normalized)) {
          groups.set(normalized, []);
        }
        groups.get(normalized)!.push({ path: relativePath, name: fileName });
      }
    };

    await collectFiles('src/pages');
    await collectFiles('src/components');

    // Parse App imports to prefer whichever file is actually used there
    const appImportsByBase = new Map<string, string[]>();
    try {
      const appContentBuffer = await context.sandbox.fs.downloadFile('/workspace/src/App.tsx');
      const appContent = appContentBuffer.toString('utf-8');
      const defaultImportRegex = /import\s+([A-Za-z0-9_]+)\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = defaultImportRegex.exec(appContent)) !== null) {
        const importedName = match[1];
        const importPath = match[2];
        const normalized = normalizeComponentBaseName(importedName);
        if (!appImportsByBase.has(normalized)) {
          appImportsByBase.set(normalized, []);
        }
        appImportsByBase.get(normalized)!.push(importPath);
      }
    } catch (e) {
      // App.tsx might not exist yet - ignore
    }

    for (const [baseName, files] of Array.from(groups.entries())) {
      if (files.length < 2) continue;

      // Determine canonical file preference: template lib components first
      let canonical = files[0];
      const libCandidate = files.find((file) => file.path.includes('src/components/lib/'));
      if (libCandidate) {
        canonical = libCandidate;
      }

      const appImportCandidates = appImportsByBase.get(baseName) || [];
      if (appImportCandidates.length > 0) {
        const candidate = files.find((file) => {
          const relFromApp = path.relative('src', file.path).replace(/\\/g, '/').replace(/\.tsx$/, '');
          const possibleImports = [`./${relFromApp}`, relFromApp.startsWith('.') ? relFromApp : `./${relFromApp}`, `@/${relFromApp}`];
          return possibleImports.some((p) => appImportCandidates.includes(p));
        });
        if (candidate) {
          canonical = candidate;
        }
      }

      if (appImportCandidates.length === 0 && !libCandidate) {
        canonical = files.reduce((best, current) => {
          return scoreDuplicateCandidate(current.path, current.name) > scoreDuplicateCandidate(best.path, best.name) ? current : best;
        }, canonical);
      }

      for (const file of files) {
        if (file.path === canonical.path) continue;

        try {
          if (file.path.includes('src/components/lib/')) {
            // Never overwrite canonical template components
            continue;
          }
          const fromDir = path.dirname(file.path);
          const canonicalRelative = path.relative(fromDir, canonical.path).replace(/\\/g, '/').replace(/\.tsx$/, '');
          const importPath = canonicalRelative.startsWith('.') ? canonicalRelative : `./${canonicalRelative}`;
          const proxyContent = `export { default } from '${importPath}';\nexport * from '${importPath}';\n`;
          const fullProxyPath = `/workspace/${file.path}`;
          await context.sandbox.fs.uploadFile(Buffer.from(proxyContent), fullProxyPath);
          console.log(`🔁 Normalized duplicate component: ${file.path} now re-exports ${canonical.path}`);
        } catch (error: any) {
          console.warn(`⚠️ Failed to normalize duplicate component ${file.path}:`, error.message);
        }
      }
    }
  } catch (error: any) {
    console.warn('⚠️ Failed to normalize component duplicates:', error.message);
  }
}

async function enforceCanonicalComponentImports(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;

  const canonicalImports: Array<{ name: string; importPath: string }> = [
    { name: 'Header', importPath: "@/components/lib/Header" },
    { name: 'Footer', importPath: "@/components/lib/Footer" },
    { name: 'Hero', importPath: "@/components/lib/Hero" },
  ];

  const filesToCheck = ['/workspace/src/App.tsx'];

  for (const filePath of filesToCheck) {
    try {
      const buffer = await context.sandbox.fs.downloadFile(filePath);
      let content = buffer.toString('utf-8');
      let updated = false;

      for (const canonical of canonicalImports) {
        const namedImportRegex = new RegExp(`import\\s+\\{\\s*${canonical.name}\\s*\\}\\s+from\\s+['\"]([^'\"]+)['\"];?`, 'g');
        const defaultImportRegex = new RegExp(`import\\s+${canonical.name}\\s+from\\s+['\"]([^'\"]+)['\"];?`, 'g');

        content = content.replace(namedImportRegex, (match: string, importPath: string) => {
          if (importPath === canonical.importPath) return match;
          updated = true;
          return `import { ${canonical.name} } from '${canonical.importPath}';`;
        });

        content = content.replace(defaultImportRegex, (match: string, importPath: string) => {
          if (importPath === canonical.importPath) return match;
          updated = true;
          return `import { ${canonical.name} } from '${canonical.importPath}';`;
        });
      }

      if (updated) {
        await context.sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), filePath);
        console.log(`✅ Enforced canonical component imports in ${filePath}`);
      }
    } catch (error) {
      // ignore missing files or read errors
    }
  }
}

async function ensurePageRoutes(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;

  try {
    const findResult = await context.sandbox.process.executeCommand(
      'cd /workspace && find src/pages -maxdepth 1 -type f -name "*.tsx" 2>/dev/null || true'
    );
    const pageFiles = (findResult.result || '').trim().split('\n').filter(Boolean);
    if (pageFiles.length === 0) return;

    const ignorePages = new Set(['Home.tsx', 'index.tsx']);
    const appPath = '/workspace/src/App.tsx';
    let appContent = '';
    try {
      appContent = (await context.sandbox.fs.downloadFile(appPath)).toString('utf-8');
    } catch (e) {
      return;
    }

    const routesMatch = appContent.match(/<Routes[^>]*>([\s\S]*?)<\/Routes>/);
    if (!routesMatch) {
      return;
    }

    let routesContent = routesMatch[1];
    let updatedAppContent = appContent;
    let routesUpdated = false;

    const existingImports = new Set(
      Array.from(appContent.matchAll(/import\s+([^;]+);/g)).map((m) => m[1].trim())
    );

    for (const file of pageFiles) {
      const fileName = path.basename(file);
      if (ignorePages.has(fileName)) continue;

      const componentName = fileName.replace(/\.tsx$/, '');
      const routePath = `/${componentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;

      const hasImport = appContent.includes(`@/pages/${componentName}`);
      const hasRoute = routesContent.includes(`path="${routePath}"`) || routesContent.includes(`path='${routePath}'`);

      if (!hasImport) {
        const importStatement = `import ${componentName} from '@/pages/${componentName}';`;
        if (!existingImports.has(importStatement)) {
          updatedAppContent = updatedAppContent.replace(/(import[^;]+;\s*)+/, (match) => `${match}${importStatement}\n`);
          existingImports.add(importStatement);
          console.log(`🔧 Added import for ${componentName} in App.tsx`);
        }
      }

      if (!hasRoute) {
        const newRoute = `          <Route path="${routePath}" element={<${componentName} />} />`;
        if (!routesContent.includes(newRoute)) {
          routesContent += `\n${newRoute}`;
          routesUpdated = true;
          console.log(`🔧 Added route for ${componentName} -> ${routePath}`);
        }
      }
    }

    if (routesUpdated || updatedAppContent !== appContent) {
      const rebuiltRoutes = `<Routes>${routesContent}\n        </Routes>`;
      updatedAppContent = updatedAppContent.replace(/<Routes[^>]*>[\s\S]*?<\/Routes>/, rebuiltRoutes);
      await context.sandbox.fs.uploadFile(Buffer.from(updatedAppContent, 'utf-8'), appPath);
      console.log('✅ Synchronized App.tsx routes with pages directory');
    }
  } catch (error: any) {
    console.warn('⚠️ Failed to ensure page routes:', error.message);
  }
}

async function localizeRemoteImages(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;

  try {
    await context.sandbox.fs.createFolder('/workspace/public/generated-images', '755').catch(() => {});

    const command = 'cd /workspace && find src -type f \( -name "*.tsx" -o -name "*.jsx" -o -name "*.html" \) | head -150';
    const result = await context.sandbox.process.executeCommand(command);
    const files = (result.result || '').trim().split('\n').filter((f: string) => f);
    if (files.length === 0) return;

    const gradients = [
      ['#5A31F4', '#FF2D92'],
      ['#2563eb', '#22d3ee'],
      ['#7f5cf3', '#f97316'],
      ['#1f2937', '#0ea5e9'],
      ['#9333ea', '#facc15']
    ];

    const cache = new Map<string, string>();

    for (const absPath of files) {
      const fullPath = absPath.startsWith('/workspace/') ? absPath : `/workspace/${absPath}`;
      let fileBuffer: Buffer;
      try {
        fileBuffer = await context.sandbox.fs.downloadFile(fullPath);
      } catch {
        continue;
      }

      let content = fileBuffer.toString('utf-8');
      if (!content.includes('<img')) continue;

      const remoteImgRegex = /<img[^>]*src=["'](https?:[^"']+)["'][^>]*>/gi;
      const matches = Array.from(content.matchAll(remoteImgRegex));
      if (matches.length === 0) continue;

      for (const match of matches) {
        const fullTag = match[0];
        const src = match[1];
        if (!src) continue;

        let replacement: string | null = cache.get(src) ?? null;
        if (!replacement) {
          replacement = await fetchRemoteImageToPublic(src, context, gradients);
          if (replacement) {
            cache.set(src, replacement);
          } else {
            continue;
          }
        }

        const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagAltMatch = fullTag.match(/alt=["']([^"']*)["']/i);
        const altText = (tagAltMatch?.[1] || 'Generated visual').slice(0, 80);
        const sanitizedAlt = altText.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));

        // Ensure alt text preserved in fallback replacements
        if (!tagAltMatch && replacement.endsWith('.svg')) {
          // nothing to do - gradient already includes text
        }

        content = content.replace(new RegExp(escapedSrc, 'g'), replacement);
        // Also ensure alt attribute exists
        if (!tagAltMatch) {
          const withoutAlt = new RegExp(`<img([^>]*?)src=["']${replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']([^>]*?)>`, 'i');
          content = content.replace(withoutAlt, `<img$1src="${replacement}" alt="${sanitizedAlt}"$2>`);
        }
      }

      await context.sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), fullPath);
    }
  } catch (error: any) {
    console.warn('⚠️ Failed to localize remote images:', error.message);
  }
}

async function fetchRemoteImageToPublic(url: string, context: ToolContext, gradients: string[][]): Promise<string | null> {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
      throw new Error('Image too large');
    }
    const extensionMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/avif': 'avif'
    };
    const extension = extensionMap[contentType] || 'png';
    const fileName = `generated-images/${crypto.randomUUID()}.${extension}`;
    await context.sandbox.fs.uploadFile(Buffer.from(arrayBuffer), `/workspace/public/${fileName}`);
    return `/${fileName}`;
  } catch (error) {
    console.warn(`⚠️ Failed to fetch remote image ${url}:`, (error as Error).message);
    const [startColor, endColor] = gradients[Math.floor(Math.random() * gradients.length)];
    const gradientId = `grad_${crypto.randomUUID().replace(/-/g, '')}`;
    const fallbackFile = `generated-images/${crypto.randomUUID()}.svg`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">\n  <defs>\n    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">\n      <stop offset="0%" stop-color="${startColor}"/>\n      <stop offset="100%" stop-color="${endColor}"/>\n    </linearGradient>\n  </defs>\n  <rect width="1600" height="900" fill="url(#${gradientId})"/>\n</svg>`;
    await context.sandbox.fs.uploadFile(Buffer.from(svg, 'utf-8'), `/workspace/public/${fallbackFile}`);
    return `/${fallbackFile}`;
  }
}

/**
 * Ensure critical components exist (Header, Footer, Hero, etc.)
 * Creates them if they're missing but referenced
 */
async function ensureCriticalComponents(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;
  
  try {
    // Check App.tsx to see what components it imports
    const appPath = '/workspace/src/App.tsx';
    let appContent = '';
    try {
      const appFile = await context.sandbox.fs.downloadFile(appPath);
      appContent = appFile.toString('utf-8');
    } catch (e) {
      // App.tsx doesn't exist, skip
      return;
    }
    
    // Extract component imports from App.tsx and pages
    const componentImports = new Set<string>();
    
    // Check App.tsx for component imports
    const appImportPattern = /import\s+.*?\{\s*(\w+)\s*\}\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = appImportPattern.exec(appContent)) !== null) {
      const componentName = match[1];
      const importPath = match[2];
      
      // Only check components from relative imports (not from node_modules)
      if (importPath.startsWith('./') || importPath.startsWith('../') || importPath.startsWith('@/components/')) {
        componentImports.add(componentName);
      }
    }
    
    // Check pages for component imports
    try {
      const pagesResult = await context.sandbox.process.executeCommand(
        'cd /workspace && find src/pages -name "*.tsx" -type f 2>/dev/null || true'
      );
      const pages = (pagesResult.result || '').trim().split('\n').filter((p: string) => p);
      
      for (const pagePath of pages) {
        try {
          const fullPath = pagePath.startsWith('/workspace/') ? pagePath : `/workspace/${pagePath}`;
          const pageContent = await context.sandbox.fs.downloadFile(fullPath);
          const content = pageContent.toString('utf-8');
          
          let pageMatch;
          const pageImportPattern = /import\s+.*?\{\s*(\w+)\s*\}\s+from\s+['"]([^'"]+)['"]/g;
          while ((pageMatch = pageImportPattern.exec(content)) !== null) {
            const componentName = pageMatch[1];
            const importPath = pageMatch[2];
            if (importPath.startsWith('./') || importPath.startsWith('../') || importPath.startsWith('@/components/')) {
              componentImports.add(componentName);
            }
          }
        } catch (e) {
          // Skip pages that can't be read
        }
      }
    } catch (e) {
      // No pages directory, skip
    }
    
    // Check if components exist, create if missing
    for (const componentName of Array.from(componentImports)) {
      // Common component names that should exist
      if (['Header', 'Footer', 'Hero', 'Navbar', 'Navigation'].includes(componentName)) {
        const componentPath = `/workspace/src/components/${componentName}.tsx`;
        
        try {
          await context.sandbox.fs.downloadFile(componentPath);
          // Component exists, skip
        } catch (e) {
          // Component doesn't exist, create it
          console.log(`🔧 Creating missing critical component: ${componentName}`);
          
          let componentContent = '';
          if (componentName === 'Header') {
            componentContent = `import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        <Link to="/" className="text-xl font-bold text-foreground">
          Web3 DEX
        </Link>
        <nav className="hidden md:flex items-center gap-6">
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Home
          </Link>
          <Link to="/swap" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Swap
          </Link>
          <Link to="/liquidity" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Liquidity
          </Link>
        </nav>
        <button
          className="md:hidden"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t bg-background">
          <div className="container px-4 py-4 space-y-2">
            <Link to="/" className="block text-sm font-medium text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link to="/swap" className="block text-sm font-medium text-muted-foreground hover:text-foreground">
              Swap
            </Link>
            <Link to="/liquidity" className="block text-sm font-medium text-muted-foreground hover:text-foreground">
              Liquidity
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
`;
          } else if (componentName === 'Footer') {
            componentContent = `export function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="container px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <h3 className="text-lg font-bold mb-4">Web3 DEX</h3>
            <p className="text-sm text-muted-foreground">
              Decentralized exchange for the future of finance.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-4">Products</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="/swap" className="hover:text-foreground">Swap</a></li>
              <li><a href="/liquidity" className="hover:text-foreground">Liquidity</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground">Documentation</a></li>
              <li><a href="#" className="hover:text-foreground">Blog</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground">Privacy</a></li>
              <li><a href="#" className="hover:text-foreground">Terms</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t pt-8 text-center text-sm text-muted-foreground">
          © ${new Date().getFullYear()} Web3 DEX. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
`;
          } else if (componentName === 'Hero') {
            componentContent = `export function Hero() {
  return (
    <section className="flex min-h-[600px] flex-col items-center justify-center px-4 py-20 text-center bg-gradient-to-br from-primary-dark to-secondary-dark">
      <div className="container space-y-6 max-w-4xl">
        <h1 className="text-4xl md:text-6xl font-bold text-foreground">
          Decentralized Exchange
        </h1>
        <p className="mx-auto max-w-[700px] text-lg md:text-xl text-muted-foreground">
          Trade tokens directly from your wallet. Fast, secure, and decentralized.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="/swap"
            className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Start Trading
          </a>
          <a
            href="/liquidity"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-8 py-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Provide Liquidity
          </a>
        </div>
      </div>
    </section>
  );
}
`;
          } else {
            // Generic component
            componentContent = `export function ${componentName}() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold">${componentName}</h2>
      <p>${componentName} component</p>
    </div>
  );
}
`;
          }
          
          // Ensure components directory exists
          try {
            await context.sandbox.fs.createFolder('/workspace/src/components', '755');
          } catch (e) {
            // Directory might already exist
          }
          
          await context.sandbox.fs.uploadFile(Buffer.from(componentContent), componentPath);
          console.log(`✅ Created missing component: ${componentName}`);
        }
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Error ensuring critical components:`, error.message);
  }
}

/**
 * Validate and fix App.tsx routing to ensure default route renders correctly
 */
async function validateAppRouting(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;
  
  try {
    const appPath = '/workspace/src/App.tsx';
    let appContent = '';
    
    try {
      const appFile = await context.sandbox.fs.downloadFile(appPath);
      appContent = appFile.toString('utf-8');
    } catch (e) {
      // App.tsx doesn't exist, skip
      return;
    }
    
    // Check if Routes exists and if the default route is properly configured
    const hasRoutes = appContent.includes('<Routes>') || appContent.includes('<Routes');
    const hasDefaultRoute = /path=["']\/["']/.test(appContent) || /path=\{\s*["']\/["']\s*\}/.test(appContent);
    
    // Check if Routes component is imported
    const hasRoutesImport = appContent.includes('from \'react-router-dom\'') || appContent.includes('from "react-router-dom"');
    
    if (hasRoutes && hasDefaultRoute && hasRoutesImport) {
      // Check if the default route is the first route (important for React Router)
      const routesMatch = appContent.match(/<Routes[^>]*>([\s\S]*?)<\/Routes>/);
      if (routesMatch) {
        const routesContent = routesMatch[1];
        const routeMatches = routesContent.match(/<Route[^>]*>/g);
        
        if (routeMatches && routeMatches.length > 0) {
          const firstRoute = routeMatches[0];
          const isFirstRouteDefault = /path=["']\/["']/.test(firstRoute) || /path=\{\s*["']\/["']\s*\}/.test(firstRoute);
          
          if (!isFirstRouteDefault) {
            console.log('⚠️ Default route is not first, reordering routes...');
            
            // Extract all routes - use a simpler pattern
            const routeLines = routesContent.split('\n').filter((line: string) => line.includes('<Route'));
            const routes: Array<{ path: string; line: string }> = [];
            
            for (const line of routeLines) {
              const pathMatch = line.match(/path=["']([^"']+)["']/);
              if (pathMatch) {
                routes.push({
                  path: pathMatch[1],
                  line: line.trim()
                });
              }
            }
            
            // Find default route and move it to the front
            const defaultRouteIndex = routes.findIndex((r: { path: string; line: string }) => r.path === '/');
            if (defaultRouteIndex > 0) {
              const defaultRoute = routes.splice(defaultRouteIndex, 1)[0];
              routes.unshift(defaultRoute);
              
              // Rebuild routes section
              const newRoutesContent = routes.map((r: { path: string; line: string }) => '          ' + r.line).join('\n');
              appContent = appContent.replace(
                /<Routes[^>]*>([\s\S]*?)<\/Routes>/,
                `<Routes>\n${newRoutesContent}\n        </Routes>`
              );
              
              await context.sandbox.fs.uploadFile(Buffer.from(appContent), appPath);
              console.log('✅ Reordered routes: default route is now first');
            }
          }
        }
      }
    } else if (hasRoutesImport && !hasDefaultRoute) {
      console.log('⚠️ App.tsx has Routes but no default route, adding default route...');
      
      // Try to add default route if missing
      const routesMatch = appContent.match(/<Routes[^>]*>([\s\S]*?)<\/Routes>/);
      if (routesMatch) {
        const routesContent = routesMatch[1];
        // Add default route at the beginning
        const newRoutesContent = `          <Route path="/" element={<Home />} />\n${routesContent}`;
        appContent = appContent.replace(
          /<Routes[^>]*>([\s\S]*?)<\/Routes>/,
          `<Routes>\n${newRoutesContent}\n        </Routes>`
        );
        
        // Ensure Home is imported
        if (!appContent.includes('Home')) {
          // Try to add import
          const importMatch = appContent.match(/(import[^;]+;)/);
          if (importMatch) {
            const lastImport = importMatch[importMatch.length - 1];
            const homeImport = lastImport.includes('pages') 
              ? `import { Home } from './pages/Home';`
              : `import Home from './pages/Home';`;
            appContent = appContent.replace(/(import[^;]+;)/, `$1\n${homeImport}`);
          }
        }
        
        await context.sandbox.fs.uploadFile(Buffer.from(appContent), appPath);
        console.log('✅ Added default route to App.tsx');
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Error validating App routing:`, error.message);
  }
}

/**
 * Fix FeatureCard usage in Home.tsx (zero-props violation)
 */
async function fixFeatureCardUsage(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;
  
  try {
    const homePath = '/workspace/src/pages/Home.tsx';
    let homeContent = '';
    
    try {
      const homeFile = await context.sandbox.fs.downloadFile(homePath);
      homeContent = homeFile.toString('utf-8');
    } catch (e) {
      // Home.tsx doesn't exist, skip
      return;
    }
    
    // Check if FeatureCard is used with props (has attributes)
    const hasPropsUsage = /<FeatureCard\s+[^>/]*>/.test(homeContent) || /<FeatureCard\s+[^>/]*\/>/.test(homeContent);
    
    if (hasPropsUsage) {
      console.log('🔧 Fixing FeatureCard usage (removing props, inlining content)...');
      
      // Replace FeatureCard usages with inline divs
      // Handle both single-line and multi-line patterns
      // Pattern 1: <FeatureCard icon={...} title="..." description="..." />
      let modified = false;
      
      // First, try to match single-line pattern
      homeContent = homeContent.replace(
        /<FeatureCard\s+icon=\{([^}]+)\}\s+title=["']([^"']+)["']\s+description=["']([^"']+)["']\s*\/>/g,
        (match, icon, title, description) => {
          modified = true;
          return `<div className="bg-card text-card-foreground p-6 rounded-lg shadow-lg transform hover:scale-105 transition-transform duration-300 flex flex-col items-center text-center">
          <div className="mb-4">
            ${icon.trim()}
          </div>
          <h3 className="text-2xl font-semibold mb-2 text-primary-foreground">${title}</h3>
          <p className="text-muted-foreground">${description}</p>
        </div>`;
        }
      );
      
      // Also handle multi-line pattern if still present
      if (/<FeatureCard\s+[^>]*>/.test(homeContent)) {
        // Use AI to fix complex multi-line FeatureCard usage
        // For now, just remove FeatureCard component definition if it exists and replace usages
        console.log('⚠️ Complex FeatureCard usage detected, may need manual fix');
      }
      
      if (modified) {
        await context.sandbox.fs.uploadFile(Buffer.from(homeContent), homePath);
        console.log('✅ Fixed FeatureCard usage in Home.tsx');
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Error fixing FeatureCard usage:`, error.message);
  }
}

/**
 * Validate and fix config files before building
 */
export async function validateAndFixConfigFiles(context: ToolContext): Promise<void> {
  if (!context.sandbox) return;

  try {
    console.log('🔍 Validating config files...');

    // Prefer TypeScript config files - remove .js versions if .ts exists
    const tailwindJsExists = await context.sandbox.fs.downloadFile('/workspace/tailwind.config.js').catch(() => null);
    const tailwindTsExists = await context.sandbox.fs.downloadFile('/workspace/tailwind.config.ts').catch(() => null);
    
    if (tailwindJsExists && tailwindTsExists) {
      console.log('⚠️ Found duplicate Tailwind configs, removing tailwind.config.js (preferring .ts)...');
      try {
        await context.sandbox.process.executeCommand('rm -f /workspace/tailwind.config.js');
        console.log('✅ Removed tailwind.config.js (using tailwind.config.ts)');
      } catch (e) {
        console.warn('⚠️ Could not remove tailwind.config.js:', e);
      }
    } else if (tailwindJsExists && !tailwindTsExists) {
      // Convert .js to .ts
      console.log('🔧 Converting tailwind.config.js to TypeScript...');
      try {
        const tailwindContent = tailwindJsExists.toString('utf-8');
        let fixedContent = tailwindContent;
        
        // Convert CommonJS to ES module if needed
        if (fixedContent.includes('module.exports')) {
          fixedContent = fixedContent.replace(/module\.exports\s*=\s*{/, 'export default {');
        }
        
        // Create TypeScript version
        await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/tailwind.config.ts');
        // Remove JavaScript version
        await context.sandbox.process.executeCommand('rm -f /workspace/tailwind.config.js');
        console.log('✅ Converted tailwind.config.js to TypeScript');
      } catch (e) {
        console.warn('⚠️ Could not convert tailwind.config.js to TypeScript:', e);
      }
    }

    // Validate PostCSS config - must be .js (PostCSS doesn't support TypeScript), ensure ES module syntax
    try {
      // Check for JavaScript version (required)
      let postcssPath = '/workspace/postcss.config.js';
      let postcssContent = await context.sandbox.fs.downloadFile(postcssPath).catch(() => null);
      
      // If TypeScript version exists, convert it to JavaScript
      if (!postcssContent) {
        postcssPath = '/workspace/postcss.config.ts';
        postcssContent = await context.sandbox.fs.downloadFile(postcssPath).catch(() => null);
        
        if (postcssContent) {
          console.log('🔧 Converting postcss.config.ts to .js (PostCSS requirement)...');
          const content = postcssContent.toString('utf-8');
          let fixedContent = content;
          
          // Ensure ES module syntax
          if (fixedContent.includes('module.exports')) {
            fixedContent = fixedContent.replace(/module\.exports\s*=\s*{/, 'export default {');
          }
          
          // Create JavaScript version
          await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/postcss.config.js');
          // Remove TypeScript version
          await context.sandbox.process.executeCommand('rm -f /workspace/postcss.config.ts');
          console.log('✅ Converted postcss.config.ts to .js');
          postcssContent = Buffer.from(fixedContent);
          postcssPath = '/workspace/postcss.config.js';
        }
      }
      
      if (postcssContent) {
        const content = postcssContent.toString('utf-8');
        
        // Ensure ES module syntax (not CommonJS)
        if (content.includes('module.exports')) {
          console.log('🔧 Fixing PostCSS config: converting CommonJS to ES module syntax...');
          const fixedContent = content.replace(/module\.exports\s*=\s*{/, 'export default {');
          await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/postcss.config.js');
          console.log('✅ Fixed PostCSS config (ES module syntax)');
        }
      }
    } catch (e) {
      // PostCSS config might not exist, that's okay if not needed
      console.log('ℹ️ No PostCSS config found (might not be needed)');
    }

    // Validate main.tsx - ensure it has BrowserRouter and ErrorBoundary
    try {
      const mainContent = await context.sandbox.fs.downloadFile('/workspace/src/main.tsx');
      const content = mainContent.toString('utf-8');
      
      // Check if BrowserRouter is missing
      if (!content.includes('BrowserRouter') && !content.includes('react-router-dom')) {
        console.log('⚠️ main.tsx missing BrowserRouter, restoring from template...');
        const correctMain = `import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App.tsx'
import './index.css'

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    errorMessage: event.error?.message,
    errorStack: event.error?.stack
  })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', {
    reason: event.reason,
    reasonMessage: event.reason?.message,
    reasonStack: event.reason?.stack
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
`;
        await context.sandbox.fs.uploadFile(Buffer.from(correctMain), '/workspace/src/main.tsx');
        console.log('✅ Restored main.tsx with BrowserRouter');
      }
    } catch (e) {
      console.warn('⚠️ Could not validate main.tsx:', e);
    }

  } catch (error: any) {
    console.error('⚠️ Error validating config files:', error.message);
    // Don't throw - continue with build
  }
}

/**
 * Auto-fix config-related build errors (PostCSS, Tailwind, etc.)
 */
async function autoFixConfigErrors(context: ToolContext, errorOutput: string): Promise<boolean> {
  if (!context.sandbox) return false;

  let fixed = false;

  // Fix PostCSS config errors
  // Check for common PostCSS errors: ts-node required, module is not defined, or postcss.config issues
  const hasPostCSSError = errorOutput.toLowerCase().includes('postcss') && 
    (errorOutput.includes('ts-node') || 
     errorOutput.includes('module is not defined') || 
     errorOutput.includes('postcss.config'));
  
  if (hasPostCSSError) {
    console.log('🔧 Fixing PostCSS config error...');
    try {
      // Check for TypeScript version first (shouldn't exist, but fix if it does)
      let postcssPath = '/workspace/postcss.config.ts';
      let postcssContent = await context.sandbox.fs.downloadFile(postcssPath).catch(() => null);
      
      // If TypeScript version exists, convert to JavaScript
      if (postcssContent) {
        console.log('🔧 Removing postcss.config.ts (PostCSS requires .js)...');
        const content = postcssContent.toString('utf-8');
        let fixedContent = content;
        
        // Ensure ES module syntax
        if (fixedContent.includes('module.exports')) {
          fixedContent = fixedContent.replace(/module\.exports\s*=\s*{/, 'export default {');
        }
        
        // Create JavaScript version
        await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/postcss.config.js');
        // Remove TypeScript version
        await context.sandbox.process.executeCommand('rm -f /workspace/postcss.config.ts');
        console.log('✅ Converted postcss.config.ts to .js (PostCSS requirement)');
        fixed = true;
      } else {
        // Check JavaScript version
        postcssPath = '/workspace/postcss.config.js';
        postcssContent = await context.sandbox.fs.downloadFile(postcssPath).catch(() => null);
        
        if (postcssContent) {
          let content = postcssContent.toString('utf-8');
          
          // Convert CommonJS to ES module
          if (content.includes('module.exports')) {
            content = content.replace(/module\.exports\s*=\s*{/, 'export default {');
            await context.sandbox.fs.uploadFile(Buffer.from(content), '/workspace/postcss.config.js');
            console.log('✅ Fixed PostCSS config: converted to ES module syntax');
            fixed = true;
          }
        }
      }
    } catch (e: any) {
      console.warn('⚠️ Could not fix PostCSS config:', e.message);
    }
  }

  // Fix duplicate Tailwind config files - prefer TypeScript
  if (errorOutput.includes('tailwind.config') || errorOutput.includes('Cannot find module')) {
    try {
      const tailwindJsExists = await context.sandbox.fs.downloadFile('/workspace/tailwind.config.js').catch(() => null);
      const tailwindTsExists = await context.sandbox.fs.downloadFile('/workspace/tailwind.config.ts').catch(() => null);
      
      if (tailwindJsExists && tailwindTsExists) {
        console.log('🔧 Removing duplicate tailwind.config.js (preferring .ts)...');
        await context.sandbox.process.executeCommand('rm -f /workspace/tailwind.config.js');
        console.log('✅ Removed duplicate tailwind.config.js');
        fixed = true;
      } else if (tailwindJsExists && !tailwindTsExists) {
        // Convert .js to .ts
        console.log('🔧 Converting tailwind.config.js to TypeScript...');
        const tailwindContent = tailwindJsExists.toString('utf-8');
        let fixedContent = tailwindContent;
        
        // Check if package.json has type: module
        try {
          const packageJsonContent = await context.sandbox.fs.downloadFile('/workspace/package.json');
          const packageJson = JSON.parse(packageJsonContent.toString('utf-8'));
          
          // Convert CommonJS to ES module if needed
          if (packageJson.type === 'module' && fixedContent.includes('module.exports')) {
            fixedContent = fixedContent.replace(/module\.exports\s*=\s*{/, 'export default {');
          }
        } catch (e) {
          // Ignore - just convert format
          if (fixedContent.includes('module.exports')) {
            fixedContent = fixedContent.replace(/module\.exports\s*=\s*{/, 'export default {');
          }
        }
        
        // Create TypeScript version
        await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/tailwind.config.ts');
        // Remove JavaScript version
        await context.sandbox.process.executeCommand('rm -f /workspace/tailwind.config.js');
        console.log('✅ Converted tailwind.config.js to TypeScript');
        fixed = true;
      }
    } catch (e: any) {
      console.warn('⚠️ Could not fix Tailwind config:', e.message);
    }
  }

  return fixed;
}

/**
 * Validate and fix malformed package.json files
 */
async function validateAndFixPackageJson(context: ToolContext): Promise<boolean> {
  if (!context.sandbox) return false;
  
  try {
    const packageJsonContent = await context.sandbox.fs.downloadFile('/workspace/package.json');
    let content = packageJsonContent.toString('utf-8');
    
    // Try to parse it
    try {
      JSON.parse(content);
      // Valid JSON, no fix needed
      return false;
    } catch (parseError: any) {
      console.log(`⚠️ package.json is malformed: ${parseError.message}`);
      
      // Common fixes:
      // 1. Remove duplicate closing braces
      content = content.replace(/\}\s*\}+/g, '}');
      
      // 2. Remove trailing commas before closing braces/brackets
      content = content.replace(/,(\s*[}\]])/g, '$1');
      
      // 3. Fix duplicate dependencies entries (merge them)
      // Try to extract valid JSON structure by finding the last valid closing brace
      const lastValidBrace = content.lastIndexOf('}');
      if (lastValidBrace > 0) {
        // Check if there's extra content after the last brace
        const afterLastBrace = content.substring(lastValidBrace + 1).trim();
        if (afterLastBrace && (afterLastBrace.startsWith('}') || afterLastBrace.startsWith('}}'))) {
          // Remove extra closing braces
          content = content.substring(0, lastValidBrace + 1);
        }
      }
      
      // 4. Try to parse again
      try {
        const fixed = JSON.parse(content);
        
        // Validate structure
        if (typeof fixed !== 'object' || Array.isArray(fixed)) {
          throw new Error('package.json must be an object');
        }
        
        // Ensure required fields exist
        if (!fixed.name) fixed.name = 'vibe-app';
        if (!fixed.version) fixed.version = '0.1.0';
        if (!fixed.dependencies) fixed.dependencies = {};
        if (!fixed.devDependencies) fixed.devDependencies = {};
        
        // Sort dependencies alphabetically for consistency
        const sortedDeps = Object.keys(fixed.dependencies).sort().reduce((acc: any, key: string) => {
          acc[key] = fixed.dependencies[key];
          return acc;
        }, {});
        fixed.dependencies = sortedDeps;
        
        const sortedDevDeps = Object.keys(fixed.devDependencies).sort().reduce((acc: any, key: string) => {
          acc[key] = fixed.devDependencies[key];
          return acc;
        }, {});
        fixed.devDependencies = sortedDevDeps;
        
        // Write fixed version
        const fixedContent = JSON.stringify(fixed, null, 2);
        await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), '/workspace/package.json');
        
        // Verify it's valid
        const verify = await context.sandbox.fs.downloadFile('/workspace/package.json');
        JSON.parse(verify.toString('utf-8'));
        
        console.log('✅ Successfully fixed malformed package.json');
        return true;
      } catch (secondParseError: any) {
        console.error(`❌ Could not fix package.json: ${secondParseError.message}`);
        
        // Last resort: restore from template if available
        try {
          // Try to restore a minimal valid package.json
          const minimalPackageJson = {
            name: 'vibe-app',
            version: '0.1.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc --build && vite build',
              preview: 'vite preview'
            },
            dependencies: {},
            devDependencies: {}
          };
          
          // Try to preserve existing dependencies if we can extract them
          try {
            const existingMatch = content.match(/"dependencies"\s*:\s*\{([^}]*)\}/);
            if (existingMatch) {
              // Try to extract dependency entries
              const depsMatch = existingMatch[1].match(/"([^"]+)":\s*"([^"]+)"/g);
              if (depsMatch) {
                depsMatch.forEach((dep: string) => {
                  const depMatch = dep.match(/"([^"]+)":\s*"([^"]+)"/);
                  if (depMatch && depMatch[1] && depMatch[2]) {
                    (minimalPackageJson.dependencies as Record<string, string>)[depMatch[1]] = depMatch[2];
                  }
                });
              }
            }
          } catch (e) {
            // Ignore extraction errors
          }
          
          await context.sandbox.fs.uploadFile(
            Buffer.from(JSON.stringify(minimalPackageJson, null, 2)),
            '/workspace/package.json'
          );
          console.log('⚠️ Restored minimal package.json (dependencies may need to be re-added)');
          return true;
        } catch (restoreError: any) {
          console.error(`❌ Could not restore package.json: ${restoreError.message}`);
          return false;
        }
      }
    }
  } catch (error: any) {
    console.error(`❌ Error validating package.json: ${error.message}`);
    return false;
  }
}

/**
 * Auto-fix common TypeScript errors
 */
async function autoFixTypeScriptErrors(context: ToolContext, errorOutput: string): Promise<void> {
  if (!context.sandbox) return;

  // Pattern: src/pages/Home.tsx(4,3): error TS2304: Cannot find name 'useEffect'.
  const missingImportPattern = /([\w\/\.-]+)\((\d+),(\d+)\): error TS\d+: Cannot find name '(\w+)'/g;
  const reactHooksFixes: Array<{ file: string; hook: string; line: number }> = [];
  const missingComponentFixes: Array<{ file: string; componentName: string; line: number }> = [];
  const invalidLucideIconFixes: Array<{ file: string; invalidIcon: string; line: number; replacement: string }> = [];
  
  // Import Lucide icon validation functions from lucide-icons.ts (has helper functions)
  let isValidLucideIcon: ((iconName: string) => boolean) | null = null;
  let findClosestLucideIcon: ((iconName: string) => string | null) | null = null;
  
  try {
    const lucideHelpers = await import('@/lib/lucide-icons');
    isValidLucideIcon = lucideHelpers.isValidLucideIcon;
    findClosestLucideIcon = lucideHelpers.findClosestLucideIcon;
  } catch (e) {
    console.warn('⚠️ Could not import Lucide icon validation helpers:', e);
  }
  
  let match;
  while ((match = missingImportPattern.exec(errorOutput)) !== null) {
    const filePath = match[1].replace(/^src\//, 'src/');
    const lineNum = parseInt(match[2], 10);
    const name = match[4];
    
    // Check if it's a React hook
    const reactHooks = ['useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useContext', 'useReducer'];
    if (reactHooks.includes(name)) {
      reactHooksFixes.push({ file: filePath, hook: name, line: lineNum });
    }
    // Check if it's an invalid Lucide icon (capitalized name, might be an icon)
    else if (name.match(/^[A-Z][a-zA-Z0-9]+$/)) {
      // Check if it's used in a Lucide import context
      try {
        const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
        const fileContent = await context.sandbox.fs.downloadFile(fullPath);
        const content = fileContent.toString('utf-8');
        const lines = content.split('\n');
        const errorLine = lines[lineNum - 1] || '';
        
        // Check if it's in a Lucide import or usage
        if (content.includes('lucide-react') && (errorLine.includes(name) || errorLine.includes(`<${name}`))) {
          // Validate using the icon validation function
          if (isValidLucideIcon && !isValidLucideIcon(name)) {
            // Icon is invalid, try to find closest match
            const closest = findClosestLucideIcon ? findClosestLucideIcon(name) : null;
            if (closest) {
              invalidLucideIconFixes.push({ file: filePath, invalidIcon: name, line: lineNum, replacement: closest });
            } else {
              // No closest match found, but it's definitely an invalid icon
              invalidLucideIconFixes.push({ file: filePath, invalidIcon: name, line: lineNum, replacement: 'ArrowRight' }); // Safe fallback
            }
          }
        }
      } catch (e) {
        // Can't read file, skip
      }
    }
    // Check if it's a missing component (capitalized name, used as JSX)
    else if (name.match(/^[A-Z][a-zA-Z0-9]+$/) && name !== 'React') {
      try {
        const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
        const fileContent = await context.sandbox.fs.downloadFile(fullPath);
        const content = fileContent.toString('utf-8');
        const lines = content.split('\n');
        const errorLine = lines[lineNum - 1] || '';
        
        // Check if it's used as JSX (<ComponentName />) or in element prop
        if (errorLine.includes(`<${name}`) || errorLine.includes(`element={<${name}`)) {
          // Check if it's imported but file doesn't exist
          const importMatch = content.match(new RegExp(`import\\s+.*\\b${name}\\b.*from\\s+['"]([^'"]+)['"]`));
          if (importMatch) {
            const importPath = importMatch[1];
            // It's imported but the file might not exist or export is wrong
            missingComponentFixes.push({ file: filePath, componentName: name, line: lineNum });
          } else {
            // Not imported at all - should be handled by validateImports
            missingComponentFixes.push({ file: filePath, componentName: name, line: lineNum });
          }
        }
      } catch (e) {
        // Can't read file, skip
      }
    }
  }

  // Fix invalid Lucide icons first
  for (const fix of invalidLucideIconFixes) {
    try {
      const fullPath = fix.file.startsWith('/workspace/') ? fix.file : `/workspace/${fix.file}`;
      const fileContent = await context.sandbox.fs.downloadFile(fullPath);
      let content = fileContent.toString('utf-8');
      const replacement = fix.replacement;
      
      if (replacement) {
        // Replace in import statement and usage (be careful not to replace in comments or strings)
        // Replace in import: import { InvalidIcon } -> import { ValidIcon }
        content = content.replace(
          new RegExp(`\\b${fix.invalidIcon}\\b`, 'g'),
          replacement
        );
        await context.sandbox.fs.uploadFile(Buffer.from(content), fullPath);
        console.log(`✅ Auto-fixed: Replaced invalid Lucide icon ${fix.invalidIcon} with ${replacement} in ${fix.file}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix Lucide icon in ${fix.file}:`, error.message);
    }
  }

  // Fix missing components
  for (const fix of missingComponentFixes) {
    try {
      const fullPath = fix.file.startsWith('/workspace/') ? fix.file : `/workspace/${fix.file}`;
      const fileContent = await context.sandbox.fs.downloadFile(fullPath);
      const content = fileContent.toString('utf-8');
      
      // Check import statement to find the expected file path
      const importMatch = content.match(new RegExp(`import\\s+.*\\b${fix.componentName}\\b.*from\\s+['"]([^'"]+)['"]`));
      
      if (importMatch) {
        const importPath = importMatch[1];
        let componentFilePath = '';
        
        // Resolve import path relative to current file
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          const currentDir = fix.file.substring(0, fix.file.lastIndexOf('/'));
          const pathParts = currentDir.split('/').filter((p: string) => p);
          const importParts = importPath.split('/').filter((p: string) => p && p !== '.');
          
          for (const part of importParts) {
            if (part === '..') {
              pathParts.pop();
            } else {
              pathParts.push(part);
            }
          }
          
          componentFilePath = pathParts.join('/');
        } else if (importPath.startsWith('@/')) {
          componentFilePath = importPath.replace('@/', 'src/');
        }
        
        // Check if file exists
        if (componentFilePath) {
          const possiblePaths = [
            `/workspace/${componentFilePath}.tsx`,
            `/workspace/${componentFilePath}/index.tsx`,
            `/workspace/${componentFilePath}.ts`,
            `/workspace/${componentFilePath}/index.ts`,
          ];
          
          let fileExists = false;
          let existingFilePath = '';
          for (const possiblePath of possiblePaths) {
            try {
              await context.sandbox.fs.downloadFile(possiblePath);
              fileExists = true;
              existingFilePath = possiblePath;
              break;
            } catch (e) {
              // File doesn't exist at this path
            }
          }
          
          // If file exists, check if export matches import style
          if (fileExists && existingFilePath) {
            try {
              const existingFileContent = await context.sandbox.fs.downloadFile(existingFilePath);
              const existingContent = existingFileContent.toString('utf-8');
              const hasNamedExport = existingContent.match(new RegExp(`export\\s+(function|const)\\s+${fix.componentName}`));
              const hasDefaultExport = existingContent.match(new RegExp(`export\\s+default\\s+.*${fix.componentName}`));
              const isNamedImport = content.match(new RegExp(`import\\s+{\\s*${fix.componentName}\\s*}\\s+from`));
              
              // Fix export mismatch
              if (isNamedImport && !hasNamedExport && hasDefaultExport) {
                // Change default export to named export
                const fixedContent = existingContent
                  .replace(/export\s+default\s+.*$/, `export function ${fix.componentName}() {`)
                  .replace(/^function\s+(\w+)\s*\(/, `function ${fix.componentName}(`);
                await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), existingFilePath);
                console.log(`✅ Fixed export mismatch: Changed ${fix.componentName} from default to named export`);
              } else if (!isNamedImport && hasNamedExport && !hasDefaultExport) {
                // Change named export to default export
                const fixedContent = existingContent
                  .replace(new RegExp(`export\\s+(function|const)\\s+${fix.componentName}`), `$1 ${fix.componentName}`)
                  + `\nexport default ${fix.componentName};`;
                await context.sandbox.fs.uploadFile(Buffer.from(fixedContent), existingFilePath);
                console.log(`✅ Fixed export mismatch: Changed ${fix.componentName} from named to default export`);
              }
            } catch (e) {
              console.warn(`⚠️ Could not check/fix export for ${existingFilePath}:`, e);
            }
          }
          // If file doesn't exist, create it
          else if (!fileExists) {
            // Determine if it should be a named or default export based on import style
            const isNamedImport = content.match(new RegExp(`import\\s+{\\s*${fix.componentName}\\s*}\\s+from`));
            
            let componentFile = '';
            if (componentFilePath.includes('/components/') || componentFilePath.includes('/pages/')) {
              componentFile = `/workspace/${componentFilePath}.tsx`;
            } else {
              // Try to infer location
              if (fix.componentName.includes('Navbar') || fix.componentName.includes('Header') || fix.componentName.includes('Footer')) {
                componentFile = `/workspace/src/components/${fix.componentName}.tsx`;
              } else if (fix.componentName.includes('Page') || ['Home', 'Swap', 'Liquidity', 'About', 'Contact'].includes(fix.componentName)) {
                componentFile = `/workspace/src/pages/${fix.componentName}.tsx`;
              } else {
                componentFile = `/workspace/src/components/${fix.componentName}.tsx`;
              }
            }
            
            const componentDir = componentFile.substring(0, componentFile.lastIndexOf('/'));
            
            // Ensure directory exists
            try {
              await context.sandbox.fs.createFolder(componentDir, '755');
            } catch (e) {
              // Directory might already exist
            }
            
            // Create component file with appropriate export style
            const placeholderContent = isNamedImport
              ? `import React from 'react';

export function ${fix.componentName}() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold">${fix.componentName}</h2>
      <p>${fix.componentName} component</p>
    </div>
  );
}
`
              : `import React from 'react';

function ${fix.componentName}() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold">${fix.componentName}</h2>
      <p>${fix.componentName} component</p>
    </div>
  );
}

export default ${fix.componentName};
`;
            await context.sandbox.fs.uploadFile(Buffer.from(placeholderContent), componentFile);
            console.log(`✅ Auto-created missing component: ${componentFile}`);
          }
        }
      } else {
        // No import found - component is used but not imported
        // Check if file might exist, otherwise create it
        const possiblePaths = [
          `/workspace/src/components/${fix.componentName}.tsx`,
          `/workspace/src/pages/${fix.componentName}.tsx`,
        ];
        
        let componentExists = false;
        for (const possiblePath of possiblePaths) {
          try {
            await context.sandbox.fs.downloadFile(possiblePath);
            // File exists - might just need to add import
            console.log(`ℹ️ Component ${fix.componentName} exists at ${possiblePath} but may not be imported correctly`);
            componentExists = true;
            break;
          } catch (e) {
            // File doesn't exist
          }
        }
        
        // If component doesn't exist, create it
        if (!componentExists) {
          // Determine location based on component name
          let componentFile = '';
          if (fix.componentName.includes('Navbar') || fix.componentName.includes('Header') || fix.componentName.includes('Footer')) {
            componentFile = `/workspace/src/components/${fix.componentName}.tsx`;
          } else if (fix.componentName.includes('Page') || ['Home', 'Swap', 'Liquidity', 'About', 'Contact'].includes(fix.componentName)) {
            componentFile = `/workspace/src/pages/${fix.componentName}.tsx`;
          } else {
            componentFile = `/workspace/src/components/${fix.componentName}.tsx`;
          }
          
          const componentDir = componentFile.substring(0, componentFile.lastIndexOf('/'));
          try {
            await context.sandbox.fs.createFolder(componentDir, '755');
          } catch (e) {
            // Directory might already exist
          }
          
          // Create with named export by default (most common)
          const placeholderContent = `import React from 'react';

export function ${fix.componentName}() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold">${fix.componentName}</h2>
      <p>${fix.componentName} component</p>
    </div>
  );
}
`;
          await context.sandbox.fs.uploadFile(Buffer.from(placeholderContent), componentFile);
          console.log(`✅ Auto-created missing component: ${componentFile}`);
          
          // Also add the import to the file that uses it
          try {
            const fullPath = fix.file.startsWith('/workspace/') ? fix.file : `/workspace/${fix.file}`;
            const fileContent = await context.sandbox.fs.downloadFile(fullPath);
            let fileContentStr = fileContent.toString('utf-8');
            
            // Determine import path
            const isPage = componentFile.includes('/pages/');
            const relativePath = isPage 
              ? `./pages/${fix.componentName}`
              : `./components/${fix.componentName}`;
            
            // Add import if it doesn't exist (check with regex)
            const hasImport = new RegExp(`import\\s+.*\\b${fix.componentName}\\b.*from`, 'g').test(fileContentStr);
            if (!hasImport) {
              // Find where to add the import (after other imports)
              const importLines = fileContentStr.match(/^import\s+.*$/gm) || [];
              const lastImportLine = importLines[importLines.length - 1] || '';
              const insertIndex = fileContentStr.indexOf(lastImportLine) + lastImportLine.length;
              
              const newImport = `\nimport { ${fix.componentName} } from '${relativePath}';`;
              fileContentStr = fileContentStr.slice(0, insertIndex) + newImport + fileContentStr.slice(insertIndex);
              
              await context.sandbox.fs.uploadFile(Buffer.from(fileContentStr), fullPath);
              console.log(`✅ Added import for ${fix.componentName} to ${fix.file}`);
            }
          } catch (e) {
            console.warn(`⚠️ Could not add import for ${fix.componentName} to ${fix.file}:`, e);
          }
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix missing component ${fix.componentName} in ${fix.file}:`, error.message);
    }
  }

  // Apply React hook fixes
  for (const fix of reactHooksFixes) {
    try {
      const fullPath = fix.file.startsWith('/workspace/') ? fix.file : `/workspace/${fix.file}`;
      const fileContent = await context.sandbox.fs.downloadFile(fullPath);
      const content = fileContent.toString('utf-8');
      
      // Check if React is already imported
      const reactImportMatch = content.match(/^import\s+(?:React,?\s*)?\{([^}]+)\}\s+from\s+['"]react['"]/m);
      
      if (reactImportMatch) {
        // React is imported, check if hook is in the import
        const imports = reactImportMatch[1].split(',').map((i: string) => i.trim());
        if (!imports.includes(fix.hook)) {
          // Add hook to existing import
          const newImports = [...imports, fix.hook].join(', ');
          const newImportLine = content.includes('import React')
            ? `import React, { ${newImports} } from 'react';`
            : `import { ${newImports} } from 'react';`;
          
          const newContent = content.replace(
            /^import\s+(?:React,?\s*)?\{[^}]+\}\s+from\s+['"]react['"]/m,
            newImportLine
          );
          
          await context.sandbox.fs.uploadFile(
            Buffer.from(newContent),
            fullPath
          );
          console.log(`✅ Auto-fixed: Added ${fix.hook} import to ${fix.file}`);
        }
      } else {
        // No React import, add one
        const newImportLine = `import { ${fix.hook} } from 'react';\n`;
        const newContent = newImportLine + content;
        
        await context.sandbox.fs.uploadFile(
          Buffer.from(newContent),
          fullPath
        );
        console.log(`✅ Auto-fixed: Added React import with ${fix.hook} to ${fix.file}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix ${fix.file}:`, error.message);
    }
  }
  
  // Pattern: src/pages/Swap.tsx(32,16): error TS2322: Property 'classNameName' does not exist
  // Fix classNameName typos
  const classNameNamePattern = /([\w\/\.-]+)\((\d+),(\d+)\): error TS\d+: Property 'classNameName'/g;
  const classNameNameFiles = new Set<string>();
  
  while ((match = classNameNamePattern.exec(errorOutput)) !== null) {
    const filePath = match[1].replace(/^src\//, 'src/');
    classNameNameFiles.add(filePath);
  }
  
  // Fix classNameName typos in affected files
  for (const filePath of Array.from(classNameNameFiles)) {
    try {
      const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
      const content = await context.sandbox.fs.downloadFile(fullPath);
      let fileContent = content.toString('utf-8');
      
      if (fileContent.includes('classNameName')) {
        fileContent = fileContent.replace(/classNameName/g, 'className');
        await context.sandbox.fs.uploadFile(Buffer.from(fileContent), fullPath);
        console.log(`✅ Auto-fixed classNameName typo in ${filePath}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix classNameName in ${filePath}:`, error.message);
    }
  }
  
  // Pattern: src/components/ui/button.tsx(5,20): error TS2307: Cannot find module '../lib/utils'
  // Fix incorrect import paths (../lib/utils should be ../../lib/utils from components/ui/)
  const importPathPattern = /([\w\/\.-]+)\((\d+),(\d+)\): error TS\d+: Cannot find module ['"]([^'"]+)['"]/g;
  const importPathFixes: Array<{ file: string; wrongPath: string; line: number }> = [];
  
  while ((match = importPathPattern.exec(errorOutput)) !== null) {
    const filePath = match[1].replace(/^src\//, 'src/');
    const lineNum = parseInt(match[2], 10);
    const wrongPath = match[4];
    
    // Check if it's a relative import path issue
    if (wrongPath.startsWith('../') || wrongPath.startsWith('./')) {
      importPathFixes.push({ file: filePath, wrongPath, line: lineNum });
    }
  }
  
  // Fix import paths
  for (const fix of importPathFixes) {
    try {
      const fullPath = fix.file.startsWith('/workspace/') ? fix.file : `/workspace/${fix.file}`;
      const content = await context.sandbox.fs.downloadFile(fullPath);
      let fileContent = content.toString('utf-8');
      
      // Check if the file is in components/ui/ and trying to import from ../lib/utils
      // It should be ../../lib/utils
      if (fix.file.includes('components/ui/') && fix.wrongPath.includes('../lib/')) {
        const correctedPath = fix.wrongPath.replace('../lib/', '../../lib/');
        fileContent = fileContent.replace(
          new RegExp(fix.wrongPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          correctedPath
        );
        await context.sandbox.fs.uploadFile(Buffer.from(fileContent), fullPath);
        console.log(`✅ Auto-fixed import path in ${fix.file}: ${fix.wrongPath} -> ${correctedPath}`);
      }
      // Check if the file is in components/ (not ui/) and trying to import from ../lib/utils
      // It should be ../lib/utils (correct)
      else if (fix.file.includes('components/') && !fix.file.includes('components/ui/') && fix.wrongPath.includes('../../lib/')) {
        const correctedPath = fix.wrongPath.replace('../../lib/', '../lib/');
        fileContent = fileContent.replace(
          new RegExp(fix.wrongPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          correctedPath
        );
        await context.sandbox.fs.uploadFile(Buffer.from(fileContent), fullPath);
        console.log(`✅ Auto-fixed import path in ${fix.file}: ${fix.wrongPath} -> ${correctedPath}`);
      }
      // Check if it's a relative import (./ or ../) that might be a renamed file
      else if (fix.wrongPath.startsWith('./') || fix.wrongPath.startsWith('../')) {
        // Extract the directory of the importing file
        const importingFileDir = fix.file.substring(0, fix.file.lastIndexOf('/'));
        const importingFileFullDir = `/workspace/${importingFileDir}`;
        
        // Resolve the import path to get the expected directory
        const importParts = fix.wrongPath.split('/');
        let targetDir = importingFileFullDir;
        
        for (const part of importParts) {
          if (part === '..') {
            targetDir = targetDir.substring(0, targetDir.lastIndexOf('/'));
          } else if (part === '.' || part === '') {
            // Current directory, do nothing
          } else {
            // This should be the filename (without extension)
            const wrongFileName = part;
            
            // Search for files in the target directory with similar names
            try {
              const listResult = await context.sandbox.process.executeCommand(
                `find "${targetDir}" -maxdepth 1 -type f \\( -name "*.ts" -o -name "*.tsx" \\) 2>/dev/null || true`
              );
              
              const files = (listResult.result || '')
                .trim()
                .split('\n')
                .filter((f: string) => f && !f.includes('node_modules'));
              
              // Try to find a file that matches (case-insensitive or with different casing)
              let foundFile: string | null = null;
              
              for (const file of files) {
                const fileName = file.substring(file.lastIndexOf('/') + 1).replace(/\.(ts|tsx)$/, '');
                const wrongFileNameLower = wrongFileName.toLowerCase();
                const fileNameLower = fileName.toLowerCase();
                
                // Check for exact match (case-insensitive)
                if (fileNameLower === wrongFileNameLower && fileName !== wrongFileName) {
                  foundFile = fileName;
                  break;
                }
                
                // Check for kebab-case to PascalCase conversion (e.g., mode-toggle -> ModeToggle)
                const kebabToPascal = wrongFileName
                  .split('-')
                  .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                  .join('');
                
                if (fileName === kebabToPascal || fileName.toLowerCase() === kebabToPascal.toLowerCase()) {
                  foundFile = fileName;
                  break;
                }
              }
              
              // If no exact match found, try to find files that contain similar words
              // e.g., mode-toggle might have been renamed to ThemeToggle (contains "toggle")
              if (!foundFile && wrongFileName.includes('-')) {
                const wrongWords = wrongFileName.toLowerCase().split('-');
                let bestMatch: { fileName: string; score: number } | null = null;
                
                for (const file of files) {
                  const fileName = file.substring(file.lastIndexOf('/') + 1).replace(/\.(ts|tsx)$/, '');
                  const fileNameLower = fileName.toLowerCase();
                  
                  // Check if any word from the wrong filename appears in the actual filename
                  let score = 0;
                  for (const word of wrongWords) {
                    if (fileNameLower.includes(word)) {
                      score++;
                    }
                  }
                  
                  // If at least one word matches and it's a reasonable match
                  if (score > 0 && (!bestMatch || score > bestMatch.score)) {
                    bestMatch = { fileName, score };
                  }
                }
                
                // Use the best match if it has a good score
                if (bestMatch && bestMatch.score >= 1) {
                  foundFile = bestMatch.fileName;
                }
              }
              
              // Last resort: if there's only one component file in the directory and the import is clearly wrong,
              // use that file (but only for component directories to avoid false positives)
              if (!foundFile && (targetDir.includes('/components/') || targetDir.includes('/pages/'))) {
                const componentFiles = files.filter((f: string) => {
                  const name = f.substring(f.lastIndexOf('/') + 1);
                  return name.match(/^[A-Z]/) && (name.endsWith('.tsx') || name.endsWith('.ts'));
                });
                
                if (componentFiles.length === 1) {
                  const singleFile = componentFiles[0];
                  const fileName = singleFile.substring(singleFile.lastIndexOf('/') + 1).replace(/\.(ts|tsx)$/, '');
                  foundFile = fileName;
                }
              }
              
              if (foundFile) {
                // Reconstruct the corrected import path
                const correctedPath = fix.wrongPath.replace(wrongFileName, foundFile);
                fileContent = fileContent.replace(
                  new RegExp(fix.wrongPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                  correctedPath
                );
                await context.sandbox.fs.uploadFile(Buffer.from(fileContent), fullPath);
                console.log(`✅ Auto-fixed renamed file import in ${fix.file}: ${fix.wrongPath} -> ${correctedPath}`);
                break; // Found and fixed, move to next fix
              }
            } catch (error: any) {
              // Could not search directory, continue
            }
          }
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix import path in ${fix.file}:`, error.message);
    }
  }
  
  // Pattern: src/main.tsx(5,8): error TS2613: Module '"/workspace/src/App"' has no default export.
  // Or: src/main.tsx(5,8): error TS2613: Module '"/workspace/src/App"' has no default export. Did you mean to use 'import { App } from "/workspace/src/App"' instead?
  // Fix App.tsx to use default export when main.tsx expects it
  const defaultExportPattern = /([\w\/\.-]+)\((\d+),(\d+)\): error TS2613: Module\s+['"]([^'"]+)['"]\s+has no default export/gi;
  const defaultExportFixes: Array<{ file: string; importedFile: string; line: number }> = [];
  
  let defaultExportMatch;
  while ((defaultExportMatch = defaultExportPattern.exec(errorOutput)) !== null) {
    const filePath = defaultExportMatch[1].replace(/^src\//, 'src/');
    const lineNum = parseInt(defaultExportMatch[2], 10);
    let importedFile = defaultExportMatch[4];
    
    // Extract the actual file path (remove quotes and workspace prefix)
    importedFile = importedFile
      .replace(/^["']/, '')
      .replace(/["']$/, '')
      .replace(/^\/workspace\/src\//, 'src/')
      .replace(/^\/workspace\//, '')
      .replace(/^src\//, 'src/');
    
    // If it's just "App" or "/App", it's App.tsx
    if (importedFile === 'App' || importedFile.endsWith('/App') || importedFile.includes('/App"')) {
      importedFile = 'App';
    }
    
    defaultExportFixes.push({ file: filePath, importedFile, line: lineNum });
  }
  
  // Fix default export issues
  for (const fix of defaultExportFixes) {
    try {
      // Find the file that needs to be fixed (the one being imported)
      let fileToFix = '';
      
      // Special handling for App.tsx (most common case)
      if (fix.importedFile === 'App' || fix.importedFile.includes('App')) {
        fileToFix = '/workspace/src/App.tsx';
      } else {
        // Try to resolve the path
        const cleanPath = fix.importedFile.replace(/^["']/, '').replace(/["']$/, '');
        const resolvedPath = cleanPath.startsWith('src/') 
          ? `/workspace/${cleanPath}.tsx`
          : `/workspace/src/${cleanPath}.tsx`;
        
        // Try different extensions
        const possiblePaths = [
          resolvedPath,
          resolvedPath.replace('.tsx', '.ts'),
          `/workspace/src/${cleanPath}.tsx`,
          `/workspace/src/${cleanPath}.ts`,
        ];
        
        for (const possiblePath of possiblePaths) {
          try {
            await context.sandbox.fs.downloadFile(possiblePath);
            fileToFix = possiblePath;
            break;
          } catch (e) {
            // File doesn't exist at this path
          }
        }
      }
      
      if (!fileToFix) {
        console.warn(`⚠️ Could not find file to fix for ${fix.importedFile} (tried App.tsx and variations)`);
        continue;
      }
      
      // Verify file exists
      try {
        await context.sandbox.fs.downloadFile(fileToFix);
      } catch (e) {
        console.warn(`⚠️ File ${fileToFix} does not exist`);
        continue;
      }
      
      // Read the file that needs fixing
      const fileContent = await context.sandbox.fs.downloadFile(fileToFix);
      let content = fileContent.toString('utf-8');
      
      // Check if it has named export but not default export
      const hasNamedExport = /export\s+(function|const)\s+(\w+)/.test(content);
      const hasDefaultExport = /export\s+default/.test(content);
      
      if (hasNamedExport && !hasDefaultExport) {
        // Extract component name from named export (get the first/main one)
        const namedExportMatch = content.match(/export\s+(function|const)\s+(\w+)/);
        if (namedExportMatch) {
          const componentName = namedExportMatch[2];
          const exportType = namedExportMatch[1]; // 'function' or 'const'
          
          console.log(`🔧 Converting ${componentName} from named export to default export in ${fileToFix}`);
          
          // Convert named export to default export
          // Replace: export function App() { ... }
          // With: function App() { ... } ... export default App;
          
          // First, remove 'export' keyword from the main component
          // Use a more precise regex that matches the entire export statement
          const exportRegex = new RegExp(`export\\s+${exportType}\\s+${componentName}\\b`, 'g');
          content = content.replace(exportRegex, `${exportType} ${componentName}`);
          
          // Remove any duplicate export statements at the end (like 'export { App }')
          content = content.replace(new RegExp(`export\\s*{\\s*${componentName}\\s*}\\s*;?\\s*$`, 'gm'), '');
          content = content.replace(new RegExp(`export\\s*{\\s*${componentName}\\s*,?[^}]*}\\s*;?\\s*$`, 'gm'), '');
          
          // Add default export at the end (remove trailing whitespace first)
          content = content.trim();
          
          // Check if there are other exports we should preserve
          const otherExports = content.match(/\n(\s*)export\s+(?!default)/);
          if (otherExports && !content.includes('export default')) {
            // Insert before the last non-default export
            const insertPos = content.lastIndexOf('\n' + otherExports[1] + 'export');
            content = content.slice(0, insertPos) + `\n\nexport default ${componentName};` + content.slice(insertPos);
          } else {
            // Add at the end
            content = content + `\n\nexport default ${componentName};`;
          }
          
          await context.sandbox.fs.uploadFile(Buffer.from(content), fileToFix);
          console.log(`✅ Fixed default export: Changed ${componentName} from named to default export in ${fileToFix}`);
        }
      } else if (!hasDefaultExport && !hasNamedExport) {
        // No export at all - might be using export { App } at the end
        // Try to find and convert that
        const namedExportAtEnd = content.match(/export\s*{\s*(\w+)\s*}/);
        if (namedExportAtEnd) {
          const componentName = namedExportAtEnd[1];
          // Remove the export { ComponentName }
          content = content.replace(/export\s*{\s*\w+\s*}\s*;?\s*$/, '');
          // Add default export
          content = content.trim() + `\n\nexport default ${componentName};`;
          await context.sandbox.fs.uploadFile(Buffer.from(content), fileToFix);
          console.log(`✅ Fixed default export: Added default export for ${componentName} in ${fileToFix}`);
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not auto-fix default export for ${fix.importedFile}:`, error.message);
    }
  }
}

/**
 * Fix file casing errors (TS1261, TS1149)
 * Renames lowercase component files to PascalCase to match imports
 */
async function fixFileCasingErrors(context: ToolContext, errorOutput: string): Promise<boolean> {
  if (!context.sandbox) return false;
  
  try {
    // Pattern: error TS1261: Already included file name '/workspace/src/components/Hero.tsx' differs from file name '/workspace/src/components/hero.tsx' only in casing.
    // Pattern: error TS1149: File name '/workspace/src/components/header.tsx' differs from already included file name '/workspace/src/components/Header.tsx' only in casing.
    const casingPattern1 = /error TS1261: Already included file name ['"]([^'"]+)['"] differs from file name ['"]([^'"]+)['"] only in casing/g;
    const casingPattern2 = /error TS1149: File name ['"]([^'"]+)['"] differs from already included file name ['"]([^'"]+)['"] only in casing/g;
    
    const casingFixes = new Map<string, string>(); // lowercase path -> PascalCase path
    
    let match;
    // Pattern 1: TS1261 - first path is the "already included" (import), second is the actual file
    while ((match = casingPattern1.exec(errorOutput)) !== null) {
      const importedPath = match[1]; // This is what's imported (PascalCase)
      const actualPath = match[2]; // This is what exists on disk (lowercase)
      
      const importedFileName = importedPath.split('/').pop() || '';
      const actualFileName = actualPath.split('/').pop() || '';
      
      // If imported is PascalCase and actual is lowercase, rename actual to imported
      if (importedFileName && importedFileName[0] === importedFileName[0].toUpperCase() && 
          actualFileName && actualFileName[0] === actualFileName[0].toLowerCase()) {
        casingFixes.set(actualPath, importedPath);
      }
    }
    
    // Pattern 2: TS1149 - first path is the actual file, second is the "already included" (import)
    while ((match = casingPattern2.exec(errorOutput)) !== null) {
      const actualPath = match[1]; // This is what exists on disk (lowercase)
      const importedPath = match[2]; // This is what's imported (PascalCase)
      
      const importedFileName = importedPath.split('/').pop() || '';
      const actualFileName = actualPath.split('/').pop() || '';
      
      // If imported is PascalCase and actual is lowercase, rename actual to imported
      if (importedFileName && importedFileName[0] === importedFileName[0].toUpperCase() && 
          actualFileName && actualFileName[0] === actualFileName[0].toLowerCase()) {
        casingFixes.set(actualPath, importedPath);
      }
    }
    
    if (casingFixes.size === 0) {
      return false;
    }
    
    console.log(`🔧 Fixing ${casingFixes.size} file casing error(s)...`);
    
    let anyFixed = false;
    
    for (const [lowercasePath, pascalCasePath] of Array.from(casingFixes.entries())) {
      try {
        // Normalize paths
        const sourcePath = lowercasePath.startsWith('/workspace/') ? lowercasePath : `/workspace/${lowercasePath}`;
        const targetPath = pascalCasePath.startsWith('/workspace/') ? pascalCasePath : `/workspace/${pascalCasePath}`;
        
        // Check if source file exists
        try {
          const fileContent = await context.sandbox.fs.downloadFile(sourcePath);
          
          // Create target directory if it doesn't exist
          const targetDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
          await context.sandbox.process.executeCommand(`mkdir -p "${targetDir}"`);
          
          // Write file with PascalCase name
          await context.sandbox.fs.uploadFile(fileContent, targetPath);
          
          // Delete lowercase file
          await context.sandbox.process.executeCommand(`rm -f "${sourcePath}"`);
          
          console.log(`✅ Renamed ${sourcePath} to ${targetPath}`);
          
          // Update imports in all files that reference the old path
          // Find all files that might import this component
          const findResult = await context.sandbox.process.executeCommand(
            'cd /workspace && find src -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*" 2>/dev/null || true'
          );
          
          const sourceFiles = (findResult.result || '')
            .trim()
            .split('\n')
            .filter((f: string) => f && f.startsWith('src/'));
          
          const componentName = (lowercasePath.split('/').pop() || '').replace(/\.tsx?$/, '');
          const pascalComponentName = (pascalCasePath.split('/').pop() || '').replace(/\.tsx?$/, '');
          
          for (const filePath of sourceFiles) {
            try {
              const fullPath = `/workspace/${filePath}`;
              const content = await context.sandbox.fs.downloadFile(fullPath);
              let fileContent = content.toString('utf-8');
              let modified = false;
              
              // Update import paths - replace lowercase component name with PascalCase
              // Handle @/components/header -> @/components/Header
              if (fileContent.includes(`@/components/${componentName}`) || 
                  fileContent.includes(`'@/components/${componentName}'`) ||
                  fileContent.includes(`"@/components/${componentName}"`)) {
                fileContent = fileContent.replace(
                  new RegExp(`@/components/${componentName}`, 'g'),
                  `@/components/${pascalComponentName}`
                );
                modified = true;
              }
              
              // Handle relative imports like ./components/header or ../components/header
              const relativeImportPattern = new RegExp(`(['"\`])(\\.\\.?/.*components/)${componentName}(['"\`])`, 'g');
              if (relativeImportPattern.test(fileContent)) {
                fileContent = fileContent.replace(
                  relativeImportPattern,
                  `$1$2${pascalComponentName}$3`
                );
                modified = true;
              }
              
              if (modified) {
                await context.sandbox.fs.uploadFile(Buffer.from(fileContent), fullPath);
                console.log(`✅ Updated imports in ${filePath}`);
              }
            } catch (error: any) {
              // Skip files we can't read/write
            }
          }
          
          anyFixed = true;
        } catch (error: any) {
          // File might not exist, try the other way
          console.warn(`⚠️ Could not fix casing for ${sourcePath}:`, error.message);
        }
      } catch (error: any) {
        console.warn(`⚠️ Error fixing casing for ${lowercasePath}:`, error.message);
      }
    }
    
    return anyFixed;
  } catch (error: any) {
    console.warn('⚠️ Error in fixFileCasingErrors:', error.message);
    return false;
  }
}

/**
 * AI-based auto-fix using Gemini to fix any TypeScript/build errors
 * This is a general approach that can handle any error type
 */
async function aiBasedAutoFix(
  context: ToolContext,
  errorOutput: string
): Promise<boolean> {
  if (!context.sandbox) return false;
  
  try {
    // Import Gemini (lazy import to avoid issues if not available)
    const { GoogleGenAI } = await import('@google/genai');
    const gemini = new GoogleGenAI({
      apiKey: process.env.GEMINI_KEY
    });
    
    // Parse errors to extract file paths and error messages
    const errorPattern = /([\w\/\.-]+)\((\d+),(\d+)\): error (TS\d+): (.+)/g;
    const errors: Array<{ file: string; line: number; col: number; code: string; message: string }> = [];
    
    let match;
    while ((match = errorPattern.exec(errorOutput)) !== null) {
      errors.push({
        file: match[1].replace(/^src\//, 'src/'),
        line: parseInt(match[2], 10),
        col: parseInt(match[3], 10),
        code: match[4],
        message: match[5]
      });
    }
    
    if (errors.length === 0) {
      console.log('⚠️ No parseable errors found for AI fix');
      return false;
    }
    
    // Group errors by file
    const errorsByFile = new Map<string, typeof errors>();
    for (const error of errors) {
      if (!errorsByFile.has(error.file)) {
        errorsByFile.set(error.file, []);
      }
      errorsByFile.get(error.file)!.push(error);
    }
    
    console.log(`🤖 AI fixing ${errorsByFile.size} file(s) with errors...`);
    
    let anyFixed = false;
    
    // Fix each file with errors
    for (const [filePath, fileErrors] of Array.from(errorsByFile.entries())) {
      try {
        const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
        
        // Read the file
        const fileContent = await context.sandbox.fs.downloadFile(fullPath);
        const content = fileContent.toString('utf-8');
        
        // Prepare error summary for this file
        const errorSummary = fileErrors
          .map((e: { file: string; line: number; col: number; code: string; message: string }) => `Line ${e.line}, Col ${e.col}: [${e.code}] ${e.message}`)
          .join('\n');
        
        // Create AI prompt to fix errors
        const fixPrompt = `Fix the TypeScript errors in this file. Return ONLY the corrected code, no explanations, no markdown formatting.

FILE: ${filePath}

ERRORS:
${errorSummary}

CURRENT CODE:
\`\`\`typescript
${content}
\`\`\`

RULES:
- Fix all errors listed above
- Maintain the same functionality and structure
- Ensure valid TypeScript/JSX syntax
- Do NOT add comments or explanations
- Return ONLY the fixed code without markdown code fences
- Preserve imports and exports
- Fix syntax errors like invalid characters, unterminated strings, etc.`;

        const response = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ text: fixPrompt }],
          config: {
            systemInstruction: 'You are a TypeScript/React expert. Fix compilation errors precisely. Return only the corrected code without markdown or explanations.',
            temperature: 0.2,
            maxOutputTokens: 8000
          }
        });
        
        const fixedCode = response.text?.trim() || '';
        
        if (!fixedCode || fixedCode.length < 50) {
          console.warn(`⚠️ AI returned empty or too short fix for ${filePath}`);
          continue;
        }
        
        // Clean up the response (remove markdown code fences if present)
        let cleanedCode = fixedCode
          .replace(/```tsx?\n?/g, '')
          .replace(/```typescript\n?/g, '')
          .replace(/```\n?/g, '')
          .replace(/^FILE:.*$/gm, '')
          .trim();
        
        // Unescape content in case it has escaped characters
        cleanedCode = unescapeContent(cleanedCode);
        
        // Write fixed file
        await context.sandbox.fs.uploadFile(Buffer.from(cleanedCode), fullPath);
        console.log(`✅ AI fixed ${filePath} (${fileErrors.length} error(s))`);
        anyFixed = true;
        
      } catch (error: any) {
        console.warn(`⚠️ Could not AI-fix ${filePath}:`, error.message);
      }
    }
    
    return anyFixed;
  } catch (error: any) {
    console.warn(`⚠️ AI-based auto-fix failed:`, error.message);
    return false;
  }
}

/**
 * Compile individual components/files to catch errors early
 * Similar to the sequential workflow's component-level compilation
 */
async function compileComponent(
  context: ToolContext,
  filePath: string
): Promise<{ success: boolean; errors: string }> {
  if (!context.sandbox) {
    return { success: false, errors: 'Sandbox not available' };
  }
  
  try {
    // Use TypeScript compiler to check just this file
    // We'll compile all files but only show errors for this specific file
    const fullPath = filePath.startsWith('/workspace/') ? filePath : `/workspace/${filePath}`;
    
    // Run tsc on just this file (or all files and filter)
    const result = await context.sandbox.process.executeCommand(
      `cd /workspace && npx tsc --noEmit ${fullPath} 2>&1 || true`
    );
    
    // Filter errors to only show errors for this file
    const output = result.result || '';
    const fileErrors = output
      .split('\n')
      .filter((line: string) => line.includes(filePath))
      .join('\n');
    
    const hasErrors = fileErrors.includes('error TS');
    
    return {
      success: !hasErrors,
      errors: fileErrors
    };
  } catch (error: any) {
    return {
      success: false,
      errors: error.message || 'Compilation check failed'
    };
  }
}

/**
 * Pre-compile all source files to catch errors before full build
 */
async function preCompileSourceFiles(context: ToolContext): Promise<{ fixed: boolean; errors: string[] }> {
  if (!context.sandbox) return { fixed: false, errors: [] };
  
  try {
    console.log('🔍 Pre-compiling source files...');
    
    // Find all TypeScript/TSX files
    const findResult = await context.sandbox.process.executeCommand(
      'cd /workspace && find src -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*" 2>/dev/null || true'
    );
    
    const sourceFiles = (findResult.result || '')
      .trim()
      .split('\n')
      .filter((f: string) => f && f.startsWith('src/'))
      .slice(0, 50); // Limit to 50 files to avoid timeout
    
    if (sourceFiles.length === 0) {
      return { fixed: false, errors: [] };
    }
    
    console.log(`🔍 Checking ${sourceFiles.length} source file(s) for errors...`);
    
    // Run TypeScript check on all files
    const tscResult = await context.sandbox.process.executeCommand(
      'cd /workspace && npx tsc --noEmit 2>&1 || true'
    );
    
    const errorOutput = tscResult.result || '';
    const hasErrors = errorOutput.includes('error TS');
    
    if (hasErrors) {
      // Try to fix errors using AI
      console.log('⚠️ Pre-compilation errors found, attempting fixes...');
      const aiFixed = await aiBasedAutoFix(context, errorOutput);
      
      if (aiFixed) {
        // Re-check after fixes
        const recheckResult = await context.sandbox.process.executeCommand(
          'cd /workspace && npx tsc --noEmit 2>&1 || true'
        );
        const recheckOutput = recheckResult.result || '';
        const stillHasErrors = recheckOutput.includes('error TS');
        
        return {
          fixed: aiFixed && !stillHasErrors,
          errors: stillHasErrors ? recheckOutput.split('\n').filter((l: string) => l.includes('error TS')) : []
        };
      }
      
      return {
        fixed: false,
        errors: errorOutput.split('\n').filter((l: string) => l.includes('error TS'))
      };
    }
    
    return { fixed: true, errors: [] };
  } catch (error: any) {
    console.warn(`⚠️ Pre-compilation check failed:`, error.message);
    return { fixed: false, errors: [error.message] };
  }
}

/**
 * Build project after tool calls
 */
export async function buildAndUploadProject(
  context: ToolContext,
  userId: string
): Promise<{ url: string; buildHash: string } | null> {
  try {
    if (!context.sandbox) {
      throw new Error('Sandbox not available');
    }

    // Validate and fix package.json before installing dependencies
    console.log('🔍 Validating package.json...');
    const packageJsonFixed = await validateAndFixPackageJson(context);
    if (packageJsonFixed) {
      console.log('✅ Fixed malformed package.json');
    }

    // Install dependencies
    console.log('📦 Installing dependencies...');
    const installResult = await context.sandbox.process.executeCommand(
      'cd /workspace && npm install'
    );
    if (installResult.exitCode !== 0) {
      // Try to fix package.json if installation fails due to JSON parse error
      if (installResult.result.includes('JSON.parse') || installResult.result.includes('EJSONPARSE')) {
        console.log('⚠️ package.json parse error detected, attempting to fix...');
        const fixed = await validateAndFixPackageJson(context);
        if (fixed) {
          console.log('✅ Fixed package.json, retrying installation...');
          const retryResult = await context.sandbox.process.executeCommand(
            'cd /workspace && npm install'
          );
          if (retryResult.exitCode !== 0) {
            throw new Error(`Dependency installation failed after fix: ${retryResult.result}`);
          }
        } else {
          throw new Error(`Dependency installation failed: ${installResult.result}`);
        }
      } else {
        throw new Error(`Dependency installation failed: ${installResult.result}`);
      }
    }

    // Validate and fix config files FIRST (before pre-compilation)
    await validateAndFixConfigFiles(context);

    // Normalize duplicate components/pages before further checks
    await normalizeComponentDuplicates(context);

    // Enforce canonical template component usage
    await enforceCanonicalComponentImports(context);

    // Ensure every page has a matching route entry
    await ensurePageRoutes(context);

    // Download remote images referenced by components into public assets
    await localizeRemoteImages(context);

    // Ensure critical components exist (Header, Footer, Hero, etc.)
    await ensureCriticalComponents(context);

    // Validate and fix App.tsx routing (ensure default route is first)
    await validateAppRouting(context);

    // Fix FeatureCard usage (zero-props violation)
    await fixFeatureCardUsage(context);

    // Pre-compile source files to catch errors early (component-level)
    const preCompileResult = await preCompileSourceFiles(context);
    if (preCompileResult.fixed) {
      console.log('✅ All source files compiled successfully');
    } else if (preCompileResult.errors.length > 0) {
      console.warn(`⚠️ Pre-compilation found ${preCompileResult.errors.length} error(s), but continuing to full build...`);
    }

    // Validate imports before building
    console.log('🔍 Validating imports...');
    const importValidation = await validateImports(context);
    if (!importValidation.valid) {
      console.warn('⚠️ Import validation errors found:');
      importValidation.errors.forEach(err => console.warn(`  - ${err}`));
      // Don't fail yet - let TypeScript check catch it and we'll try to fix
    } else {
      console.log('✅ All imports validated');
    }

    // TypeScript check
    console.log('🔍 Running TypeScript check...');
    const tscResult = await context.sandbox.process.executeCommand(
      'cd /workspace && npx tsc --noEmit'
    );
    if (tscResult.exitCode !== 0) {
      console.warn('⚠️ TypeScript errors found:', tscResult.result);
      // Try to auto-fix common errors
      await autoFixTypeScriptErrors(context, tscResult.result);
      
      // Also try AI-based fix if pattern-based fixes didn't work
      const aiFixed = await aiBasedAutoFix(context, tscResult.result);
      if (aiFixed) {
        console.log('✅ AI fixes applied after TypeScript check');
      }
    }

    // Config files already validated above, but re-validate before build
    await validateAndFixConfigFiles(context);

    // Build project
    console.log('🔨 Building project...');
    let buildResult = await context.sandbox.process.executeCommand(
      'cd /workspace && npm run build'
    );
    if (buildResult.exitCode !== 0) {
      // Try auto-fixing build errors
      console.log('🔧 Attempting to auto-fix build errors...');
      
      // Check for config errors first (PostCSS, Tailwind, etc.)
      const configFixed = await autoFixConfigErrors(context, buildResult.result);
      if (configFixed) {
        console.log('✅ Config errors fixed, retrying build...');
        buildResult = await context.sandbox.process.executeCommand(
          'cd /workspace && npm run build'
        );
      }
      
      // Check for file casing errors (TS1261, TS1149) - must be fixed before other errors
      if (buildResult.exitCode !== 0) {
        const casingFixed = await fixFileCasingErrors(context, buildResult.result);
        if (casingFixed) {
          console.log('✅ File casing errors fixed, retrying build...');
          buildResult = await context.sandbox.process.executeCommand(
            'cd /workspace && npm run build'
          );
        }
      }
      
      // Check for JSX syntax errors
      if (buildResult.exitCode !== 0) {
        const jsxFixed = await autoFixJSXErrors(context, buildResult.result);
        if (jsxFixed) {
          console.log('✅ JSX errors fixed, retrying build...');
          buildResult = await context.sandbox.process.executeCommand(
            'cd /workspace && npm run build'
          );
        }
      }
      
      // If still failing, try TypeScript import fixes
      if (buildResult.exitCode !== 0) {
        await autoFixTypeScriptErrors(context, buildResult.result);
        
        // Retry build again
        buildResult = await context.sandbox.process.executeCommand(
          'cd /workspace && npm run build'
        );
      }
      
      // If still failing, try AI-based auto-fix (general approach)
      if (buildResult.exitCode !== 0) {
        console.log('🤖 Attempting AI-based auto-fix for remaining errors...');
        const aiFixed = await aiBasedAutoFix(context, buildResult.result);
        if (aiFixed) {
          console.log('✅ AI fixes applied, retrying build...');
          buildResult = await context.sandbox.process.executeCommand(
            'cd /workspace && npm run build'
          );
        }
      }
      
      if (buildResult.exitCode !== 0) {
        console.error('❌ Build failed after all auto-fix attempts');
        console.error('Build error output:', buildResult.result);
        throw new Error(`Build failed: ${buildResult.result}`);
      }
    }

    // Collect build files
    console.log('📁 Collecting build files...');
    const listResult = await context.sandbox.process.executeCommand(
      'cd /workspace && find dist -type f'
    );
    if (!listResult.result) {
      throw new Error('No build files found');
    }

    const distFiles = listResult.result
      .trim()
      .split('\n')
      .filter((f: string) => f && f.startsWith('dist/'));

    const buildFiles: Array<{ path: string; content: Buffer }> = [];
    for (const filePath of distFiles) {
      const content = await context.sandbox.fs.downloadFile(`/workspace/${filePath}`);
      const relativePath = filePath.replace('dist/', '');
      buildFiles.push({
        path: relativePath,
        content: content as Buffer,
      });
    }

    // Upload to storage
    console.log('📤 Uploading to storage...');
    const { uploadBuild } = await import('@/lib/storage');
    const uploadResult = await uploadBuild(userId, context.projectId, buildFiles);

    console.log('✅ Build complete');
    return uploadResult;
  } catch (error: any) {
    console.error('Build error:', error);
    return null;
  }
}

